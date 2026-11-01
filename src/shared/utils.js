'use strict';

/* Message commands, element ids and text helpers shared by the service worker and content scripts. */

var utils = {
	// messages: content/options -> service worker
	CMD_GET_MENU: 'cmd_get_menu',
	CMD_GET_PANEL: 'cmd_get_panel',
	CMD_GET_TRANSLATION_PANEL: 'cmd_get_translation_panel',
	CMD_GET_CONVERT_PANEL: 'cmd_get_convert_panel',
	CMD_OPEN_URL: 'cmd_open_url',
	CMD_OPEN_BOOKMARK: 'cmd_open_bookmark',
	CMD_ADD_BOOKMARK: 'cmd_add_bookmark',
	CMD_BLINK: 'cmd_blink',
	CMD_SET_BADGE_TEXT: 'cmd_set_badge_text',
	CMD_MAILTO: 'cmd_mailto',
	CMD_SEARCH: 'cmd_search',
	CMD_PLAY: 'cmd_play',
	CMD_RESTORE_BOOKMARKS: 'cmd_restore_bookmarks',
	CMD_NOTIFY: 'cmd_notify',
	// network requests (done by the service worker because of CORS)
	CMD_GOOGLE_DICT: 'cmd_google_dict',
	CMD_GOOGLE_TRANSLATE: 'cmd_google_translate',
	CMD_WORDNIK_DICT: 'cmd_wordnik_dict',
	CMD_URBAN_DICT: 'cmd_urban_dict',
	CMD_YANDEX_DICT: 'cmd_yandex_dict',
	CMD_YANDEX_TRANSLATE: 'cmd_yandex_translate',
	CMD_MS_DETECT_LNG: 'cmd_ms_detect_lng',
	CMD_MS_DICT: 'cmd_ms_dict',
	CMD_MS_TRANSLATOR: 'cmd_ms_translator',
	CMD_CONV_CURRENCY: 'cmd_conv_currency',
	// messages: service worker -> content
	CMD_DEFAULT_TRANSLATE: 'cmd_default_translate',
	CMD_HIGHLIGHT: 'cmd_highlight',
	CMD_CONVERT: 'cmd_convert',
	CMD_RUN_TOOL: 'cmd_run_tool',
	// messages: service worker -> offscreen document
	CMD_OFFSCREEN_PLAY: 'cmd_offscreen_play',

	// popup items; bookmark placeholders use https://<id>/ as url
	ID_SEPARATOR: 'ssk_id_separator',
	ID_POPUP_BUTTON: 'ssk_id_button_img',
	ID_CUT: 'ssk_id_cut',
	ID_COPY: 'ssk_id_copy',
	ID_PASTE: 'ssk_id_paste',
	ID_DELETE: 'ssk_id_delete',
	ID_COPY_PLAIN: 'ssk_id_copy_plain',
	ID_COPY_HTML: 'ssk_id_copy_html',
	ID_GOOGLE_TRANSLATE: 'ssk_id_google_translate',
	ID_WORDNIK_DICT: 'ssk_id_wordnik_dict',
	ID_URBAN_DICT: 'ssk_id_urban_dict',
	ID_YANDEX_TRANSLATE: 'ssk_id_yandex_translate',
	ID_MS_TRANSLATOR: 'ssk_id_ms_translator',
	ID_OPEN_URL: 'ssk_id_open_url',
	ID_OPEN_ALL_URLS: 'ssk_id_open_all_urls',
	ID_COPY_ALL_URLS: 'ssk_id_copy_all_urls',
	ID_HIGHLIGHT: 'ssk_id_highlight',
	ID_CONVERT: 'ssk_id_convert',
	ID_UPS: 'ssk_id_ups',
	ID_USPS: 'ssk_id_usps',
	ID_FEDEX: 'ssk_id_fedex',
	ID_CONV_CURRENCY: 'ssk_id_conv_currency',
	ID_CONV_TEMPERATURE: 'ssk_id_conv_temperature',
	ID_CONV_MASS: 'ssk_id_conv_mass',
	ID_CONV_LEN: 'ssk_id_conv_len',
	ID_MAILTO: 'ssk_id_mailto',
	ID_SEARCH: 'ssk_id_search',
	ID_BOOKMARK_PREFIX: 'ssk_bm_',

	SSK_URL_PREFIX: 'https://ssk_id_',
	MOUSE_BUTTON_CLICK_DELAY_MS: 500,

	// 'https://ssk_id_copy/' -> 'ssk_id_copy'; '' for regular bookmarks
	sskIdFromUrl: function (url) {
		if (!url || !url.toLowerCase().startsWith(utils.SSK_URL_PREFIX)) { return ''; }
		return url.slice('https://'.length).replace(/\/+$/, '').toLowerCase();
	},

	sskUrl: function (id) {
		return 'https://' + id + '/';
	},

	// finds urls in the plain text and in links/images of the selected html fragment ('node')
	extractURLs: function (s, node) {
		try {
			s = s.replace(/ /gi, '');
			// the original regex was taken from https://www.regextester.com/96504, some modifications made
			const e = /(?:(?:https?|ftp):\/\/|\b(?:[a-z\d\-]+\.))(?:(?:[ ]+|[^\s()<>]+|\((?:[^\s()<>]+|(?:\([^\s()<>]+\)))?\))+(?:\((?:[^\s()<>]+|(?:\(?:[^\s()<>]+\)))?\)|[^\s`!()\[\]{};:\'\".,<>?]))?/gi;
			const fromText = s.match(e) || [];
			const fromNodes = [];
			const walk = function (n) {
				if (n.nodeType === 1 && n.tagName === 'A') {
					if (n.href && n.href.match(e)) { fromNodes.push(n.href); }
					n.remove();
					return;
				}
				if (n.nodeType === 1 && n.tagName === 'IMG') {
					if (n.src && n.src.match(e)) { fromNodes.push(n.src); }
					n.remove();
					return;
				}
				for (const child of Array.from(n.childNodes)) { walk(child); }
			};
			if (node) { walk(node); }

			// normalize links and eliminate duplicates
			const uniq = new Map();
			for (const link of fromNodes.concat(fromText)) {
				let str = link.trim().replace(/&amp;/g, '&');
				str = (str.indexOf('://') === -1 ? 'http://' : '') + str;
				// skip false urls and search-related queries
				if (str.indexOf('cache:') === -1 && str.indexOf('related:') === -1) { uniq.set(str, true); }
			}
			for (const u of Array.from(uniq.keys())) {
				if (u.endsWith('/') && uniq.has(u.slice(0, -1))) { uniq.set(u.slice(0, -1), false); }
				if (u.endsWith('.')) { uniq.set(u, false); }
				if (u.startsWith('https://') && uniq.has('http://' + u.slice(8))) { uniq.set('http://' + u.slice(8), false); }
			}
			return Array.from(uniq.entries()).filter(([, keep]) => keep).map(([u]) => u);
		} catch (ex) { cmn.log(ex); }
		return [];
	},

	extractEmailAddress: function (s) {
		try {
			// the original regex was taken from https://www.regular-expressions.info/email.html, some modifications made
			const m = s.replace(/ /g, '').toLowerCase().match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}\b/i);
			return m ? m[0] : '';
		} catch (ex) { cmn.log(ex); }
		return '';
	},

	// de-obfuscates things like 'name (at) example [dot] com' and 'hxxp://'
	deobfuscate: function (sel) {
		sel = sel.replace(/hxxp|_ttp| ttp|h\?\?p|h\+\+p|h\*\*p/gi, 'http');
		sel = sel.replace(/ ?(\(@\)|\[@\]|\{@\}|_@_) ?| @ /gi, '@');
		sel = sel.replace(/ ?(\(at\)|\[at\]|\{at\}|_at_) ?/gi, '@');
		sel = sel.replace(/ ?(\(#\)|\[#\]|\{#\}|_#_) ?| # /gi, '@');
		sel = sel.replace(/ ?(\(\.\)|\[\.\]|\{\.\}|_\._) ?| \. /gi, '.');
		sel = sel.replace(/ ?(\(dot\)|\[dot\]|\{dot\}|_dot_) ?| dot /gi, '.');
		sel = sel.replace(/ ?(\(point\)|\[point\]|\{point\}|_point_) ?| point /gi, '.');
		sel = sel.replace(/ ?(\(точка\)|\[точка\]|\{точка\}|_точка_) ?| точка /gi, '.');
		sel = sel.replace(/ ?(\(punkt\)|\[punkt\]|\{punkt\}|_punkt_) ?| punkt /gi, '.');
		return sel;
	},

	removeHtmlTags: function (txt) {
		return txt.replace(/<\/?[^>]+(>|$)/g, '');
	},

	getTextWidth: function (txt, size) {
		const context = document.createElement('canvas').getContext('2d');
		context.font = cmn.fmt('normal {0}pt Roboto', size);
		return context.measureText(txt).width + 'px';
	},

	hasDigit: function (txt) { return /\d/.test(txt); },

	isNumber: function (txt) { return /^[\d.]+$/.test(txt); },

	isWord: function (txt) { return !/[\s]/.test(txt); },

	getNumber: function (txt) {
		const neg = txt.indexOf('-') > -1 ? '-' : '';
		txt = txt.replace(/[^\d.]/g, '');	// remove non-numeric symbols
		txt = txt.replace(/^\.+/, '');		// remove leading dots
		txt = txt.replace(/\.+$/, '');		// remove trailing dots
		return txt !== '' ? neg + txt : '0';
	},

	getNumberEur: function (txt) {
		return utils.getNumber(txt.replace(',', '.'));
	},

	formatFloat: function (f, n) {
		f = parseFloat(f).toFixed(n);
		f = f.replace(/0+$/, '');	// remove trailing zeroes
		return f.endsWith('.') ? f + '0' : f;
	},

	// mouse position in page coordinates, clamped to the visible window
	getAdjustedXY: function (e) {
		let x = e.pageX, y = e.pageY, xClient = e.clientX, yClient = e.clientY;
		if (xClient < 0) {
			x -= xClient;
			xClient = 0;
		} else if (xClient > window.innerWidth) {
			x -= (xClient - window.innerWidth);
			xClient = window.innerWidth;
		}
		if (yClient < 0) {
			y -= yClient;
			yClient = 0;
		}
		return [x, y, xClient, yClient];
	},

	// size of the element as seen by the user when the page is zoomed and the element is scaled back by 1/zoom
	getAdjustedSize: function (obj, zoom) {
		let w = obj.clientWidth, h = obj.clientHeight, offsetW = 0, offsetH = 0;
		if (zoom && zoom !== 1) {
			w = w / zoom;
			h = h / zoom;
			offsetW = (obj.clientWidth - w) / 2;
			offsetH = (obj.clientHeight - h) / 2;
		}
		return [cmn.round(w, 0), cmn.round(h, 0), cmn.round(offsetW, 0), cmn.round(offsetH, 0)];
	},

	insertHtml: function (html) {
		const parent = document.body || document.documentElement;
		parent.insertAdjacentHTML('beforeend', html);
	},

	isUPSTrackingNumber: function (s) {
		// https://en.wikipedia.org/wiki/Tracking_number
		s = s.replace(/ /g, '').toLowerCase();
		return (s.length === 18 && s.startsWith('1z') && utils.isNumber(s.substring(14))) || (s.length === 11 && s.startsWith('t') && utils.isNumber(s.substring(1)));
	},

	isUSPSTrackingNumber: function (s) {
		s = s.replace(/ /g, '').toLowerCase();
		if (s.length === 22) {
			return utils.isNumber(s) && ['92021', '92055', '92088', '92701', '93033', '93748', '94001', '94055', '94071', '94073'].includes(s.substring(0, 5));
		}
		return s.length === 13 && (s.startsWith('ec') || s.startsWith('ea') || s.startsWith('cp')) && s.endsWith('us');
	},

	isFedexTrackingNumber: function (s) {
		// 12 digits with a mod-11 check digit
		s = s.replace(/ /g, '');
		if (s.length !== 12 || !/^\d+$/.test(s)) { return false; }
		const weights = [3, 1, 7, 3, 1, 7, 3, 1, 7, 3, 1];
		const num = Array.from(s, Number);
		let sum = 0;
		for (let i = 0; i < weights.length; i++) { sum += weights[i] * num[i]; }
		return (sum % 11) % 10 === num[11];
	}
};
