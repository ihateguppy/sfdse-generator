// node test.cjs [iterations] — checks the generator against its rules.
const assert = require('node:assert');
const crypto = require('node:crypto');
const S = require('./sfdse-core.cjs');

const N = Number(process.argv[2] || 200000);

// SHA-256 matches Node's.
for (const s of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(200)]) {
  assert.strictEqual(Buffer.from(S.sha256(new TextEncoder().encode(s))).toString('hex'),
    crypto.createHash('sha256').update(s).digest('hex'));
}

// Exact odds.
const odds = S.odds();
assert.deepStrictEqual(odds, { Common: 900, Uncommon: 340, Rare: 30, 'So Close!': 20, 'Ultra Rare': 5, 'Double Snake Eyes': 1 });

// Hand-checked examples from the brief.
assert.strictEqual(S.rarity([6, 5, 4, 2]), 'Common');
assert.strictEqual(S.rarity([2, 2, 3, 1]), 'Uncommon');
assert.strictEqual(S.rarity([3, 3, 2, 2]), 'Rare');
assert.strictEqual(S.rarity([5, 5, 5, 5]), 'Ultra Rare');
assert.strictEqual(S.rarity([1, 6, 1, 1]), 'So Close!');
assert.strictEqual(S.rarity([1, 1, 1, 1]), 'Double Snake Eyes');

// Each rarity has its own symbol; Common has none.
{
  const c = { x: 500, y: 500 };
  const marks = S.RARITIES.map((r) => S.mark(r, S.DEFAULTS, c));
  assert.strictEqual(marks[0], '');
  assert.strictEqual(new Set(marks).size, marks.length);
}

// Real-data packing: a block with every transaction the smallest possible size
// (the hardest case for the grid) still packs, and an empty block is all empty.
{
  const full = Array.from({ length: 16000 }, (_, i) => ({ vsize: 61, rate: 1 + (i % 50) }));
  const t0 = Date.now();
  const n = S.generate('worst', { txs: full });
  assert.strictEqual(n.blocks.length + n.overflow, full.length);
  assert.strictEqual(n.empty.length, 0, 'an overfull block should show no empty space');
  console.log(`16,000 tiny transactions: ${n.blocks.length} shown, ${n.overflow} ran off the top, ${Date.now() - t0} ms, ${S.svg(n).length} bytes`);
  const none = S.generate('empty', { txs: [] });
  assert.strictEqual(none.blocks.length, 0);
}

