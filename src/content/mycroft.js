'use strict';

/*
 * mycroftproject.com integration: adds a SelectionSK icon next to every search engine listed
 * there; clicking it adds the engine to the SelectionSK bookmark folder.
 */

var mycroft = {
	ICON: 'SelectionSK_32.png',

	// reads the OpenSearch description and returns its html search url with %s for the terms
	getSearchURL: async function (xmlUrl) {
		const response = await fetch(xmlUrl, { credentials: 'omit' });
		const xml = new DOMParser().parseFromString(await response.text(), 'text/xml');
		for (const elem of xml.getElementsByTagName('Url')) {
			if (elem.getAttribute('type') !== 'text/html') { continue; }
			let url = elem.getAttribute('template') || '';
			for (const param of elem.getElementsByTagName('Param')) {
				url += (url.indexOf('?') === -1 ? '?' : '&') + param.getAttribute('name') + '=' + param.getAttribute('value');
			}
			return url.replace(/{searchTerms}/gi, '%s').replace(/{(startIndex|startPage)\??}/gi, '1');
		}
		return '';
	},

	addEngine: async function (title, xmlUrl) {
		try {
			const url = await mycroft.getSearchURL(xmlUrl);
			if (!url) { throw new Error('No search url in ' + xmlUrl); }
			await sskSend({ cmd: utils.CMD_ADD_BOOKMARK, title: title, url: url });
		} catch (ex) {
			sskSend({ cmd: utils.CMD_NOTIFY, txt: String(ex && ex.message || ex) });
		}
	},

	integrate: function () {
		if (location.host !== 'mycroftproject.com' || !sskPage.isTop) { return; }
		const iconUrl = cmn.getIconURL(mycroft.ICON);
		for (const link of document.querySelectorAll('a[title^="Ref:"]')) {
			// title looks like "Ref: (12345) (name)"
			const items = link.title.replace(/[()]/g, '').split(/\s+/);
			if (items.length < 3) { continue; }
			const xmlUrl = 'https://mycroftproject.com/installos.php/' + encodeURIComponent(items[2]) + '/' + encodeURIComponent(items[1]) + '.xml';
			const title = link.textContent.trim();
			const icon = document.createElement('img');
			icon.className = 'icon ssk-mycroft-icon';
			icon.src = iconUrl;
			icon.title = 'Add "' + title + '" to SelectionSK';
			icon.addEventListener('click', () => mycroft.addEngine(title, xmlUrl));
			link.before(icon);
		}
		const rows = document.getElementsByClassName('altrowgw');
		if (rows.length && rows[0].lastChild && rows[0].lastChild.firstChild) {
			const tr = document.createElement('tr');
			const td = document.createElement('td');
			const img = document.createElement('img');
			img.className = 'icon';
			img.src = iconUrl;
			td.append(img, ' ' + cmn.msg('txtMycroftAdd'));
			tr.appendChild(td);
			rows[0].lastChild.firstChild.after(tr);
		}
	}
};
