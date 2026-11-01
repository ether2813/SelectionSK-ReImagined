'use strict';

/*
 * Builds the html of the in-page popup (menu or pane), the translation pane and the converter pane.
 * It is built here because content scripts have no access to bookmarks. Every piece of text is
 * escaped: bookmark titles and urls taken from the selection must never become markup.
 */

var sskIcons = {
	NAMES: ['close', 'convert', 'copy', 'copy_html', 'copy_plain', 'cut', 'delete', 'fedex', 'highlight', 'lng_tools', 'mailto',
		'open_url', 'paste', 'play', 'reverse', 'search', 'settings', 'ups', 'url_blocked', 'usps'],
	_svg: {},
	_loading: null,

	load: function () {
		if (!sskIcons._loading) {
			sskIcons._loading = Promise.all(sskIcons.NAMES.map(async function (name) {
				try {
					const response = await fetch(cmn.getIconURL(name + '.svg'));
					sskIcons._svg[name] = await response.text();
				} catch (ex) { cmn.log(ex); }
			}));
		}
		return sskIcons._loading;
	},

	// url of the icon painted with 'color'; call load() first
	get: function (name, color) {
		const svg = sskIcons._svg[name];
		if (!svg || !color || cmn.isBlack(color)) { return cmn.getIconURL(name + '.svg'); }
		return cmn.svgDataUrl(svg.split('fill:rgb(0,0,0)').join('fill:' + cmn.toHex(color)));
	}
};

var sskFavicons = {
	// quality icons for the most popular sites, shipped with the extension
	CACHED: ['canacopegdl.com.svg', 'docs.microsoft.com.svg', 'duckduckgo.com.svg', 'en.wikipedia.org.svg', 'gibiru.com.png',
		'maps.google.com.png', 'ms.translate.png', 'news.google.com.png', 'onelook.com.png', 'open.spotify.com.svg', 'rutube.ru.svg',
		'scholar.google.com.png', 'search.aol.com.svg', 'search.lilo.org.png', 'search.lycos.com.png', 'search.yahoo.com.svg',
		'stackoverflow.com.svg', 'swisscows.ch.png', 'translate.google.com.svg', 'translate.yandex.com.png', 'twitter.com.svg',
		'www.amazon.com.svg', 'www.baidu.com.svg', 'www.bing.com.svg', 'www.britannica.com.png', 'www.dictionary.com.png',
		'www.dogpile.com.png', 'www.facebook.com.svg', 'www.flickr.com.svg', 'www.google.com.png', 'www.imdb.com.png',
		'www.merriam-webster.com.svg', 'www.mojeek.com.png', 'www.mouser.com.png', 'www.qwant.com.png', 'www.rottentomatoes.com.png',
		'www.startpage.com.png', 'www.thefreedictionary.com.svg', 'www.urbandictionary.com.png', 'www.wolframalpha.com.svg',
		'www.wordnik.com.png', 'www.yandex.com.svg', 'www.youtube.com.svg'],

	getURL: function (url, prefs) {
		if (!url) { return ''; }
		if (url.indexOf('site=imghp&tbm=isch') !== -1) { return cmn.getIconURL('favicons/google_image.png'); }
		if (url.indexOf('encrypted.google.com') !== -1) { return cmn.getIconURL('favicons/www.google.com.png'); }
		if (url.indexOf('start.duckduckgo.com') !== -1) { return cmn.getIconURL('favicons/duckduckgo.com.svg'); }
		if (url.indexOf('www.bing.com/translator') !== -1) { return cmn.getIconURL('favicons/ms.translate.png'); }
		const parts = url.split('/');
		const host = parts[2] || '';
		for (const ext of ['.svg', '.png']) {
			if (sskFavicons.CACHED.includes(host + ext)) { return cmn.getIconURL('favicons/' + host + ext); }
		}
		if (prefs.prefFavGoogle) {
			return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(parts[0] + '//' + host);
		}
		return 'https://icons.duckduckgo.com/ip3/' + encodeURIComponent(host) + '.ico';
	}
};

