// Build unremarkable.me: static HTML pages, plus an agent surface
// (llms.txt, llms-full.txt, Markdown mirrors) generated from the same pages.
// Requires Node 18+. Run: node build.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ORIGIN = 'https://unremarkable.me';
const SITE = 'Unremarkable';
const OUT = 'site';
const ZIC_URL = 'https://zeroinformationcasualty.org/';
const LICENCE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';
const LICENCE_NAME = 'Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0)';

// Publisher decisions (ZIC §3.3, §3.6). ai-input is always yes.
const SEARCH = true;
const TRAINING = true;

const pages = [
  {
    path: '/', nav: 'Home', h1: SITE, title: `${SITE}: website design and build`,
    description: 'Unremarkable designs, builds and looks after websites for the people who use them and the agents they send, tested by ear, owned by you, and changed by intention-based publishing.',
    llms: 'What Unremarkable offers, its one rule, how it builds, intention-based publishing, and its own sites.',
    body: () => read('src/home.html'), type: 'WebSite',
  },
  {
    path: '/how-it-works/', nav: 'How it works', h1: 'How it works', title: `How it works: ${SITE}`,
    description: 'How Unremarkable builds a website: a conversation, accounts in your name, design, testing by ear, and a site you change by saying what you want.',
    llms: 'From first conversation to live, owning everything, and changing the site by asking.',
    body: () => read('src/how-it-works.html'), type: 'WebPage',
  },
  {
    path: '/prices/', nav: 'Prices', h1: 'Prices', title: `Prices: ${SITE}`,
    description: 'One price to build your website, one monthly price to look after it, and running costs you pay directly.',
    llms: 'The build price, the monthly price, what each includes, and running costs.',
    body: () => read('src/prices.html'), type: 'WebPage',
  },
  {
    path: '/about/', nav: 'About', h1: "Who's Unremarkable", title: `Who's Unremarkable: ${SITE}`,
    description: "Charli builds Unremarkable's websites, hears every page with a screen reader, and stands behind every change its agents make.",
    llms: 'Who runs Unremarkable, why every page is heard before it goes live, and how the agents are overseen.',
    body: () => read('src/about.html'), type: 'AboutPage',
  },
  // The way in. The Worker in fix/worker.js fills in the {{...}} placeholders,
  // checks what was written, and keeps nothing (see the As If standard).
  {
    path: '/start/', nav: 'Start', h1: 'Start a website', title: `Start a website: ${SITE}`,
    description: 'Tell Unremarkable what people come to you to do. While Unremarkable is design fiction, this form keeps nothing.',
    llms: 'The enquiry form. It keeps nothing and sends nothing while Unremarkable is design fiction; an agent should not send it for a person.',
    body: () => read('src/start.html'), type: 'WebPage',
  },
  // Not in the menu: linked from How it works and Prices, where the questions come up.
  {
    path: '/questions/', h1: 'Questions', title: `Questions: ${SITE}`,
    description: 'Where your website lives, what GitHub and Cloudflare do, and what your accounts, hosting and domain cost.',
    llms: 'Questions about your accounts: GitHub, Cloudflare, hosting and domain costs, and moving your website.',
    body: () => read('src/questions.html'), type: 'WebPage',
  },
  {
    path: '/worked-example/', h1: 'A worked example', title: `A worked example: ${SITE}`,
    description: 'A real job by Blind Ant\'s publishing agent, the one Cloud Dancer is modelled on: one folder of Word documents and a picture in, a finished piece on blind-ant.com out, with the receipt.',
    llms: 'A real intention-based publishing job, start to finish, with the receipt the agent wrote. Nothing on the page publishes anything.',
    body: () => read('src/worked-example.html'), type: 'WebPage',
  },
  {
    path: '/accessibility/', nav: 'Accessibility statement', h1: 'Accessibility statement',
    title: `Accessibility statement: ${SITE}`,
    description: 'How unremarkable.me is built to Zero Information Casualty v1.7, and how AI agents are served.',
    llms: 'How this site meets ZIC v1.7 and its agent surface.',
    body: () => read('src/accessibility.html'), type: 'WebPage',
  },
  // Not in the menu: linked from the accessibility statement.
  {
    path: '/what-is-accessibility/', h1: 'What is web accessibility?', title: `What is web accessibility?: ${SITE}`,
    description: 'What web accessibility is, introduced in the words of W3C WAI, and what it means at Unremarkable.',
    llms: 'What web accessibility is, a short introduction quoted from W3C WAI, how Unremarkable builds for it, and further reading.',
    body: () => read('src/what-is-accessibility.html'), type: 'WebPage',
  },
  // Outside the fiction: what is real here and what isn't. Linked from the note on every page, not the menu.
  {
    path: '/as-if/', h1: 'As if', title: `As if: ${SITE}`,
    description: 'Unremarkable is written as if it were a business. This is the standard that keeps that honest.',
    llms: 'The As If standard: this site is design fiction, what is real here and what is not.',
    body: () => read('src/as-if.html'), type: 'WebPage',
  },
  {
    path: '/start/sent/', h1: 'What would happen next', title: `What would happen next: ${SITE}`,
    description: 'Nothing you wrote was kept. This is what would happen next if Unremarkable were trading.',
    body: () => read('src/start-sent.html'), type: 'WebPage', hidden: true,
  },
  // The bug-report form. Not in the navigation, llms.txt or the sitemap, and not indexed.
  // The Worker in fix/worker.js fills in the {{...}} placeholders.
  {
    path: '/fix/', h1: 'Fix something', title: `Fix something on a page: ${SITE}`,
    description: 'Report a problem with a page on a site Unremarkable built, so it can be fixed.',
    body: () => read('src/fix.html'), type: 'WebPage', hidden: true,
  },
  // Served by Cloudflare for any address with no page (not_found_handling in wrangler.jsonc).
  {
    path: '/404/', file: '404.html', h1: 'Page not found', title: `Page not found: ${SITE}`,
    description: 'There is no page at this address on unremarkable.me.',
    body: () => read('src/not-found.html'), type: 'WebPage', hidden: true,
  },
  {
    path: '/fix/sent/', h1: 'Thank you', title: `Report sent: ${SITE}`,
    description: 'Your report about a page has been saved, with its own link so you can follow it.',
    body: () => read('src/fix-sent.html'), type: 'WebPage', hidden: true,
  },
  // The reporter's own page for one report, at /fix/r/<key>/. The Worker fills in {{REPORT}}.
  {
    path: '/fix/r/', h1: 'Your report', title: `Your report: ${SITE}`,
    description: 'A report about a page on a site Unremarkable built, and where it stands.',
    body: () => read('src/fix-report.html'), type: 'WebPage', hidden: true,
  },
  // The owner's page for one fix from Phix, at /fix/owner/<key>/: Publish, or Reject with reasons. The Worker fills in {{OWNER}}.
  {
    path: '/fix/owner/', h1: 'Check a fix', title: `Check a fix: ${SITE}`,
    description: 'A fix made by Phix, waiting for the owner to publish or reject it.',
    body: () => read('src/fix-owner.html'), type: 'WebPage', hidden: true,
  },
];
const listed = pages.filter(p => !p.hidden);
const inMenu = listed.filter(p => p.nav);

