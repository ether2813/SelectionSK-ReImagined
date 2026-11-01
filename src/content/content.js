'use strict';

/*
 * Content script: watches text selection and shows the SelectionSK popup (menu, pane or a small
 * button in unobtrusive mode), performs clipboard actions, highlighting and word counting.
 */

var sskPage = {
	prefs: prefDefaults.complete({}),
	selection: '',			// current selection as a string
	selectionHtml: '',		// current selection as html (when it holds markup)
	selectionObj: null,		// Selection object for selections in regular html
	textBox: null,			// text box the selection was made in
	email: '',				// e-mail address found in the selection
	urls: [],				// urls found in the selection
	event: null,			// mouse event that made the selection
	closeTimeout: null,
	buttonTimeout: null,
	copyData: null,			// data the next 'copy' event puts on the clipboard
	markCount: 0,			// number of highlighted matches
	markIdx: 0,				// color of the next highlight
	markCur: null,			// highlight selected with S/W
	holdKeyCode: null,		// key held down while selecting
	enteredSsk: false,		// mouse has been over SelectionSK ui
	zoom: 1.0,
	isTop: window === window.top
};

var SSK_UI_SELECTOR = '#ssk_id_popup, #ssk_id_button, #ssk_id_translation_panel, #ssk_id_converter_panel';

// ---------- messaging ----------

function sskSend(msg) {
	try {
		return chrome.runtime.sendMessage(msg).catch(function (err) { cmn.log(err); return null; });
	} catch (ex) {
		// the extension was reloaded or removed; this content script is orphaned
		return Promise.resolve(null);
	}
}

// ---------- initialization ----------

window.addEventListener('load', onLoad, true);
window.addEventListener('mouseup', onMouseUp, true);
window.addEventListener('mousedown', onMouseDown, true);
window.addEventListener('keyup', onKeyUp, true);
window.addEventListener('keydown', onKeyDown, true);
window.addEventListener('copy', onCopy, true);
window.addEventListener('scroll', onScroll);
chrome.runtime.onMessage.addListener(onExtensionMessage);
chrome.storage.onChanged.addListener(loadPrefs);

loadPrefs();
if (sskPage.isTop) { setBadgeText(); }

function loadPrefs() {
	try {
		chrome.storage.local.get(null).then(function (prefs) {
			sskPage.prefs = prefDefaults.complete(prefs);
		}, cmn.log);
	} catch (ex) { cmn.log(ex); }
}

async function onLoad(e) {
	if (e.target !== document) { return; }	// ignore load events of images etc. (captured)
	let prefs;
	try { prefs = prefDefaults.complete(await chrome.storage.local.get(null)); } catch (ex) { return; }
	if (isDisabledEx(prefs)) { return; }
	autoMark(prefs);
	enableTextSelection(prefs);
	mycroft.integrate();
}

// ---------- helpers ----------

function pageDomain() {
	if (location.host) { return location.host; }
	// about:blank and srcdoc frames inherit the site of their parent
	try { return window.parent.location.host || ''; } catch (ex) { return ''; }
}

function isDisabledEx(prefs) {
	try { return prefs.prefBlacklist.includes(pageDomain()); } catch (ex) { return false; }
}

function isDisabled() { return isDisabledEx(sskPage.prefs); }

function isSskElement(el) {
	return !!(el && el.nodeType === 1 && el.closest && el.closest(SSK_UI_SELECTOR));
}

function isEditable(el) {
	return !!(el && (el.isContentEditable || isTextBox(el) || (el.ownerDocument && el.ownerDocument.designMode === 'on')));
}

function isTextBoxDesignMode(e) {
	try {
		return (e.target.ownerDocument && e.target.ownerDocument.designMode === 'on') || e.target.isContentEditable === true;
	} catch (ex) { return false; }
}

function isTextBox(elem) {
	return (elem instanceof HTMLInputElement && ['text', 'search', 'password', 'url', 'email', 'tel'].includes(elem.type)) ||
		elem instanceof HTMLTextAreaElement;
}

