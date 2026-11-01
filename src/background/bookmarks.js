'use strict';

/*
 * The SelectionSK bookmark folder drives both the in-page popup and the browser context menu.
 * Regular bookmarks become "search with" items; bookmarks with a https://ssk_id_xxx/ url are
 * placeholders that set the position of the built-in tools (copy, translate, highlight...).
 */

var sskBookmarks = {
	_folder: null,		// cached sub tree of the folder
	_loading: null,		// pending load promise
	_generation: 0,		// bumps on every invalidate so a stale load never lands in the cache

	invalidate: function () {
		sskBookmarks._generation += 1;
		sskBookmarks._folder = null;
		sskBookmarks._loading = null;
	},

	// finds the configured folder; returns its full sub tree or null
	getFolder: async function () {
		if (sskBookmarks._folder) { return sskBookmarks._folder; }
		if (!sskBookmarks._loading) {
			const generation = sskBookmarks._generation;
			sskBookmarks._loading = (async function () {
				const prefs = await prefDefaults.get();
				const found = await chrome.bookmarks.search({ title: prefs.prefBookmarkFolder });
				const folder = found.find(b => !b.url);
				if (!folder) { return null; }
				const [tree] = await chrome.bookmarks.getSubTree(folder.id);
				return tree;
			})().then(function (tree) {
				if (generation === sskBookmarks._generation) { sskBookmarks._folder = tree; }
				return tree;
			}, function (err) {
				if (generation === sskBookmarks._generation) { sskBookmarks._loading = null; }
				throw err;
			});
		}
		return sskBookmarks._loading;
	},

	// built-in tools, in the order they appear in a fresh folder
	defaultSskItems: function () {
		return [
			{ id: utils.ID_COPY, title: 'txtCopy' },
			{ id: utils.ID_PASTE, title: 'txtPaste' },
			{ id: utils.ID_CUT, title: 'txtCut' },
			{ id: utils.ID_DELETE, title: 'txtDelete' },
			{ id: utils.ID_COPY_PLAIN, title: 'txtCopyPlain' },
			{ id: utils.ID_COPY_HTML, title: 'txtCopyHtml' },
			{
				folder: 'txtLngTools', children: [
					{ id: utils.ID_GOOGLE_TRANSLATE, title: 'txtGoogleTranslate' },
					{ id: utils.ID_WORDNIK_DICT, title: 'txtWordnikDictionary' },
					{ id: utils.ID_URBAN_DICT, title: 'txtUrbanDictionary' },
					{ id: utils.ID_YANDEX_TRANSLATE, title: 'txtYandexTranslate' },
					{ id: utils.ID_MS_TRANSLATOR, title: 'txtMsTranslator' }
				]
			},
			{ id: utils.ID_OPEN_URL, title: 'txtOpenUrl' },
			{ id: utils.ID_HIGHLIGHT, title: 'txtHighlight' },
			{ id: utils.ID_CONVERT, title: 'txtConvert' },
			{ id: utils.ID_UPS, title: 'txtUPS' },
			{ id: utils.ID_USPS, title: 'txtUSPS' },
			{ id: utils.ID_FEDEX, title: 'txtFedex' },
			{ id: utils.ID_MAILTO, title: 'txtMailto' },
			{ id: utils.ID_SEARCH, title: 'txtInitSearch' },
			{ id: utils.ID_SEPARATOR, title: 'Separator', raw: true }
		];
	},

	defaultUserItems: function () {
		return [
			{ title: 'StartPage', url: 'https://www.startpage.com/do/search?query=%s' },
			{
				folder: 'txtInitSearch', children: [
					{ title: 'Google', url: 'https://www.google.com/search?q=%s' },
					{ title: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
					{ title: 'Bing', url: 'https://www.bing.com/search?q=%s' },
					{ title: 'Wolfram|Alpha', url: 'https://www.wolframalpha.com/input/?i=%s' },
					{ title: 'Wikipedia (en)', url: 'https://en.wikipedia.org/w/index.php?search=%s' },
					{ title: 'Google Maps', url: 'https://maps.google.com/?q=%s' },
					{ title: 'Google Images', url: 'https://www.google.com/search?site=imghp&tbm=isch&q=%s' }
				]
			},
			{
				folder: 'txtInitDictionary', children: [
					{ title: 'Merriam-Webster', url: 'https://www.merriam-webster.com/dictionary?s=%s' },
					{ title: 'The Free Dictionary', url: 'https://www.thefreedictionary.com/%s' },
					{ title: 'Dictionary.com', url: 'https://www.dictionary.com/browse/%s' },
					{ title: 'OneLook', url: 'https://onelook.com/?w=%s' }
				]
			}
		];
	},

	// creates items in order under parentId starting at 'index' (or appended when index is undefined)
	_createItems: async function (parentId, items, index) {
		for (const item of items) {
			const pos = index === undefined ? {} : { index: index++ };
			if (item.folder) {
				const folder = await chrome.bookmarks.create(Object.assign({ parentId: parentId, title: cmn.msg(item.folder) }, pos));
				await sskBookmarks._createItems(folder.id, item.children);
			} else if (item.id) {
				const title = 'SSK: ' + (item.raw ? item.title : cmn.msg(item.title));
				await chrome.bookmarks.create(Object.assign({ parentId: parentId, title: title, url: utils.sskUrl(item.id) }, pos));
			} else {
				await chrome.bookmarks.create(Object.assign({ parentId: parentId, title: item.title, url: item.url }, pos));
			}
		}
	},

	// (re)creates the folder. keep=true leaves an existing folder alone but adds missing SSK placeholders.
	createDefaults: async function (folderName, keep) {
		sskBookmarks.invalidate();
		const found = (await chrome.bookmarks.search({ title: folderName })).filter(b => !b.url);
		if (keep && found.length) {
			const [tree] = await chrome.bookmarks.getSubTree(found[0].id);
			const hasSsk = function (node) {
				return (node.children || []).some(c => utils.sskIdFromUrl(c.url) || hasSsk(c));
			};
			if (!hasSsk(tree)) { await sskBookmarks._createItems(tree.id, sskBookmarks.defaultSskItems(), 0); }
		} else {
			if (!keep) {
				for (const folder of found) {
					try { await chrome.bookmarks.removeTree(folder.id); } catch (ex) { cmn.log(ex); }
				}
			}
			const root = await chrome.bookmarks.create({ title: folderName, index: 0 });
			await sskBookmarks._createItems(root.id, sskBookmarks.defaultSskItems());
			await sskBookmarks._createItems(root.id, sskBookmarks.defaultUserItems());
		}
		sskBookmarks.invalidate();
	},

	// adds a bookmark to the end of the folder
	add: async function (title, url) {
		const folder = await sskBookmarks.getFolder();
		if (!folder) { throw new Error('Bookmark folder not found'); }
		await chrome.bookmarks.create({ parentId: folder.id, title: title, url: url });
	}
};