// Determinism, fairness, geometry.
const faces = [0, 0, 0, 0, 0, 0, 0];
const seen = {};
let fallbacks = 0, maxBytes = 0;
const comp = { rectGap: new Set(), rectStagger: new Set(), rectX: new Set(), rectY: new Set() };
for (let i = 0; i < N; i++) {
  const seed = crypto.randomBytes(32).toString('hex');
  // Packing a full stand-in block is the slow part, so only the first 2,000
  // NFTs get one; the rest test dice and layout with an empty block.
  const opts = i < 2000 ? {} : { txs: [] };
  const a = S.generate(seed, opts), b = S.generate(seed, opts);
  assert.strictEqual(S.svg(a), S.svg(b));
  a.dice.forEach((d) => faces[d]++);
  seen[a.rarity] = (seen[a.rarity] || 0) + 1;
  const h = a.cfg.die / 2 + a.cfg.dieLine / 2;
  a.placed.forEach((p, k) => {
    if (p.fallback) fallbacks++;
    assert.ok(S.inside(p, a.rects[k >> 1], h), `die ${k} outside square, seed ${seed}`);
  });
  assert.ok(!S.overlaps(a.placed[0], a.placed[1], h), `dice 1–2 overlap, seed ${seed}`);
  assert.ok(!S.overlaps(a.placed[2], a.placed[3], h), `dice 3–4 overlap, seed ${seed}`);
  // The composition is random but the rectangles never change size or leave the margin,
  // and every drawn value is one that takes effect (inside its range, not clamped).
  const G = a.cfg.grid, GY = a.cfg.rows, m = a.cfg.rectMargin, rr = S.ranges(a.cfg);
  a.layout.rects.forEach((r) => {
    assert.ok(r.w === 60 && r.h === 40, `rectangle resized, seed ${seed}`);
    assert.ok(r.x >= m && r.y >= m && r.x + r.w <= G - m && r.y + r.h <= GY - m, `rectangle in the margin, seed ${seed}`);
  });
  for (const k of ['rectGap', 'rectStagger', 'rectX', 'rectY']) {
    assert.ok(a.cfg[k] >= rr[k][0] && a.cfg[k] <= rr[k][1], `${k} out of range, seed ${seed}`);
    comp[k].add(a.cfg[k]);
  }
  maxBytes = Math.max(maxBytes, S.svg(a).length);
  // The image no longer shows the rarity, so the metadata must carry the four rolls and the rarity.
  const traits = Object.fromEntries(S.metadata(a, 1, 1, 'x').attributes.map((t) => [t.trait_type, t.value]));
  assert.deepStrictEqual([1, 2, 3, 4].map((k) => traits[`Roll ${k}`]), a.dice.map(String), `rolls missing from metadata, seed ${seed}`);
  assert.strictEqual(traits.Rarity, a.rarity, `rarity missing from metadata, seed ${seed}`);
  if (i < 2000) {
    // Background blocks and reserved areas cover every grid cell exactly once.
    const G = a.cfg.grid, GY = a.cfg.rows, cover = new Uint8Array(G * GY);
    const fill = (x, y, w, h) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { assert.ok(xx >= 0 && xx < G && yy >= 0 && yy < GY, 'block off the grid'); cover[yy * G + xx]++; } };
    a.blocks.forEach((b) => fill(b.x, b.y, b.s, b.s));
    a.empty.forEach((r) => fill(r.x, r.y, r.w, 1));
    a.reserved.forEach((r) => fill(r.x, r.y, r.w, r.h));
    assert.ok(cover.every((v) => v === 1), 'grid not covered exactly once, seed ' + seed);
  }
}
console.log(`${N} NFTs ok. faces:`, faces.slice(1).map((f) => (f / (N * 4) * 6).toFixed(4)).join(' '),
  `\nrarities:`, Object.entries(seen).map(([k, v]) => `${k} ${(v / N * 100).toFixed(2)}% (exp ${(odds[k] / 12.96).toFixed(2)}%)`).join(', '),
  `\nfallback placements: ${fallbacks}, largest SVG: ${maxBytes} bytes`);
{
  // Every gap from 1 to 41 and every stagger from -36 to 36 turns up.
  const all = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  assert.deepStrictEqual([...comp.rectGap].sort((x, y) => x - y), all(1, 41));
  assert.deepStrictEqual([...comp.rectStagger].sort((x, y) => x - y), all(-36, 36));
  console.log(`composition ok: ${comp.rectX.size} left/right and ${comp.rectY.size} up/down positions seen`);
}

// A fee listed with float noise (219, or 219.00000000000003) must not change the image: fees
// are whole satoshis, and equal fee rates are ordered by txid.
{
  const mk = (fee) => JSON.stringify(Array.from({ length: 400 }, (_, i) => ({ txid: i.toString(16).padStart(64, '0'), fee: i === 7 ? fee : 100 + (i % 3) * 10, vsize: 100 + (i % 3) * 20 + (i % 2) * 0.25, value: 1 })));
  const a = S.parseSummary(mk(219)), b = S.parseSummary(mk(219.00000000000003));
  assert.deepStrictEqual(a, b);
  // A vsize is whole vbytes rounded up, however the server lists it (109.25, with noise, or 110).
  for (const v of [109.25000000000001, 109.25, 110]) assert.deepStrictEqual(S.parseSummary(JSON.stringify([{ txid: 'a', fee: 100, vsize: v, value: 1 }])), [{ id: 'a', vsize: 110, rate: 100 / 110 }]);
  assert.strictEqual(S.svg(S.generate('ab'.repeat(32), { txs: a })), S.svg(S.generate('ab'.repeat(32), { txs: b })));
}
console.log('fee rounding ok');