function isGoogleCalendarDateTime(e) {
	try {
		if (e.target instanceof HTMLInputElement && e.target.type === 'text' && location.host === 'calendar.google.com') {
			const v = e.target.value;
			const idx1 = v.indexOf('am'), idx2 = v.indexOf('pm'), idx3 = v.indexOf(', 1'), idx4 = v.indexOf(', 2');
			return [4, 5].includes(idx1) || [4, 5].includes(idx2) || [5, 6].includes(idx3) || [5, 6].includes(idx4);
		}
	} catch (ex) { cmn.log(ex); }
	return false;
}

function isGoogleDocs() {
	return location.host === 'docs.google.com' || location.host === 'keep.google.com';
}

// fills '{title} ({URL})' with properties of the document
function getPageDetails(pattern) {
	return String(pattern || '').replace(/\{([^{}]+)\}/g, function (match, name) {
		try {
			const value = document[name];
			return value === undefined || value === null || typeof value === 'object' || typeof value === 'function' ? match : String(value);
		} catch (ex) { return match; }
	});
}

function onStopEvent(e) {
	e.preventDefault();
	e.stopPropagation();
	e.stopImmediatePropagation();
	return false;
}

// right click on SelectionSK ui performs alternative actions, so the page menu is suppressed while it is up
function blockContextMenu(block) {
	window.setTimeout(function () {
		if (block) { window.addEventListener('contextmenu', onStopEvent, true); }
		else { window.removeEventListener('contextmenu', onStopEvent, true); }
	}, utils.MOUSE_BUTTON_CLICK_DELAY_MS);
}

function clearTimers() {
	if (sskPage.closeTimeout) { window.clearTimeout(sskPage.closeTimeout); sskPage.closeTimeout = null; }
	if (sskPage.buttonTimeout) { window.clearTimeout(sskPage.buttonTimeout); sskPage.buttonTimeout = null; }
}

function hideAll() {
	clearTimers();
	hidePopup();
	translator.hideTranslation();
	converter.hideConverter();
}

// ---------- selection ----------

function readSelection(e) {
	sskPage.selection = '';
	sskPage.selectionObj = null;
	sskPage.textBox = null;
	if (isTextBoxDesignMode(e)) {
		sskPage.selectionObj = document.getSelection();
		sskPage.textBox = e.target;
		sskPage.selection = sskPage.selectionObj ? sskPage.selectionObj.toString().trim() : '';
		return;
	}
	const box = isTextBox(e.target) ? e.target : (isTextBox(document.activeElement) ? document.activeElement : null);
	if (box) {
		sskPage.textBox = box;
		try { sskPage.selection = box.value.substring(box.selectionStart, box.selectionEnd).trim(); } catch (ex) { sskPage.selection = ''; }
		return;
	}
	if (isGoogleDocs()) {
		try { sskPage.selection = (googleDocsUtil.getGoogleDocument().selectedText || '').trim(); } catch (ex) { cmn.log(ex); }
	}
	// some google apps (like forms) behave like regular pages
	if (!sskPage.selection) {
		sskPage.selectionObj = document.getSelection();
		sskPage.selection = sskPage.selectionObj ? sskPage.selectionObj.toString().trim() : '';
	}
}

function onMouseUp(e) {
	if (document.getElementById('ssk_id_translation_panel') || document.getElementById('ssk_id_converter_panel')) { return; }
	if (isActionElement(e.target)) { onAction(e); return; }
	if (e.button !== 0) { return; }
	if (isGoogleCalendarDateTime(e)) { return; }
	if (isDisabled()) { return; }
	const prefs = sskPage.prefs;

	readSelection(e);
	if (sskPage.textBox && !prefs.prefAllowInTextBox) { return; }
	if (!sskPage.selection) {
		clearSelectionVars();
		setBadgeText();
		return;
	}

	if (prefs.prefAutoCopy && (prefs.prefAllowACInTextBox || !sskPage.textBox)) {
		if (prefs.prefAutoCopyPlain) { copyPlain(sskPage.selection); }
		else { document.execCommand('copy'); }
		if (prefs.prefBlinkOnCopy) { sskSend({ cmd: utils.CMD_BLINK }); }
	}

	const holdKey = sskPage.holdKeyCode;
	sskPage.holdKeyCode = null;
	const held = pref => !!holdKey && String(pref || '').includes(holdKey);
	const notLink = !(e.target.closest && e.target.closest('a'));

	if (notLink && (held(prefs.prefInstantTranslationKey) || prefs.prefShowAsTranslation)) {
		translator.defaultTranslate(e, sskPage.selection);
		clearSelection();
	} else if (notLink && held(prefs.prefInstantHighlightKey)) {
		mark(sskPage.selection);
		clearSelection();
	} else if (notLink && held(prefs.prefInstantConversionKey)) {
		converter.convert(e, sskPage.selection);
		clearSelection();
	} else if (!prefs.prefShowContextOnly) {
		sskPage.event = e;
		const fragment = document.createElement('div');
		sskPage.selectionHtml = '';
		if (sskPage.selectionObj && sskPage.selectionObj.rangeCount) {
			fragment.appendChild(sskPage.selectionObj.getRangeAt(0).cloneContents());
			const html = fragment.innerHTML.trim();
			sskPage.selectionHtml = html !== sskPage.selection && html.indexOf('<') !== -1 ? html : '';
		}
		const sel = utils.deobfuscate(sskPage.selection);
		sskPage.email = utils.extractEmailAddress(sel);
		sskPage.urls = sskPage.email ? [] : utils.extractURLs(sel, fragment);
		setBadgeText();
		if (prefs.prefUnobtrusive) {
			window.addEventListener('mousemove', onMouseMove);
			showPopupButton(e);
		} else {
			showPopup(e);
		}
	} else {
		setBadgeText();
	}
}

