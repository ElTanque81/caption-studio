<img src="docs/logo-256.png" alt="Caption Studio logo" width="96">

# Caption Studio

An Anna App that writes product descriptions, social media captions and hashtags in your brand's voice.

Built for the [Anna AI App Builder Program](https://dorahacks.io/hackathon/2349/detail) on DoraHacks.

![Caption Studio](docs/screenshots/1-captions.png)

## What it does

Small sellers write the same kind of copy every day: a shop listing, then an Instagram caption, then a TikTok caption, then a pin. Caption Studio turns one product brief into all of them.

- **Start from a photo.** Drop, paste or pick a product photo. It is resized in the browser and sent to the host's vision model with `anna.llm.complete` (text + image block); the model fills in the product name and the details it can see, and is told never to guess sizes, prices, brands or materials. One click undoes it. A model without image support gets a clear message.
- **Brand voices.** Save how your brand sounds, who buys, words to avoid and emoji style. Every text uses it. Switch between several brands.
- **Six platforms.** Shop listing, Instagram, TikTok, Pinterest, LinkedIn and X, each with its own length, structure and hashtag count.
- **Several angles per platform.** Benefit, story, feeling, practical detail.
- **Length check.** Each variant shows its length against the platform limit and turns red when it is too long.
- **Share in one click.** "Post on X" and "Post on LinkedIn" open a pre-filled post. For Instagram, TikTok and Pinterest the text is copied and the site opens, ready to paste next to your photo or video. "Copy all platforms" copies everything at once.
- **One-click rewrites.** Shorter, longer, warmer, or a stronger call to action, per variant. "Shorter" and "Longer" always move in the right direction: the result is checked in code, retried once if needed, and never accepted if it went the wrong way or past the platform limit. "Longer" only adds detail from the product information the user gave. Each button switches off at a sensible minimum or maximum for the platform.
- **Five interface languages.** English, German, Chinese, Russian and Hindi, picked from the browser language and switchable in the header; the choice is saved per user.
- **14 copy languages.** The copy language follows the interface language unless the user picks another one.
- **History.** The last 12 results are saved and can be reopened.
- **No invented facts.** The prompt forbids inventing prices, materials, awards or discounts the user did not give.

## How AI is used

The app calls the host LLM with `anna.llm.complete`. Each platform gets its own request with a platform-specific format guide and the brand voice, and the model answers in strict JSON (`{"variants":[{"text","hashtags"}]}`) that the UI renders and validates. Rewrites send the chosen variant back with a single instruction. Brand voices, the last brief and history are stored per user with `anna.storage`.

## Project layout

| Path | What |
|---|---|
| `app.json` | Store listing (name, tagline, description, category) |
| `manifest.json` | Schema 3 manifest: static SPA bundle, `llm.complete`, `storage.get/set`, `chat.write_message`, `window.set_title` |
| `bundle/index.html` | UI |
| `bundle/style.css` | Styles, light and dark |
| `bundle/app.js` | App logic, prompts, storage, photo input |
| `bundle/i18n.js` | Interface texts in English, German, Chinese, Russian and Hindi |
| `bundle/icon.svg`, `logo.svg` | Window icon and store logo (source) |
| `docs/logo-256.png`, `logo-512.png`, `logo-1024.png` | Store logo as PNG (`logo_file` in app.json) |
| `docs/screenshots/` | Store screenshots (`screenshots` in app.json, uploaded by `anna-app publish`) |
| `fixtures/happy-path.jsonl` | Canned LLM answer for offline testing |

No backend and no Executa: everything runs in the Anna iframe.

## Run locally

```bash
npm install
npm run validate          # schema + permission checks
npm run dev:mock          # local harness with a canned AI answer, no account needed
anna-app login --host https://anna.partners
npm run dev               # local harness against the real Anna model
```

The harness opens at http://localhost:5180/.

Opening `bundle/index.html` from a plain web server also works: the app detects that it is not inside Anna and shows sample copy.

## Publish

```bash
anna-app login --host https://anna.partners
npm run publish
```

Then submit the version for review in the Anna developer console.

## License

MIT
