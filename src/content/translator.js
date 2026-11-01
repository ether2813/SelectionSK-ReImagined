'use strict';

/*
 * Translation pane: Google Translate, Microsoft Translator, Yandex (dictionary), Wordnik and Urban
 * Dictionary. Requests go through the service worker; everything received is escaped before it is
 * put into the page.
 */

var translator = {
	event: null,
	engine: utils.ID_GOOGLE_TRANSLATE,
	details_url: '',
	src_lng: null,
	dst_lng: null,
	txt: '',
	trans_txt: '',
	trans_txt_copy: '',
	wait_timeout: null,
	play_img: '',
	zoom: 1.0,
	request_id: 0,		// only the answer to the latest request is shown

	EOL: '<br class="ssk-translationpanel-eol">',

	em: function (txt) {
		return '<em class="ssk-translationpanel-em">' + cmn.escapeHtml(txt) + ':</em>&nbsp;';
	},

	xref: function (html) {
		return '<xref class="ssk-translationpanel-xref">' + html + '</xref>';
	},

	// keeps <xref>/<strong> cross references of dictionary texts, escapes everything else
	sanitizeDictText: function (text) {
		const marked = String(text || '')
			.replace(/<(xref|strong)\b[^>]*>/gi, '\u0001')
			.replace(/<\/(xref|strong)\s*>/gi, '\u0002')
			.replace(/<\/?[^>]+(>|$)/g, '');
		return cmn.escapeHtml(marked)
			.replace(/\u0001/g, '<xref class="ssk-translationpanel-xref">')
			.replace(/\u0002/g, '</xref>');
	},

	send: async function (msg) {
		const response = await sskSend(msg);
		return response && response.data ? response.data : { ssk_error: true };
	},

	// ---------- pane controls ----------

	engineCode: function () {
		switch (translator.engine) {
			case utils.ID_GOOGLE_TRANSLATE: return 'gt';
			case utils.ID_YANDEX_TRANSLATE: return 'y';
			case utils.ID_MS_TRANSLATOR: return 'ms';
		}
		return '';
	},

	addLanguages: function (lngSrc, lngDst) {
		const prefs = sskPage.prefs;
		const srcSelect = document.getElementById('ssk_id_lng_src');
		const dstSelect = document.getElementById('ssk_id_lng_dst');
		if (!srcSelect.onchange) {
			srcSelect.onchange = translator.onChange;
			dstSelect.onchange = translator.onChange;
		}
		srcSelect.textContent = '';
		dstSelect.textContent = '';
		const engineCode = translator.engineCode();
		const fontSize = prefs.prefTranslationFontSize - 2;
		for (const code in const_lng.L) {
			if (!(const_lng.isSupported(code, engineCode, prefs.prefTranslationSelectedLng) || code === lngSrc || code === lngDst)) { continue; }
			const native = const_lng.getNativeName(code);
			const description = const_lng.getDescription(code);
			const make = function (select, prefix, selected) {
				const option = document.createElement('option');
				option.value = code;
				option.id = prefix + code;
				option.classList.add('ssk-translationpanel-select-option');
				option.textContent = selected ? native : description;
				if (selected) {
					option.selected = true;
					option.title = select.title = const_lng.getShortDescription(code);
					select.style.setProperty('width', utils.getTextWidth(native, fontSize), 'important');
				}
				select.appendChild(option);
			};
			make(srcSelect, 'ssk_id_src', code === lngSrc);
			make(dstSelect, 'ssk_id_dst', code === lngDst);
		}
	},

	addEngines: function () {
		const select = document.getElementById('ssk_id_engine');
		if (!select.onchange) { select.onchange = translator.onChange; }
		select.textContent = '';
		const engines = {
			txtGoogleTranslate: utils.ID_GOOGLE_TRANSLATE,
			txtWordnikDictionary: utils.ID_WORDNIK_DICT,
			txtUrbanDictionary: utils.ID_URBAN_DICT,
			txtYandexTranslate: utils.ID_YANDEX_TRANSLATE,
			txtMsTranslator: utils.ID_MS_TRANSLATOR
		};
		for (const [label, value] of Object.entries(engines)) {
			const option = document.createElement('option');
			option.value = value;
			option.textContent = cmn.msg(label);
			option.id = 'ssk_id_engine' + label;
			option.classList.add('ssk-translationpanel-select-option');
			if (value === translator.engine) {
				option.selected = true;
				select.style.setProperty('width', utils.getTextWidth(option.textContent, sskPage.prefs.prefTranslationFontSize - 2), 'important');
			}
			select.appendChild(option);
		}
	},

	// a language or engine was changed (e) or the swap button was pressed (e == null)
	onChange: function (e) {
		const value = id => { const s = document.getElementById(id); return s.options[s.selectedIndex].value; };
		let src = value('ssk_id_lng_src');
		let dst = value('ssk_id_lng_dst');
		const engine = value('ssk_id_engine');
		let txt = translator.txt;
		if (e == null) {
			[src, dst] = [dst, src];
			txt = translator.trans_txt || translator.txt;
		} else if (e.target.id === 'ssk_id_engine') {
			src = 'auto';
		}
		switch (engine) {
			case utils.ID_GOOGLE_TRANSLATE: translator.googleTranslate(null, txt, src, dst); break;
			case utils.ID_WORDNIK_DICT: translator.wordnikDict(null, txt); break;
			case utils.ID_URBAN_DICT: translator.urbanDict(null, txt); break;
			case utils.ID_YANDEX_TRANSLATE: translator.yandexTranslate(null, txt, src, dst); break;
			case utils.ID_MS_TRANSLATOR: translator.msTranslator(null, txt, src, dst); break;
		}
	},

	onMouseUp: function (e) {
		switch (e.target.id) {
			case 'ssk_id_translation_open':
				sskSend({ cmd: utils.CMD_OPEN_URL, url: translator.details_url });
				translator.hideTranslation();
				return;
			case 'ssk_id_translation_copy':
				// right click copies the original text too
				copyPlain(e.button === 2 ? translator.txt + ': ' + translator.trans_txt_copy : translator.trans_txt_copy);
				translator.hideTranslation();
				return;
			case 'ssk_id_lng_reverse': translator.onChange(null); return;
			case 'ssk_id_translation_close': translator.hideTranslation(); return;
			case 'ssk_id_translation_play_orig': translator.play(true); return;
			case 'ssk_id_translation_play_trans': translator.play(false); return;
		}
		if (!isSskElement(e.target)) { translator.hideTranslation(); }
	},

	play: function (isOrig) {
		sskSend({
			cmd: utils.CMD_PLAY,
			txt: isOrig ? translator.txt : (translator.trans_txt || translator.trans_txt_copy),
			lng: isOrig ? translator.src_lng : translator.dst_lng
		});
	},

	showWaitCursor: function () {
		if (translator.wait_timeout) { window.clearTimeout(translator.wait_timeout); }
		translator.wait_timeout = window.setTimeout(translator.hideWaitCursor, 5000);
		if (document.body) { document.body.classList.add('ssk-translationpanel-waiting'); }
	},

	hideWaitCursor: function () {
		if (translator.wait_timeout) { window.clearTimeout(translator.wait_timeout); translator.wait_timeout = null; }
		if (document.body) { document.body.classList.remove('ssk-translationpanel-waiting'); }
	},

	// starts a request; returns a function telling whether its answer is still wanted
	begin: function () {
		translator.showWaitCursor();
		const id = ++translator.request_id;
		return () => id === translator.request_id;
	},

	fail: function () {
		translator.hideWaitCursor();
	},

	// ---------- engines ----------

	defaultTranslate: function (e, txt) {
		const prefs = sskPage.prefs;
		if (prefs.prefDefaultTranslator === 'y') {
			translator.yandexTranslate(e, txt, 'auto', prefs.prefTranslationDestLng);
		} else if (prefs.prefDefaultTranslator === 'm') {
			translator.msTranslator(e, txt, 'auto', prefs.prefTranslationDestLng);
		} else {
			translator.googleTranslate(e, txt, 'auto', prefs.prefTranslationDestLng);
		}
	},

	// single words: translation plus dictionary entries
	googleDict: async function (e, txt, lngSrc, lngDst) {
		const current = translator.begin();
		translator.details_url = 'https://translate.google.com/?sl=' + encodeURIComponent(lngSrc) + '&tl=' + encodeURIComponent(lngDst) +
			'&text=' + encodeURIComponent(txt) + '&op=translate';
		const data = await translator.send({ cmd: utils.CMD_GOOGLE_DICT, txt: txt, lngSrc: lngSrc, lngDst: lngDst });
		if (!current()) { return; }
		if (data.ssk_error || !data.sentences) { translator.fail(); return; }
		const strings = [];
		const transcription = data.sentences.length > 1 && data.sentences[1].src_translit ? data.sentences[1].src_translit : '';
		translator.trans_txt = data.sentences[0].trans || '';
		strings.push(cmn.escapeHtml(translator.trans_txt));
		if (Array.isArray(data.dict)) {
			strings.push('');
			for (const entry of data.dict) {
				strings.push((entry.pos ? translator.em(entry.pos) : '&nbsp;&nbsp;&nbsp;') + cmn.escapeHtml((entry.terms || []).join(', ')));
			}
		}
		if (data.src) { lngSrc = data.src === 'iw' ? 'he' : data.src; }	// google still reports Hebrew as 'iw'
		translator.showTranslation(e, txt, transcription, strings, true, lngSrc, lngDst);
	},

	googleTranslate: async function (e, txt, lngSrc, lngDst) {
		translator.engine = utils.ID_GOOGLE_TRANSLATE;
		if (utils.isWord(txt)) { return translator.googleDict(e, txt, lngSrc, lngDst); }
		const current = translator.begin();
		translator.details_url = 'https://translate.google.com/?sl=' + encodeURIComponent(lngSrc) + '&tl=' + encodeURIComponent(lngDst) +
			'&text=' + encodeURIComponent(txt) + '&op=translate';
		const data = await translator.send({ cmd: utils.CMD_GOOGLE_TRANSLATE, txt: txt, lngSrc: lngSrc, lngDst: lngDst });
		if (!current()) { return; }
		if (data.ssk_error || !Array.isArray(data[0])) { translator.fail(); return; }
		const parts = data[0].map(p => String(p[0] || '').replace(/[\r\n]/g, ''));
		translator.trans_txt = parts.join(' ');
		const detected = data[2] === 'iw' ? 'he' : data[2];
		translator.showTranslation(e, txt, '', parts.map(cmn.escapeHtml), true, detected || lngSrc, lngDst);
	},

	wordnikDict: async function (e, txt) {
		translator.engine = utils.ID_WORDNIK_DICT;
		const current = translator.begin();
		translator.details_url = 'https://www.wordnik.com/words/' + encodeURIComponent(txt);
		const data = await translator.send({ cmd: utils.CMD_WORDNIK_DICT, txt: txt });
		if (!current()) { return; }
		if (data.ssk_error) { translator.fail(); return; }
		const strings = [];
		if (Array.isArray(data)) {
			for (const def of data) {
				if (def.text) { strings.push((def.partOfSpeech ? translator.em(def.partOfSpeech) : '&nbsp;&nbsp;&nbsp;') + translator.sanitizeDictText(def.text)); }
			}
		}
		if (data.message) { strings.push(cmn.escapeHtml(data.message)); }
		if (txt !== txt.toLowerCase()) {
			strings.push('You may find more data at ' + translator.xref(cmn.escapeHtml(txt.toLowerCase())));
		}
		translator.trans_txt = '';
		translator.showTranslation(e, txt, '', strings, false, translator.src_lng || 'en', translator.dst_lng || sskPage.prefs.prefTranslationDestLng);
	},

	urbanDict: async function (e, txt) {
		translator.engine = utils.ID_URBAN_DICT;
		const current = translator.begin();
		translator.details_url = 'https://www.urbandictionary.com/define.php?term=' + encodeURIComponent(txt);
		const data = await translator.send({ cmd: utils.CMD_URBAN_DICT, txt: txt });
		if (!current()) { return; }
		if (data.ssk_error || !Array.isArray(data.list)) { translator.fail(); return; }
		// [word] marks a link to another definition
		const strings = data.list.map(item => '&nbsp;&nbsp;&nbsp;' + cmn.escapeHtml(item.definition || '')
			.replace(/\[/g, '<xref class="ssk-translationpanel-xref">').replace(/\]/g, '</xref>'));
		translator.trans_txt = '';
		translator.showTranslation(e, txt, '', strings, false, translator.src_lng || 'en', translator.dst_lng || sskPage.prefs.prefTranslationDestLng);
	},

	// detects the language with Microsoft Translator (Yandex's detect api is no longer free)
	detect: async function (txt, lngSrc) {
		if (lngSrc && lngSrc !== 'auto') { return lngSrc; }
		const data = await translator.send({ cmd: utils.CMD_MS_DETECT_LNG, txt: txt });
		if (data.ssk_error) { return null; }
		return (Array.isArray(data) && data[0] && data[0].language) || 'en';
	},

	yandexDict: async function (e, txt, lngSrc, lngDst) {
		const current = translator.begin();
		translator.details_url = 'https://translate.yandex.com/?source_lang=' + encodeURIComponent(lngSrc) + '&target_lang=' + encodeURIComponent(lngDst) +
			'&text=' + encodeURIComponent(txt);
		const src = await translator.detect(txt, lngSrc);
		if (!current()) { return; }
		if (!src) { translator.fail(); return; }
		const data = await translator.send({ cmd: utils.CMD_YANDEX_DICT, txt: txt, lngSrc: src, lngDst: lngDst });
		if (!current()) { return; }
		const strings = [];
		let transcription = '';
		if (!data.ssk_error && Array.isArray(data.def)) {
			data.def.forEach(function (def, i) {
				const translations = (def.tr || []).map(t => t.text);
				if (i === 0 && translations.length) {
					transcription = def.ts || '';
					translator.trans_txt = translations[0];
					strings.push(cmn.escapeHtml(translator.trans_txt));
					strings.push('');
				}
				strings.push((def.pos ? translator.em(def.pos) : '&nbsp;&nbsp;&nbsp;') + cmn.escapeHtml(translations.join(', ')));
			});
		}
		if (strings.length) {
			translator.showTranslation(e, txt, transcription, strings, true, src, lngDst);
		} else {
			// no dictionary entry (or no API key): translate the word instead
			translator.yandexTranslate(e, txt, 'auto', lngDst, true);
		}
	},

	// Yandex's translation api is no longer free, so its text translations come from Microsoft Translator
	yandexTranslate: async function (e, txt, lngSrc, lngDst, force = false) {
		translator.engine = utils.ID_YANDEX_TRANSLATE;
		if (!force && utils.isWord(txt)) { return translator.yandexDict(e, txt, lngSrc, lngDst); }
		const current = translator.begin();
		translator.details_url = 'https://translate.yandex.com/?target_lang=' + encodeURIComponent(lngDst) + '&text=' + encodeURIComponent(txt);
		const data = await translator.send({ cmd: utils.CMD_MS_TRANSLATOR, txt: txt, lngSrc: lngSrc, lngDst: lngDst });
		if (!current()) { return; }
		translator.showMsTranslation(e, txt, data, lngDst);
	},

	showMsTranslation: function (e, txt, data, lngDst) {
		if (data.ssk_error || !Array.isArray(data) || !data[0] || !data[0].translations) { translator.fail(); return; }
		translator.trans_txt = data[0].translations[0].text;
		const detected = data[0].detectedLanguage ? data[0].detectedLanguage.language : 'auto';
		translator.showTranslation(e, txt, '', [cmn.escapeHtml(translator.trans_txt)], true, const_lng.Override[detected] || detected, lngDst);
	},

	msDict: async function (e, txt, lngSrc, lngDst) {
		const current = translator.begin();
		translator.details_url = 'https://www.bing.com/translator/?text=' + encodeURIComponent(txt) + '&to=' + encodeURIComponent(lngDst);
		const src = await translator.detect(txt, lngSrc);
		if (!current()) { return; }
		if (!src) { translator.fail(); return; }
		const data = await translator.send({ cmd: utils.CMD_MS_DICT, txt: txt, lngSrc: src, lngDst: lngDst });
		if (!current()) { return; }
		const strings = [];
		if (!data.ssk_error && Array.isArray(data) && data[0] && Array.isArray(data[0].translations)) {
			data[0].translations.forEach(function (t, i) {
				if (i === 0) {
					translator.trans_txt = t.displayTarget;
					strings.push(cmn.escapeHtml(translator.trans_txt));
					strings.push('');
				}
				strings.push(translator.em(String(t.posTag || '').toLowerCase()) + cmn.escapeHtml(t.displayTarget));
			});
		}
		if (strings.length) {
			translator.showTranslation(e, txt, '', strings, true, src, lngDst);
		} else {
			translator.msTranslator(e, txt, 'auto', lngDst, true);
		}
	},

	msTranslator: async function (e, txt, lngSrc, lngDst, force = false) {
		translator.engine = utils.ID_MS_TRANSLATOR;
		if (!force && utils.isWord(txt)) { return translator.msDict(e, txt, lngSrc, lngDst); }
		const current = translator.begin();
		translator.details_url = 'https://www.bing.com/translator/?text=' + encodeURIComponent(txt) + '&to=' + encodeURIComponent(lngDst);
		const data = await translator.send({ cmd: utils.CMD_MS_TRANSLATOR, txt: txt, lngSrc: lngSrc, lngDst: lngDst });
		if (!current()) { return; }
		translator.showMsTranslation(e, txt, data, lngDst);
	},

	// ---------- pane ----------

	styleTranslation: function (isMultiLng, transcription) {
		const prefs = sskPage.prefs;
		if (translator.zoom !== 1) {
			const panel = document.getElementById('ssk_id_translation_panel');
			panel.style.setProperty('transform', cmn.fmt('scale({0})', cmn.round(1 / translator.zoom, 2)), 'important');
		}
		// language selectors only make sense for translators
		for (const id of ['ssk_id_lng_src', 'ssk_id_lng_reverse', 'ssk_id_lng_dst']) {
			document.getElementById(id).style.setProperty('display', isMultiLng ? 'inline' : 'none', 'important');
		}
		document.getElementById('ssk_id_engine').style.setProperty('display', 'inline', 'important');
		const size = parseInt(prefs.prefTranslationFontSize, 10) || 14;
		const font = 'Roboto,sans-serif';
		cmn.setStyleProp('ssk-translationpanel', { 'font-size': size + 'px', 'background-color': prefs.prefTranslationBkColor, 'color': prefs.prefTranslationFontColor, 'border-color': prefs.prefTranslationBorderColor, 'font-family': font });
		cmn.setStyleProp('ssk-translationpanel-origtext', { 'font-size': size + 'px', 'background-color': prefs.prefTranslationBkColor, 'color': prefs.prefTranslationFontColor, 'font-family': font });
		if (prefs.prefTranscriptionOwnLine && transcription) {
			cmn.setStyleProp('ssk-translationpanel-origtext', { 'line-height': '1.0' });
		}
		cmn.setStyleProp('ssk-translationpanel-translation', { 'font-size': size + 'px', 'background-color': prefs.prefTranslationBkColor, 'color': prefs.prefTranslationFontColor, 'font-family': font });
		cmn.setStyleProp('ssk-translationpanel-select', { 'font-size': (size - 2) + 'px', 'min-height;max-height': (size + 2) + 'px', 'color': prefs.prefTranslationLngColor, 'font-family': font });
		cmn.setStyleProp('ssk-translationpanel-select-engine', { 'font-size': (size - 2) + 'px', 'color': prefs.prefTranslationEngineColor });
		cmn.setStyleProp('ssk-translationpanel-button', { 'min-width;max-width;min-height;max-height': (size + 2) + 'px' });
		cmn.setStyleProp('ssk-translationpanel-em', { 'color': prefs.prefTransIconsColor });
		// some sites style every select with !important
		cmn.setStyleProp('ssk-translationpanel-select', { 'background-color': 'transparent' });
	},

	adjustTranslation: function (txt, transcription, strings, isMultiLng) {
		const prefs = sskPage.prefs;
		translator.addLanguages(translator.src_lng, translator.dst_lng);
		translator.addEngines();
		const shownTxt = txt.length > 100 ? txt.substr(0, 100) + '...' : txt;
		const playImg = cmn.escapeHtml(translator.play_img);
		const playOrig = "<img id='ssk_id_translation_play_orig' src='" + playImg + "' class='ssk-translationpanel-button ssk-translationpanel-playbutton'/>&nbsp;";
		const playTrans = isMultiLng ? "<img id='ssk_id_translation_play_trans' src='" + playImg + "' class='ssk-translationpanel-button ssk-translationpanel-playbutton'/>&nbsp;" : '';
		const transcriptionHtml = transcription
			? (prefs.prefTranscriptionOwnLine ? translator.EOL + '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;' : ' ') + '[' + cmn.escapeHtml(transcription) + ']'
			: '';
		document.getElementById('ssk_id_translation').innerHTML =
			"<span id='ssk_id_translation_origtext' class='ssk-translationpanel-origtext'>" + playOrig + cmn.escapeHtml(shownTxt) + transcriptionHtml + '</span>' +
			playTrans + strings.join(translator.EOL);
		translator.styleTranslation(isMultiLng, transcription);

		const plain = document.createElement('div');
		plain.innerHTML = strings.join('\n');
		translator.trans_txt_copy = plain.textContent.replace(/ /g, ' ');

		// position: next to the selection, or centered when opened from a menu/shortcut
		const e = translator.event;
		const panel = document.getElementById('ssk_id_translation_panel');
		let [x, y, xClient, yClient] = utils.getAdjustedXY(e);
		const [w, h, offsetW, offsetH] = utils.getAdjustedSize(panel, translator.zoom);
		if (e.pageX === 0 && e.pageY === 0) {
			x = (window.innerWidth - w) / 2;
			y = (window.innerHeight - h) / 2;
		} else if (!prefs.prefHideOnScroll) {
			x = xClient - offsetW;
			y = yClient - offsetH;
		}
		if (xClient + w + 10 > window.innerWidth) { x = Math.max(x - w, 0); }
		if (yClient + h + 10 > window.innerHeight) { y = Math.max(y - yClient, Math.max(y - h - 10, 0)); }
		panel.style.setProperty('left', x + 'px', 'important');
		panel.style.setProperty('top', y + 'px', 'important');

		// Wordnik and Urban Dictionary link to other entries
		for (const elem of document.getElementsByClassName('ssk-translationpanel-xref')) {
			elem.addEventListener('click', function (ev) {
				if (translator.engine === utils.ID_WORDNIK_DICT) { translator.wordnikDict(null, ev.target.textContent); }
				if (translator.engine === utils.ID_URBAN_DICT) { translator.urbanDict(null, ev.target.textContent); }
			});
		}
	},

	showTranslation: async function (e, txt, transcription, strings, isMultiLng, lngSrc, lngDst) {
		translator.hideWaitCursor();
		sskPage.enteredSsk = false;
		translator.txt = txt;
		translator.src_lng = lngSrc || translator.src_lng;
		translator.dst_lng = lngDst || translator.dst_lng;
		const prefs = sskPage.prefs;
		if (e == null && document.getElementById('ssk_id_translation_panel')) {
			translator.adjustTranslation(txt, transcription, strings, isMultiLng);
			return;
		}
		if (e == null) { e = translator.event || { pageX: 0, pageY: 0, clientX: 0, clientY: 0 }; }
		translator.hideTranslation();
		converter.hideConverter();
		translator.event = e;
		const posFixed = (e.pageX === 0 && e.pageY === 0) || !prefs.prefHideOnScroll;
		const response = await sskSend({ cmd: utils.CMD_GET_TRANSLATION_PANEL, pos_fixed: posFixed, icnsClr: prefs.prefTransIconsColor });
		if (!response || !response.panel) { return; }
		translator.hideTranslation();
		translator.play_img = response.play_img;
		translator.zoom = response.zoom || 1;
		utils.insertHtml(response.panel);
		window.addEventListener('mouseup', translator.onMouseUp, true);
		if (prefs.prefHideOnMoveMouseAway) { window.addEventListener('mousemove', onMouseMove); }
		blockContextMenu(true);
		translator.adjustTranslation(txt, transcription, strings, isMultiLng);
	},

	hideTranslation: function () {
		translator.hideWaitCursor();
		translator.request_id += 1;	// drop answers that are still on their way
		const panel = document.getElementById('ssk_id_translation_panel');
		if (!panel) { return; }
		window.removeEventListener('mouseup', translator.onMouseUp, true);
		window.removeEventListener('mousemove', onMouseMove);
		blockContextMenu(false);
		panel.remove();
	}
};