function selectionContext() {
	const s = sskPage.selection;
	const isUPS = utils.isUPSTrackingNumber(s), isUSPS = utils.isUSPSTrackingNumber(s), isFedex = utils.isFedexTrackingNumber(s);
	const hasUnit = const_cur.hasSymbol(s) || const_temp.hasSymbol(s) || const_mass.hasSymbol(s) || const_len.hasSymbol(s);
	return {
		urls: sskPage.urls,
		email: sskPage.email,
		hasHtml: sskPage.selectionHtml !== '',
		inTextBox: sskPage.textBox !== null,
		isGoogleDocs: isGoogleDocs(),
		isConvertible: !isUPS && !isUSPS && !isFedex && ((utils.hasDigit(s) && !!hasUnit) || utils.isNumber(s)),
		isUPS: isUPS,
		isUSPS: isUSPS,
		isFedex: isFedex
	};
}

// ---------- popup actions ----------

function isActionElement(el) {
	return !!(el && el.nodeType === 1 && el.closest &&
		el.closest('#ssk_id_popup .ssk-menu-item, #ssk_id_popup .ssk-panel-img, #ssk_id_button .ssk-popup-button-img'));
}

function onAction(e) {
	setBadgeText();
	const target = e.target.closest('.ssk-menu-item, .ssk-panel-img, .ssk-popup-button-img');
	const id = target ? target.id : '';
	const prefs = sskPage.prefs;
	const evt = prefs.prefShowAsMenu ? sskPage.event : e;
	const s = sskPage.selection;
	const focusBox = function () { if (sskPage.textBox) { sskPage.textBox.focus(); } };

	switch (id) {
		case utils.ID_POPUP_BUTTON: {
			clearTimers();
			const button = document.getElementById('ssk_id_button');
			if (button) { button.remove(); }
			showPopup(sskPage.event);
			return;
		}
		case utils.ID_CUT: focusBox(); document.execCommand('cut'); break;
		case utils.ID_COPY:
			if (isGoogleDocs() || e.button === 2) { copyPlain(s); }	// google apps do not support browser commands
			else { focusBox(); document.execCommand('copy'); }
			break;
		case utils.ID_PASTE: focusBox(); document.execCommand('paste'); break;
		case utils.ID_DELETE: focusBox(); document.execCommand('delete'); break;
		case utils.ID_COPY_PLAIN:
			if (e.button === 2) { focusBox(); document.execCommand('copy'); }
			else { copyPlain(s); }
			break;
		case utils.ID_COPY_HTML: copyPlain(sskPage.selectionHtml); break;
		case utils.ID_GOOGLE_TRANSLATE: translator.googleTranslate(evt, s, 'auto', prefs.prefTranslationDestLng); break;
		case utils.ID_WORDNIK_DICT: translator.wordnikDict(evt, s); break;
		case utils.ID_URBAN_DICT: translator.urbanDict(evt, s); break;
		case utils.ID_YANDEX_TRANSLATE: translator.yandexTranslate(evt, s, 'auto', prefs.prefTranslationDestLng); break;
		case utils.ID_MS_TRANSLATOR: translator.msTranslator(evt, s, 'auto', prefs.prefTranslationDestLng); break;
		case utils.ID_OPEN_URL: sskSend({ cmd: utils.CMD_OPEN_URL, url: sskPage.urls[0] }); break;
		case utils.ID_OPEN_ALL_URLS: sskSend({ cmd: utils.CMD_OPEN_URL, urls: sskPage.urls }); break;
		case utils.ID_COPY_ALL_URLS: copyURLs(); break;
		case utils.ID_HIGHLIGHT: mark(s, e.button === 2, e.button === 1); break;
		case utils.ID_CONVERT: converter.convert(evt, s); break;
		case utils.ID_UPS: sskSend({ cmd: utils.CMD_OPEN_URL, url: 'https://www.ups.com/track?tracknum=' + encodeURIComponent(s.replace(/ /g, '')) }); break;
		case utils.ID_USPS: sskSend({ cmd: utils.CMD_OPEN_URL, url: 'https://tools.usps.com/go/TrackConfirmAction.action?tLabels=' + encodeURIComponent(s.replace(/ /g, '')) }); break;
		case utils.ID_FEDEX: sskSend({ cmd: utils.CMD_OPEN_URL, url: 'https://www.fedex.com/fedextrack/?trknbr=' + encodeURIComponent(s.replace(/ /g, '')) }); break;
		case utils.ID_MAILTO:
			if (sskPage.email) {
				sskSend({ cmd: utils.CMD_MAILTO, to: sskPage.email, subj: '', selection: '' });
			} else {
				sskSend({ cmd: utils.CMD_MAILTO, to: '', subj: getPageDetails(prefs.prefCtrlCPattern), selection: s });
			}
			break;
		case utils.ID_SEARCH: {
			// right click searches for the exact phrase, middle click also highlights it on the result page
			if (prefs.prefAutoHighlight || e.button === 1) { setAutoMark(s); }
			sskSend({ cmd: utils.CMD_SEARCH, selection: e.button === 2 ? '"' + s + '"' : s });
			break;
		}
		default:
			if (!id) { return; }	// a submenu header: nothing to do
			if (id.startsWith(utils.ID_OPEN_URL + '_')) {
				sskSend({ cmd: utils.CMD_OPEN_URL, url: sskPage.urls[Number(id.slice(utils.ID_OPEN_URL.length + 1))] });
			} else if (id.startsWith(utils.ID_HIGHLIGHT + '_')) {
				sskPage.markIdx = Number(id.slice(utils.ID_HIGHLIGHT.length + 1));
				mark(s, e.button === 2, e.button === 1);
			} else if (id.startsWith(utils.ID_BOOKMARK_PREFIX)) {
				if (prefs.prefAutoHighlight || e.button === 1) { setAutoMark(s); }
				sskSend({ cmd: utils.CMD_OPEN_BOOKMARK, id: id.slice(utils.ID_BOOKMARK_PREFIX.length), selection: e.button === 2 ? '"' + s + '"' : s });
			} else {
				return;
			}
	}
	if (!prefs.prefKeepPopup) {
		clearTimers();
		hidePopup();
		clearSelection(!prefs.prefKeepSelection);
	}
}