// The As If standard (src/as-if.html): while Unremarkable is design fiction, every page says so
// directly under its main heading, and so do llms.txt and every Markdown version.
// When the business is real, set AS_IF to false and say so on /as-if/.
const AS_IF = true;
const AS_IF_TEXT = 'Unremarkable is written as if it were a business. It isn\'t taking work yet.';
// A plain note, not a landmark: as a landmark named "Design fiction" that begins with those words, NVDA said them twice.
const asIfHtml = AS_IF ? `<div class="as-if">
<p><strong>Design fiction</strong><br>
${AS_IF_TEXT.replace("'", '&#39;')}<br>
<a href="/as-if/">What that means</a></p>
</div>
` : '';
const asIfMarkdown = AS_IF ? `> **Design fiction.** ${AS_IF_TEXT} What that means: ${ORIGIN}/as-if/\n\n` : '';

// The wordmark: a screen reader reads one word, "Unremarkable". The styled "Un" is its own box, and
// VoiceOver on iPhone stops at every box, so the drawn word is hidden and a plain copy is read instead.
const WORDMARK = '<span class="wm-said">Unremarkable</span><span class="wm" aria-hidden="true"><span class="wm-un">Un</span>remarkable</span>';

// Security headers. The site runs no JavaScript, so the policy allows none. fix/worker.js sends the same policy.
const CSP = "default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self' data:; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'";

