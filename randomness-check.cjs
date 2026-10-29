// node randomness-check.cjs [output.json] — chi-square tests on the dice rolled from real
// Bitcoin block hashes (the blocks cached by replay.cjs, so run `node replay.cjs 730` first).
// A test like this can only fail to find bias; it cannot prove randomness. Prints the
// results, and writes them to output.json when one is given.
const fs = require('fs');
const path = require('path');
const S = require('./sfdse-core.cjs');

const CACHE = process.env.SFDSE_CACHE || path.join(__dirname, '.cache');
const blocks = JSON.parse(fs.readFileSync(path.join(CACHE, 'blocks.json'), 'utf8'));
// Only an unbroken run of blocks counts (the next-block test needs neighbours): the one
// ending at the newest cached block, if an interrupted fetch left a gap further back.
const all = Object.keys(blocks).map(Number).sort((a, b) => a - b);
let start = all.length - 1;
while (start > 0 && all[start - 1] === all[start] - 1) start--;
// The last two years at most (730 days of 144 blocks).
const heights = all.slice(Math.max(start, all.length - 730 * 144));

// P(chi-square with k degrees of freedom >= x): the regularized upper incomplete gamma.
function gammaQ(a, x) {
  const lg = (z) => { // Lanczos log-gamma
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = z, t = z + 5.5; t -= (z + 0.5) * Math.log(t);
    let s = 1.000000000190015; for (const k of c) s += k / ++y;
    return -t + Math.log((2.5066282746310005 * s) / z);
  };
  if (x < a + 1) { // series for P, then 1 - P
    let sum = 1 / a, term = sum;
    for (let n = 1; n < 500; n++) { term *= x / (a + n); sum += term; if (Math.abs(term) < Math.abs(sum) * 1e-14) break; }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - lg(a));
  }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d; // continued fraction for Q
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a); b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - lg(a)) * h;
}
const chiTest = (observed, expected) => {
  const chi = observed.reduce((s, o, i) => s + (o - expected[i]) ** 2 / expected[i], 0);
  const df = observed.length - 1;
  return { chi: +chi.toFixed(2), df, p: +gammaQ(df / 2, chi / 2).toFixed(4) };
};

const odds = S.odds(), rarities = S.RARITIES;
const faces = Array(6).fill(0), pairs = Array(36).fill(0), next = Array(36).fill(0), rar = {};
let prev = null;
const rolls = heights.map((h) => { const r = S.stream(blocks[h][0]); return [r.die(), r.die(), r.die(), r.die()]; });
rolls.forEach((d, i) => {
  d.forEach((f) => faces[f - 1]++);
  pairs[(d[0] - 1) * 6 + (d[1] - 1)]++;
  if (i) next[(rolls[i - 1][0] - 1) * 6 + (d[0] - 1)]++;
  const r = S.rarity(d); rar[r] = (rar[r] || 0) + 1;
});

const n = rolls.length;
const out = {
  blocks: n, from: heights[0], to: heights[heights.length - 1],
  faces: { counts: faces, ...chiTest(faces, faces.map(() => (n * 4) / 6)) },
  rarities: { counts: rar, ...chiTest(rarities.map((r) => rar[r] || 0), rarities.map((r) => (n * odds[r]) / 1296)) },
  firstTwoDice: chiTest(pairs, pairs.map(() => n / 36)),
  nextBlock: chiTest(next, next.map(() => (n - 1) / 36)),
};
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