// ---------- mouse & keyboard ----------

function onMouseDown(e) {
	if (!isSskElement(e.target)) {
		clearTimers();
		if (e.button === 0) { clearSelection(false); }
		hidePopup();
		translator.hideTranslation();
		converter.hideConverter();
	} else if (e.button === 1) {
		onStopEvent(e);	// no auto-scroll on middle click over SelectionSK
	}
}

function onMouseMove(e) {
	if (isSskElement(e.target)) {
		sskPage.enteredSsk = true;
		if (sskPage.closeTimeout) { window.clearTimeout(sskPage.closeTimeout); sskPage.closeTimeout = null; }
		if (e.target.id === utils.ID_POPUP_BUTTON && !sskPage.buttonTimeout) {
			sskPage.buttonTimeout = window.setTimeout(function () { onAction(e); }, 600);
		}
		return;
	}
	if (!sskPage.closeTimeout) {
		sskPage.closeTimeout = window.setTimeout(function () {
			sskPage.closeTimeout = null;
			const isOpen = !!document.getElementById('ssk_id_popup');
			const isButton = !!document.getElementById('ssk_id_button');
			if ((isOpen && sskPage.enteredSsk) || isButton) { hidePopup(); }
			if (sskPage.enteredSsk && document.getElementById('ssk_id_translation_panel')) { translator.hideTranslation(); }
			if (sskPage.enteredSsk && document.getElementById('ssk_id_converter_panel')) { converter.hideConverter(); }
		}, 1200);
	}
	if (sskPage.buttonTimeout) { window.clearTimeout(sskPage.buttonTimeout); sskPage.buttonTimeout = null; }
}