function read(p) { return readFileSync(p, 'utf8'); }

// Accessibility always comes first in the menu, on every site Unremarkable builds.
const navHtml = (current) => [...inMenu].sort((a, b) => (b.path === '/accessibility/') - (a.path === '/accessibility/')).map(p =>
  (p.path === current
    // The page you are on is named in the menu, but is not a link to itself (rulebook rule 2).
    ? `<li><a aria-current="page">${p.nav}</a></li>`
    : `<li><a href="${p.path}">${p.nav}</a></li>`)).join('\n');

function jsonLd(p) {
  const url = ORIGIN + p.path;
  const org = { '@type': 'Organization', name: SITE, url: ORIGIN + '/', description: pages[0].description };
  const base = p.type === 'WebSite'
    ? { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE, url, description: p.description, license: LICENCE_URL, publisher: org }
    : { '@context': 'https://schema.org', '@type': 'WebPage', name: p.h1, url, description: p.description, license: LICENCE_URL,
        isPartOf: { '@type': 'WebSite', name: SITE, url: ORIGIN + '/' }, publisher: org };
  return JSON.stringify(base, null, 2).replace(/</g, '\\u003c');
}

function layout(p, main) {
  const url = ORIGIN + p.path;
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${p.title}</title>
<meta name="description" content="${p.description}">
${p.hidden ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${url}">`}
<meta property="og:title" content="${p.title}">
<meta property="og:description" content="${p.description}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/fraunces-latin-900-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/styles.css">
${p.hidden ? '' : `<link rel="alternate" type="text/markdown" href="${p.path}index.md" title="Markdown version of this page">`}
<script type="application/ld+json">
${jsonLd(p)}
</script>
</head>
<body>
<a class="skip" href="#main">Skip to main content</a>
<header>
${p.path === '/' ? '' : `<p class="site-name"><a href="/">${WORDMARK}</a></p>
`}<nav aria-label="Main">
<ul>
${navHtml(p.path)}
</ul>
</nav>
</header>
<main id="main" tabindex="-1">
<h1${p.path === '/' ? ' class="home-title"' : ''}>${p.path === '/' ? WORDMARK : p.h1}</h1>
${asIfHtml}${main}
</main>
<footer>
<p class="credit"><img class="trainer" src="/pictures/trainer.svg" width="120" height="70" alt="">This site is Unremarkable${p.path.startsWith('/fix/') || p.path === '/404/' ? '' : `<br>\n<a href="/fix/?page=${encodeURIComponent(url)}">Fix something on this page</a>`}</p>
<p>Licensed under <a href="${LICENCE_URL}">Creative Commons Attribution-ShareAlike 4.0</a></p>
<p>Built to <a href="${ZIC_URL}">Zero Information Casualty v1.7</a></p>
<p>For agents: <a href="/llms.txt">llms.txt</a></p>
</footer>
</body>
</html>
`;
}

// The menu and footer, as Markdown, for each page's Markdown version.
const navMarkdown = (current) => 'Menu:\n\n' + [...inMenu]
  .sort((a, b) => (b.path === '/accessibility/') - (a.path === '/accessibility/'))
  .map(p => `- [${p.nav}](${ORIGIN}${p.path})${p.path === current ? ' (this page)' : ''}`).join('\n');

const footerMarkdown = (p) => `
---

This site is Unremarkable

[Fix something on this page](${ORIGIN}/fix/?page=${encodeURIComponent(ORIGIN + p.path)})

Licensed under [${LICENCE_NAME.replace(/ \(.*\)$/, '')}](${LICENCE_URL})

Built to [Zero Information Casualty v1.7](${ZIC_URL})

For agents: [llms.txt](${ORIGIN}/llms.txt)
`;

// A small HTML-to-Markdown converter for the hand-written pages in src/.
// It covers exactly the elements those pages use: h2, h3, p, ul/li, ol/li, blockquote, figure, img, a, strong, em, section.
function toMarkdown(html) {
  const inline = s => s
    // Pictures keep their description; decorative ones (empty alt) are left out.
    .replace(/<img [^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>\s*/g, (_, src, alt) => alt ? `![${alt}](${src.startsWith('/') ? ORIGIN + src : src}) ` : '')
    .replace(/<a class="work-name" href="([^"]+)">([\s\S]*?)<\/a>\s*/g, (_, href, text) => `[**${text}**](${href}): `)
    .replace(/<a href="([^"]+)">([\s\S]*?)<\/a>/g, (_, href, text) => `[${inline(text)}](${href.startsWith('/') ? ORIGIN + href : href})`)
    .replace(/<strong>([\s\S]*?)<\/strong>/g, '**$1**')
    .replace(/<em>([\s\S]*?)<\/em>/g, '*$1*')
    .replace(/<span class="work-name">([\s\S]*?)<\/span>\s*/g, '**$1**: ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const blocks = [];
  html = html.replace(/<\/?section[^>]*>/g, '');
  for (const [, tag, body] of html.matchAll(/<(h2|h3|p|ul|ol|blockquote|figure)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    if (tag === 'figure') blocks.push(inline(body.replace(/<figcaption>([\s\S]*?)<\/figcaption>/, ' $1')));
    else if (tag === 'h2') blocks.push(`## ${inline(body)}`);
    else if (tag === 'h3') blocks.push(`### ${inline(body)}`);
    else if (tag === 'p') blocks.push(inline(body));
    else if (tag === 'blockquote') blocks.push([...body.matchAll(/<p>([\s\S]*?)<\/p>/g)].map(([, q]) => `> ${inline(q)}`).join('\n>\n'));
    else blocks.push([...body.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, li], i) => `${tag === 'ol' ? `${i + 1}.` : '-'} ${inline(li)}`).join('\n'));
  }
  return blocks.join('\n\n');
}

