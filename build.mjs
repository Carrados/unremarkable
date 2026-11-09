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
    description: 'Unremarkable designs and builds websites that impress everyone who meets them: by eye, by screen reader, by braille or by agent.',
    llms: 'What Unremarkable is, its one rule, how it builds, and the sites it has made.',
    body: () => read('src/home.html'), type: 'WebSite',
  },
  {
    path: '/accessibility/', nav: 'Accessibility', h1: 'Accessibility statement',
    title: `Accessibility statement: ${SITE}`,
    description: 'How unremarkable.me is built to Zero Information Casualty v1.7, and how AI agents are served.',
    llms: 'How this site meets ZIC v1.7 and its agent surface.',
    body: () => read('src/accessibility.html'), type: 'WebPage',
  },
  // The bug-report form. Not in the navigation, llms.txt or the sitemap, and not indexed.
  // The Worker in fix/worker.js fills in the {{...}} placeholders.
  {
    path: '/fix/', h1: 'Fix something', title: `Fix something on a page: ${SITE}`,
    description: 'Report a problem with a page on a site Unremarkable built, so it can be fixed.',
    body: () => read('src/fix.html'), type: 'WebPage', hidden: true,
  },
  {
    path: '/fix/sent/', h1: 'Thank you', title: `Report sent: ${SITE}`,
    description: 'Your report about a page has been saved.',
    body: () => read('src/fix-sent.html'), type: 'WebPage', hidden: true,
  },
];
const listed = pages.filter(p => !p.hidden);

// The wordmark as live text: a screen reader reads one word, "Unremarkable".
const WORDMARK = '<span class="wm"><span class="wm-un">Un</span>remarkable</span>';

function read(p) { return readFileSync(p, 'utf8'); }

// Accessibility always comes first in the menu, on every site Unremarkable builds.
const navHtml = (current) => [...listed].sort((a, b) => (b.path === '/accessibility/') - (a.path === '/accessibility/')).map(p =>
  `<li><a href="${p.path}"${p.path === current ? ' aria-current="page"' : ''}>${p.nav}</a></li>`).join('\n');

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
${main}
</main>
<footer>
<p class="credit">This site is Unremarkable${p.hidden ? '' : `<br>\n<a href="/fix/?page=${encodeURIComponent(url)}">Fix something on this page</a>`}</p>
<p>Content on this site is licensed under <a href="${LICENCE_URL}">${LICENCE_NAME}</a></p>
<p>This site is built to <a href="${ZIC_URL}">Zero Information Casualty v1.7</a><br>
Read the <a href="/accessibility/">accessibility statement</a></p>
<p>Information for agents is at <a href="/llms.txt">llms.txt</a></p>
</footer>
</body>
</html>
`;
}

// A small HTML-to-Markdown converter for the hand-written pages in src/.
// It covers exactly the elements those pages use: h2, h3, p, ul/li, a, strong, em, section.
function toMarkdown(html) {
  const inline = s => s
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
  for (const [, tag, body] of html.matchAll(/<(h2|h3|p|ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    if (tag === 'h2') blocks.push(`## ${inline(body)}`);
    else if (tag === 'h3') blocks.push(`### ${inline(body)}`);
    else if (tag === 'p') blocks.push(inline(body));
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
for (const f of readdirSync('src/fonts')) write(`fonts/${f}`, readFileSync(join('src/fonts', f)));
// The wordmark files are published at /brand/ so other sites can use them in their credit line.
for (const f of readdirSync('brand').filter(f => f.endsWith('.svg'))) write(`brand/${f}`, readFileSync(join('brand', f)));
copyFileSync('brand/favicon.svg', join(OUT, 'favicon.svg'));
// Cloudflare static asset headers: serve the agent surface with honest content types.
write('_headers', `/*.md
  Content-Type: text/markdown; charset=utf-8
/llms.txt
  Content-Type: text/plain; charset=utf-8
/llms-full.txt
  Content-Type: text/plain; charset=utf-8
`);

const mirrors = [];
for (const p of pages) {
  const main = p.body();
  write(`${p.path}index.html`, layout(p, main));
  if (p.hidden) continue;
  const md = `# ${p.h1}\n\nCanonical page: ${ORIGIN}${p.path}\n\n${toMarkdown(main)}\n`;
  write(`${p.path}index.md`, md);
  mirrors.push(md);
}

const yesNo = b => (b ? 'yes' : 'no');
const allow = b => (b ? 'Allow' : 'Disallow');

write('llms.txt', `# ${SITE}

> ${pages[0].description} Its one rule: Unremarkable never is.

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
