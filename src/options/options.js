'use strict';

/*
 * Options page. Every control carries data-pref="<preference>" and is saved as soon as it
 * changes; radio buttons map to a group of boolean preferences (the format the extension has
 * always used).
 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let prefs = prefDefaults.complete({});

// ---------- helpers ----------

function el(tag, attrs = {}, ...children) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		if (key === 'class') { node.className = value; }
		else if (key === 'style') {
			for (const [prop, v] of Object.entries(value)) {
				if (prop.startsWith('--')) { node.style.setProperty(prop, v); } else { node.style[prop] = v; }
			}
		}
		else if (key === 'text') { node.textContent = value; }
		else if (key.startsWith('on')) { node.addEventListener(key.slice(2), value); }
		else if (value !== false && value !== null && value !== undefined) { node.setAttribute(key, value === true ? '' : value); }
	}
	for (const child of children.flat()) {
		if (child !== null && child !== undefined && child !== false) { node.append(child); }
	}
	return node;
}

function iconUrl(name) {
	return '../../icons/' + name;
}

// an svg icon from /icons painted with 'color' through a css mask
function maskIcon(name, color, size) {
	return el('span', {
		class: 'pv-icon',
		style: { '--icon': 'url("' + iconUrl(name + '.svg') + '")', '--icon-color': color, width: size + 'px', height: size + 'px' }
	});
}

let toastTimer = null;
function toast(text, isError = false) {
	const box = $('#toast');
	box.textContent = text;
	box.classList.toggle('error', isError);
	box.classList.add('show');
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => box.classList.remove('show'), isError ? 4000 : 1600);
}

function confirmDialog(text) {
	const dialog = $('#confirmDialog');
	$('#confirmText').textContent = text;
	dialog.returnValue = '';
	dialog.showModal();
	$('#confirmOk').focus();
	return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true }));
}

async function save(values, quiet = false) {
	Object.assign(prefs, values);
	try {
		await chrome.storage.local.set(values);
		if (!quiet) { toast(cmn.msg('txtPrefSaved')); }
	} catch (err) {
		toast(String(err && err.message || err), true);
	}
	updateDependents();
	renderPreviews();
}

// ---------- localization ----------

function localize() {
	for (const node of $$('[data-i18n]')) {
		const text = chrome.i18n.getMessage(node.dataset.i18n);
		if (text) { node.textContent = text; }
	}
	for (const node of $$('[data-i18n-placeholder]')) {
		node.placeholder = chrome.i18n.getMessage(node.dataset.i18nPlaceholder) || '';
	}
	for (const node of $$('[data-hold]')) {
		node.textContent = cmn.msg('txtPrefHold') + ' … ' + cmn.msg(node.dataset.hold);
	}
	document.documentElement.lang = chrome.i18n.getUILanguage();
	document.documentElement.dir = chrome.i18n.getMessage('@@bidi_dir') || 'ltr';
	document.title = 'SelectionSK · ' + cmn.msg('txtPrefPreferences');
	const version = chrome.runtime.getManifest().version;
	$('#version').textContent = 'v' + version;
	$('#aboutVersion').textContent = version;
}

// ---------- controls ----------

const SOURCES = {
	lng: [const_lng, const_lng.L],
	trans: [const_def_trans, const_def_trans.T],
	keys: [const_keys, const_keys.K],
	cur: [const_cur, const_cur.C],
	temp: [const_temp, const_temp.T],
	mass: [const_mass, const_mass.M],
	len: [const_len, const_len.L]
};

function fillSelects() {
	for (const select of $$('select[data-source]')) {
		const [obj, items] = SOURCES[select.dataset.source];
		select.textContent = '';
		for (const key of Object.keys(items)) {
			select.append(el('option', { value: key, text: obj.getDescription(key) }));
		}
	}
}

function buildHighlighter() {
	const grid = $('#hlGrid');
	grid.textContent = '';
	for (let i = 0; i < 10; i++) {
		const letter = String.fromCharCode(65 + i);
		grid.append(el('div', { class: 'hl-tile' },
			el('span', { class: 'hl-sample', id: 'hlSample_' + i, text: letter + ' · Aa' }),
			el('input', { type: 'color', class: 'color', 'data-pref': 'prefBkColor_' + i, title: cmn.msg('txtPrefBkColor'), 'aria-label': letter + ' ' + cmn.msg('txtPrefBkColor') }),
			el('input', { type: 'color', class: 'color', 'data-pref': 'prefTxColor_' + i, title: cmn.msg('txtPrefColor'), 'aria-label': letter + ' ' + cmn.msg('txtPrefColor') })
		));
	}
}

function renderHighlighter() {
	for (let i = 0; i < 10; i++) {
		const sample = $('#hlSample_' + i);
		sample.style.background = prefs['prefBkColor_' + i];
		sample.style.color = prefs['prefTxColor_' + i];
	}
}

function bindControls() {
	for (const input of $$('[data-pref]')) {
		const key = input.dataset.pref;
		if (input.type === 'radio') {
			input.addEventListener('change', function () {
				if (!input.checked) { return; }
				const values = {};
				for (const radio of $$('input[type=radio][name="' + input.name + '"]')) { values[radio.dataset.pref] = radio === input; }
				save(values);
			});
		} else if (input.type === 'checkbox') {
			input.addEventListener('change', () => save({ [key]: input.checked }));
		} else if (input.type === 'color') {
			// live preview while dragging, save when the picker closes
			input.addEventListener('input', function () {
				prefs[key] = input.value;
				renderPreviews();
				renderHighlighter();
			});
			input.addEventListener('change', () => save({ [key]: input.value }));
		} else if (input.type === 'number') {
			const commit = function () {
				let n = Number(input.value);
				if (!Number.isFinite(n) || input.value === '') { n = prefDefaults.DEFAULTS[key]; }
				n = Math.min(Math.max(n, Number(input.min || -Infinity)), Number(input.max || Infinity));
				input.value = n;
				if (n !== Number(prefs[key])) { save({ [key]: n }); }
			};
			input.addEventListener('input', function () {
				const n = Number(input.value);
				if (input.value !== '' && Number.isFinite(n)) { prefs[key] = n; renderPreviews(); }
			});
			input.addEventListener('change', commit);
		} else if (input.tagName === 'SELECT') {
			input.addEventListener('change', () => save({ [key]: input.value }));
		} else {
			input.addEventListener('change', function () {
				const value = input.value.trim();
				if (key === 'prefBookmarkFolder' && !value) { input.value = prefs[key]; return; }
				input.value = value;
				save({ [key]: value });
			});
		}
	}
}

function render() {
	for (const input of $$('[data-pref]')) {
		const value = prefs[input.dataset.pref];
		if (input.type === 'radio' || input.type === 'checkbox') { input.checked = !!value; }
		else if (input.type === 'color') { input.value = cmn.toHex(value); }
		else { input.value = value === undefined ? '' : value; }
	}
	renderHighlighter();
	renderLanguages();
	renderSites();
	updateDependents();
	renderPreviews();
}

// rows that only matter when another switch is on
function updateDependents() {
	for (const row of $$('[data-depends]')) {
		row.classList.toggle('disabled', !prefs[row.dataset.depends]);
	}
}

// ---------- languages ----------

function buildLanguages() {
	const list = $('#lngList');
	list.textContent = '';
	for (const code of Object.keys(const_lng.L)) {
		const lng = const_lng.L[code];
		list.append(el('label', { 'data-text': (lng.name + ' ' + lng.native_name + ' ' + code).toLowerCase() },
			el('input', { type: 'checkbox', value: code, onchange: saveLanguages }),
			el('span', { text: lng.name }),
			lng.native_name ? el('small', { text: lng.native_name }) : null
		));
	}
	$('#lngAll').addEventListener('change', function () {
		const checked = $$('#lngList input:checked').map(i => i.value);
		if (!this.checked && !checked.length) {
			// start from the destination language rather than from nothing
			const box = $('#lngList input[value="' + prefs.prefTranslationDestLng + '"]');
			if (box) { box.checked = true; }
		}
		saveLanguages();
	});
	$('#lngFilter').addEventListener('input', function () {
		const q = this.value.trim().toLowerCase();
		for (const label of $$('#lngList label')) { label.hidden = !!q && !label.dataset.text.includes(q); }
	});
}

function saveLanguages() {
	const all = $('#lngAll').checked;
	const selected = $$('#lngList input:checked').map(i => i.value);
	save({ prefTranslationSelectedLng: all || !selected.length ? ['all'] : selected });
	renderLanguages();
}

function renderLanguages() {
	const selected = Array.isArray(prefs.prefTranslationSelectedLng) ? prefs.prefTranslationSelectedLng : ['all'];
	const all = selected.includes('all');
	$('#lngAll').checked = all;
	$('#lngList').classList.toggle('all', all);
	for (const box of $$('#lngList input')) { box.checked = !all && selected.includes(box.value); }
	$('#lngCount').textContent = all ? cmn.msg('txtPrefAllLanguages') : cmn.msg('txtPrefLanguagesSelected', [String(selected.length)]);
}

// ---------- disabled sites ----------

function renderSites() {
	const list = $('#siteList');
	list.textContent = '';
	const sites = Array.isArray(prefs.prefBlacklist) ? prefs.prefBlacklist : [];
	for (const site of sites) {
		list.append(el('li', {},
			el('img', { src: cmn.getTxtLetterIcon(site || '?'), alt: '' }),
			el('span', { text: site || '(local files)', title: site }),
			el('button', {
				type: 'button', class: 'icon-btn', title: cmn.msg('txtPrefRemove'), 'aria-label': cmn.msg('txtPrefRemove') + ' ' + site, text: '×',
				onclick: () => save({ prefBlacklist: sites.filter(s => s !== site) }).then(renderSites)
			})
		));
	}
	$('#siteListEmpty').hidden = sites.length > 0;
}

// ---------- keyboard shortcuts ----------

async function renderCommands() {
	const box = $('#commandList');
	box.textContent = '';
	const labels = { page_translate: 'txtTranslatePage', conversion: 'txtShowConverter' };
	let commands = [];
	try { commands = await chrome.commands.getAll(); } catch (ex) { cmn.log(ex); }
	for (const command of commands) {
		if (!labels[command.name] && !command.description) { continue; }
		box.append(el('div', { class: 'row' },
			el('div', { class: 'row-text' }, el('div', { class: 'row-label', text: labels[command.name] ? cmn.msg(labels[command.name]) : command.description })),
			el('div', { class: 'row-control' }, command.shortcut
				? el('kbd', { text: command.shortcut })
				: el('span', { class: 'not-set', text: cmn.msg('txtPrefNotSet') }))
		));
	}
}

// ---------- previews ----------

function renderPreviews() {
	renderMenuPreview();
	renderPanelPreview();
	renderTranslationPreview();
	renderConverterPreview();
}

function renderMenuPreview() {
	const menu = $('#pvMenu');
	const size = Number(prefs.prefMenuFontSize) || 15;
	const iconColor = prefs.prefMenuIconsColor;
	menu.style.background = prefs.prefMenuBkColor;
	menu.style.color = prefs.prefMenuFontColor;
	menu.style.fontSize = size + 'px';
	const item = function (label, icon, opts = {}) {
		const img = !icon ? el('span', { style: { width: (size + 1) + 'px', height: (size + 1) + 'px', display: 'inline-block' } })
			: icon.endsWith('.png') || icon.endsWith('.svg') ? el('img', { src: iconUrl(icon), alt: '', width: size + 1, height: size + 1 })
				: maskIcon(icon, opts.hover ? '#ffffff' : iconColor, size + 1);
		return el('li', { class: (opts.hover ? 'hover ' : '') + (opts.sub ? 'sub' : ''), style: { minHeight: (size + 9) + 'px' } }, img, el('span', { text: label }));
	};
	menu.replaceChildren(
		item(cmn.msg('txtCopy'), 'copy'),
		item(cmn.msg('txtCopyPlain'), 'copy_plain'),
		el('li', { class: 'sep' }),
		item(cmn.msg('txtLngTools'), 'lng_tools', { sub: true }),
		item(cmn.msg('txtHighlight'), 'highlight', { hover: true }),
		item(cmn.msg('txtConvert'), 'convert'),
		el('li', { class: 'sep' }),
		item('StartPage', 'favicons/www.startpage.com.png'),
		item(cmn.msg('txtInitSearch'), null, { sub: true })
	);
}

function renderPanelPreview() {
	const panel = $('#pvPanel');
	const iconSize = Number(prefs.prefPanelIconSize) || 18;
	const pad = Number(prefs.prefPanelIconPadding) || 0;
	const color = prefs.prefPanelIconsColor;
	panel.style.background = prefs.prefPanelBkColor;
	panel.style.padding = (Number(prefs.prefPanelPadding) || 0) + 'px';
	panel.style.borderRadius = (Number(prefs.prefPanelRoundness) || 0) + 'px';

	const SEP = 'sep';
	const items = ['copy', 'copy_plain', SEP, 'favicons/translate.google.com.svg', 'favicons/ms.translate.png', SEP,
		'highlight', 'convert', 'mailto', SEP, 'favicons/www.startpage.com.png', 'favicons/www.google.com.png'];
	const icons = items.filter(i => i !== SEP);
	let size = Number(prefs.prefPanelItemsN) || 0;
	if (size <= 0) { size = icons.length; }
	else if (prefs.prefPanelItemsNRows) { size = Math.ceil(icons.length / size); }

	const rows = [];
	let row = null, count = 0, sepPending = false;
	for (const it of items) {
		if (it === SEP) { sepPending = true; continue; }
		if (count % size === 0) { row = el('span', { class: 'pv-panel-row' }); rows.push(row); sepPending = false; }
		if (sepPending) { row.append(el('span', { class: 'pv-panel-sep', style: { height: (iconSize + 2 * pad) + 'px' } })); sepPending = false; }
		const content = it.startsWith('favicons/') ? el('img', { src: iconUrl(it), alt: '' }) : maskIcon(it, color, iconSize);
		row.append(el('span', { class: 'pv-panel-item' + (count === 4 ? ' hover' : ''), style: { width: iconSize + 'px', height: iconSize + 'px', padding: pad + 'px' } }, content));
		count++;
	}
	panel.replaceChildren(...rows);
}

function renderTranslationPreview() {
	const box = $('#pvTranslation');
	const size = Number(prefs.prefTranslationFontSize) || 14;
	const icon = prefs.prefTransIconsColor;
	const btn = name => maskIcon(name, icon, size + 2);
	box.style.background = prefs.prefTranslationBkColor;
	box.style.borderColor = prefs.prefTranslationBorderColor;
	box.style.color = prefs.prefTranslationFontColor;
	box.style.fontSize = size + 'px';
	const lng = { style: { color: prefs.prefTranslationLngColor, fontSize: (size - 2) + 'px' } };
	box.replaceChildren(
		el('div', { class: 'pv-bar' },
			btn('open_url'), btn('copy_plain'),
			el('span', Object.assign({ text: const_lng.getNativeName('en') }, lng)),
			btn('reverse'),
			el('span', Object.assign({ text: const_lng.getNativeName(prefs.prefTranslationDestLng === 'en' ? 'de' : prefs.prefTranslationDestLng) }, lng)),
			el('span', { text: cmn.msg('txtGoogleTranslate'), style: { color: prefs.prefTranslationEngineColor, fontSize: (size - 2) + 'px' } }),
			el('span', { class: 'grow' }),
			btn('close')
		),
		el('div', { class: 'pv-orig' }, btn('play'), el('span', { text: 'selection [sɪˈlɛkʃən]' })),
		el('div', { class: 'pv-line' }, btn('play'), el('span', { text: 'Auswahl' })),
		el('div', { class: 'pv-line' }, el('em', { class: 'pv-em', text: 'noun:', style: { color: icon } }), el('span', { text: 'Auswahl, Selektion, Wahl' }))
	);
}

function renderConverterPreview() {
	const box = $('#pvConverter');
	const size = Number(prefs.prefConversionFontSize) || 14;
	const unit = prefs.prefConversionUnitColor;
	const btn = name => maskIcon(name, prefs.prefConversionIconsColor, size + 2);
	box.style.background = prefs.prefConversionBkColor;
	box.style.borderColor = prefs.prefConversionBorderColor;
	box.style.color = prefs.prefConversionFontColor;
	box.style.fontSize = size + 'px';
	const value = text => el('span', { class: 'pv-input', text: text, style: { borderColor: unit, color: prefs.prefConversionFontColor } });
	box.replaceChildren(
		el('div', { class: 'pv-bar' },
			el('span', { text: cmn.msg('txtConvTemperature'), style: { color: prefs.prefConversionConverterColor } }),
			el('span', { class: 'grow' }),
			btn('close')
		),
		el('div', { class: 'pv-bar', style: { marginTop: '10px' } },
			value('100'), el('span', { text: const_temp.getDescription('C'), style: { color: unit } }),
			btn('reverse'),
			value('212'), el('span', { text: const_temp.getDescription('F'), style: { color: unit } })
		)
	);
}

// ---------- navigation & search ----------

function setupNavigation() {
	const links = $$('#sidenav a');
	const byId = Object.fromEntries(links.map(a => [a.getAttribute('href').slice(1), a]));
	const visible = new Map();
	const observer = new IntersectionObserver(function (entries) {
		for (const entry of entries) { visible.set(entry.target.id, entry.isIntersecting); }
		const current = $$('main .section').find(s => visible.get(s.id) && !s.hidden);
		if (current) {
			links.forEach(a => a.classList.toggle('active', a === byId[current.id]));
		}
	}, { rootMargin: '-25% 0px -65% 0px' });
	$$('main .section').forEach(s => observer.observe(s));
	links[0].classList.add('active');
}

// text a row can be found by (labels, hints and choices, not the options of its selects)
function searchText(node) {
	if (node.dataset.search === undefined) {
		const parts = $$('.row-label, .row-hint, .chip span, .segmented span, .btn', node).map(n => n.textContent);
		if (node.classList.contains('card-title')) { parts.push(node.textContent); }
		node.dataset.search = parts.join(' ').toLowerCase();
	}
	return node.dataset.search;
}

function applySearch(query) {
	const q = query.trim().toLowerCase();
	let anySection = false;
	for (const section of $$('main .section')) {
		const title = $('h2', section).textContent.toLowerCase();
		const sectionMatch = !q || title.includes(q);
		let sectionVisible = false;
		for (const card of $$('.card', section)) {
			const cardTitle = $('.card-title', card);
			const cardMatch = sectionMatch || (cardTitle && searchText(cardTitle).includes(q));
			let cardVisible = false;
			for (const row of $$('.row', card)) {
				const show = cardMatch || searchText(row).includes(q);
				row.hidden = !show;
				cardVisible = cardVisible || show;
			}
			if (card.classList.contains('about')) { cardVisible = sectionMatch; }
			card.hidden = !cardVisible;
			const heading = card.previousElementSibling;
			if (heading && heading.tagName === 'H3') { heading.hidden = !cardVisible; }
			sectionVisible = sectionVisible || cardVisible;
		}
		const desc = $('.section-desc', section);
		if (desc) { desc.hidden = !sectionVisible; }
		section.hidden = !sectionVisible;
		anySection = anySection || sectionVisible;
		const link = $('#sidenav a[href="#' + section.id + '"]');
		if (link) { link.classList.toggle('dim', !sectionVisible); }
	}
	$('#noResults').hidden = anySection;
}

// ---------- maintenance ----------

async function backupToFile() {
	const data = await chrome.storage.local.get(null);
	for (const key of prefDefaults.INTERNAL) { delete data[key]; }
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
	const d = new Date();
	const pad = n => String(n).padStart(2, '0');
	const link = el('a', { href: URL.createObjectURL(blob), download: 'SelectionSK-backup-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json' });
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

async function restoreFromFile(file) {
	try {
		const values = prefDefaults.sanitize(JSON.parse(await file.text()));
		if (!Object.keys(values).length) { throw new Error('empty'); }
		await chrome.storage.local.set(values);
		prefs = prefDefaults.complete(await chrome.storage.local.get(null));
		render();
		toast(cmn.msg('txtPrefRestoreDone'));
	} catch (ex) {
		toast(cmn.msg('txtPrefRestoreError'), true);
	}
}

async function restoreDefaults() {
	if (!await confirmDialog(cmn.msg('txtPrefRestorePrefsQ'))) { return; }
	// the list of disabled sites and the api keys are not preferences: keep them
	const keep = {};
	for (const key of ['prefBlacklist', 'prefKeyWordnik', 'prefKeyCryptoCompare', 'prefKeyYandexDict']) { keep[key] = prefs[key]; }
	const values = Object.assign({}, prefDefaults.DEFAULTS, keep);
	await chrome.storage.local.set(values);
	prefs = prefDefaults.complete(values);
	render();
	toast(cmn.msg('txtPrefSaved'));
}

async function restoreBookmarks() {
	if (!await confirmDialog(cmn.msg('txtPrefRestoreBookmarksQ'))) { return; }
	const response = await chrome.runtime.sendMessage({ cmd: utils.CMD_RESTORE_BOOKMARKS });
	if (response && response.ok) { toast(cmn.msg('txtPrefSaved')); }
	else { toast(String(response && response.error || 'Error'), true); }
}

// ---------- start ----------

async function init() {
	localize();
	fillSelects();
	buildHighlighter();
	buildLanguages();
	prefs = prefDefaults.complete(await chrome.storage.local.get(null));
	bindControls();
	render();
	renderCommands();
	setupNavigation();

	$('#search').addEventListener('input', e => applySearch(e.target.value));
	$('#btnConfigureShortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
	$('#btnBackupToFile').addEventListener('click', backupToFile);
	$('#btnRestoreFromFile').addEventListener('click', () => $('#prefSelectedFile').click());
	$('#prefSelectedFile').addEventListener('change', function () {
		if (this.files[0]) { restoreFromFile(this.files[0]); }
		this.value = '';
	});
	$('#btnRestorePrefs').addEventListener('click', restoreDefaults);
	$('#btnRestoreBookmarks').addEventListener('click', restoreBookmarks);

	// sites can be turned off from the toolbar while this page is open
	chrome.storage.onChanged.addListener(function (changes, area) {
		if (area === 'local' && changes.prefBlacklist) {
			prefs.prefBlacklist = changes.prefBlacklist.newValue || [];
			renderSites();
		}
	});
	// shortcuts may have been changed on chrome://extensions/shortcuts
	document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderCommands(); } });

	if (location.hash) { const target = document.getElementById(location.hash.slice(1)); if (target) { target.scrollIntoView(); } }
}

document.addEventListener('DOMContentLoaded', init);
