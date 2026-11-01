'use strict';

importScripts(
	'/src/shared/common.js',
	'/src/shared/consts.js',
	'/src/shared/utils.js',
	'/src/shared/defaults.js',
	'/src/background/bookmarks.js',
	'/src/background/popup_builder.js',
	'/src/background/requests.js',
	'/src/background/actions.js',
	'/src/background/context_menu.js'
);

/*
 * Service worker entry point. All listeners are registered synchronously at the top level, as
 * Manifest V3 requires; state is kept in storage or rebuilt on demand because the worker can be
 * stopped at any time.
 */

async function getZoom(tab) {
	try { return tab && tab.id >= 0 ? await chrome.tabs.getZoom(tab.id) : 1.0; } catch (ex) { return 1.0; }
}

// the content script describes the selection; prefs decide the rest
function selectionContext(msg) {
	const ctx = msg.ctx || {};
	ctx.urls = Array.isArray(ctx.urls) ? ctx.urls.map(String) : [];
	ctx.email = ctx.email ? String(ctx.email) : '';
	return ctx;
}

const messageHandlers = {
	[utils.CMD_GET_MENU]: async function (msg, sender) {
		const [prefs, folder, zoom] = await Promise.all([prefDefaults.get(), sskBookmarks.getFolder(), getZoom(sender.tab), sskIcons.load()]);
		return { menu: popupBuilder.buildMenu(selectionContext(msg), prefs, folder), zoom: zoom };
	},
	[utils.CMD_GET_PANEL]: async function (msg, sender) {
		const [prefs, folder, zoom] = await Promise.all([prefDefaults.get(), sskBookmarks.getFolder(), getZoom(sender.tab), sskIcons.load()]);
		return { panel: popupBuilder.buildPanel(selectionContext(msg), prefs, folder), zoom: zoom };
	},
	[utils.CMD_GET_TRANSLATION_PANEL]: async function (msg, sender) {
		const [zoom] = await Promise.all([getZoom(sender.tab), sskIcons.load()]);
		return { panel: popupBuilder.buildTranslationPanel(msg), zoom: zoom, play_img: sskIcons.get('play', msg.icnsClr) };
	},
	[utils.CMD_GET_CONVERT_PANEL]: async function (msg, sender) {
		const [zoom] = await Promise.all([getZoom(sender.tab), sskIcons.load()]);
		return { panel: popupBuilder.buildConvertPanel(msg), zoom: zoom };
	},
	[utils.CMD_OPEN_URL]: (msg, sender) => sskActions.openURLs(msg.urls || msg.url, sender.tab),
	[utils.CMD_OPEN_BOOKMARK]: (msg, sender) => sskActions.openBookmark(msg.id, msg.selection, sender.tab),
	[utils.CMD_MAILTO]: msg => sskActions.openEmail(msg.to, msg.subj, msg.selection),
	[utils.CMD_SEARCH]: (msg, sender) => sskActions.search(msg.selection, sender.tab),
	[utils.CMD_BLINK]: (msg, sender) => sskActions.blink(sender.tab),
	[utils.CMD_SET_BADGE_TEXT]: (msg, sender) => sskActions.setBadgeText(msg, sender.tab),
	[utils.CMD_PLAY]: msg => sskActions.play(msg.txt, msg.lng),
	[utils.CMD_NOTIFY]: msg => sskActions.notification(msg.txt),
	[utils.CMD_ADD_BOOKMARK]: async function (msg) {
		try {
			await sskBookmarks.add(String(msg.title || msg.url), String(msg.url));
			sskActions.notification(cmn.msg('txtBookmarkAdded', [String(msg.title)]));
			return { ok: true };
		} catch (err) {
			sskActions.notification(String(err && err.message || err));
			return { ok: false };
		}
	},
	[utils.CMD_RESTORE_BOOKMARKS]: async function () {
		const prefs = await prefDefaults.get();
		await sskBookmarks.createDefaults(prefs.prefBookmarkFolder, false);
		return { ok: true };
	},
	// network
	[utils.CMD_GOOGLE_DICT]: msg => sskRequests.googleDict(msg),
	[utils.CMD_GOOGLE_TRANSLATE]: msg => sskRequests.googleTranslate(msg),
	[utils.CMD_WORDNIK_DICT]: msg => sskRequests.wordnikDict(msg),
	[utils.CMD_URBAN_DICT]: msg => sskRequests.urbanDict(msg),
	[utils.CMD_YANDEX_DICT]: msg => sskRequests.yandexDict(msg),
	[utils.CMD_MS_DETECT_LNG]: msg => sskRequests.msDetect(msg),
	[utils.CMD_MS_DICT]: msg => sskRequests.msDict(msg),
	[utils.CMD_MS_TRANSLATOR]: msg => sskRequests.msTranslate(msg),
	[utils.CMD_CONV_CURRENCY]: msg => sskRequests.currencyRate(msg)
};

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
	if (!msg || msg.target === 'offscreen') { return false; }
	const handler = messageHandlers[msg.cmd];
	if (!handler) { return false; }
	Promise.resolve()
		.then(() => handler(msg, sender))
		.then(result => sendResponse(result === undefined ? {} : result), function (err) {
			console.error('SelectionSK', msg.cmd, err);
			sendResponse({ error: String(err && err.message || err), data: { ssk_error: true } });
		});
	return true;	// keep the channel open for the async response
});

