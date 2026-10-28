# SiteBlueprint User Manual

Made by **Swapnil Das**.

SiteBlueprint scans a website you have open and gives you two files: a **master prompt** that tells an AI how to rebuild the site's frontend (layout, copy, colors, fonts and animations), and **backend documentation** describing the API calls the site makes.

## Quick start (about 3 minutes)

1. Click the SiteBlueprint icon in Chrome to open the side panel. If you do not see it, click the puzzle-piece icon and pin SiteBlueprint.
2. **Step 1:** choose **Groq (free, recommended)**, press **Get a free key**, sign in, create a key and copy it. Paste it into the panel and press **Test & save**.
3. Open the website you want to copy in the same tab.
4. **Step 3:** press **Scan and make everything**. Wait until the status says Done.
5. Open the **Master prompt** tab, press **Copy**, and paste it into your AI tool.

## Installing from the zip

1. Unzip the downloaded file. Keep the `siteblueprint` folder somewhere permanent (Chrome reads it from there).
2. Go to `chrome://extensions` and turn on **Developer mode** (top right).
3. Press **Load unpacked** and select the `siteblueprint` folder.
4. Pin the extension with the puzzle-piece icon.

## Getting a free API key (Groq)

1. Press **Get a free key** in step 1, or open console.groq.com/keys.
2. Sign up or log in (no payment card needed for the free tier).
3. Press **Create API Key**, give it any name and copy it. It starts with `gsk_`.
4. Paste it in the panel and press **Test & save**. A green "Connected" label means it works.

Other free options are in the provider list (OpenRouter, Cerebras, Google Gemini). Choose **Other** to use any OpenAI-compatible service. Provider model names change from time to time; if a test fails with "model not found", open **Advanced** and fix the model name.

## Scanning a website

- Open the site in the active tab, then press **Scan this page** (or **Scan and make everything**).
- Leave **Reload the page first** ticked so the extension can record every network call from the start.
- The page scrolls by itself for 20 to 40 seconds. This triggers lazy-loaded content and scroll animations, so do not touch the page meanwhile.
- **Pages behind a login:** log in and open the page first, then untick **Reload the page first** and scan. Click around (search, open menus, change tabs) before scanning so those API calls are recorded.

## Tech stack tab

Right after a scan, open the **Tech stack** tab. It lists every technology found on the site, point by point, grouped as: frameworks, UI and styling, animation and graphics, JavaScript libraries, build tooling, hosting and CDN, server-side hints, backend services, CMS and e-commerce, authentication, payments, analytics, monitoring, search and media, maps and embeds, fonts and icons, security, and web platform features. Each item shows the evidence (a script address, a response header, a cookie name or a page marker). It needs no AI key, and the same inventory is added to the master prompt and the backend docs.

Databases and private server tools cannot be seen from a browser, and entries marked "inferred" or "likely" are best guesses.

## Using the master prompt

1. Open the **Master prompt** tab and press **Copy** (or **Download** to get a `.md` file).
2. Paste it into an AI that can write code: Claude, ChatGPT, Cursor, Bolt, Lovable, v0 or similar.
3. If the AI says the prompt is too long, paste it in parts: first "1. Design system", then "2. Page structure", then "3. Animations". Tell it to keep building on the same project.
4. Ask the AI to build the project and run it. Then compare with the original site and ask it to fix differences section by section.
5. Add your own images and content. Scanned image links point to the original site.

## Using the backend docs

The **Backend docs** tab lists the endpoints the site called, with request and response shapes, headers and architecture hints. Give it to a developer or an AI as a specification for a compatible backend. It is documentation, not a prompt.

## Tips for better results

- Scan on a desktop-sized window so desktop layout is captured.
- Scan each important page separately (home, pricing, dashboard) and build them one at a time.
- Use the **Raw scan** tab if you want to feed the full data to your own AI.
- If the free limit is reached, wait a minute (the extension retries by itself) or use another provider.

## Troubleshooting

| Problem | What to do |
|---|---|
| "Your API key was rejected" | Copy the key again from the provider, paste it and press Test & save. |
| "Not found (404)" | Press Test & save again: it now finds a working model for your key automatically. If it still fails, check the Base URL under Advanced (Groq: `https://api.groq.com/openai/v1`). |
| "Too much data per request" | Open Advanced and lower Max input chars per call to 6000. |
| Status says "rate limited, retrying" | Normal on free plans. Wait, it continues automatically. |
| "Open the website you want to scan" | You are on a browser page like chrome://. Open a normal website. |
| Few or no API endpoints listed | Reload and scan again, and interact with the site before scanning. |
| Animations look different | Animations coded in JavaScript or WebGL are approximated. Add a screen recording or description when prompting the AI. |

## Privacy and safety

- Your API key is stored only in this browser and is sent only to the provider you chose.
- Scan data (page structure, text, styles, request shapes) is sent to that provider to write the prompt. Do not scan pages showing private or confidential information.
- Authorization headers, cookies and API keys are redacted. Only the shape of requests and responses is recorded, not personal data values.
- Nothing is sent to the author of this extension.

## Limits

- Backend documentation covers only what the browser can observe. Server code and databases cannot be seen.
- Closed shadow DOM, cross-origin iframes and WebGL shader code cannot be read.
- Use SiteBlueprint to learn and to rebuild your own designs. Do not republish other people's copy, images, logos or code. Respect each site's terms of service and copyright.

## Credits

SiteBlueprint was designed and built by **Swapnil Das**.
