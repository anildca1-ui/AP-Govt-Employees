// Regenerates the PWA icons in public/icons from the vector source below.
//
//   node apps/web/scripts/generate-icons.mjs
//
// The mark is pure geometry — a document with an order's text lines — so it
// renders identically everywhere without depending on a Telugu font being
// installed on the machine doing the rendering.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "public", "icons");

const NAVY = "#0f172a";
const PAPER = "#ffffff";
const ACCENT = "#38bdf8";

/**
 * @param {number} inset padding around the mark, as a fraction of the canvas.
 *   Maskable icons need their content inside the middle 80% so a launcher can
 *   crop to a circle without clipping the document.
 */
function svg(inset) {
  const s = 512;
  const pad = s * inset;
  const w = s - pad * 2;

  // Document sheet, centred in the safe area.
  const docW = w * 0.62;
  const docH = w * 0.78;
  const docX = (s - docW) / 2;
  const docY = (s - docH) / 2;
  const fold = docW * 0.28;

  const lineX = docX + docW * 0.16;
  const lineW = docW * 0.68;
  const lineH = docH * 0.055;
  const lines = [0.42, 0.56, 0.7]
    .map(
      (t) =>
        `<rect x="${lineX}" y="${docY + docH * t}" width="${t === 0.7 ? lineW * 0.6 : lineW}" height="${lineH}" rx="${lineH / 2}" fill="${NAVY}" opacity="0.75"/>`,
    )
    .join("");

  // Absolute coordinates throughout: the corner radius has to be subtracted
  // from each edge, and relative arcs make that easy to get subtly wrong.
  const r = docW * 0.06;
  const left = docX;
  const right = docX + docW;
  const top = docY;
  const bottom = docY + docH;
  const foldX = right - fold;
  const foldY = top + fold;

  const sheet = [
    `M ${left + r} ${top}`,
    `L ${foldX} ${top}`,
    `L ${right} ${foldY}`, // diagonal cut where the corner is turned down
    `L ${right} ${bottom - r}`,
    `A ${r} ${r} 0 0 1 ${right - r} ${bottom}`,
    `L ${left + r} ${bottom}`,
    `A ${r} ${r} 0 0 1 ${left} ${bottom - r}`,
    `L ${left} ${top + r}`,
    `A ${r} ${r} 0 0 1 ${left + r} ${top}`,
    "Z",
  ].join(" ");

  const foldTriangle = `M ${foldX} ${top} L ${right} ${foldY} L ${foldX} ${foldY} Z`;

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" rx="${s * 0.18}" fill="${NAVY}"/>
  <path d="${sheet}" fill="${PAPER}"/>
  <path d="${foldTriangle}" fill="${ACCENT}"/>
  ${lines}
</svg>`);
}

await mkdir(outDir, { recursive: true });

const targets = [
  { file: "icon-192.png", size: 192, inset: 0.06 },
  { file: "icon-512.png", size: 512, inset: 0.06 },
  { file: "icon-maskable-512.png", size: 512, inset: 0.16 },
];

for (const { file, size, inset } of targets) {
  const png = await sharp(svg(inset)).resize(size, size).png().toBuffer();
  await writeFile(join(outDir, file), png);
  console.log(`wrote ${file} (${size}x${size}, ${png.length} bytes)`);
}

// Browser-tab favicon, from the same source so it can never drift from the
// installed-app icons. Next picks this up automatically as a metadata file.
const faviconPath = join(here, "..", "src", "app", "icon.svg");
await writeFile(faviconPath, svg(0.06));
console.log("wrote src/app/icon.svg");
