'use strict';

/* The browser's right-click menu ("Send '...' to") and the toolbar button's menu. */

var sskContextMenu = {
	ROOT_ID: 'ssk_root',
	ACTION_TRANSLATE_PAGE: 'ssk_action_translate_page',
	ACTION_SHOW_CONVERTER: 'ssk_action_show_converter',
	FOLDER_PREFIX: 'ssk_folder_',
	SEPARATOR_PREFIX: 'ssk_sep_',

	// built-in tools that make sense in the browser menu, with the pref that shows them
	TOOLS: {
		ssk_id_google_translate: { label: 'txtGoogleTranslate', pref: 'prefShowGoogleTranslate' },
		ssk_id_wordnik_dict: { label: 'txtWordnikDictionary', pref: 'prefShowWordnikDictionary' },
		ssk_id_urban_dict: { label: 'txtUrbanDictionary', pref: 'prefShowUrbanDictionary' },
		ssk_id_yandex_translate: { label: 'txtYandexTranslate', pref: 'prefShowYandexTranslate' },
		ssk_id_ms_translator: { label: 'txtMsTranslator', pref: 'prefShowMsTranslator' },
		ssk_id_highlight: { label: 'txtHighlight', pref: 'prefShowHighlight' },
		ssk_id_convert: { label: 'txtConvert', pref: 'prefShowConvert' },
		ssk_id_mailto: { label: 'txtMailto', pref: 'prefShowMailto' },
		ssk_id_search: { label: 'txtSearchDefault', pref: 'prefShowSearch' }
	},

	_timer: null,
	_chain: Promise.resolve(),

	// rebuilds are debounced (bookmark edits fire many events) and never overlap
	schedule: function () {
		clearTimeout(sskContextMenu._timer);
		sskContextMenu._timer = setTimeout(function () {
			sskContextMenu._chain = sskContextMenu._chain.then(sskContextMenu.rebuild).catch(err => console.error('SelectionSK menu', err));
		}, 150);
	},

	create: function (props) {
		return new Promise(function (resolve) {
			chrome.contextMenus.create(props, function () {
				if (chrome.runtime.lastError) { cmn.log(chrome.runtime.lastError.message, props); }
				resolve();
			});
		});
	},

	// converts the bookmark tree into a list of menu nodes, dropping hidden tools and empty folders
	buildNodes: function (bookmarks, prefs, used) {
		const nodes = [];
		for (const bm of bookmarks || []) {
			if (!bm.url) {
				const children = sskContextMenu.buildNodes(bm.children, prefs, used);
				if (children.some(n => n.type !== 'separator')) {
					nodes.push({ id: sskContextMenu.FOLDER_PREFIX + bm.id, title: bm.title, children: children });
				}
				continue;
			}
			const sskId = utils.sskIdFromUrl(bm.url);
			if (sskId === utils.ID_SEPARATOR) {
				nodes.push({ type: 'separator' });
			} else if (sskId) {
				const tool = sskContextMenu.TOOLS[sskId];
				if (tool && prefs[tool.pref] && !used.has(sskId)) {
					used.add(sskId);
					nodes.push({ id: sskId, title: cmn.msg(tool.label) });
				}
			} else if (prefs.prefShowBookmarks) {
				nodes.push({ id: utils.ID_BOOKMARK_PREFIX + bm.id, title: bm.title || bm.url });
			}
		}
		// no leading, trailing or doubled separators
		return nodes.filter(function (n, i, all) {
			if (n.type !== 'separator') { return true; }
			if (i === 0 || i === all.length - 1) { return false; }
			return all[i - 1].type !== 'separator';
		});
	},

	createNodes: async function (parentId, nodes, counter) {
		for (const node of nodes) {
			if (node.type === 'separator') {
				await sskContextMenu.create({ id: sskContextMenu.SEPARATOR_PREFIX + (counter.n++), parentId: parentId, type: 'separator', contexts: ['selection'] });
			} else {
				await sskContextMenu.create({ id: node.id, parentId: parentId, title: node.title, contexts: ['selection'] });
				if (node.children) { await sskContextMenu.createNodes(node.id, node.children, counter); }
			}
		}
	},

	rebuild: async function () {
		await chrome.contextMenus.removeAll();
		await sskContextMenu.create({ id: sskContextMenu.ACTION_TRANSLATE_PAGE, title: cmn.msg('txtTranslatePage'), contexts: ['action'] });
		await sskContextMenu.create({ id: sskContextMenu.ACTION_SHOW_CONVERTER, title: cmn.msg('txtShowConverter'), contexts: ['action'] });

		const prefs = await prefDefaults.get();
		if (prefs.prefShowPopupOnly) { return; }
		const folder = await sskBookmarks.getFolder();
		if (!folder) { return; }
		const nodes = sskContextMenu.buildNodes(folder.children, prefs, new Set());
		if (!nodes.length) { return; }
		await sskContextMenu.create({ id: sskContextMenu.ROOT_ID, title: cmn.msg('txtSendTo'), contexts: ['selection'] });
		await sskContextMenu.createNodes(sskContextMenu.ROOT_ID, nodes, { n: 0 });
	},

	onClicked: async function (info, tab) {
		const id = String(info.menuItemId);
		const selection = info.selectionText || '';
		switch (id) {
			case sskContextMenu.ACTION_TRANSLATE_PAGE: return sskActions.translatePage(tab);
			case sskContextMenu.ACTION_SHOW_CONVERTER: return sskActions.showConverter(tab);
			case utils.ID_MAILTO: return sskActions.openEmail('', tab ? tab.url : '', selection);
			case utils.ID_SEARCH: return sskActions.search(selection, tab);
			case utils.ID_HIGHLIGHT:
				// highlight in every frame of the page
				return tab && sskActions.sendToTab(tab.id, { cmd: utils.CMD_RUN_TOOL, tool: id, txt: selection }, null);
			case utils.ID_GOOGLE_TRANSLATE:
			case utils.ID_WORDNIK_DICT:
			case utils.ID_URBAN_DICT:
			case utils.ID_YANDEX_TRANSLATE:
			case utils.ID_MS_TRANSLATOR:
			case utils.ID_CONVERT:
				return tab && sskActions.sendToTab(tab.id, { cmd: utils.CMD_RUN_TOOL, tool: id, txt: selection });
		}
		if (id.startsWith(utils.ID_BOOKMARK_PREFIX)) {
			return sskActions.openBookmark(id.slice(utils.ID_BOOKMARK_PREFIX.length), selection, tab);
		}
	}
};
