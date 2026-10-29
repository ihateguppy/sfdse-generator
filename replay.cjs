// Replays S.F.D.S.E. against real Bitcoin block history (off-chain).
//
//   node replay.cjs [days]     # default 365: the last year of blocks
//
// Rolls every block's dice from its real hash, then splits history into back-to-back
// runs: a run starts at a block and ends at the first Double Snake Eyes, and the next
// run starts at the block after it. Block data comes from mempool.space and is cached
// in .cache/ (or the folder in SFDSE_CACHE). Writes replay.json there.
const fs = require('fs');
const path = require('path');
const S = require('./sfdse-core.cjs');

const DAYS = Number(process.argv[2] || 365);
const API = 'https://mempool.space/api';
const CACHE = process.env.SFDSE_CACHE || path.join(__dirname, '.cache');
const BLOCKS = path.join(CACHE, 'blocks.json');

async function get(url, attempt = 1) {
  const res = await fetch(url).catch((e) => ({ ok: false, status: e.message }));
  if (res.ok) return res.json();
  if (attempt >= 6) throw new Error(`${url}: ${res.status}`);
  await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  return get(url, attempt + 1);
}

// height → [hash, timestamp], fetched 15 blocks per request from the tip down.
async function loadBlocks(tip, from) {
  fs.mkdirSync(CACHE, { recursive: true });
  const blocks = fs.existsSync(BLOCKS) ? JSON.parse(fs.readFileSync(BLOCKS, 'utf8')) : {};
  const todo = [];
  for (let h = tip; h >= from; h -= 15) if (!blocks[h] || !blocks[Math.max(from, h - 14)]) todo.push(h);
  let done = 0;
  const worker = async () => {
    while (todo.length) {
      const h = todo.shift();
      for (const b of await get(`${API}/v1/blocks/${h}`)) blocks[b.height] = [b.id, b.timestamp];
      if (++done % 100 === 0) {
        process.stdout.write(`  ${done} requests, ${todo.length} to go\r`);
        fs.writeFileSync(BLOCKS, JSON.stringify(blocks));
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  fs.writeFileSync(BLOCKS, JSON.stringify(blocks));
  return blocks;
}

const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

(async () => {
  const tip = Number(await (await fetch(`${API}/blocks/tip/height`)).text());
  const from = tip - Math.round(DAYS * 144);
  console.log(`Blocks ${from}–${tip} (about ${DAYS} days)`);
  const blocks = await loadBlocks(tip, from);

  const runs = [];
  let run = null;
  for (let h = from; h <= tip; h++) {
    const [hash, time] = blocks[h];
    const rng = S.stream(hash);
    const dice = [rng.die(), rng.die(), rng.die(), rng.die()];
    const rarity = S.rarity(dice);
    if (!run) run = { start: h, startTime: time, counts: Object.fromEntries(S.RARITIES.map((r) => [r, 0])) };
    run.counts[rarity]++;
    if (rarity === 'Double Snake Eyes') {
      runs.push({ ...run, end: h, endTime: time, hash, dice, nfts: h - run.start + 1, days: (time - run.startTime) / 86400 });
      run = null;
    }
  }
  const open = run && { ...run, nfts: tip - run.start + 1, days: (blocks[tip][1] - run.startTime) / 86400 };

  console.log('\nRun  Starts       Block    Found        Block    NFTs   Days');
  runs.forEach((r, i) => console.log(
    `${String(i + 1).padStart(3)}  ${day(r.startTime)}  ${r.start}  ${day(r.endTime)}  ${r.end}  ${String(r.nfts).padStart(5)}  ${r.days.toFixed(1).padStart(5)}`));
  if (open) console.log(`  …  ${day(open.startTime)}  ${open.start}  still searching    ${String(open.nfts).padStart(5)}  ${open.days.toFixed(1).padStart(5)}`);

  const total = Object.fromEntries(S.RARITIES.map((r) => [r, 0]));
  for (const r of [...runs, open].filter(Boolean)) for (const k in total) total[k] += r.counts[k];
  const n = tip - from + 1;
  const odds = S.odds();
  const nfts = runs.map((r) => r.nfts), days = runs.map((r) => r.days);
  console.log(`\n${runs.length} finished runs over ${n} blocks (expected about ${(n / 1296).toFixed(0)})`);
  if (runs.length) {
    console.log(`NFTs per run: average ${Math.round(nfts.reduce((a, b) => a + b) / runs.length)} (expected 1,296), median ${median(nfts)}, shortest ${Math.min(...nfts)}, longest ${Math.max(...nfts)}`);
    console.log(`Days per run: average ${(days.reduce((a, b) => a + b) / runs.length).toFixed(1)}, median ${median(days).toFixed(1)}, shortest ${Math.min(...days).toFixed(1)}, longest ${Math.max(...days).toFixed(1)}`);
  }
  console.log('Rarities: ' + S.RARITIES.map((r) => `${r} ${total[r]} (exp ${Math.round((n * odds[r]) / 1296)})`).join(', '));

  fs.writeFileSync(path.join(CACHE, 'replay.json'), JSON.stringify({ from, tip, total, runs, open }, null, 1));
})();
