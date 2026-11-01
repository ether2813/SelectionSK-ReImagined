'use strict';

/*
 * Helpers shared by every part of the extension: the service worker (via importScripts),
 * the content scripts and the options page. Nothing here may touch the DOM at load time,
 * because the service worker has no DOM.
 */

var cmn = {
	DEBUG: false,

	BK_COLORS: ['#1628aa', '#93711d', '#e91e63', '#5a3877', '#42365f', '#5006ca', '#17cbe8', '#3f3e03', '#277634', '#4a1a00',
		'#fd079f', '#256437', '#000000', '#17a361', '#cf17ba', '#1e38f3', '#f92947', '#0d8abc', '#0080c0', '#e44201', '#009688'],

	log: function (...args) {
		if (cmn.DEBUG) { console.log('[SelectionSK]', ...args); }
	},

	// fmt('{0} and {1}', a, b) or fmt('{name}', {name: 'x'}); unknown placeholders are left untouched
	fmt: function (str, ...args) {
		const values = (args.length === 1 && args[0] !== null && typeof args[0] === 'object') ? args[0] : args;
		return String(str).replace(/\{([^{}]+)\}/g, function (match, key) {
			return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match;
		});
	},

	msg: function (key, subs) {
		return chrome.i18n.getMessage(key, subs) || key;
	},

	escapeHtml: function (str) {
		return String(str == null ? '' : str)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	},

	round: function (num, places) {
		return +(Math.round(num + 'e+' + places) + 'e-' + places);
	},

	getIconURL: function (name) {
		return chrome.runtime.getURL('icons/' + name);
	},

	// host (with port) of the url, '' when the url has no meaningful host
	domainOf: function (url) {
		try { return new URL(url).host; } catch (ex) { return ''; }
	},

	// SelectionSK can only run where content scripts can be injected
	isSupportedUrl: function (url) {
		try {
			const u = new URL(url);
			if (!['http:', 'https:', 'file:', 'ftp:'].includes(u.protocol)) { return false; }
			return !/^(chrome\.google\.com|chromewebstore\.google\.com)$/.test(u.host);
		} catch (ex) { return false; }
	},

	// any css color ('#abc', '#aabbcc', 'rgb(1, 2, 3)', 'rgba(...)') -> '#rrggbb'
	toHex: function (color, fallback = '#000000') {
		if (!color) { return fallback; }
		color = String(color).trim();
		let m = /^#([0-9a-f]{3})$/i.exec(color);
		if (m) { return '#' + m[1].split('').map(c => c + c).join('').toLowerCase(); }
		m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
		if (m) { return '#' + m[1].toLowerCase(); }
		m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color);
		if (m) { return '#' + [m[1], m[2], m[3]].map(n => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join(''); }
		return fallback;
	},

	isBlack: function (color) {
		return cmn.toHex(color, '') === '#000000';
	},

	svgDataUrl: function (svg) {
		return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
	},

	// square icon with a letter, used for the highlighter colors and as a fallback favicon
	getLetterIcon: function (letter, fg, bg) {
		const svg = cmn.fmt('<svg width="160" height="160" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">' +
			'<rect x="0" y="0" rx="10" ry="10" width="160" height="160" fill="{0}"/>' +
			'<text x="80" y="140" font-family="sans-serif" text-anchor="middle" font-weight="500" font-size="170px" fill="{1}">{2}</text></svg>',
			cmn.toHex(bg), cmn.toHex(fg), cmn.escapeHtml(letter));
		return cmn.svgDataUrl(svg);
	},

	// letter icon whose background color is derived from the text
	getTxtLetterIcon: function (txt) {
		txt = String(txt || '');
		let sum = 0;
		for (const ch of txt) { sum += ch.charCodeAt(0); }
		const letters = txt.replace(/\W/g, '');
		return cmn.getLetterIcon(letters.length ? letters[0].toUpperCase() : 'A', '#ffffff', cmn.BK_COLORS[sum % cmn.BK_COLORS.length]);
	},

	// sets the given properties with !important on every element with class 'cls';
	// a key may hold several properties separated by ';'
	setStyleProp: function (cls, propsValues) {
		const elems = document.getElementsByClassName(cls);
		for (const elem of elems) {
			for (const [props, value] of Object.entries(propsValues)) {
				for (const prop of props.split(';')) {
					elem.style.setProperty(prop, value, 'important');
				}
			}
		}
	},

	prepareSearchUrl: function (url, txt) {
		if (url.indexOf('%s') !== -1) {
			return url.replace('%s', encodeURIComponent(txt));
		}
		return url + encodeURIComponent(txt);
	}
};
