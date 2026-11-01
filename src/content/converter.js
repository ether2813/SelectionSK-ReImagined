'use strict';

/* Converter pane: currency, temperature, mass and length. */

var converter = {
	event: null,
	converter: utils.ID_CONV_TEMPERATURE,
	src_conv: null,
	dst_conv: null,
	src_val: '',
	dst_val: '',
	wait_timeout: null,
	zoom: 1.0,
	request_id: 0,

	TABLES: {
		ssk_id_conv_currency: () => [const_cur, const_cur.C],
		ssk_id_conv_temperature: () => [const_temp, const_temp.T],
		ssk_id_conv_mass: () => [const_mass, const_mass.M],
		ssk_id_conv_len: () => [const_len, const_len.L]
	},

	addConverterValues: function (srcConv, dstConv) {
		const srcSelect = document.getElementById('ssk_id_conv_src');
		const dstSelect = document.getElementById('ssk_id_conv_dst');
		if (!srcSelect.onchange) {
			srcSelect.onchange = converter.onChange;
			dstSelect.onchange = converter.onChange;
		}
		srcSelect.textContent = '';
		dstSelect.textContent = '';
		const [obj, items] = converter.TABLES[converter.converter]();
		const fontSize = sskPage.prefs.prefConversionFontSize - 2;
		for (const item in items) {
			const description = obj.getDescription(item);
			const make = function (select, prefix, selected) {
				const option = document.createElement('option');
				option.textContent = description;
				option.value = item;
				option.id = prefix + item;
				option.classList.add('ssk-converterpanel-select-option');
				if (selected) {
					option.selected = true;
					select.style.setProperty('width', utils.getTextWidth(description, fontSize), 'important');
				}
				select.appendChild(option);
			};
			make(srcSelect, 'ssk_id_conv_src', item === srcConv);
			make(dstSelect, 'ssk_id_conv_dst', item === dstConv);
		}
	},

	addConverters: function () {
		const select = document.getElementById('ssk_id_conv');
		if (!select.onchange) { select.onchange = converter.onChange; }
		select.textContent = '';
		const converters = {
			txtConvCurrency: utils.ID_CONV_CURRENCY,
			txtConvTemperature: utils.ID_CONV_TEMPERATURE,
			txtConvMass: utils.ID_CONV_MASS,
			txtConvLen: utils.ID_CONV_LEN
		};
		for (const [label, value] of Object.entries(converters)) {
			const option = document.createElement('option');
			option.value = value;
			option.textContent = cmn.msg(label);
			option.id = 'ssk_id_conv' + label;
			option.classList.add('ssk-converterpanel-select-option');
			if (value === converter.converter) {
				option.selected = true;
				select.style.setProperty('width', utils.getTextWidth(option.textContent, sskPage.prefs.prefConversionFontSize - 2), 'important');
			}
			select.appendChild(option);
		}
	},

	// a unit, converter or value was changed (e) or the swap button was pressed (e == null)
	onChange: function (e) {
		const value = id => { const s = document.getElementById(id); return s.options[s.selectedIndex].value; };
		let src = value('ssk_id_conv_src');
		let dst = value('ssk_id_conv_dst');
		const conv = value('ssk_id_conv');
		let val = utils.getNumber(document.getElementById('ssk_id_conv_src_val').value);
		if (e == null) {
			[src, dst] = [dst, src];
			val = converter.dst_val;
		} else if (conv !== converter.converter) {
			src = null;		// another converter: use its default units
			dst = null;
		}
		switch (conv) {
			case utils.ID_CONV_CURRENCY: converter.currency(null, val, src, dst); break;
			case utils.ID_CONV_TEMPERATURE: converter.temperature(null, val, src, dst); break;
			case utils.ID_CONV_MASS: converter.mass(null, val, src, dst); break;
			case utils.ID_CONV_LEN: converter.len(null, val, src, dst); break;
		}
	},

	onMouseUp: function (e) {
		switch (e.target.id) {
			case 'ssk_id_conv_reverse': converter.onChange(null); return;
			case 'ssk_id_conv_close': converter.hideConverter(); return;
		}
		if (!isSskElement(e.target)) { converter.hideConverter(); }
	},

	showWaitCursor: function () {
		if (converter.wait_timeout) { window.clearTimeout(converter.wait_timeout); }
		converter.wait_timeout = window.setTimeout(converter.hideWaitCursor, 5000);
		if (document.body) { document.body.classList.add('ssk-converterpanel-waiting'); }
	},

	hideWaitCursor: function () {
		if (converter.wait_timeout) { window.clearTimeout(converter.wait_timeout); converter.wait_timeout = null; }
		if (document.body) { document.body.classList.remove('ssk-converterpanel-waiting'); }
	},

	// detects the kind of value in the text and converts it with the default destination unit
	convert: function (e, txt) {
		const prefs = sskPage.prefs;
		const cur = const_cur.hasSymbol(txt);
		if (cur) {
			const num = ['EUR', 'PLN'].includes(cur) ? utils.getNumberEur(txt) : utils.getNumber(txt);
			return converter.currency(e, num, cur, prefs.prefConversionDestCur);
		}
		const temp = const_temp.hasSymbol(txt);
		if (temp) { return converter.temperature(e, utils.getNumber(txt), temp, prefs.prefConversionDestTemp); }
		const mass = const_mass.hasSymbol(txt);
		if (mass) { return converter.mass(e, utils.getNumber(txt), mass, prefs.prefConversionDestMass); }
		const len = const_len.hasSymbol(txt);
		if (len) { return converter.len(e, utils.getNumber(txt), len, prefs.prefConversionDestLen); }
		converter.temperature(e, utils.getNumber(txt), 'C', prefs.prefConversionDestTemp);
	},

	currency: async function (e, value, srcCur, dstCur) {
		converter.converter = utils.ID_CONV_CURRENCY;
		converter.src_conv = srcCur || 'EUR';
		converter.dst_conv = dstCur || sskPage.prefs.prefConversionDestCur;
		if (converter.src_conv === converter.dst_conv) {
			converter.showConverter(e, utils.formatFloat(value, 4), utils.formatFloat(value, 4));
			return;
		}
		converter.showWaitCursor();
		const id = ++converter.request_id;
		const response = await sskSend({ cmd: utils.CMD_CONV_CURRENCY, src_conv: converter.src_conv, dst_conv: converter.dst_conv });
		if (id !== converter.request_id) { return; }
		if (!response || response.rate === 'ssk_error') { converter.hideWaitCursor(); return; }
		converter.showConverter(e, utils.formatFloat(value, 4), utils.formatFloat(value * response.rate, 4));
	},

	temperature: function (e, value, srcTemp, dstTemp) {
		converter.converter = utils.ID_CONV_TEMPERATURE;
		converter.src_conv = srcTemp || 'C';
		converter.dst_conv = dstTemp || sskPage.prefs.prefConversionDestTemp;
		value = Number(value) || 0.0;
		let result;
		switch (converter.src_conv + converter.dst_conv) {
			case 'FC': result = (value - 32) * 5 / 9; break;
			case 'CF': result = (value * 9 / 5) + 32; break;
			case 'CK': result = value + 273.15; break;
			case 'KC': result = value - 273.15; break;
			case 'KF': result = (value - 273.15) * 9 / 5 + 32; break;
			case 'FK': result = (value - 32) * 5 / 9 + 273.15; break;
			default: result = value;
		}
		converter.showConverter(e, utils.formatFloat(value, 2), utils.formatFloat(result, 2));
	},

	// unit codes look like 'KG_0.001' (system_factor); metric <-> imperial needs one extra factor
	linear: function (e, value, srcUnit, dstUnit, crossFactors) {
		const [srcSys, srcFactor] = srcUnit.split('_');
		const [dstSys, dstFactor] = dstUnit.split('_');
		value = Number(value) || 0.0;
		const result = value * (parseFloat(srcFactor) / parseFloat(dstFactor)) * (crossFactors[srcSys + dstSys] || 1);
		converter.showConverter(e, utils.formatFloat(value, 12), utils.formatFloat(result, 12));
	},

	mass: function (e, value, srcMass, dstMass) {
		converter.converter = utils.ID_CONV_MASS;
		converter.src_conv = srcMass || 'KG_1';
		converter.dst_conv = dstMass || sskPage.prefs.prefConversionDestMass;
		converter.linear(e, value, converter.src_conv, converter.dst_conv, { 'KGP': 2.20462262, 'PKG': 0.45359237 });
	},

	len: function (e, value, srcLen, dstLen) {
		converter.converter = utils.ID_CONV_LEN;
		converter.src_conv = srcLen || 'M_1';
		converter.dst_conv = dstLen || sskPage.prefs.prefConversionDestLen;
		converter.linear(e, value, converter.src_conv, converter.dst_conv, { 'MF': 3.28084, 'FM': 0.3048 });
	},

	styleConverter: function () {
		const prefs = sskPage.prefs;
		if (converter.zoom !== 1) {
			const panel = document.getElementById('ssk_id_converter_panel');
			panel.style.setProperty('transform', cmn.fmt('scale({0})', cmn.round(1 / converter.zoom, 2)), 'important');
		}
		const size = parseInt(prefs.prefConversionFontSize, 10) || 14;
		const font = 'Roboto,sans-serif';
		cmn.setStyleProp('ssk-converterpanel', { 'font-size': size + 'px', 'background-color': prefs.prefConversionBkColor, 'color': prefs.prefConversionFontColor, 'border-color': prefs.prefConversionBorderColor, 'font-family': font });
		cmn.setStyleProp('ssk-converterpanel-value', { 'font-size': size + 'px', 'min-height;max-height': (size + 2) + 'px', 'color;-webkit-text-fill-color': prefs.prefConversionFontColor, 'border-color': prefs.prefConversionUnitColor, 'font-family': font });
		cmn.setStyleProp('ssk-converterpanel-select', { 'font-size': size + 'px', 'min-height;max-height': (size + 2) + 'px', 'color': prefs.prefConversionUnitColor, 'font-family': font });
		cmn.setStyleProp('ssk-converterpanel-select-converter', { 'font-size': size + 'px', 'color': prefs.prefConversionConverterColor });
		cmn.setStyleProp('ssk-converterpanel-button', { 'min-width;max-width;min-height;max-height': (size + 2) + 'px' });
		// some sites style inputs and selects with !important
		cmn.setStyleProp('ssk-converterpanel', { 'line-height': 'normal' });
		cmn.setStyleProp('ssk-converterpanel-value', { 'width': 'auto', 'padding': '2px', 'background-color': '#fff', 'border': '1px solid ' + prefs.prefConversionUnitColor, 'box-sizing': 'content-box' });
		cmn.setStyleProp('ssk-converterpanel-select', { 'background-color': 'transparent' });
	},

	adjustConverter: function (setSource, val, valConv) {
		const prefs = sskPage.prefs;
		converter.addConverterValues(converter.src_conv, converter.dst_conv);
		converter.addConverters();
		if (setSource) { document.getElementById('ssk_id_conv_src_val').value = val; }
		document.getElementById('ssk_id_conv_dst_val').value = valConv;
		converter.styleConverter();
		const e = converter.event;
		const panel = document.getElementById('ssk_id_converter_panel');
		let [x, y, xClient, yClient] = utils.getAdjustedXY(e);
		const [w, h, offsetW, offsetH] = utils.getAdjustedSize(panel, converter.zoom);
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
	},

	showConverter: async function (e, val, valConv) {
		converter.hideWaitCursor();
		sskPage.enteredSsk = false;
		converter.src_val = val;
		converter.dst_val = valConv;
		const prefs = sskPage.prefs;
		if (e == null && document.getElementById('ssk_id_converter_panel')) {
			converter.adjustConverter(false, val, valConv);
			return;
		}
		if (e == null) { e = converter.event || { pageX: 0, pageY: 0, clientX: 0, clientY: 0 }; }
		converter.hideConverter();
		translator.hideTranslation();
		converter.event = e;
		const posFixed = (e.pageX === 0 && e.pageY === 0) || !prefs.prefHideOnScroll;
		const response = await sskSend({ cmd: utils.CMD_GET_CONVERT_PANEL, pos_fixed: posFixed, icnsClr: prefs.prefConversionIconsColor });
		if (!response || !response.panel) { return; }
		converter.hideConverter();
		converter.zoom = response.zoom || 1;
		utils.insertHtml(response.panel);
		window.addEventListener('mouseup', converter.onMouseUp, true);
		if (prefs.prefHideOnMoveMouseAway) { window.addEventListener('mousemove', onMouseMove); }
		blockContextMenu(true);
		document.getElementById('ssk_id_conv_src_val').oninput = converter.onChange;
		converter.adjustConverter(true, val, valConv);
	},

	hideConverter: function () {
		converter.hideWaitCursor();
		converter.request_id += 1;
		const panel = document.getElementById('ssk_id_converter_panel');
		if (!panel) { return; }
		window.removeEventListener('mouseup', converter.onMouseUp, true);
		window.removeEventListener('mousemove', onMouseMove);
		blockContextMenu(false);
		panel.remove();
	}
};