function onScroll(e) {
	if (sskPage.prefs.prefHideOnScroll) { hideAll(); }
}

function onKeyUp(e) {
	sskPage.holdKeyCode = null;
	if (isDisabled()) { return; }
	const isOpen = !!document.getElementById('ssk_id_popup');
	const isButton = !!document.getElementById('ssk_id_button');

	if (e.key === 'Escape') {
		if (isOpen || isButton) { hidePopup(); }
		else if (document.getElementById('ssk_id_translation_panel')) { translator.hideTranslation(); }
		else if (document.getElementById('ssk_id_converter_panel')) { converter.hideConverter(); }
		else { unmarkAll(); }
	}

	// S / W walk through highlights
	if ((e.code === 'KeyS' || e.code === 'KeyW') && !e.ctrlKey && !e.altKey && !e.metaKey && !isEditable(e.target)) {
		const marks = document.querySelectorAll('[data-markjs="true"]');
		if (marks.length) {
			if (sskPage.markCur === null || sskPage.markCur >= marks.length) {
				sskPage.markCur = 0;
			} else {
				marks[sskPage.markCur].style.setProperty('outline', 'unset', 'important');
				if (e.code === 'KeyS') { sskPage.markCur = (sskPage.markCur + 1) % marks.length; }
				else { sskPage.markCur = (sskPage.markCur - 1 + marks.length) % marks.length; }
			}
			marks[sskPage.markCur].style.setProperty('outline', '4px ridge #00ffff', 'important');
			marks[sskPage.markCur].scrollIntoView({ block: 'nearest', inline: 'nearest' });
		}
	}

	// typing in a text box closes the popup
	if (isOpen && sskPage.textBox) { hidePopup(); }
}

function onKeyDown(e) {
	// Ctrl+C copies the page title and url when nothing is selected
	if (e.ctrlKey && e.code === 'KeyC' && sskPage.prefs.prefCtrlC && !isDisabled()) {
		const t = e.target;
		const noBoxSelection = !(t && typeof t.selectionStart === 'number' && t.selectionStart !== t.selectionEnd);
		if (noBoxSelection && document.getSelection().toString() === '') {
			copyPlain(getPageDetails(sskPage.prefs.prefCtrlCPattern));
			sskSend({ cmd: utils.CMD_BLINK });
		}
	}
	sskPage.holdKeyCode = e.code;
}

// ---------- clipboard ----------

function onCopy(e) {
	if (sskPage.copyData) {
		if ('text' in sskPage.copyData) { e.clipboardData.setData('text/plain', sskPage.copyData.text); }
		if ('html' in sskPage.copyData) { e.clipboardData.setData('text/html', sskPage.copyData.html); }
		sskPage.copyData = null;
		onStopEvent(e);
	}
}

function copyPlain(strings) {
	if (!Array.isArray(strings)) { strings = [strings]; }
	sskPage.copyData = { text: strings.join('\r\n') };
	document.execCommand('copy');
	sskPage.copyData = null;
}

function copyURLs() {
	const html = sskPage.urls.map(u => cmn.fmt('<a href="{0}">{0}</a><br/>', cmn.escapeHtml(u))).join('');
	sskPage.copyData = { text: sskPage.urls.join('\r\n'), html: html };
	document.execCommand('copy');
	sskPage.copyData = null;
}

// ---------- messages from the service worker ----------

