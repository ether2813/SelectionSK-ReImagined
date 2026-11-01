# SelectionSK ReImagined

A rewrite of the [SelectionSK](https://addons.mozilla.org/firefox/addon/selectionsk/) extension (v6.0, Firefox, Manifest V2) for **Chrome and Chromium-based browsers using Manifest V3** (Chrome, Edge, Brave, Vivaldi, Opera, …; Chrome 116 or newer).

Select text on any page and SelectionSK pops up a menu (or a compact icon pane) with tools for the selection:

- **Clipboard**: copy, copy as plain text, copy as HTML, cut, paste, delete, auto-copy on select, Ctrl+C with no selection copies the page title and URL
- **Language tools**: Google Translate, Microsoft Translator, Yandex, Wordnik and Urban Dictionary in an in-page pane, with text-to-speech
- **Search**: every bookmark in the *SelectionSK* bookmark folder becomes a "search with" item (`%s` is replaced by the selection); Mycroft Project integration adds search engines with one click
- **Highlight** all occurrences in 10 colors (S / W to jump between them, Esc to clear)
- **Convert** currencies (including crypto), temperature, mass and length
- **Open** URLs found in the selection, **e-mail** the selection, track **UPS / USPS / FedEx** numbers
- Word counter on the toolbar badge; click the toolbar button to turn the popup off for a site
- The same tools in the browser's right-click menu ("Send '…' to")

## Install (developer mode)

1. Download or clone this repository.
2. Open `chrome://extensions`, turn on **Developer mode**.
3. Click **Load unpacked** and pick the repository folder.

The options page opens after installation. Shortcuts (default `Ctrl+Shift+0` translate page, `Ctrl+Shift+1` converter) can be changed at `chrome://extensions/shortcuts`. Type `t` + space in the address bar to translate a phrase.

## What changed compared to SelectionSK 6.0

- **Manifest V3**: the background page is now a service worker; blocking `webRequest` became a `declarativeNetRequest` session rule; text-to-speech plays in an offscreen document; context menus use `contextMenus.onClicked`; the toolbar icon state is kept per tab.
- **Chrome only**: Firefox-specific code (containers, `browser.search`, shortcut editing, menu icons) was removed. "Search with default engine" uses `chrome.search`.
- **Donation panel removed.**
- **New options page**: sidebar navigation, setting search, auto-save, toggle switches and segmented controls, live previews of the menu, pane, translation and converter styles, a language picker with filter, a list of disabled sites, the current keyboard shortcuts, backup/restore as JSON and light/dark themes. The in-page popup and the right-click menu look as before.
- **No bundled API keys.** Wordnik, CryptoCompare and Yandex Dictionary keys can be entered under *Options → API keys*. Without them SelectionSK uses keyless services: the [Free Dictionary API](https://dictionaryapi.dev/) for definitions, the [Currency API](https://github.com/fawazahmed0/exchange-api) for exchange rates and Microsoft Translator for single-word lookups.
- **Safer page injection**: bookmark titles, selected URLs and every dictionary or translation response are escaped before they are added to the page.
- Smaller fixes: the highlight item followed the "Open URL" setting, the Ctrl+C option was ignored, S/W jumped between highlights while typing in a text box, out-of-order translation responses could overwrite newer ones, and Microsoft tokens are cached.

## Project layout

```
manifest.json
src/background/   service worker: bookmarks, popup html, context menu, network requests, actions
src/content/      content scripts: selection & popup, translator pane, converter pane, Mycroft
src/offscreen/    audio playback for text-to-speech
src/options/      options page
src/shared/       helpers, constants and default preferences used everywhere
css/              styles of the in-page popup and panes
lib/              mark.js and googleDocsUtil.js
_locales/         translations (15 languages; new option strings fall back to English)
icons/
```

## Permissions

| Permission | Why |
| --- | --- |
| `<all_urls>` host access | show the popup on every page, call translation and dictionary services |
| `bookmarks` | the SelectionSK bookmark folder defines the popup items |
| `clipboardRead`, `clipboardWrite` | copy / paste items |
| `contextMenus` | the right-click menu |
| `declarativeNetRequestWithHostAccess` | sets the Referer header Google's text-to-speech expects |
| `notifications` | errors and confirmations |
| `offscreen` | plays text-to-speech audio |
| `search` | "Search with default engine" |
| `storage` | preferences |
| `tabs` | open results next to the current tab, per-tab toolbar state, page zoom |

## License

The original code is © 2011–2023 Andrey Shemetov, available under MPL 1.1 / GPL 3.0 / LGPL 3.0 (see `license.txt`). Third-party libraries are listed in `lib/LIBRARIES.txt`.