function write(rel, content) {
  const f = join(OUT, rel);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, content);
}

// Build
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });
copyFileSync('src/styles.css', join(OUT, 'styles.css'));
// Photographs and pictures, published at /pictures/.
mkdirSync(join(OUT, 'pictures'), { recursive: true });
for (const f of readdirSync('src/pictures')) copyFileSync(join('src/pictures', f), join(OUT, 'pictures', f));
for (const f of readdirSync('src/fonts')) write(`fonts/${f}`, readFileSync(join('src/fonts', f)));
// The wordmark files are published at /brand/ so other sites can use them in their credit line.
for (const f of readdirSync('brand').filter(f => f.endsWith('.svg'))) write(`brand/${f}`, readFileSync(join('brand', f)));
copyFileSync('brand/favicon.svg', join(OUT, 'favicon.svg'));
// Cloudflare static asset headers: serve the agent surface with honest content types.
write('_headers', `/*
  Strict-Transport-Security: max-age=31536000
  Content-Security-Policy: ${CSP}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
/*.md
  Content-Type: text/markdown; charset=utf-8
/llms.txt
  Content-Type: text/plain; charset=utf-8
/llms-full.txt
  Content-Type: text/plain; charset=utf-8
`);

const mirrors = [];
for (const p of pages) {
  const main = p.body();
  write(p.file || `${p.path}index.html`, layout(p, main));
  if (p.hidden) continue;
  const md = `# ${p.h1}\n\nCanonical page: ${ORIGIN}${p.path}\n\n${asIfMarkdown}${toMarkdown(main)}\n`;
  // The page's own Markdown carries the menu and footer too, so an agent gets
  // what the person gets, the fix link and the licence included.
  // llms-full.txt keeps just the content, so they aren't repeated for every page.
  write(`${p.path}index.md`, `# ${p.h1}\n\nCanonical page: ${ORIGIN}${p.path}\n\n${asIfMarkdown}${navMarkdown(p.path)}\n\n${toMarkdown(main)}\n${footerMarkdown(p)}`);
  mirrors.push(md);
}

