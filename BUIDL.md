# Caption Studio — DoraHacks BUIDL

## Name
Caption Studio

## One-liner
Product descriptions, social captions and hashtags in your brand's voice — one brief, six platforms, ready to post.

## Tags
AI, Anna, AI-Native Apps, Productivity, Copywriting, E-commerce, Social Media

## Description

### The problem
Small sellers on Etsy, Shopify and marketplaces write the same product story over and over: a shop listing, then an Instagram caption, a TikTok caption, a Pinterest pin. Every platform wants a different length, structure and hashtag style. Generic AI chat helps, but you have to re-explain your brand voice each time, copy-paste between platforms, and check character limits by hand.

### The solution
Caption Studio is an Anna App that turns one product brief into ready-to-post copy for six platforms at once, always in the seller's own brand voice.

1. **Save your brand voice once.** How it sounds, who buys, words to never use, emoji style. Several brands can be stored and switched.
2. **Describe the product.** Name, what makes it worth buying, an optional call to action.
3. **Pick where it will be posted.** Shop listing, Instagram, TikTok, Pinterest, LinkedIn, X.
4. **Get 2–5 variants per platform**, each taking a different angle (benefit, story, feeling, practical detail), with hashtags and a live length check against the platform limit.
5. **Refine with one click:** shorter, warmer, or a stronger call to action. Copy and post.

Output in 12 languages. The last 12 results are saved and can be reopened.

### How AI is used
- Each platform gets its own `anna.llm.complete` request with a platform-specific format guide (length, structure, hashtag count) plus the saved brand voice.
- The model answers in strict JSON, which the app validates and renders as individual "hang tags" with copy buttons and length meters.
- Rewrites send a single variant back with one targeted instruction.
- Guardrail: the prompt forbids inventing prices, materials, awards or discounts the user did not provide.
- Brand voices, the last brief and history persist per user with `anna.storage`.

### Fit with Anna
Caption Studio is a pure Anna App: a static SPA bundle running in the Anna iframe, using the host LLM and host storage. No separate backend, no API keys, no extra accounts — install and start writing.

### Who it's for
Etsy and Shopify sellers, marketplace resellers, social media managers and freelance copywriters — people who write product copy every week, which makes it a daily-use tool rather than a one-off demo.

### Roadmap
- Inline use in chat: `#caption-studio write an Instagram caption for…`
- Image input: upload a product photo and let a vision model draft the brief.
- Content calendar export (CSV) for a week of posts.
- Brand voice import from existing posts.

## Links
- Code: https://github.com/ElTanque81/caption-studio
- Anna App: (link after publishing)
- Demo video: (optional)
