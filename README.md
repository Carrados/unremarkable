# unremarkable.me

The home of Unremarkable, the studio behind the "Site by Unremarkable" line at the foot of each site it makes.

## The rule

Unremarkable never is. Everything about it, the design, the writing and this site, has to be impressive, to people reading by eye, by screen reader or by braille, and to the agents they send. Any change to this repo is held to that rule.

## As if

The site is design fiction: it is written as if Unremarkable were a business that designs, builds and looks after websites for organisations, with real prices, terms and a way in. It isn't trading. The As If standard (`src/as-if.html`, published at /as-if/) keeps that honest: everything inside is done for real, every page says it's fiction directly under its main heading, nothing that would take your name, email or money keeps anything, and llms.txt and every Markdown version say so too. The note comes from `AS_IF` in `build.mjs`; when the business is real, set it to `false`, give the date on /as-if/, and make the Start form keep enquiries, with a privacy notice first.

## Build

Needs Node 18 or later. Nothing else.

```
node build.mjs
```

The finished site is written to `site/`. It is built to Zero Information Casualty v1.7: static HTML, no JavaScript, and an agent surface (llms.txt, llms-full.txt and a Markdown mirror of every page) generated from the same pages.

## Where things live

- `src/*.html`: the pages, written by hand: home, how it works, prices, start (the enquiry form) and its sent page, the accessibility statement, as if, and the fix form and its sent page. Add a site to "Our work" in `src/home.html`.
- `fix/worker.js`: the Worker for the two forms. `/fix/` saves reports to D1; `/start/` checks an enquiry and keeps nothing.
- `src/styles.css`: the one stylesheet, with light, dark, high-contrast and forced-colours handling.
- `build.mjs`: the page list, layout, Markdown mirrors, llms.txt, robots.txt and sitemap. The search and training declarations are the `SEARCH` and `TRAINING` settings near the top.
- `wrangler.jsonc`: Cloudflare Workers deployment. Publishing is Cloudflare Workers Builds from GitHub, like the other sites (since 9 November 2026): merging to `main` runs `node build.mjs` and then `npx wrangler deploy` on Cloudflare (Worker `unremarkable`, trigger "unremarkable main", previews off). Still run the build and commit `site/`, so the repo matches the live site. `npx wrangler deploy` from the laptop is an emergency fallback only.

## The wordmark

The wordmark is the one word "Unremarkable": "Un" in Fraunces italic (regular weight) in the accent colour, and "remarkable" in Fraunces Black. Fraunces is under the SIL Open Font License (`src/fonts/OFL.txt`).

- On this site it is live text (`WORDMARK` in `build.mjs`), so screen readers read one word.
- `brand/` holds it as SVG outlines that need no font: `unremarkable-wordmark.svg` (berry and near-black, for pale backgrounds), `-dark.svg` (rose and pink-white, for dark backgrounds), and one-colour `-black.svg` and `-white.svg`, plus `favicon.svg`. They are published at https://unremarkable.me/brand/.
- `brand/make.mjs` redraws them. It needs `@fontsource/fraunces` and `opentype.js` installed next to it.

## The credit line

On every site Unremarkable makes, the footer carries:

```html
<p>Site by <a href="https://unremarkable.me/">Unremarkable</a></p>
```

## Licence

Content is licensed under CC BY-SA 4.0.
