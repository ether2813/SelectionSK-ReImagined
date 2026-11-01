'use strict';

/* Default preferences. Loaded by the service worker and the options page. */

var prefDefaults = {
	DEFAULTS: {
		// internal
		prefBlacklist: [],
		prefAutoMark: '',
		// general
		prefBookmarkFolder: 'SelectionSK',
		prefShowPopupOnly: false,
		prefShowContextOnly: false,
		prefShowPopupContext: true,
		prefAutoCopy: true,
		prefAutoCopyPlain: false,
		prefAllowACInTextBox: false,
		prefBlinkOnCopy: true,
		prefCountWords: true,
		prefCtrlC: true,
		prefCtrlCPattern: '{title} ({URL})',
		prefOpenInNewTab: true,
		prefOpenInBgTab: false,
		prefOpenInCurrTab: false,
		prefFavDuck: true,
		prefFavGoogle: false,
		prefEnableSelection: true,
		// popup
		prefShowAsMenu: true,
		prefShowAsPanel: false,
		prefShowAsTranslation: false,
		prefUnobtrusive: false,
		prefShowCopy: true,
		prefShowCopyPlain: true,
		prefShowCopyHtml: false,
		prefShowGoogleTranslate: true,
		prefShowWordnikDictionary: true,
		prefShowUrbanDictionary: true,
		prefShowYandexTranslate: false,
		prefShowMsTranslator: true,
		prefShowOpenUrl: true,
		prefShowHighlight: true,
		prefShowConvert: true,
		prefShowTrackingNumbers: true,
		prefShowMailto: true,
		prefShowSearch: false,
		prefShowBookmarks: true,
		prefAllowInTextBox: true,
		prefHideOnScroll: true,
		prefHideOnMoveMouseAway: true,
		prefKeepSelection: false,
		prefKeepPopup: false,
		// translation
		prefTranslationDestLng: 'en',
		prefTranslationSelectedLng: ['all'],
		prefDefaultTranslator: 'g',
		prefTranscriptionOwnLine: false,
		prefInstantTranslationKey: 'ControlLeftControlRight',
		// highlighter
		prefAutoSelectColors: true,
		prefIgnorePunctuation: false,
		prefAutoHighlight: false,
		prefInstantHighlightKey: 'ShiftLeftShiftRight',
		prefBkColor_0: '#c100c1', prefTxColor_0: '#ffffff',
		prefBkColor_1: '#ffa500', prefTxColor_1: '#000000',
		prefBkColor_2: '#0000ff', prefTxColor_2: '#ffffff',
		prefBkColor_3: '#ffff00', prefTxColor_3: '#000000',
		prefBkColor_4: '#b22222', prefTxColor_4: '#ffffff',
		prefBkColor_5: '#00ff40', prefTxColor_5: '#000000',
		prefBkColor_6: '#0080c0', prefTxColor_6: '#ffffff',
		prefBkColor_7: '#ff8080', prefTxColor_7: '#000000',
		prefBkColor_8: '#4b0082', prefTxColor_8: '#ffffff',
		prefBkColor_9: '#80ffff', prefTxColor_9: '#000000',
		// conversion
		prefConversionDestCur: 'USD',
		prefConversionDestTemp: 'F',
		prefConversionDestMass: 'P_1',
		prefConversionDestLen: 'F_1',
		prefInstantConversionKey: 'AltLeftAltRight',
		// appearance - menu
		prefMenuFontSize: 15,
		prefMenuFontColor: '#0d0d0d',
		prefMenuIconsColor: '#000000',
		prefMenuBkColor: '#f0f0f0',
		// appearance - panel
		prefPanelItemsN: 0,
		prefPanelItemsNRows: true,
		prefPanelItemsNCols: false,
		prefPanelBkColor: '#f0f0f0',
		prefPanelIconsColor: '#000000',
		prefPanelPadding: 1,
		prefPanelRoundness: 2,
		prefPanelIconSize: 18,
		prefPanelIconPadding: 2,
		// appearance - translation
		prefTranslationFontSize: 14,
		prefTranslationFontColor: '#000000',
		prefTransIconsColor: '#000000',
		prefTranslationBkColor: '#fffef2',
		prefTranslationBorderColor: '#2e5186',
		prefTranslationLngColor: '#993333',
		prefTranslationEngineColor: '#2e5186',
		// appearance - conversion
		prefConversionFontSize: 14,
		prefConversionFontColor: '#000000',
		prefConversionIconsColor: '#000000',
		prefConversionBkColor: '#fffef2',
		prefConversionBorderColor: '#5d6d79',
		prefConversionConverterColor: '#2e5186',
		prefConversionUnitColor: '#993333',
		// api keys (optional, supplied by the user)
		prefKeyWordnik: '',
		prefKeyCryptoCompare: '',
		prefKeyYandexDict: ''
	},

	// keys that are never exported to a backup file
	INTERNAL: ['prefAutoMark'],

	// returns stored prefs completed with defaults for anything missing
	complete: function (prefs) {
		return Object.assign({}, prefDefaults.DEFAULTS, prefs || {});
	},

	// keeps only known keys with a value of the expected type (used when restoring a backup)
	sanitize: function (data) {
		const out = {};
		if (!data || typeof data !== 'object') { return out; }
		for (const [key, def] of Object.entries(prefDefaults.DEFAULTS)) {
			if (!(key in data)) { continue; }
			const val = data[key];
			if (Array.isArray(def)) {
				if (Array.isArray(val)) { out[key] = val.filter(v => typeof v === 'string'); }
			} else if (typeof def === 'number') {
				const n = Number(val);
				if (Number.isFinite(n)) { out[key] = n; }
			} else if (typeof def === typeof val) {
				out[key] = val;
			}
		}
		return out;
	},

	get: async function () {
		return prefDefaults.complete(await chrome.storage.local.get(null));
	}
};
