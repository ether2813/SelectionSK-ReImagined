'use strict';

/* Offscreen document: plays text-to-speech audio, which a service worker cannot do. */

let audio = null;

chrome.runtime.onMessage.addListener(function (msg) {
	if (!msg || msg.target !== 'offscreen') { return false; }
	if (msg.cmd === 'cmd_offscreen_play') {
		if (audio) { audio.pause(); }
		audio = new Audio(msg.url);
		audio.play().catch(err => console.warn('SelectionSK: audio playback failed', err));
	}
	return false;
});
