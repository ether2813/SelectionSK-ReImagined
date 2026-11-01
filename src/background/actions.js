'use strict';

/* Things the service worker does on behalf of content scripts, menus, commands and the toolbar button. */

var sskActions = {
	ICON_ON: {
		'16': '/icons/SelectionSK_16.png', '24': '/icons/SelectionSK_24.png', '32': '/icons/SelectionSK_32.png',
		'48': '/icons/SelectionSK_48.png', '64': '/icons/SelectionSK_64.png'
	},
	ICON_OFF: {
		'16': '/icons/SelectionSK_16_grey.png', '24': '/icons/SelectionSK_24_grey.png', '32': '/icons/SelectionSK_32_grey.png',
		'48': '/icons/SelectionSK_48_grey.png', '64': '/icons/SelectionSK_64_grey.png'
	},
	NOTIFICATION_ID: 'ssk-notification',
	_notificationTimer: null,
	_offscreenCreating: null,

	ignore: function () { void chrome.runtime.lastError; },

	activeTab: async function () {
		const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
		return tab || null;
	},

	// sends a message to the top frame of a tab, ignoring tabs without a content script
	sendToTab: async function (tabId, msg, frameId = 0) {
		try {
			return await chrome.tabs.sendMessage(tabId, msg, frameId === null ? undefined : { frameId: frameId });
		} catch (ex) {
			cmn.log(ex);
			return null;
		}
	},

	// ---------- opening things ----------

	isOpenable: function (url) {
		return !!url && !/^\s*(javascript|data|vbscript):/i.test(url);
	},

	// opens urls next to 'srcTab' (or the active tab) according to the "Open in" preference
	openURLs: async function (urls, srcTab) {
		urls = (Array.isArray(urls) ? urls : [urls]).filter(sskActions.isOpenable);
		if (!urls.length) { return; }
		const prefs = await prefDefaults.get();
		const tab = srcTab && srcTab.id >= 0 ? srcTab : await sskActions.activeTab();
		if (prefs.prefOpenInCurrTab && tab && urls.length === 1) {
			await chrome.tabs.update(tab.id, { url: urls[0], active: true });
			return;
		}
		let index = tab ? tab.index + 1 : undefined;
		for (let i = 0; i < urls.length; i++) {
			const props = { url: urls[i], active: !!prefs.prefOpenInNewTab && i === 0 };
			if (tab) {
				props.windowId = tab.windowId;
				props.openerTabId = tab.id;
				props.index = index++;
			}
			await chrome.tabs.create(props);
		}
	},

	openSelectionURL: function (url, selection, srcTab) {
		return sskActions.openURLs(cmn.prepareSearchUrl(url, selection), srcTab);
	},

	openBookmark: async function (bookmarkId, selection, srcTab) {
		const [bookmark] = await chrome.bookmarks.get(String(bookmarkId));
		if (bookmark && bookmark.url) { await sskActions.openSelectionURL(bookmark.url, selection, srcTab); }
	},

	// searches with the browser's default search engine
	search: async function (selection, srcTab) {
		const prefs = await prefDefaults.get();
		const tab = srcTab && srcTab.id >= 0 ? srcTab : await sskActions.activeTab();
		if (prefs.prefOpenInCurrTab && tab) {
			await chrome.search.query({ text: selection, tabId: tab.id });
		} else {
			await chrome.search.query({ text: selection, disposition: 'NEW_TAB' });
		}
	},

	// opens the mail client through a short-lived background tab
	openEmail: async function (to, subj, body) {
		let email = 'mailto:' + (to ? encodeURIComponent(to) : '');
		if (subj || body) {
			email += '?subject=' + encodeURIComponent(subj || '') + '&body=' + encodeURIComponent(body || '');
		}
		const tab = await chrome.tabs.create({ url: email, active: false });
		const started = Date.now();
		// chrome only hands the url to the mail client once the tab stops loading
		const closeWhenLoaded = async function () {
			try {
				const t = await chrome.tabs.get(tab.id);
				if (t.status === 'complete' || Date.now() - started > 5000) {
					await chrome.tabs.remove(tab.id);
				} else {
					setTimeout(closeWhenLoaded, 50);
				}
			} catch (ex) { cmn.log(ex); }
		};
		setTimeout(closeWhenLoaded, 50);
	},

	translatePage: async function (tab) {
		if (!tab || !cmn.isSupportedUrl(tab.url)) { return; }
		const prefs = await prefDefaults.get();
		const url = 'https://translate.google.com/translate?sl=auto&tl=' + encodeURIComponent(prefs.prefTranslationDestLng) +
			'&js=y&u=' + encodeURIComponent(tab.url);
		await sskActions.openURLs(url, tab);
	},

	showConverter: function (tab) {
		if (tab) { return sskActions.sendToTab(tab.id, { cmd: utils.CMD_CONVERT, txt: '0' }); }
	},

	// ---------- toolbar button ----------

	tabStatus: async function (tab, prefs) {
		const url = tab.url || tab.pendingUrl || '';
		if (!cmn.isSupportedUrl(url)) { return { supported: false, enabled: false, domain: '' }; }
		const domain = cmn.domainOf(url);
		return { supported: true, enabled: !prefs.prefBlacklist.includes(domain), domain: domain };
	},

	updateTabStatus: async function (tab, prefs) {
		if (!tab || tab.id === undefined || tab.id < 0) { return; }
		prefs = prefs || await prefDefaults.get();
		const status = await sskActions.tabStatus(tab, prefs);
		let title;
		if (!status.supported) { title = cmn.msg('txtUnavailable'); }
		else { title = cmn.msg(status.enabled ? 'txtDisableAddon' : 'txtEnableAddon') + ' "' + status.domain + '"'; }
		try {
			await chrome.action.setIcon({ tabId: tab.id, path: status.enabled ? sskActions.ICON_ON : sskActions.ICON_OFF });
			await chrome.action.setTitle({ tabId: tab.id, title: title });
			if (!status.enabled) { await chrome.action.setBadgeText({ tabId: tab.id, text: '' }); }
		} catch (ex) { cmn.log(ex); }	// the tab may be gone already
	},

	updateAllTabs: async function () {
		const prefs = await prefDefaults.get();
		const tabs = await chrome.tabs.query({});
		await Promise.all(tabs.map(t => sskActions.updateTabStatus(t, prefs)));
	},

	// toolbar button click: turns the popup off/on for the site of the tab
	toggleStatus: async function (tab) {
		const prefs = await prefDefaults.get();
		const status = await sskActions.tabStatus(tab, prefs);
		if (!status.supported) { return; }
		const blacklist = prefs.prefBlacklist.filter(d => d !== status.domain);
		if (status.enabled) { blacklist.push(status.domain); }
		await chrome.storage.local.set({ prefBlacklist: blacklist });	// storage listener refreshes all tabs
	},

	// briefly greys out the toolbar icon to confirm an auto-copy
	blink: async function (tab) {
		if (!tab || tab.id < 0) { return; }
		try {
			await chrome.action.setIcon({ tabId: tab.id, path: sskActions.ICON_OFF });
		} catch (ex) { return; }
		setTimeout(() => sskActions.updateTabStatus(tab), 500);
	},

	// small text over the toolbar icon (word or highlight count)
	setBadgeText: async function (msg, tab) {
		if (!tab || tab.id < 0) { return; }
		const prefs = await prefDefaults.get();
		if (!prefs.prefCountWords && msg.txt) { return; }
		try {
			if (msg.txt) {
				await chrome.action.setBadgeBackgroundColor({ color: msg.color || '#3399ff', tabId: tab.id });
				if (chrome.action.setBadgeTextColor) { await chrome.action.setBadgeTextColor({ color: '#ffffff', tabId: tab.id }); }
			}
			await chrome.action.setBadgeText({ text: String(msg.txt || ''), tabId: tab.id });
		} catch (ex) { cmn.log(ex); }
	},

	notification: function (txt) {
		chrome.notifications.create(sskActions.NOTIFICATION_ID, {
			type: 'basic',
			iconUrl: cmn.getIconURL('SelectionSK_128.png'),
			title: 'SelectionSK',
			message: String(txt || '')
		}, sskActions.ignore);
		clearTimeout(sskActions._notificationTimer);
		sskActions._notificationTimer = setTimeout(() => chrome.notifications.clear(sskActions.NOTIFICATION_ID, sskActions.ignore), 3000);
	},

	// ---------- text to speech ----------

	ensureOffscreen: async function () {
		const url = chrome.runtime.getURL('src/offscreen/offscreen.html');
		const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
		if (existing.length) { return; }
		if (!sskActions._offscreenCreating) {
			sskActions._offscreenCreating = chrome.offscreen.createDocument({
				url: url,
				reasons: ['AUDIO_PLAYBACK'],
				justification: 'Reads the selected text and its translation aloud.'
			}).catch(function (err) {
				if (!/single offscreen/i.test(String(err && err.message))) { throw err; }
			}).finally(function () {
				sskActions._offscreenCreating = null;
			});
		}
		await sskActions._offscreenCreating;
	},

	play: async function (txt, lng) {
		txt = String(txt || '').trim().slice(0, 200);
		if (!txt) { return; }
		const url = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=' + encodeURIComponent(lng || 'en') +
			'&q=' + encodeURIComponent(txt);
		await sskActions.ensureOffscreen();
		await chrome.runtime.sendMessage({ target: 'offscreen', cmd: utils.CMD_OFFSCREEN_PLAY, url: url });
	},

	// google's tts endpoint expects to be called from its own site
	installRefererRule: async function () {
		try {
			await chrome.declarativeNetRequest.updateSessionRules({
				removeRuleIds: [1],
				addRules: [{
					id: 1,
					priority: 1,
					action: {
						type: 'modifyHeaders',
						requestHeaders: [{ header: 'Referer', operation: 'set', value: 'https://translate.google.com/' }]
					},
					condition: {
						urlFilter: '||translate.google.com/translate_tts',
						tabIds: [chrome.tabs.TAB_ID_NONE],
						resourceTypes: ['media', 'xmlhttprequest', 'other']
					}
				}]
			});
		} catch (ex) { cmn.log(ex); }
	}
};