var popupBuilder = {
	LNG_ICONS: {},

	// which built-in tools apply to the current selection
	visibility: function (ctx, prefs) {
		const inTextBox = !!ctx.inTextBox;
		const txtControls = prefs.prefShowCopy && inTextBox;
		return {
			[utils.ID_COPY]: prefs.prefShowCopy,
			[utils.ID_PASTE]: txtControls,
			[utils.ID_CUT]: txtControls,
			[utils.ID_DELETE]: txtControls,
			[utils.ID_COPY_PLAIN]: prefs.prefShowCopyPlain && !inTextBox && !ctx.isGoogleDocs,
			[utils.ID_COPY_HTML]: prefs.prefShowCopyHtml && !!ctx.hasHtml && !inTextBox,
			[utils.ID_GOOGLE_TRANSLATE]: prefs.prefShowGoogleTranslate,
			[utils.ID_WORDNIK_DICT]: prefs.prefShowWordnikDictionary,
			[utils.ID_URBAN_DICT]: prefs.prefShowUrbanDictionary,
			[utils.ID_YANDEX_TRANSLATE]: prefs.prefShowYandexTranslate,
			[utils.ID_MS_TRANSLATOR]: prefs.prefShowMsTranslator,
			[utils.ID_OPEN_URL]: prefs.prefShowOpenUrl && ctx.urls.length > 0,
			[utils.ID_HIGHLIGHT]: prefs.prefShowHighlight,
			[utils.ID_CONVERT]: prefs.prefShowConvert && !!ctx.isConvertible,
			[utils.ID_UPS]: prefs.prefShowTrackingNumbers && !!ctx.isUPS,
			[utils.ID_USPS]: prefs.prefShowTrackingNumbers && !!ctx.isUSPS,
			[utils.ID_FEDEX]: prefs.prefShowTrackingNumbers && !!ctx.isFedex,
			[utils.ID_MAILTO]: prefs.prefShowMailto,
			[utils.ID_SEARCH]: prefs.prefShowSearch
		};
	},

	// label, icon name (recolorable) or favicon url for each built-in tool
	TOOLS: {
		ssk_id_copy: { label: 'txtCopy', icon: 'copy' },
		ssk_id_paste: { label: 'txtPaste', icon: 'paste' },
		ssk_id_cut: { label: 'txtCut', icon: 'cut' },
		ssk_id_delete: { label: 'txtDelete', icon: 'delete' },
		ssk_id_copy_plain: { label: 'txtCopyPlain', icon: 'copy_plain' },
		ssk_id_copy_html: { label: 'txtCopyHtml', icon: 'copy_html' },
		ssk_id_google_translate: { label: 'txtGoogleTranslate', favicon: 'favicons/translate.google.com.svg' },
		ssk_id_wordnik_dict: { label: 'txtWordnikDictionary', favicon: 'favicons/www.wordnik.com.png' },
		ssk_id_urban_dict: { label: 'txtUrbanDictionary', favicon: 'favicons/www.urbandictionary.com.png' },
		ssk_id_yandex_translate: { label: 'txtYandexTranslate', favicon: 'favicons/translate.yandex.com.png' },
		ssk_id_ms_translator: { label: 'txtMsTranslator', favicon: 'favicons/ms.translate.png' },
		ssk_id_open_url: { label: 'txtOpenUrl', icon: 'open_url' },
		ssk_id_highlight: { label: 'txtHighlight', icon: 'highlight' },
		ssk_id_convert: { label: 'txtConvert', icon: 'convert' },
		ssk_id_ups: { label: 'txtUPS', icon: 'ups' },
		ssk_id_usps: { label: 'txtUSPS', icon: 'usps' },
		ssk_id_fedex: { label: 'txtFedex', icon: 'fedex' },
		ssk_id_mailto: { label: 'txtMailto', icon: 'mailto' },
		ssk_id_search: { label: 'txtSearchDefault', icon: 'search' }
	},

	toolIcon: function (tool, color) {
		return tool.favicon ? cmn.getIconURL(tool.favicon) : sskIcons.get(tool.icon, color);
	},

	isLngToolsFolder: function (node) {
		return !node.url && node.title === cmn.msg('txtLngTools');
	},

	// ---------- menu ----------

	buildMenu: function (ctx, prefs, folder) {
		const esc = cmn.escapeHtml;
		const color = prefs.prefMenuIconsColor;
		const visible = popupBuilder.visibility(ctx, prefs);
		const SEP = "<li class='ssk-menu-separator'></li>";

		const button = function (name, img) {
			return "<button type='button' class='ssk-menu-btn'>" +
				(img ? "<img src='" + esc(img) + "' class='ssk-button-img' alt=''/>" : '') +
				"<span class='ssk-menu-text'>" + esc(name) + '</span></button>';
		};
		const item = function (name, id, img, title) {
			return "<li class='ssk-menu-item'" + (id ? " id='" + esc(id) + "'" : '') + (title ? " title='" + esc(title) + "'" : '') + '>' +
				button(name, img) + '</li>';
		};
		const submenu = function (name, img, children) {
			const content = children.filter(Boolean);
			while (content.length && content[content.length - 1] === SEP) { content.pop(); }
			if (!content.some(c => c !== SEP)) { return ''; }	// drop empty folders
			return "<li class='ssk-menu-item ssk-submenu'>" + button(name, img) +
				"<ul class='ssk-menu ssk-submenu-pos-normal'>" + content.join('') + '</ul></li>';
		};

		const sskItem = function (id) {
			if (id === utils.ID_SEPARATOR) { return SEP; }
			const tool = popupBuilder.TOOLS[id];
			if (!tool || !visible[id]) { return ''; }
			const label = cmn.msg(tool.label);
			const icon = popupBuilder.toolIcon(tool, color);
			if (id === utils.ID_OPEN_URL && ctx.urls.length > 1) {
				const children = ctx.urls.map((u, i) => item(u, utils.ID_OPEN_URL + '_' + i, null));
				children.push(SEP);
				children.push(item(cmn.msg('txtOpenUrlAll'), utils.ID_OPEN_ALL_URLS, sskIcons.get('open_url', color)));
				children.push(item(cmn.msg('txtCopyUrlAll'), utils.ID_COPY_ALL_URLS, sskIcons.get('copy_plain', color)));
				return submenu(label, icon, children);
			}
			if (id === utils.ID_OPEN_URL) { return item(label, id, icon, ctx.urls[0]); }
			if (id === utils.ID_HIGHLIGHT && !prefs.prefAutoSelectColors) {
				const children = [];
				for (let i = 0; i < 10; i++) {
					const letter = String.fromCharCode(65 + i);
					children.push(item('', utils.ID_HIGHLIGHT + '_' + i, cmn.getLetterIcon(letter, prefs['prefTxColor_' + i], prefs['prefBkColor_' + i]), letter));
				}
				return submenu(label, icon, children);
			}
			if (id === utils.ID_MAILTO) { return item(label, id, icon, ctx.email); }
			return item(label, id, icon);
		};

		const node = function (bm) {
			if (!bm.url) {
				const icon = popupBuilder.isLngToolsFolder(bm) ? sskIcons.get('lng_tools', color) : null;
				return submenu(bm.title, icon, (bm.children || []).map(node));
			}
			const sskId = utils.sskIdFromUrl(bm.url);
			if (sskId) { return sskItem(sskId); }
			return prefs.prefShowBookmarks ? item(bm.title, utils.ID_BOOKMARK_PREFIX + bm.id, sskFavicons.getURL(bm.url, prefs)) : '';
		};

		const content = folder ? (folder.children || []).map(node).filter(Boolean) : [];
		while (content.length && content[0] === SEP) { content.shift(); }
		while (content.length && content[content.length - 1] === SEP) { content.pop(); }
		return "<ul id='ssk_id_popup' spellcheck='false' class='ssk-menu ssk-show-menu notranslate'>" + content.join('') + '</ul>';
	},

	// ---------- pane ----------

	buildPanel: function (ctx, prefs, folder) {
		const esc = cmn.escapeHtml;
		const color = prefs.prefPanelIconsColor;
		const visible = popupBuilder.visibility(ctx, prefs);
		const SEP = "<span class='ssk-panel-separator'></span>";
		const PLACEHOLDER = "<span class='ssk-panel-separator-placeholder'></span>";
		let items = [];

		const add = function (name, id, img) {
			items.push("<img id='" + esc(id) + "' src='" + esc(img) + "' title='" + esc(name) + "' alt='" + esc(name) + "' class='ssk-panel-img'/>");
		};
		const sskItem = function (id) {
			if (id === utils.ID_SEPARATOR) { items.push(SEP); return; }
			const tool = popupBuilder.TOOLS[id];
			if (!tool || !visible[id]) { return; }
			let label = cmn.msg(tool.label);
			if (id === utils.ID_OPEN_URL) { label += ' - ' + ctx.urls[0]; }
			if (id === utils.ID_MAILTO && ctx.email) { label += ': ' + ctx.email; }
			add(label, id, popupBuilder.toolIcon(tool, color));
		};
		const node = function (bm) {
			if (!bm.url) {
				items.push(SEP);
				(bm.children || []).forEach(node);
				items.push(SEP);
				return;
			}
			const sskId = utils.sskIdFromUrl(bm.url);
			if (sskId) { sskItem(sskId); }
			else if (prefs.prefShowBookmarks) { add(bm.title, utils.ID_BOOKMARK_PREFIX + bm.id, sskFavicons.getURL(bm.url, prefs)); }
		};
		if (folder) { (folder.children || []).forEach(node); }

		// remove leading, trailing and duplicate separators
		items = items.filter((it, i) => !(it === SEP && (i === 0 || items[i - 1] === SEP)));
		while (items.length && items[items.length - 1] === SEP) { items.pop(); }

		// remember separator positions (in terms of icons before them) and remove them
		const sepIdx = [];
		const icons = [];
		for (const it of items) {
			if (it === SEP) { sepIdx.push(icons.length); } else { icons.push(it); }
		}

		// 'size' is the number of icons in a row
		let size = Number(prefs.prefPanelItemsN) || 0;
		if (size <= 0) {
			size = Math.max(icons.length, 1);		// fit everything in one row
		} else if (prefs.prefPanelItemsNRows) {
			size = Math.max(Math.ceil(icons.length / size), 1);	// N rows
		}

		const rows = [];
		for (let i = 0; i < icons.length; i += size) { rows.push(icons.slice(i, i + size)); }

		// put a separator in its row and an invisible placeholder at the same column of the other rows,
		// so the columns stay aligned; insert from the right so earlier positions stay valid
		const sepPos = sepIdx.filter(i => i > 0 && i < icons.length && i % size !== 0)
			.map(i => [Math.floor(i / size), i % size])
			.sort((a, b) => b[1] - a[1]);
		for (const [row, col] of sepPos) {
			rows.forEach(function (r, j) {
				if (r[col] === SEP || r[col] === PLACEHOLDER) {
					if (j === row) { r[col] = SEP; }
					return;
				}
				r.splice(col, 0, j === row ? SEP : PLACEHOLDER);
			});
		}

		return "<span id='ssk_id_popup' class='ssk-panel'>" + rows.map(r => "<span class='ssk-panel-row'>" + r.join('') + '</span>').join('') + '</span>';
	},

	// ---------- translation & converter panes ----------

	buildTranslationPanel: function (msg) {
		const esc = cmn.escapeHtml;
		const icon = name => esc(sskIcons.get(name, msg.icnsClr));
		return "<span id='ssk_id_translation_panel' spellcheck='false' class='ssk-translationpanel " + (msg.pos_fixed ? 'ssk-translationpanel-fixed ' : '') + "notranslate'>" +
			"<img id='ssk_id_translation_open' src='" + icon('open_url') + "' title='" + esc(cmn.msg('txtTranslationDetails')) + "' class='ssk-translationpanel-button'/>" +
			"<img id='ssk_id_translation_copy' src='" + icon('copy_plain') + "' title='" + esc(cmn.msg('txtCopyTranslation')) + "' class='ssk-translationpanel-button'/>" +
			'&nbsp;' +
			"<select id='ssk_id_lng_src' class='ssk-translationpanel-select'></select>" +
			"<img id='ssk_id_lng_reverse' src='" + icon('reverse') + "' title='" + esc(cmn.msg('txtTranslateReverse')) + "' class='ssk-translationpanel-button'/>" +
			"<select id='ssk_id_lng_dst' class='ssk-translationpanel-select'></select>" +
			'&nbsp;' +
			"<select id='ssk_id_engine' class='ssk-translationpanel-select ssk-translationpanel-select-engine'></select>" +
			'&nbsp;' +
			"<img id='ssk_id_translation_close' src='" + icon('close') + "' class='ssk-translationpanel-button ssk-translationpanel-button-close'/>" +
			'<br>' +
			"<span id='ssk_id_translation' class='ssk-translationpanel-translation'></span>" +
			'</span>';
	},

	buildConvertPanel: function (msg) {
		const esc = cmn.escapeHtml;
		const icon = name => esc(sskIcons.get(name, msg.icnsClr));
		return "<span id='ssk_id_converter_panel' spellcheck='false' class='ssk-converterpanel " + (msg.pos_fixed ? 'ssk-converterpanel-fixed ' : '') + "notranslate'>" +
			"<select id='ssk_id_conv' class='ssk-converterpanel-select ssk-converterpanel-select-converter'></select>" +
			"<img id='ssk_id_conv_close' src='" + icon('close') + "' class='ssk-converterpanel-button ssk-converterpanel-button-close'/>" +
			"<br class='ssk-converterpanel-br'><br class='ssk-converterpanel-br'>" +
			"<input type='text' id='ssk_id_conv_src_val' class='ssk-converterpanel-value'>" +
			"<select id='ssk_id_conv_src' class='ssk-converterpanel-select'></select>" +
			"<img id='ssk_id_conv_reverse' src='" + icon('reverse') + "' title='" + esc(cmn.msg('txtReverse')) + "' class='ssk-converterpanel-button'/>" +
			"<input type='text' id='ssk_id_conv_dst_val' class='ssk-converterpanel-value' disabled>" +
			"<select id='ssk_id_conv_dst' class='ssk-converterpanel-select'></select>" +
			'</span>';
	}
};