chrome.runtime.onInstalled.addListener(async function (details) {
	const stored = await chrome.storage.local.get(null);
	// drop preferences of the Firefox version that mean nothing here
	await chrome.storage.local.remove(['prefTkk', 'ffVersion', 'prefReuseContainer', 'prefShortcutPageTranslate', 'prefShortcutShowConverter', 'history']);
	const prefs = prefDefaults.complete(stored);
	await chrome.storage.local.set(prefs);
	try {
		await sskBookmarks.createDefaults(prefs.prefBookmarkFolder, true);
	} catch (ex) { console.error('SelectionSK bookmarks', ex); }
	sskContextMenu.schedule();
	sskActions.updateAllTabs();
	if (details.reason === 'install') { chrome.runtime.openOptionsPage(); }
});

chrome.runtime.onStartup.addListener(function () {
	sskContextMenu.schedule();
	sskActions.updateAllTabs();
});

function onBookmarksChanged() {
	sskBookmarks.invalidate();
	sskContextMenu.schedule();
}
chrome.bookmarks.onCreated.addListener(onBookmarksChanged);
chrome.bookmarks.onRemoved.addListener(onBookmarksChanged);
chrome.bookmarks.onChanged.addListener(onBookmarksChanged);
chrome.bookmarks.onMoved.addListener(onBookmarksChanged);
chrome.bookmarks.onChildrenReordered.addListener(onBookmarksChanged);

chrome.storage.onChanged.addListener(function (changes, area) {
	if (area !== 'local') { return; }
	const keys = Object.keys(changes);
	if (keys.includes('prefBlacklist')) { sskActions.updateAllTabs(); }
	if (keys.some(k => k !== 'prefBlacklist' && k !== 'prefAutoMark')) {
		sskBookmarks.invalidate();
		sskContextMenu.schedule();
	}
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
	sskContextMenu.onClicked(info, tab).catch(err => console.error('SelectionSK menu click', err));
});

chrome.commands.onCommand.addListener(async function (command, tab) {
	tab = tab || await sskActions.activeTab();
	if (!tab) { return; }
	if (command === 'page_translate') { sskActions.translatePage(tab); }
	if (command === 'conversion') { sskActions.showConverter(tab); }
});

chrome.action.onClicked.addListener(tab => sskActions.toggleStatus(tab));

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
	if (changeInfo.status || changeInfo.url) { sskActions.updateTabStatus(tab); }
});

chrome.omnibox.setDefaultSuggestion({ description: 'SelectionSK: ' + cmn.msg('txtPrefTranslation') });
chrome.omnibox.onInputEntered.addListener(async function (text) {
	const tab = await sskActions.activeTab();
	if (tab) { sskActions.sendToTab(tab.id, { cmd: utils.CMD_DEFAULT_TRANSLATE, txt: text }); }
});

sskActions.installRefererRule();
