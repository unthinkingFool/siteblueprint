# SiteBlueprint

**Created by Swapnil Das.**

A Chrome extension that scans any website and generates:

1. A **master prompt** to rebuild its frontend, in the same stack as the original, with colors, fonts, layout, exact copy and every animation.
2. **Backend documentation** reverse-documented from what the browser can observe (network calls, headers, tech stack).

It also lists the full **tech stack** of the site with evidence for every item.

It runs on your own free AI key (Groq recommended), so there is no subscription and no server.

## Install (2 minutes)

1. Download and unzip the project. Keep the `siteblueprint` folder somewhere permanent.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the `siteblueprint` folder.
4. Pin the extension, then click its icon to open the side panel. A manual opens on first install.

## Use

1. **Connect a free key:** pick Groq, press *Get a free key*, paste it, press *Test & save*.
2. Open any website, press **Scan and make everything**.
3. Copy the **Master prompt** and paste it into Claude, ChatGPT, Cursor, Bolt, Lovable or v0.

Full instructions: [USER_MANUAL.md](USER_MANUAL.md) (also inside the extension via *Open manual*).

## Project files

| File | Purpose |
|---|---|
| `manifest.json` | Extension configuration (Manifest V3) |
| `hook.js` | Records network calls inside the page (secrets redacted) |
| `content.js` | Extracts design, layout, copy, motion and backend data |
| `background.js` | Talks to the AI provider, splits data to fit free limits |
| `sidepanel.*` | The guided 3-step interface |
| `manual.html`, `manual.js` | In-extension user manual |

## Limits and fair use

Backend docs cover only observable data, not server code. JavaScript or WebGL animations are approximated. Use this tool to learn and to rebuild your own work. Do not republish other people's copy, images, logos or code.

## Author

Swapnil Das. All rights reserved unless a license is added.
