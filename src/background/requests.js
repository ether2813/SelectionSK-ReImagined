'use strict';

/*
 * Network requests for the translator, dictionaries and the currency converter. Content scripts
 * cannot make them because of CORS, so they ask the service worker.
 *
 * Every handler resolves to { data: ... } or { data: { ssk_error: true } }; the currency handler
 * resolves to { rate: number | 'ssk_error' }.
 *
 * API keys are never bundled: services that need one use the key the user typed in the options
 * page, or a free keyless service instead.
 */

var sskRequests = {
	TIMEOUT_MS: 15000,
	_msToken: null,
	_msTokenTime: 0,

	fetchJson: async function (url, options = {}) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), sskRequests.TIMEOUT_MS);
		try {
			const response = await fetch(url, Object.assign({ signal: controller.signal, credentials: 'omit' }, options));
			if (!response.ok && response.status !== 404) { throw new Error('HTTP ' + response.status + ' - ' + url.split('?')[0]); }
			return await response.json();
		} finally {
			clearTimeout(timer);
		}
	},

	// wraps a request so failures turn into the error shape the content script expects
	wrap: async function (fn) {
		try {
			return { data: await fn() };
		} catch (err) {
			sskActions.notification(String(err && err.message || err));
			return { data: { ssk_error: true } };
		}
	},

	// ---------- Google ----------

	googleDict: function (msg) {
		const url = 'https://clients5.google.com/translate_a/single?dj=1&dt=t&dt=sp&dt=ld&dt=bd&client=dict-chrome-ex' +
			'&sl=' + encodeURIComponent(msg.lngSrc) + '&tl=' + encodeURIComponent(msg.lngDst) + '&q=' + encodeURIComponent(msg.txt);
		return sskRequests.wrap(() => sskRequests.fetchJson(url));
	},

	googleTranslate: function (msg) {
		const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t' +
			'&sl=' + encodeURIComponent(msg.lngSrc) + '&tl=' + encodeURIComponent(msg.lngDst) + '&q=' + encodeURIComponent(msg.txt);
		return sskRequests.wrap(() => sskRequests.fetchJson(url));
	},

	// ---------- dictionaries ----------

	// returns a Wordnik-like list: [{ partOfSpeech, text }]
	wordnikDict: async function (msg) {
		const prefs = await prefDefaults.get();
		const key = (prefs.prefKeyWordnik || '').trim();
		if (key) {
			const url = 'https://api.wordnik.com/v4/word.json/' + encodeURIComponent(msg.txt) +
				'/definitions?limit=30&includeRelated=false&useCanonical=true&includeTags=true&api_key=' + encodeURIComponent(key);
			return sskRequests.wrap(() => sskRequests.fetchJson(url));
		}
		// keyless fallback: https://dictionaryapi.dev/
		return sskRequests.wrap(async function () {
			const data = await sskRequests.fetchJson('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(msg.txt.toLowerCase()));
			if (!Array.isArray(data)) { return { message: data && data.message ? data.message : 'No definitions found' }; }
			const list = [];
			for (const entry of data) {
				for (const meaning of entry.meanings || []) {
					for (const def of meaning.definitions || []) {
						list.push({ partOfSpeech: meaning.partOfSpeech, text: def.definition });
					}
				}
			}
			return list.slice(0, 30);
		});
	},

	urbanDict: function (msg) {
		const url = 'https://api.urbandictionary.com/v0/define?term=' + encodeURIComponent(msg.txt);
		return sskRequests.wrap(() => sskRequests.fetchJson(url));
	},

	yandexDict: async function (msg) {
		const prefs = await prefDefaults.get();
		const key = (prefs.prefKeyYandexDict || '').trim();
		if (!key) { return { data: { ssk_error: true, no_key: true } }; }
		const url = 'https://dictionary.yandex.net/api/v1/dicservice.json/lookup?key=' + encodeURIComponent(key) +
			'&lang=' + encodeURIComponent(msg.lngSrc + '-' + msg.lngDst) + '&text=' + encodeURIComponent(msg.txt) + '&flags=4';
		return sskRequests.wrap(() => sskRequests.fetchJson(url));
	},

	// ---------- Microsoft ----------

	msToken: async function () {
		// tokens are valid for 10 minutes, reuse them for 8
		if (sskRequests._msToken && Date.now() - sskRequests._msTokenTime < 8 * 60 * 1000) { return sskRequests._msToken; }
		const response = await fetch('https://edge.microsoft.com/translate/auth', { credentials: 'omit' });
		if (!response.ok) { throw new Error('HTTP ' + response.status + ' - Microsoft Translator auth'); }
		sskRequests._msToken = await response.text();
		sskRequests._msTokenTime = Date.now();
		return sskRequests._msToken;
	},

	msPost: async function (url, txt) {
		const token = await sskRequests.msToken();
		return sskRequests.fetchJson(url, {
			method: 'POST',
			headers: { 'authorization': 'Bearer ' + token, 'content-type': 'application/json' },
			body: JSON.stringify([{ Text: txt }])
		});
	},

	msDetect: function (msg) {
		return sskRequests.wrap(() => sskRequests.msPost('https://api.cognitive.microsofttranslator.com/detect?api-version=3.0', msg.txt));
	},

	msDict: function (msg) {
		const url = 'https://api.cognitive.microsofttranslator.com/dictionary/lookup?api-version=3.0' +
			'&from=' + encodeURIComponent(msg.lngSrc) + '&to=' + encodeURIComponent(msg.lngDst);
		return sskRequests.wrap(() => sskRequests.msPost(url, msg.txt));
	},

	msTranslate: function (msg) {
		const from = msg.lngSrc && msg.lngSrc !== 'auto' ? '&from=' + encodeURIComponent(msg.lngSrc) : '';
		const url = 'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=' + encodeURIComponent(msg.lngDst) + from;
		return sskRequests.wrap(async function () {
			const data = await sskRequests.msPost(url, msg.txt);
			// keep the shape stable when the source language was given explicitly
			if (Array.isArray(data) && data[0] && !data[0].detectedLanguage) {
				data[0].detectedLanguage = { language: msg.lngSrc };
			}
			return data;
		});
	},

	// ---------- currency ----------

	// codes used by the free currency api that differ from ours
	CURRENCY_API_CODES: { 'DSH': 'dash' },

	currencyRate: async function (msg) {
		const src = msg.src_conv, dst = msg.dst_conv;
		try {
			const prefs = await prefDefaults.get();
			const key = (prefs.prefKeyCryptoCompare || '').trim();
			if (key) {
				const url = 'https://min-api.cryptocompare.com/data/price?fsym=' + encodeURIComponent(src) + '&tsyms=' + encodeURIComponent(dst) +
					'&api_key=' + encodeURIComponent(key);
				const data = await sskRequests.fetchJson(url);
				return { rate: Number(data[dst]) || 0 };
			}
			// keyless fallback: https://github.com/fawazahmed0/exchange-api (covers fiat, crypto and metals)
			const code = c => (sskRequests.CURRENCY_API_CODES[c] || c).toLowerCase();
			const path = 'v1/currencies/' + code(src) + '.min.json';
			let data;
			try {
				data = await sskRequests.fetchJson('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/' + path);
			} catch (ex) {
				data = await sskRequests.fetchJson('https://latest.currency-api.pages.dev/' + path);
			}
			const rates = data && data[code(src)];
			return { rate: rates ? Number(rates[code(dst)]) || 0 : 0 };
		} catch (err) {
			sskActions.notification(String(err && err.message || err));
			return { rate: 'ssk_error' };
		}
	}
};