function onExtensionMessage(msg) {
	if (!msg || !msg.cmd) { return false; }
	hideAll();
	const e = { pageX: 0, pageY: 0, clientX: 0, clientY: 0 };	// centered panes
	const txt = String(msg.txt || '').trim();
	const prefs = sskPage.prefs;
	switch (msg.cmd) {
		case utils.CMD_DEFAULT_TRANSLATE:
			if (sskPage.isTop) { translator.defaultTranslate(e, txt); }
			break;
		case utils.CMD_CONVERT:
			if (sskPage.isTop) { converter.convert(e, txt); }
			break;
		case utils.CMD_RUN_TOOL:
			if (msg.tool === utils.ID_HIGHLIGHT) { mark(txt); break; }
			if (!sskPage.isTop) { break; }
			switch (msg.tool) {
				case utils.ID_GOOGLE_TRANSLATE: translator.googleTranslate(e, txt, 'auto', prefs.prefTranslationDestLng); break;
				case utils.ID_WORDNIK_DICT: translator.wordnikDict(e, txt); break;
				case utils.ID_URBAN_DICT: translator.urbanDict(e, txt); break;
				case utils.ID_YANDEX_TRANSLATE: translator.yandexTranslate(e, txt, 'auto', prefs.prefTranslationDestLng); break;
				case utils.ID_MS_TRANSLATOR: translator.msTranslator(e, txt, 'auto', prefs.prefTranslationDestLng); break;
				case utils.ID_CONVERT: converter.convert(e, txt); break;
			}
			break;
	}
	return false;
}

// ---------- popup ----------

// replaces icons that fail to load (blocked by the page or the network) with a letter icon
function fixBrokenImages(root, isMenu) {
	const images = root.querySelectorAll('img');
	const fallback = function (img) {
		if (img.dataset.sskFallback) { return; }
		img.dataset.sskFallback = '1';
		let name = img.title;
		if (isMenu) {
			const text = img.nextElementSibling ? img.nextElementSibling.textContent : '';
			const item = img.closest('.ssk-menu-item');
			name = text || (item ? item.title : '');
		}
		img.src = cmn.getTxtLetterIcon(name || 'A');
	};
	for (const img of images) {
		img.addEventListener('error', () => fallback(img), { once: true });
	}
	window.setTimeout(function () {
		for (const img of images) {
			if (img.isConnected && img.complete && img.naturalWidth === 0) { fallback(img); }
		}
	}, 1000);
}

function showPopupButton(e) {
	sskPage.enteredSsk = false;
	utils.insertHtml("<span id='ssk_id_button' class='ssk-popup-button'><img id='" + utils.ID_POPUP_BUTTON + "' class='ssk-popup-button-img' src='" +
		cmn.escapeHtml(cmn.getIconURL('SelectionSK_24.png')) + "' alt=''/></span>");
	let [x, y] = utils.getAdjustedXY(e);
	x = x + 35 < window.innerWidth ? x + 10 : x - 35;
	const button = document.getElementById('ssk_id_button');
	button.style.setProperty('left', x + 'px', 'important');
	button.style.setProperty('top', y + 'px', 'important');
}

function showPopup(e) {
	sskPage.enteredSsk = false;
	hideAll();
	if (sskPage.prefs.prefHideOnMoveMouseAway) { window.addEventListener('mousemove', onMouseMove); }
	blockContextMenu(true);
	if (sskPage.prefs.prefShowAsMenu) { showPopupMenu(e); } else { showPopupPanel(e); }
}

function scaleForZoom(elem) {
	if (sskPage.zoom !== 1) {
		elem.style.setProperty('transform', cmn.fmt('scale({0})', cmn.round(1 / sskPage.zoom, 2)), 'important');
	}
}

function stylePopupMenu() {
	const prefs = sskPage.prefs;
	scaleForZoom(document.getElementById('ssk_id_popup'));
	const size = parseInt(prefs.prefMenuFontSize, 10) || 15;
	const font = 'Roboto,sans-serif';
	cmn.setStyleProp('ssk-menu', { 'margin': '0', 'overflow': 'visible', 'background-color': prefs.prefMenuBkColor, 'color': prefs.prefMenuFontColor });
	cmn.setStyleProp('ssk-menu-item', { 'font-size': size + 'px', 'color': prefs.prefMenuFontColor, 'font-family': font });
	cmn.setStyleProp('ssk-menu-btn', {
		'border': '1px solid transparent', 'opacity': '1', 'background-color': prefs.prefMenuBkColor, 'font-size': size + 'px',
		'min-height;max-height': (size + 9) + 'px', 'color': prefs.prefMenuFontColor, 'text-transform': 'none', 'padding': '1px 6px', 'font-family': font
	});
	cmn.setStyleProp('ssk-menu-text', { 'font-size': size + 'px', 'margin-left': (size + 1) + 'px', 'text-transform': 'none', 'font-family': font });
	cmn.setStyleProp('ssk-button-img', { 'min-width;max-width;min-height;max-height': (size + 1) + 'px' });
}

