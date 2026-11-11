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

- `src/*.html`: the pages, written by hand: home, how it works, prices, start (the enquiry form) and its sent page, the accessibility statement, as if, the fix form, its sent page, and the reporter's own page for a report (`src/fix-report.html`). Add a site to "Our work" in `src/home.html`.
- `fix/worker.js`: the Worker for the two forms. `/fix/` saves reports to D1 and gives each one a private link, `/fix/r/<key>/`, where the reporter sees where it stands and can say whether the fix works for them (no email asked). Mark a report fixed by setting `status = 'fixed'` and `fixed_at`; schema changes go in `fix/migrations/`; `/start/` checks an enquiry and keeps nothing.
- `fix/phix.js` and `phix/PHIX.md`: Phix (said "fix"), the agent that works on reports. The Worker wakes it at 06:00 and midday UK time (the cron in `wrangler.jsonc`), only when there is work, by starting `.github/workflows/phix.yml`. Phix can only claim reports, add steps for the reporter, and hand a fix to the owner, who gets an email with a link to `/fix/owner/<key>/` to Publish, or Reject with reasons. Phix never publishes. Worker secrets: `PHIX_SECRET`, `GITHUB_TOKEN` (merges on Publish, starts Phix), `OWNER_EMAIL`, and the `OWNER_MAIL` binding to Cloudflare Email Sending (unremarkable.me is onboarded there). Locally, `.dev.vars` with `PHIX_DRY_RUN=1` logs emails and GitHub calls instead of sending them. What Phix hands in is checked with GitHub, not taken on trust: the pull request must be open, from `phix/report-<id>` in the site's own repo, and the preview on the account's workers.dev address; Publish merges the commit that was handed in (`fix_ref`) and nothing pushed after it. `node --test fix/phix.test.mjs` tests those checks. `phix/FUTURE.md` holds notes on where Phix could go next: ideas to be considered, not instructions to Phix.
- `dancer/`: Cloud Dancer's connector, a Worker of its own (`cloud-dancer`, at https://dancer.unremarkable.me/mcp), apart from the Worker that serves this site. A site's owner adds it to their own agent and changes their site by saying what they want. Who they are comes from the connector, never from the site: they sign in once, on Cloud Dancer's own address, with a six-figure code sent to the email address their site is registered to (`signin.js`, on Cloudflare's OAuth library). The five tools (`mcp.js`) are `my_sites`, `request_change`, `where_it_stands`, `publish` and `send_back`; an owner sees only their own requests, and `publish` merges only the commit that was handed in. Owners and requests are in the D1 database `cloud-dancer` (`schema.sql`); the sites it may change are in `sites.js`. Tests: `npm test` in `dancer/`, and `e2e.mjs` for the sign-in and the whole loop (ask, work, hand in, send back, publish) against a local run. The agent itself runs in `.github/workflows/dancer.yml`, started by the Worker the moment a request arrives (`github.js`), one request per run. It is two jobs, and the split is the point. In `change`, the model follows `dancer/DANCER.md` on a checkout with no keys at all and leaves a patch. In `hand-in`, a fixed script with no model (`run.mjs`, from `main`) checks the patch stays inside the site's fence (`paths` and `built` in `sites.js`: for this site, `src/` and `site/`), builds the site again, pushes `dancer/request-<id>`, opens the pull request, uploads a preview copy and calls the Worker's `/agent/ready` (`agent.js`), which asks GitHub what the pull request is and which files it changes before the owner is told. So Cloud Dancer can change a page's words; it cannot change the build script, a Worker, a workflow or its own rules, and a new page (the page list is in `build.mjs`) or a picture comes back to the owner as needing Unremarkable. Worker secrets: `DANCER_SECRET`, `GITHUB_TOKEN`. Actions secrets: `DANCER_SECRET`, `DANCER_GITHUB_TOKEN`, and the ones Phix already uses. Until `DANCER_OPEN` is `1` in `dancer/wrangler.jsonc`, a request is kept and the owner is told nothing will happen to it.
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