const yesNo = b => (b ? 'yes' : 'no');
const allow = b => (b ? 'Allow' : 'Disallow');

write('llms.txt', `# ${SITE}

> ${pages[0].description} Its one rule: Unremarkable never is.
${AS_IF ? `
Design fiction: ${AS_IF_TEXT} Prices and terms on this site are worked out but cannot be bought, and the Start form keeps and sends nothing. Agents sent to hire Unremarkable should tell the person this. The standard: ${ORIGIN}/as-if/
` : ''}
Licence: ${LICENCE_NAME}, ${LICENCE_URL}
Sent-agent guarantee: an AI agent fetching any public page on this site on behalf of a person is welcome, and will be served the same content a person reading the page receives.
Search indexing: ${SEARCH ? 'permitted' : 'not permitted'}. Model training: ${TRAINING ? 'permitted' : 'not permitted'}. These are separate decisions, declared in /robots.txt.
This file, /llms-full.txt and the Markdown mirrors are generated from the site's pages at build time.

## Pages

${listed.map(p => `- [${p.h1}](${ORIGIN}${p.path}): ${p.llms} Markdown: ${ORIGIN}${p.path}index.md`).join('\n')}

## Optional

- [Zero Information Casualty v1.7](${ZIC_URL}): the specification this site is built to.
- [Full text of the site](${ORIGIN}/llms-full.txt): every page in one Markdown file.
`);

write('llms-full.txt', `# ${SITE}: full text\n\nGenerated from the site's pages at build time. Licence: ${LICENCE_NAME}.\n\n` + mirrors.join('\n\n---\n\n'));

write('robots.txt', `# ZIC robots.txt for unremarkable.me (Zero Information Casualty v1.7)

# Mandatory sent-agent service.
# A person asked, and is waiting. These agents are welcome on every public page.
User-agent: ChatGPT-User
Allow: /

User-agent: Claude-User
Allow: /

User-agent: Perplexity-User
Allow: /

# Search indexing: publisher decision, search=${yesNo(SEARCH)}.
User-agent: OAI-SearchBot
${allow(SEARCH)}: /

User-agent: Claude-SearchBot
${allow(SEARCH)}: /

User-agent: PerplexityBot
${allow(SEARCH)}: /

# Mixed-use crawlers: Google, Microsoft and Apple's base crawlers are treated as search.
# Google and Apple separate training through Google-Extended and Applebot-Extended, declared below.
# Bingbot has no separate training control; the search declaration governs it.
User-agent: Googlebot
${allow(SEARCH)}: /

User-agent: Bingbot
${allow(SEARCH)}: /

User-agent: Applebot
${allow(SEARCH)}: /

# Model training: a separate publisher decision, ai-train=${yesNo(TRAINING)}.
# This is independent of search, and never affects service to sent agents.
User-agent: GPTBot
${allow(TRAINING)}: /

User-agent: ClaudeBot
${allow(TRAINING)}: /

User-agent: Google-Extended
${allow(TRAINING)}: /

User-agent: Applebot-Extended
${allow(TRAINING)}: /

User-agent: CCBot
${allow(TRAINING)}: /

User-agent: Meta-ExternalAgent
${allow(TRAINING)}: /

User-agent: *
Allow: /

Content-Signal: search=${yesNo(SEARCH)}, ai-input=yes, ai-train=${yesNo(TRAINING)}

Sitemap: ${ORIGIN}/sitemap.xml
`);

write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${listed.map(p => `  <url><loc>${ORIGIN}${p.path}</loc></url>`).join('\n')}
</urlset>
`);

console.log(`Built ${pages.length} pages into ${OUT}/`);
