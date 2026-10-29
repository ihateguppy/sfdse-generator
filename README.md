# sfdse-generator

The generator behind [S.F.D.S.E. Searching For Double Snake Eyes](https://guppy.studio/projects/sfdse)
([FAQ](https://guppy.studio/projects/sfdse/randomness)). It is a pure function: a Bitcoin block hash in,
four dice, a rarity, an image and the NFT's metadata out. The same hash always gives the same result.
The project's NFTs are generated with this exact code.

## How the dice are made

1. The seed is the block's hash, as the 64 hex characters a block explorer shows.
2. The code hashes the text `sfdse:<hash>:0` with SHA-256, then `sfdse:<hash>:1`, `…:2` and so on, and
   reads the resulting bytes in order.
3. Each die takes the next byte and skips bytes 252 to 255, so every face from 1 to 6 has exactly the
   same chance (`stream()` in `sfdse-core.cjs`).
4. The four dice are read first. The layout of the image is read from the same stream afterwards.

Rarity comes from the four dice: Common, Uncommon (one pair), Rare (two different pairs), Ultra Rare
(all four the same, not 1s), So Close! (three 1s), Double Snake Eyes (four 1s).

## Check a block yourself

Take a block's hash from any block explorer (an NFT's Block Height trait tells you which block) and run:

```bash
node -e "const S=require('./sfdse-core.cjs');const r=S.stream('000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f');const d=[r.die(),r.die(),r.die(),r.die()];console.log(d,S.rarity(d))"
```

That is Bitcoin's first block, and it prints `[ 6, 3, 5, 6 ] 'Common'`. The page at
https://guppy.studio/projects/sfdse/randomness does the same in your browser. The file also works as a
classic `<script>` in a browser, where it defines `SFDSE`.

## Tests

```bash
npm test                 # 100,000 random seeds: dice fairness, exact odds, geometry (about a minute)
npm run replay           # roll the last 730 days of real blocks (needs network access to mempool.space)
npm run randomness       # chi-square tests on those real hashes
```

`npm run randomness` reports whether the faces, the rarities, the first two dice together and one block
to the next look biased. A test like that can only fail to find bias; it cannot prove randomness.

## What this does and does not show

- The mapping from a hash to the dice is fixed, public and checkable: anyone can redo it.
- The unpredictability rests on one assumption, that a Bitcoin block hash cannot be predicted ahead of
  time or cheaply steered. This code cannot prove that.
- The project's Workers, keys and deployment are not in this repository.