async function showPopupMenu(e) {
	const response = await sskSend({ cmd: utils.CMD_GET_MENU, ctx: selectionContext() });
	if (!response || !response.menu) { return; }
	let menuHtml = response.menu;
	sskPage.zoom = response.zoom || 1;
	utils.insertHtml(menuHtml);
	stylePopupMenu();
	let menu = document.getElementById('ssk_id_popup');
	let [x, y, xClient, yClient] = utils.getAdjustedXY(e);
	const [w, h, offsetW, offsetH] = utils.getAdjustedSize(menu, sskPage.zoom);
	let pos = '';
	x -= offsetW;
	y -= offsetH;
	if (xClient + w + 25 > window.innerWidth) {
		x = Math.max(x - menu.clientWidth, 0);
		y += 3;	// moved a bit so a triple click still works
	} else if (xClient + 2 * w + 25 > window.innerWidth) {
		x += 2 * offsetW;
		pos += '-left';	// submenus open to the left
		y += 3;
	} else {
		x += 3;
	}
	if (yClient + h + 25 > window.innerHeight) {
		y = Math.max(y - h, 0);
		pos += '-top';	// submenus open upwards
	}
	if (pos) {
		menu.remove();
		menuHtml = menuHtml.replace(/ssk-submenu-pos-normal/g, 'ssk-submenu-pos' + pos);
		utils.insertHtml(menuHtml);
		stylePopupMenu();
		menu = document.getElementById('ssk_id_popup');
	}
	menu.style.setProperty('left', x + 'px', 'important');
	menu.style.setProperty('top', y + 'px', 'important');
	fixBrokenImages(menu, true);
}

function stylePopupPanel() {
	const prefs = sskPage.prefs;
	scaleForZoom(document.getElementById('ssk_id_popup'));
	const rowHeight = (Number(prefs.prefPanelIconSize) + 2 * Number(prefs.prefPanelIconPadding)) + 'px';
	cmn.setStyleProp('ssk-panel', { 'background-color': prefs.prefPanelBkColor, 'padding': prefs.prefPanelPadding + 'px', 'border-radius': prefs.prefPanelRoundness + 'px' });
	cmn.setStyleProp('ssk-panel-img', { 'min-width;max-width;min-height;max-height': prefs.prefPanelIconSize + 'px', 'padding': prefs.prefPanelIconPadding + 'px' });
	cmn.setStyleProp('ssk-panel-separator', { 'min-height;max-height': rowHeight });
	cmn.setStyleProp('ssk-panel-separator-placeholder', { 'min-height;max-height': rowHeight });
}

async function showPopupPanel(e) {
	const response = await sskSend({ cmd: utils.CMD_GET_PANEL, ctx: selectionContext() });
	if (!response || !response.panel) { return; }
	utils.insertHtml(response.panel);
	sskPage.zoom = response.zoom || 1;
	stylePopupPanel();
	const panel = document.getElementById('ssk_id_popup');
	let [x, y, , yClient] = utils.getAdjustedXY(e);
	const [w, h, offsetW] = utils.getAdjustedSize(panel, sskPage.zoom);
	x = x - w / 2;
	x = Math.min(x, window.scrollX + window.innerWidth - w - 30);
	x = Math.max(x, 0);
	x = x - offsetW;
	y = yClient - h - 20 < 0 ? y + 15 : y - h - 20;
	panel.style.setProperty('left', x + 'px', 'important');
	panel.style.setProperty('top', y + 'px', 'important');
	fixBrokenImages(panel, false);
}

function hidePopup() {
	window.removeEventListener('mousemove', onMouseMove);
	blockContextMenu(false);
	const popup = document.getElementById('ssk_id_popup');
	if (popup) { popup.remove(); }
	const button = document.getElementById('ssk_id_button');
	if (button) { button.remove(); }
}

// ---------- highlighting ----------

