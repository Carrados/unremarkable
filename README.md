# unremarkable.me

The home of Unremarkable, the studio behind the "Site by Unremarkable" line at the foot of each site it makes.

## The rule

Unremarkable never is. Everything about it, the design, the writing and this site, has to be impressive, to people reading by eye, by screen reader or by braille, and to the agents they send. Any change to this repo is held to that rule.

## Build

Needs Node 18 or later. Nothing else.

```
node build.mjs
```

The finished site is written to `site/`. It is built to Zero Information Casualty v1.7: static HTML, no JavaScript, and an agent surface (llms.txt, llms-full.txt and a Markdown mirror of every page) generated from the same pages.

## Where things live

- `src/home.html` and `src/accessibility.html`: the pages, written by hand. Add a site to "The work" in `src/home.html`.
- `src/styles.css`: the one stylesheet, with light, dark, high-contrast and forced-colours handling.
- `build.mjs`: the page list, layout, Markdown mirrors, llms.txt, robots.txt and sitemap. The search and training declarations are the `SEARCH` and `TRAINING` settings near the top.
- `wrangler.jsonc`: Cloudflare Workers deployment. Cloudflare serves the `site/` folder as it is in the repo, so run the build and commit `site/` before pushing.

## The credit line

On every site Unremarkable makes, the footer carries:

```html
<p>Site by <a href="https://unremarkable.me/">Unremarkable</a></p>
```

## Licence

Content is licensed under CC BY-SA 4.0.
