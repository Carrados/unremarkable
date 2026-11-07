// Draws the Unremarkable wordmark as SVG outlines (no font needed to display it).
// "Un" in Fraunces italic 400, "remarkable" in Fraunces 900. Usage: node make.mjs <outdir>
import opentype from 'opentype.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
mkdirSync(out, { recursive: true });
const F = 'node_modules/@fontsource/fraunces/files/';
const italic = opentype.loadSync(F + 'fraunces-latin-400-italic.woff');
const black = opentype.loadSync(F + 'fraunces-latin-900-normal.woff');

const SIZE = 200;
const GAP = 4; // optical space between the italic "n" and the upright "r"

function wordmark() {
  const un = italic.getPath('Un', 0, 0, SIZE, { kerning: true });
  const unW = italic.getAdvanceWidth('Un', SIZE, { kerning: true });
  const rest = black.getPath('remarkable', unW + GAP, 0, SIZE, { kerning: true });
  const b1 = un.getBoundingBox(), b2 = rest.getBoundingBox();
  const box = { x1: Math.min(b1.x1, b2.x1), y1: Math.min(b1.y1, b2.y1), x2: Math.max(b1.x2, b2.x2), y2: Math.max(b1.y2, b2.y2) };
  return { un: un.toPathData(2), rest: rest.toPathData(2), box };
}

const { un, rest, box } = wordmark();
const pad = 8;
const vb = [box.x1 - pad, box.y1 - pad, box.x2 - box.x1 + pad * 2, box.y2 - box.y1 + pad * 2].map(n => +n.toFixed(2));

const svg = (unFill, restFill, bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" role="img" aria-labelledby="t">
<title id="t">Unremarkable</title>
${bg ? `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="${bg}"/>\n` : ''}<path fill="${unFill}" d="${un}"/>
<path fill="${restFill}" d="${rest}"/>
</svg>
`;

const variants = {
  'unremarkable-wordmark.svg': ['#7d1734', '#141312'],        // for pale backgrounds
  'unremarkable-wordmark-dark.svg': ['#ff9cb8', '#f7eef0'],   // for dark backgrounds
  'unremarkable-wordmark-black.svg': ['#000000', '#000000'],  // one colour, print
  'unremarkable-wordmark-white.svg': ['#ffffff', '#ffffff'],  // one colour, reversed
};
for (const [name, [a, b]] of Object.entries(variants)) writeFileSync(join(out, name), svg(a, b));

// Favicon: an italic "U" in pale pink on a berry square with rounded corners.
const u = italic.getPath('U', 0, 0, 100);
const ub = u.getBoundingBox();
const s = 128, scale = 0.9 * s / Math.max(ub.x2 - ub.x1, ub.y2 - ub.y1);
const tx = (s - (ub.x2 - ub.x1) * scale) / 2 - ub.x1 * scale;
const ty = (s - (ub.y2 - ub.y1) * scale) / 2 - ub.y1 * scale;
writeFileSync(join(out, 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}">
<rect width="${s}" height="${s}" rx="24" fill="#7d1734"/>
<path fill="#fbecef" transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(4)})" d="${u.toPathData(2)}"/>
</svg>
`);

console.log('viewBox', vb.join(' '), 'aspect', (vb[2] / vb[3]).toFixed(2));