function mark(txt, wholeWords = false, caseSensitive = false) {
	try {
		const prefs = sskPage.prefs;
		const idx = String(sskPage.markIdx % 10);
		const cls = 'ssk-color-' + idx;
		const body = document.body;
		if (!body || !txt) { return; }
		const marks = document.querySelectorAll('[data-markjs="true"]');
		if (sskPage.markCur !== null && marks[sskPage.markCur]) { marks[sskPage.markCur].style.setProperty('outline', 'unset', 'important'); }
		if (prefs.prefIgnorePunctuation) {
			txt = txt.replace(/[:;.,\-?_(){}\[\]!'"+=]/g, '');
		}
		new Mark(body).mark(txt, {
			className: cls,
			separateWordSearch: false,
			accuracy: wholeWords ? 'exactly' : 'partially',
			caseSensitive: caseSensitive,
			exclude: [SSK_UI_SELECTOR, '#ssk_id_popup *', '#ssk_id_translation_panel *', '#ssk_id_converter_panel *'],
			done: function (count) {
				window.setTimeout(function () { sskPage.markCount += count; setBadgeText(); }, utils.MOUSE_BUTTON_CLICK_DELAY_MS);
			}
		});
		sskPage.markCur = null;
		for (const elem of document.getElementsByClassName(cls)) {
			elem.style.setProperty('background', prefs['prefBkColor_' + idx], 'important');
			elem.style.setProperty('color', prefs['prefTxColor_' + idx], 'important');
		}
		sskPage.markIdx += 1;
	} catch (ex) { cmn.log(ex); }
}

function unmarkAll() {
	try {
		if (document.body) { new Mark(document.body).unmark(); }
		sskPage.markCount = 0;
		sskPage.markIdx = 0;
		sskPage.markCur = null;
		clearSelection();
		setAutoMark('');
	} catch (ex) { cmn.log(ex); }
}

// remembered text is highlighted on the next page that loads (e.g. a search result)
function setAutoMark(txt) {
	try { chrome.storage.local.set({ prefAutoMark: txt }); } catch (ex) { cmn.log(ex); }
}

function autoMark(prefs) {
	if (prefs.prefAutoMark) {
		mark(prefs.prefAutoMark);
		setAutoMark('');
	}
}

// ---------- misc ----------

function setBadgeText() {
	if (sskPage.selection) {
		sskSend({ cmd: utils.CMD_SET_BADGE_TEXT, txt: String(sskPage.selection.split(/\s+/).filter(Boolean).length), color: '#3399ff' });
	} else if (sskPage.markCount) {
		sskSend({ cmd: utils.CMD_SET_BADGE_TEXT, txt: String(sskPage.markCount), color: '#c100c1' });
	} else {
		sskSend({ cmd: utils.CMD_SET_BADGE_TEXT, txt: '', color: '#000000' });
	}
}

function clearSelectionVars() {
	sskPage.selection = '';
	sskPage.selectionHtml = '';
	sskPage.selectionObj = null;
	sskPage.textBox = null;
	sskPage.email = '';
	sskPage.urls = [];
	sskPage.event = null;
	clearTimers();
}

function clearSelection(clearAll = true) {
	if (clearAll) {
		if (sskPage.selectionObj) { sskPage.selectionObj.removeAllRanges(); }
		if (sskPage.textBox) {
			try { sskPage.textBox.selectionStart = sskPage.textBox.selectionEnd; } catch (ex) { cmn.log(ex); }
		}
	}
	clearSelectionVars();
	setBadgeText();
}

// undoes the tricks some sites use to prevent selecting and copying text
function enableTextSelection(prefs) {
	if (!prefs.prefEnableSelection) { return; }
	const enable = function () { return true; };
	for (const elem of document.querySelectorAll('*')) {
		const userSelect = window.getComputedStyle(elem).userSelect;
		if (userSelect === 'none' || userSelect === 'all') { elem.style.setProperty('user-select', 'auto', 'important'); }
		if (elem.onselectstart) { elem.onselectstart = enable; }
		if (elem.oncopy) { elem.oncopy = enable; }
		if (elem.onmousedown) { elem.onmousedown = enable; }
	}
	if (document.onselectstart) { document.onselectstart = enable; }
	if (document.oncopy) { document.oncopy = enable; }
	if (document.onmousedown) { document.onmousedown = enable; }
}
