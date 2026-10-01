// Builds a card image in public/cards from a 300 DEGEN original (1024 px PNG
// from IPFS). The suit colour replaces the degen's flat background; the figure
// keeps its pixels. Degens with a painted scene (the 1/1s) are not cut out:
// the untouched artwork sits in a passe-partout on the suit colour.
//
//   node scripts/card-art.cjs <original.png> <degen number> <suit 0-3> [--legend] [--white]
//
// Suits: 0 ♠ navy, 1 ♥ red, 2 ♦ gold, 3 ♣ grey-black (see SUIT_COLORS in lib/game/card-race.ts).
// --white puts a legend on ivory instead of its suit colour (the Oracle).
const sharp = require("sharp");
const path = require("node:path");

const SUITS = [
  [[58, 84, 150], [14, 20, 44]],
  [[204, 52, 62], [76, 10, 20]],
  [[240, 184, 70], [132, 80, 14]],
  [[118, 122, 132], [22, 23, 27]],
];
const WHITE = [[252, 250, 244], [200, 194, 182]];
const SIZE = 512;
const OUT = 256;
const FILL = 34; // colour distance that still counts as background
const EDGE = 120; // beyond this an edge pixel is pure figure
const HOLE = 16; // stricter distance for enclosed background patches
const HOLE_MIN = 120; // …of at least this many pixels

const dist = (p, c) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);

/** Radial gradient in the suit's two tones with a faint diagonal sheen. */
const suitPixel = ([inner, outer], x, y) => {
  const t = Math.min(1, Math.hypot(x / SIZE - 0.5, y / SIZE - 0.42) / 0.75);
  const sheen = Math.max(0, 1 - Math.abs((x - y) / SIZE - 0.1) * 6) * 0.06;
  return inner.map((c, i) => Math.min(255, Math.round((c * (1 - t) + outer[i] * t) * (1 + sheen))));
};

const suitBackground = (suit, tones = SUITS[suit]) => {
  const data = Buffer.alloc(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) data.set(suitPixel(tones, x, y), (y * SIZE + x) * 3);
  return data;
};

/** Flood fill from the border through background-coloured pixels; the outline stops it. */
async function recolor(input, suit) {
  const data = await sharp(input).resize(SIZE, SIZE).removeAlpha().raw().toBuffer();
  const n = SIZE * SIZE;
  const px = (i) => [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
  const ring = [];
  for (let i = 0; i < SIZE; i++) ring.push(i, n - 1 - i, i * SIZE, i * SIZE + SIZE - 1);
  const bg = [0, 1, 2].map((c) => ring.map((j) => data[j * 3 + c]).sort((a, b) => a - b)[ring.length >> 1]);

  const mask = new Uint8Array(n);
  const fill = (seeds, limit) => {
    const component = [];
    for (const s of seeds) if (!mask[s] && dist(px(s), bg) < limit) (mask[s] = 2), component.push(s);
    for (let q = 0; q < component.length; q++) {
      const j = component[q], x = j % SIZE, y = (j / SIZE) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const k = ny * SIZE + nx;
        if (nx >= 0 && ny >= 0 && nx < SIZE && ny < SIZE && !mask[k] && dist(px(k), bg) < limit) (mask[k] = 2), component.push(k);
      }
    }
    return component;
  };
  for (const j of fill(ring, FILL)) mask[j] = 1;
  // enclosed patches (between arm and body): strict colour match and a minimum size
  for (let s = 0; s < n; s++) {
    if (mask[s] || dist(px(s), bg) >= HOLE) continue;
    const component = fill([s], HOLE);
    for (const j of component) mask[j] = component.length >= HOLE_MIN ? 1 : 3;
  }
  for (let j = 0; j < n; j++) if (mask[j] === 3) mask[j] = 0;

  const background = suitBackground(suit);
  const out = Buffer.alloc(n * 3);
  for (let j = 0; j < n; j++) {
    const x = j % SIZE, y = (j / SIZE) | 0;
    const p = px(j);
    let alpha = 1;
    if (mask[j]) alpha = 0;
    else {
      // mixed edge pixels: swap the old background share for the new one
      let near = false;
      for (let oy = -2; oy <= 2 && !near; oy++)
        for (let ox = -2; ox <= 2 && !near; ox++) {
          const nx = x + ox, ny = y + oy;
          near = nx >= 0 && ny >= 0 && nx < SIZE && ny < SIZE && mask[ny * SIZE + nx] === 1;
        }
      if (near) alpha = Math.min(1, Math.max(0, (dist(p, bg) - FILL) / (EDGE - FILL)));
    }
    for (let c = 0; c < 3; c++) {
      const nb = background[j * 3 + c];
      out[j * 3 + c] = Math.max(0, Math.min(255, Math.round(alpha === 0 ? nb : p[c] + (1 - alpha) * (nb - bg[c]))));
    }
  }
  return sharp(out, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toBuffer();
}

/** The untouched artwork, scaled down, in a gold-lined passe-partout. */
async function legend(input, suit, tones) {
  const art = 400, radius = 18, offset = (SIZE - art) / 2;
  const rounded = Buffer.from(`<svg width="${art}" height="${art}"><rect width="${art}" height="${art}" rx="${radius}" fill="#fff"/></svg>`);
  const line = Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}"><rect x="${offset - 7}" y="${offset - 7}" width="${art + 14}" height="${art + 14}" rx="${radius + 6}" fill="none" stroke="#f3cf73" stroke-width="4"/></svg>`,
  );
  const image = await sharp(input).resize(art, art).removeAlpha().composite([{ input: rounded, blend: "dest-in" }]).png().toBuffer();
  return sharp(suitBackground(suit, tones), { raw: { width: SIZE, height: SIZE, channels: 3 } })
    .composite([{ input: line }, { input: image, left: offset, top: offset }])
    .png()
    .toBuffer();
}

if (require.main === module) {
  const [input, degen, suit] = process.argv.slice(2);
  if (!input || !degen || !(Number(suit) >= 0 && Number(suit) <= 3)) {
    console.error("usage: node scripts/card-art.cjs <original.png> <degen number> <suit 0-3> [--legend]");
    process.exit(1);
  }
  const output = path.join(__dirname, "..", "public", "cards", `degen-${String(degen).padStart(3, "0")}.jpg`);
  (process.argv.includes("--legend") ? legend(input, Number(suit), process.argv.includes("--white") ? WHITE : undefined) : recolor(input, Number(suit)))
    .then((card) => sharp(card).resize(OUT, OUT).jpeg({ quality: 82, mozjpeg: true }).toFile(output))
    .then(() => console.log("wrote", output));
}
