// S.F.D.S.E. generator prototype: a pure function from a Bitcoin block hash to
// four dice, a rarity, NFT metadata and an SVG image. Same hash in, same NFT out.
// Works as a classic <script> in the browser and with require() in Node.

const SFDSE = (() => {
  // ---- SHA-256 (sync, dependency-free) -------------------------------------
  const K = new Uint32Array(64);
  const H0 = new Uint32Array(8);
  {
    const frac = (x) => ((x - Math.floor(x)) * 4294967296) >>> 0;
    const isPrime = (x) => { for (let d = 2; d * d <= x; d++) if (x % d === 0) return false; return true; };
    for (let n = 0, p = 2; n < 64; p++) {
      if (!isPrime(p)) continue;
      if (n < 8) H0[n] = frac(Math.sqrt(p));
      K[n++] = frac(Math.cbrt(p));
    }
  }
  const ror = (x, n) => (x >>> n) | (x << (32 - n));

  function sha256(msg) {
    const l = msg.length;
    const n = ((l + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(n);
    m.set(msg);
    m[l] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(n - 4, (l * 8) >>> 0);
    dv.setUint32(n - 8, Math.floor((l * 8) / 4294967296));
    const h = H0.slice();
    const w = new Uint32Array(64);
    for (let o = 0; o < n; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        const s0 = ror(a, 7) ^ ror(a, 18) ^ (a >>> 3);
        const s1 = ror(b, 17) ^ ror(b, 19) ^ (b >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [A, B, C, D, E, F, G, H] = h;
      for (let i = 0; i < 64; i++) {
        const S1 = ror(E, 6) ^ ror(E, 11) ^ ror(E, 25);
        const ch = (E & F) ^ (~E & G);
        const t1 = (H + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = ror(A, 2) ^ ror(A, 13) ^ ror(A, 22);
        const maj = (A & B) ^ (A & C) ^ (B & C);
        const t2 = (S0 + maj) >>> 0;
        H = G; G = F; F = E; E = (D + t1) >>> 0; D = C; C = B; B = A; A = (t1 + t2) >>> 0;
      }
      const v = [A, B, C, D, E, F, G, H];
      for (let i = 0; i < 8; i++) h[i] = (h[i] + v[i]) >>> 0;
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i]);
    return out;
  }

  // ---- Randomness: an endless byte stream from the block hash -------------
  // bytes = SHA-256("sfdse:<hash>:0"), SHA-256("sfdse:<hash>:1"), ...
  // Dice use rejection sampling (bytes 252–255 are skipped) so every face is
  // exactly 1/6. The four dice are always drawn first, before any layout.
  function stream(seed) {
    const enc = new TextEncoder();
    let counter = 0, buf = null, pos = 32;
    const byte = () => {
      if (pos >= 32) { buf = sha256(enc.encode(`sfdse:${seed}:${counter++}`)); pos = 0; }
      return buf[pos++];
    };
    return {
      die() { for (;;) { const b = byte(); if (b < 252) return (b % 6) + 1; } },
      // A whole number from lo to hi, each exactly equally likely (rejection sampling, as for dice).
      int(lo, hi) {
        const n = hi - lo + 1;
        if (n <= 1) return lo;
        if (n > 256) throw new Error('int: range wider than one byte');
        const limit = 256 - (256 % n);
        for (;;) { const b = byte(); if (b < limit) return lo + (b % n); }
      },
      float() { return (((byte() << 24) | (byte() << 16) | (byte() << 8) | byte()) >>> 0) / 4294967296; },
    };
  }

  // ---- Rules ----------------------------------------------------------------
  // The generator's version. Bump it whenever a change makes any block draw differently
  // (each NFT records the version that drew it, so the block job redraws a confirming NFT
  // drawn by an older one, and the audit knows which NFTs a redraw must match). It must
  // never change once mainnet NFTs exist: a minted image must stay reproducible.
  //   1  until Oct 28: one fixed composition
  //   2  Oct 28: gap, stagger and position drawn from the hash
  const LOOK = 2;

  const RARITIES = ['Common', 'Uncommon', 'Rare', 'So Close!', 'Ultra Rare', 'Double Snake Eyes'];

  function rarity([a, b, c, d]) {
    const ones = [a, b, c, d].filter((x) => x === 1).length;
    if (ones === 4) return 'Double Snake Eyes';
    if (ones === 3) return 'So Close!';
    const p1 = a === b, p2 = c === d;
    if (p1 && p2) return a === c ? 'Ultra Rare' : 'Rare';
    if (p1 || p2) return 'Uncommon';
    return 'Common';
  }

  // ---- Look -----------------------------------------------------------------
  // The square is a Bitcoin block drawn the way mempool.space draws one: every
  // transaction a small square, sized by its vsize, shaded by its fee rate, packed
  // from the bottom up; unused block space shows white. The two black rectangles
  // (rolls 1–2 first, 3–4 second) are reserved spaces in the same grid,
  // so everything lines up. The rarity symbol floats on top in the top right corner.
  const DEFAULTS = {
    size: 1000,                   // the outer square
    grid: 96,                     // cells per side
    // Composition of the two black rectangles (all in cells):
    arrange: 'stacked',           // 'stacked' (one above the other) or 'side' (side by side)
    rectRatio: '3:2',             // each rectangle's width:height
    rectW: 52,                    // rectangle width
    rectGap: 6,                   // space between the two rectangles
    rectStagger: 0,               // shifts the second rectangle across (stacked: right, side: down)
    rectX: 0,                     // moves the pair right of centre (negative: left)
    rectY: 0,                     // moves the pair below centre (negative: up)
    rectMargin: 2,                // the pair always stays this far from the edge
    rectRandom: true,             // each NFT draws gap, stagger and position from its hash
    markCells: 8,                 // the symbol's corner area, in cells per side
    gutter: 2,                    // gap between blocks
    shades: 6,                    // steps of gray, from lowest to highest fee rate
    blockVsize: 1000000,          // a full block, in vbytes
    die: 84,                      // die edge length
    dieLine: 2.5,                 // die outline
    radius: 0.09,                 // die corner radius, fraction of edge
    pip: 0.12,                    // pip radius, fraction of edge
    onePip: 1,                    // size multiplier for the single pip on a 1
    gap: 2,                       // minimum space between two dice, and die-to-edge
    mark: 32,                     // rarity symbol height
    ink: '#000000',
    rect: '#000000',
    white: '#ffffff',
    red: '#8f1d1d',
    canvas: '#d9d9d9',            // the gaps between blocks: darker than the blocks
    blockLight: '#f5f5f5',        // lowest fee rate
    blockDark: '#e2e2e2',         // highest fee rate
    empty: '#f5f5f5',             // unused block space (as light as the lightest block)
    markColor: '#8c8c8c',
  };

  const PIPS = {
    1: [[0, 0]],
    2: [[-1, -1], [1, 1]],
    3: [[-1, -1], [0, 0], [1, 1]],
    4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
    6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
  };

  const r1 = (x) => Math.round(x * 10) / 10;
  const r3 = (x) => Math.round(x * 1000) / 1000;

  // ---- Placement --------------------------------------------------------------
  function corners(p, h) {
    const c = Math.cos(p.rad), s = Math.sin(p.rad);
    return [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => [p.x + x * c - y * s, p.y + x * s + y * c]);
  }

  // Separating-axis test on the dice's bounding squares (rounded corners only
  // make the real shapes smaller, so "no overlap" here means no overlap there).
  function overlaps(a, b, h) {
    const A = corners(a, h), B = corners(b, h);
    for (const ang of [a.rad, a.rad + Math.PI / 2, b.rad, b.rad + Math.PI / 2]) {
      const ux = Math.cos(ang), uy = Math.sin(ang);
      const pa = A.map(([x, y]) => x * ux + y * uy), pb = B.map(([x, y]) => x * ux + y * uy);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
    }
    return true;
  }

  // Two dice inside one rectangle. Random angle 0–360°, random position anywhere
  // the rotated die (plus outline and gap) fits; retry on overlap. The fallback
  // is unreachable in practice but guarantees the function always ends.
  function placePair(rng, sq, cfg) {
    const h = cfg.die / 2 + cfg.dieLine / 2;         // half-size including outline
    const hs = h + cfg.gap / 2;                      // with half the spacing
    const out = [];
    for (let k = 0; k < 2; k++) {
      let p = null;
      for (let t = 0; t < 1000 && !p; t++) {
        const deg = rng.float() * 360, rad = (deg * Math.PI) / 180;
        const e = h * (Math.abs(Math.cos(rad)) + Math.abs(Math.sin(rad))) + cfg.gap;
        const cand = {
          x: r1(sq.x0 + e + rng.float() * (sq.x1 - sq.x0 - 2 * e)),
          y: r1(sq.y0 + e + rng.float() * (sq.y1 - sq.y0 - 2 * e)),
          deg: r1(deg),
        };
        cand.rad = (cand.deg * Math.PI) / 180;
        if (!inside(cand, sq, h + cfg.gap - 0.5)) continue;            // rounding guard
        if (out.every((q) => !overlaps(q, cand, hs))) p = cand;
      }
      if (!p) {
        const e = h + cfg.gap;
        p = k === 0 ? { x: sq.x0 + e, y: sq.y0 + e, deg: 0 } : { x: sq.x1 - e, y: sq.y1 - e, deg: 0 };
        p.rad = 0;
        p.fallback = true;
      }
      out.push(p);
    }
    return out;
  }

  function inside(p, sq, h) {
    return corners(p, h).every(([x, y]) => x >= sq.x0 && x <= sq.x1 && y >= sq.y0 && y <= sq.y1);
  }

  // The rectangles keep their size whatever the composition. Only a look where the
  // tightest pair (1 apart, no stagger) can't fit inside the margin makes them smaller.
  function rectSize(cfg) {
    const G = cfg.grid, room = G - 2 * cfg.rectMargin, side = cfg.arrange === 'side';
    const [rw, rh] = String(cfg.rectRatio).split(':').map(Number);
    const size = (w) => ({ w, h: Math.max(1, Math.round((w * rh) / rw)) });
    let d = size(Math.round(cfg.rectW));
    while (d.w > 1 && (side ? 2 * d.w + 1 > room || d.h > room : d.w > room || 2 * d.h + 1 > room)) d = size(d.w - 1);
    return d;
  }

  // What each composition value can be, given the others, so that every value in a
  // range moves the picture and the pair stays inside the margin: no value is ever cut
  // off by the edge. Gap and stagger don't limit each other; position depends on both.
  // rectX/rectY count from the centred spot (the pair's outer box, rounded up-left).
  function ranges(cfg) {
    const G = cfg.grid, m = cfg.rectMargin, room = G - 2 * m, side = cfg.arrange === 'side';
    const { w, h } = rectSize(cfg);
    const clamp = (v, [lo, hi]) => Math.min(Math.max(Math.round(v), lo), hi);
    const rectGap = [1, Math.max(1, room - (side ? 2 * w : 2 * h))];
    const sMax = Math.max(0, room - (side ? h : w));
    const rectStagger = [-sMax, sMax];
    const gap = clamp(cfg.rectGap, rectGap), st = clamp(cfg.rectStagger, rectStagger), s = Math.abs(st);
    const W = side ? 2 * w + gap : w + s, H = side ? h + s : 2 * h + gap;
    const along = (L) => { const c = Math.floor((G - L) / 2); return [m - c, Math.max(m, G - m - L) - c]; };
    return { w, h, W, H, gap, st, rectGap, rectStagger, rectX: along(W), rectY: along(H), clamp };
  }

  // A composition drawn from the hash: each value equally likely across its full range,
  // gap and stagger first, then the position within the room they leave.
  function compose(rng, cfg) {
    const c = {};
    c.rectGap = rng.int(...ranges(cfg).rectGap);
    c.rectStagger = rng.int(...ranges({ ...cfg, ...c }).rectStagger);
    const r = ranges({ ...cfg, ...c });
    c.rectX = rng.int(...r.rectX);
    c.rectY = rng.int(...r.rectY);
    return c;
  }

  // Reserved areas, in grid cells: the two rectangles, stacked or side by side,
  // centred and then moved by rectX/rectY; and the top right corner area where
  // the rarity symbol is drawn. Values outside their range are brought into it.
  function layout(cfg) {
    const G = cfg.grid, side = cfg.arrange === 'side';
    const r = ranges(cfg), { w, h, W, H, gap, st } = r;
    const rx = r.clamp(cfg.rectX, r.rectX), ry = r.clamp(cfg.rectY, r.rectY);
    const x = Math.floor((G - W) / 2) + rx, y = Math.floor((G - H) / 2) + ry;
    const a = Math.max(0, -st), b = Math.max(0, st);
    return {
      rects: side
        ? [{ x, y: y + a, w, h }, { x: x + w + gap, y: y + b, w, h }]
        : [{ x: x + a, y, w, h }, { x: x + b, y: y + h + gap, w, h }],
      markCell: { x: G - cfg.markCells, y: 0, w: cfg.markCells, h: cfg.markCells },
      composition: { rectGap: gap, rectStagger: st, rectX: rx, rectY: ry },
    };
  }

  // Cells → image coordinates. The grid is inset by half a gutter so the blocks
  // on the edge get the same gap to the edge as to each other.
  const unit = (cfg) => (cfg.size - cfg.gutter) / cfg.grid;
  function toPx(c, cfg) {
    const u = unit(cfg), g = cfg.gutter;
    return { x0: g / 2 + c.x * u + g / 2, y0: g / 2 + c.y * u + g / 2, x1: g / 2 + (c.x + c.w) * u - g / 2, y1: g / 2 + (c.y + c.h) * u - g / 2 };
  }

  // Pack a block's transactions the way mempool.space does (block-scene.ts):
  // each transaction is a square of round(√(1.1 × vsize ÷ vbytes-per-cell))
  // cells, at least 1; highest fee rate first; each goes into the lowest, then
  // leftmost, spot where it fits, so the block fills from the bottom up.
  // vbytes-per-cell is set so a full block (1,000,000 vB) just fills the free
  // cells, with mempool.space's 2% margin. Whatever is left over is empty space.
  // A block of thousands of tiny transactions can need more squares than there
  // are cells; like mempool.space, the ones that don't fit (the lowest fee
  // rates, as they come last) run off the picture, and the block looks full.
  function packTxs(txs, cfg, reserved) {
    const G = cfg.grid;
    const base = new Uint8Array(G * G);
    for (const r of reserved) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) base[y * G + x] = 1;
    const freeCells = base.reduce((n, v) => n + (v ? 0 : 1), 0);
    const order = txs.map((t, i) => ({ ...t, i })).sort((a, b) => b.rate - a.rate || (a.id === undefined || a.id === b.id ? 0 : a.id < b.id ? -1 : 1) || a.i - b.i);
    const rates = order.map((t) => t.rate).sort((a, b) => a - b);
    const lo = Math.max(0.1, rates[Math.floor(rates.length * 0.1)] || 1);
    const hi = Math.max(lo * 4, rates[Math.floor(rates.length * 0.99)] || 1);
    const shadeOf = (rate) => {
      const t = Math.log(Math.max(rate, lo) / lo) / Math.log(hi / lo);
      return Math.min(cfg.shades - 1, Math.floor(Math.min(1, t) * cfg.shades));
    };
    const perCell = cfg.blockVsize / (freeCells / 1.02 ** 2);
    const used = base.slice(), blocks = [];
    // run[i]: how many free cells start at cell i and continue to the right, so a
    // spot is tested row by row instead of cell by cell. from[s]: the lowest row a
    // square of size s can still have its bottom on; rows only ever fill up, so a
    // row that had no room for size s never will. Same result as a full scan.
    const run = new Uint8Array(G * G);
    for (let y = 0; y < G; y++) for (let x = G - 1, n = 0; x >= 0; x--) { n = used[y * G + x] ? 0 : n + 1; run[y * G + x] = n; }
    // first[y]: no free cell in row y lies left of this (cells only ever fill up).
    const first = new Int16Array(G);
    const from = new Int16Array(G + 1).fill(G - 1);
    let left = freeCells, overflow = 0;
    for (const t of order) {
      const s = Math.min(G, Math.max(1, Math.round(Math.sqrt((1.1 * t.vsize) / perCell))));
      let at = null;
      if (s * s <= left) {
        let y = from[s];
        for (; y >= s - 1 && !at; y--) {
          while (first[y] < G && used[y * G + first[y]]) first[y]++;
          for (let x = first[y]; x + s <= G && !at;) {
            const r = run[y * G + x];
            if (r < s) { x += r + 1; continue; }
            let yy = y - 1;
            while (yy > y - s && run[yy * G + x] >= s) yy--;
            if (yy === y - s) at = { x, y };
            else x++;
          }
        }
        from[s] = at ? at.y : -1;
      }
      if (!at) { overflow++; continue; }
      for (let yy = at.y - s + 1; yy <= at.y; yy++) {
        const i = yy * G + at.x;
        used.fill(1, i, i + s);
        run.fill(0, i, i + s);
        // Only the free cells just left of the new square have shorter runs now.
        for (let j = i - 1, n = 1; j >= yy * G && !used[j]; j--, n++) run[j] = n;
      }
      left -= s * s;
      blocks.push({ x: at.x, y: at.y - s + 1, s, shade: shadeOf(t.rate) });
    }
    // Empty space, as runs of free cells per row.
    const empty = [];
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      if (used[y * G + x]) continue;
      let w = 1;
      while (x + w < G && !used[y * G + x + w]) w++;
      empty.push({ x, y, w });
      x += w - 1;
    }
    return { blocks, empty, overflow, perCell, filled: txs.reduce((n, t) => n + t.vsize, 0) / cfg.blockVsize };
  }

  // Stand-in transactions for previews without real block data: a block filled
  // 15–100%, transaction sizes and fee rates spread roughly like real ones.
  function sampleTxs(rng, cfg) {
    const target = cfg.blockVsize * (0.15 + 0.85 * rng.float()), txs = [];
    const normal = () => Math.sqrt(-2 * Math.log(1 - rng.float())) * Math.cos(2 * Math.PI * rng.float());
    for (let v = 0; v < target;) {
      const vsize = Math.max(60, Math.round(Math.exp(5.3 + 0.8 * normal() + (rng.float() < 0.02 ? 2.5 : 0))));
      txs.push({ vsize, rate: Math.max(1, Math.exp(0.9 + 0.9 * normal())) });
      v += vsize;
    }
    return txs;
  }

  // mempool.space's block summary (JSON text) → [{ id, vsize, rate }]. The fee rate is each
  // transaction's fee ÷ its vsize: what it actually paid, fixed in the block itself, so
  // anyone can reproduce an image from the raw block. (The summary's own "rate" is
  // mempool.space's effective rate, rounded and adjusted for related transactions, and
  // it can be recalculated later: images drawn from it couldn't be reproduced.) JSON.parse
  // is native code: a regular expression over the ~900 KB text was as fast once warm but
  // 4x slower in a cold start, which is what a block job run on Workers Free always is.
  function parseSummary(text) {
    // A fee is whole satoshis, but mempool.space sometimes lists one with float noise
    // (219 one time, 219.00000000000003 the next, seen in block 973,497), which moved that
    // transaction past the others with the same fee rate and changed the image: rounded. A
    // vsize is Bitcoin's virtual size, weight ÷ 4 rounded up to a whole vbyte; some servers
    // list the unrounded weight ÷ 4 (140.25 where others say 141, seen on block 973,557), so
    // it is taken to the nearest quarter (float noise), then rounded up.
    return JSON.parse(text).map((t) => {
      const vsize = Math.ceil(Math.round(t.vsize * 4) / 4);
      return { id: t.txid, vsize, rate: Math.round(t.fee) / vsize };
    });
  }

  // ---- Generate -------------------------------------------------------------
  // seed: the block hash (hex). txs: the block's transactions as [{ vsize, rate }]
  // (from mempool.space's block summary); stand-ins are used when omitted.
  // dice: optional override, for previews only.
  function generate(seed, opts = {}) {
    let cfg = { ...DEFAULTS, ...(opts.look || {}) };
    const rng = stream(seed);
    const rolled = [rng.die(), rng.die(), rng.die(), rng.die()];
    const dice = opts.dice || rolled;
    const r = rarity(dice);
    // The composition is drawn right after the dice, before anything else.
    if (cfg.rectRandom) cfg = { ...cfg, ...compose(rng, cfg) };
    const lay = layout(cfg);
    cfg = { ...cfg, ...lay.composition };
    const rects = lay.rects.map((c) => toPx(c, cfg));
    const placed = [...placePair(rng, rects[0], cfg), ...placePair(rng, rects[1], cfg)];
    // Stand-ins are drawn after the dice, so they never change where the dice land.
    const txs = opts.txs || sampleTxs(rng, cfg);
    // The rarity symbol floats over the transactions, so only the rectangles are kept clear.
    const reserved = lay.rects;
    const packed = packTxs(txs, cfg, reserved);
    return { seed, dice, rarity: r, placed, cfg, rects, layout: lay, reserved, ...packed, realData: !!opts.txs };
  }

  // ---- SVG ------------------------------------------------------------------
  function star(cx, cy, R) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? R * 0.42 : R;
      pts.push(`${r1(cx + r * Math.cos(a))} ${r1(cy + r * Math.sin(a))}`);
    }
    return `<path d="M${pts.join('L')}Z"/>`;
  }

  // The rarity symbol, centred in its corner area, over whatever is behind it. Common has none.
  function mark(rarity, cfg, c) {
    const m = cfg.mark, h = m / 2, cx = r1(c.x), cy = r1(c.y);
    let shape;
    switch (rarity) {
      case 'Common': return '';
      case 'Uncommon': shape = `<circle cx="${cx}" cy="${cy}" r="${r1(h * 0.9)}"/>`; break;
      case 'Rare': shape = `<path d="M${cx} ${r1(cy - h)}L${r1(cx + h)} ${cy}L${cx} ${r1(cy + h)}L${r1(cx - h)} ${cy}Z"/>`; break;
      case 'Ultra Rare': shape = star(cx, r1(cy + h * 0.11), h * 1.1); break;
      case 'So Close!': {
        // ‼ as a surprised mark: each stick tapers from a wide top to a thin foot, with
        // slightly rounded corners (a trapezoid drawn inset, then stroked with round
        // joins in the same color), over a round dot.
        const top = cy - h, bar = m * 0.66, wt = m * 0.3, wb = m * 0.14, rr = m * 0.05, dx = m * 0.22, dr = m * 0.13;
        const sticks = [-dx, dx].map((o) => {
          const x = cx + o, a = wt / 2 - rr, b = wb / 2 - rr, y0 = top + rr, y1 = top + bar - rr;
          return `M${r1(x - a)} ${r1(y0)}H${r1(x + a)}L${r1(x + b)} ${r1(y1)}H${r1(x - b)}Z`;
        }).join('');
        const dots = [-dx, dx].map((o) => `<circle cx="${r1(cx + o)}" cy="${r1(cy + h - dr)}" r="${r1(dr)}"/>`).join('');
        shape = `<path d="${sticks}" stroke="${cfg.markColor}" stroke-width="${r1(rr * 2)}" stroke-linejoin="round"/>${dots}`;
        break;
      }
      case 'Double Snake Eyes': {
        // A geometric heart (a square on its point with two half-circles), about
        // as wide as it is tall. d is the square's diagonal; the heart is 1.207d wide.
        const d = m / 1.207, a = d / 2, r = r1(d / (2 * Math.SQRT2)), oy = r1(cy + d * 0.052);
        shape = `<path d="M${cx} ${r1(oy + a)}L${r1(cx - a)} ${oy}A${r} ${r} 0 0 1 ${cx} ${r1(oy - a)}A${r} ${r} 0 0 1 ${r1(cx + a)} ${oy}Z"/>`;
        break;
      }
      default: throw new Error(`unknown rarity ${rarity}`);
    }
    // The heart is the same dark red as the pip on a 1.
    return `<g fill="${rarity === 'Double Snake Eyes' ? cfg.red : cfg.markColor}">${shape}</g>`;
  }

  function die(p, n, cfg) {
    const s = cfg.die, h = s / 2, q = r1(s * 0.27), pr = r1(s * cfg.pip);
    const pip = n === 1 ? r1(pr * cfg.onePip) : pr;
    const fill = n === 1 ? cfg.red : cfg.ink;
    const pips = PIPS[n].map(([x, y]) => `<circle cx="${r1(x * q)}" cy="${r1(y * q)}" r="${pip}"/>`).join('');
    return `<g transform="translate(${p.x} ${p.y}) rotate(${p.deg})">`
      + `<rect x="${-h}" y="${-h}" width="${s}" height="${s}" rx="${r1(s * cfg.radius)}" fill="${cfg.white}" stroke="${cfg.ink}" stroke-width="${cfg.dieLine}"/>`
      + `<g fill="${fill}">${pips}</g></g>`;
  }

  const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    return '#' + [16, 8, 0].map((sh) => hex(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t)).join('');
  }

  // Every block is inset by half a gap, so two blocks side by side show a whole gap.
  // Empty space fills its cells edge to edge, so wherever it meets a block (or the
  // image edge) it gets a half-gap strip in the gap color, keeping every line equal.
  function emptyEdges(empty, G, h, color) {
    h = r3(h);                                                   // same rounding as the blocks' inset
    const free = new Uint8Array(G * G);
    for (const r of empty) free.fill(1, r.y * G + r.x, r.y * G + r.x + r.w);
    const isFree = (x, y) => x >= 0 && y >= 0 && x < G && y < G && free[y * G + x] === 1;
    const d = [];
    const hz = (x, y, w) => d.push(`M${x} ${r3(y)}h${w}v${h}h-${w}z`);
    const vt = (x, y, n) => d.push(`M${r3(x)} ${y}h${h}v${n}h-${h}z`);
    for (let y = 0; y < G; y++) {
      for (const [dy, off] of [[-1, 0], [1, 1 - h]]) {           // top and bottom edges
        for (let x = 0; x < G; x++) {
          if (!isFree(x, y) || isFree(x, y + dy)) continue;
          let w = 1;
          while (isFree(x + w, y) && !isFree(x + w, y + dy)) w++;
          hz(x, y + off, w);
          x += w - 1;
        }
      }
    }
    for (let x = 0; x < G; x++) {
      for (const [dx, off] of [[-1, 0], [1, 1 - h]]) {           // left and right edges
        for (let y = 0; y < G; y++) {
          if (!isFree(x, y) || isFree(x + dx, y)) continue;
          let n = 1;
          while (isFree(x, y + n) && !isFree(x + dx, y + n)) n++;
          vt(x + off, y, n);
          y += n - 1;
        }
      }
    }
    // Corners where only the diagonal neighbour is a block.
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      if (!isFree(x, y)) continue;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        if (isFree(x + dx, y + dy) || !isFree(x + dx, y) || !isFree(x, y + dy)) continue;
        d.push(`M${r3(x + (dx > 0 ? 1 - h : 0))} ${r3(y + (dy > 0 ? 1 - h : 0))}h${h}v${h}h-${h}z`);
      }
    }
    return d.length ? `<path fill="${color}" d="${d.join('')}"/>` : '';
  }

  function svg(nft) {
    const { cfg, placed, dice, blocks, empty, layout: lay } = nft, S = cfg.size, u = unit(cfg);
    const g = r3(cfg.gutter / u);                       // gap, in cells
    const shade = (i) => mix(cfg.blockDark, cfg.blockLight, 1 - i / Math.max(1, cfg.shades - 1));
    // Thousands of 1-cell squares: merged into runs per row and shade, filled with
    // a one-cell pattern that draws the gap, so the file stays small. Bigger
    // squares are drawn one by one, with a stroke in the gap color as their gap.
    const runs = Array.from({ length: cfg.shades }, () => []), big = Array.from({ length: cfg.shades }, () => '');
    const ones = blocks.filter((b) => b.s === 1).sort((a, b) => a.y - b.y || a.x - b.x);
    for (const b of ones) {
      const list = runs[b.shade], last = list[list.length - 1];
      if (last && last.y === b.y && last.x + last.w === b.x) last.w++;
      else list.push({ x: b.x, y: b.y, w: 1 });
    }
    for (const b of blocks) if (b.s > 1) big[b.shade] += `M${b.x} ${b.y}h${b.s}v${b.s}h-${b.s}z`;
    let defs = '';
    runs.forEach((l, i) => {
      if (l.length) defs += `<pattern id="p${i}" width="1" height="1" patternUnits="userSpaceOnUse"><rect x="${r3(g / 2)}" y="${r3(g / 2)}" width="${r3(1 - g)}" height="${r3(1 - g)}" fill="${shade(i)}"/></pattern>`;
    });
    const row = (r) => `M${r.x} ${r.y}h${r.w}v1h-${r.w}z`;
    let grid = '';
    if (empty.length) grid += `<path fill="${cfg.empty}" d="${empty.map(row).join('')}"/>${emptyEdges(empty, cfg.grid, g / 2, cfg.canvas)}`;
    runs.forEach((l, i) => { if (l.length) grid += `<path fill="url(#p${i})" d="${l.map(row).join('')}"/>`; });
    let strokes = big.map((d, i) => d && `<path fill="${shade(i)}" d="${d}"/>`).join('');
    const mc = lay.markCell;
    strokes += `<path fill="${cfg.rect}" d="${lay.rects.map((r) => `M${r.x} ${r.y}h${r.w}v${r.h}h-${r.w}z`).join('')}"/>`;
    let body = `<rect width="${S}" height="${S}" fill="${cfg.canvas}"/>`;
    body += `<g transform="translate(${cfg.gutter / 2} ${cfg.gutter / 2}) scale(${r3(u)})">${grid}<g stroke="${cfg.canvas}" stroke-width="${g}">${strokes}</g></g>`;
    const mp = toPx(mc, cfg);
    body += mark(nft.rarity, cfg, { x: (mp.x0 + mp.x1) / 2, y: (mp.y0 + mp.y1) / 2 });
    body += placed.map((p, i) => die(p, dice[i], cfg)).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
  }

  // ---- Metadata (Metaplex JSON) ---------------------------------------------
  // Royalties go to Guppy's public wallet, which also receives the mint prices. On chain
  // they are set by the collection's Royalties plugin; the JSON fields are for older readers.
  const CREATOR = '3dtAiqZB2KUq3Areq7EZ89nQACjoTEaoFgEwaQi24eTh';
  const ROYALTY_BPS = 500;                        // 5%

  function metadata(nft, number, block, imageUri) {
    return {
      name: `Searching For Double Snake Eyes #${number}`,
      symbol: 'SFDSE',
      description: '',
      seller_fee_basis_points: ROYALTY_BPS,
      image: imageUri,
      attributes: [
        { trait_type: 'Roll 1', value: String(nft.dice[0]) },
        { trait_type: 'Roll 2', value: String(nft.dice[1]) },
        { trait_type: 'Roll 3', value: String(nft.dice[2]) },
        { trait_type: 'Roll 4', value: String(nft.dice[3]) },
        { trait_type: 'Rarity', value: nft.rarity },
        { trait_type: 'Block Height', value: String(block) },
      ],
      properties: {
        category: 'image',
        files: [{ uri: imageUri, type: 'image/svg+xml' }],
        creators: [{ address: CREATOR, share: 100 }],
      },
    };
  }

  // Short version tag for an image: the first 8 hex digits of its SHA-256. Image links
  // carry it (?v=…) so a redrawn image is fetched again despite long caching.
  function version(svgText) {
    return Array.from(sha256(new TextEncoder().encode(svgText)).slice(0, 4), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Exact odds per NFT, by counting all 6^4 = 1,296 outcomes.
  function odds() {
    const counts = Object.fromEntries(RARITIES.map((r) => [r, 0]));
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) for (let d = 1; d <= 6; d++) counts[rarity([a, b, c, d])]++;
    return counts;
  }

  return { LOOK, sha256, stream, rarity, generate, svg, mark, layout, ranges, compose, packTxs, parseSummary, metadata, version, odds, overlaps, inside, RARITIES, DEFAULTS, CREATOR, ROYALTY_BPS };
})();

if (typeof module !== 'undefined') module.exports = SFDSE;
