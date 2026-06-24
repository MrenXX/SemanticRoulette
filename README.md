# Semantic Roulette

A web word‑guessing game played in **semantic space**. You guess words to reach a hidden target; each
guess is scored by **meaning** (not spelling), shown as a 0–100 score with decimals, a rank against the
vocabulary, and a temperature label (Freezing → Boiling). Every guess is revealed with a satisfying
slot‑machine animation. Fully client‑side, no backend.

## How it plays
- Type a word. Its **score** reflects how close it is in meaning to the target — e.g. `#7 of 40,000`,
  `80.38`, "Hot". Closer = higher.
- **Out‑of‑vocabulary** words (very rare / proper nouns) return **"not in word list"** — the game knows
  ~40k common words.
- **Bank score** starts at 1000: −10 per unique wrong guess, −75 per hint (3 max). Win by guessing the
  exact word — **plural/tense variants count** (oceans → ocean, danced → dance).
- **Hint** runs the same reveal animation, lands on a related word, and pins it on the right as
  "Hint N: word — score". Hints are de‑duplicated by **meaning** as well as spelling, so you never
  burn a hint on a word you effectively already have (e.g. `organisation`/`organization`,
  `gold`/`golden`). **Give up** reveals the target. **New word** starts a fresh round.
- **Best runs** (your highest‑scoring wins) are saved locally so you can chase your personal best.

## Semantics: precomputed word vectors
Scoring uses **GloVe word vectors** (whole‑word co‑occurrence embeddings), not a neural sentence model.
This gives true word association (key → lock/door, ocean → sea/waves) and avoids the subword bias of
sentence models (where "key" and "keyboard" share a token and score falsely high). It's also a plain
**lookup table** — instant, no model download, no inference — so the game feels snappy.

- Offline, `scripts/build-vectors.ts` filters GloVe‑100d to ~40k common words, L2‑normalizes, and
  **int8‑quantizes** them into `public/data/vectors.bin` (~3.8 MB). Verified lossless for ranking
  (9.8/10 nearest‑neighbour overlap vs fp32) by `scripts/feasibility-glove.ts`.
- At runtime, `src/game/vectors.ts` loads the matrix once and ranks a guess against the whole
  vocabulary with int8 dot products. All synchronous and instant.

## The deep‑space world
One immersive Three.js world. The hidden target is a central **body** you choose (Star, or Black hole
with a gravitationally‑lensed accretion disk), surrounded by temperature‑varied stars, planets, and
nebula. **Click‑drag to rotate** the whole system (with inertia); **mouse‑wheel to zoom**. A guess lands
at **distance‑from‑centre = score** (closer is better). Requires WebGL2 (a friendly message is shown if
it's unavailable).

### Reveal mechanics (the "slot machine" moment)
Selectable, satisfying gambles (bottom‑left selector, or `?reveal=`):
- **Orbital Roulette** (`orbital`) — the guess whips around the body like a roulette ball, its orbit
  decaying inward through odds rings before dropping into its final orbit.
- **Supernova Snap** (`supernova`) — the field is dragged inward and crushed to a singularity, then
  detonates: a deep cosmic boom and an expanding remnant scatter the field back as the guess is flung
  out to its score radius, the camera gliding to track it.
- **Classic** (`baseline`) — the original flicker‑and‑settle.

Body and reveal mechanic are remembered (localStorage + URL). The world respects
`prefers-reduced-motion` and has a mutable synth soundtrack.

## Run it
```powershell
npm install
npm run dev        # http://localhost:5173
# or a production build:
npm run build      # static site in dist/
npm run preview    # http://localhost:4173
```
Use Microsoft Edge or Chrome. The game is fully static — host `dist/` anywhere.

## Rebuilding the vectors / hints (optional)
The shipped `public/data/*` is already built.

**Regenerate just the hints** (fast; reuses the existing vectors, so guess **scores are unchanged** —
the script hash‑asserts `vectors.bin`/`vocab.json` are untouched):
```powershell
npm run test:hints   # unit tests for the meaning-level de-dup (sameConcept)
npm run hints        # rewrite public/data/targets.json (dedup + quality filter)
```
Hint quality is curated as **data**, not by hand‑editing `targets.json`:
- `scripts/vocab/hint-denylist.txt` — words never used as hints (interjections, letter‑names…).
- `scripts/vocab/hint-overrides.json` — per‑target curated lists for polysemous targets (e.g. `bee`,
  `penguin`). `npm run hints` validates these against the vocab and asserts every target keeps ≥6
  diverse, in‑vocab hints with no meaning‑level duplicates.

**Full rebuild from GloVe** (regenerates `vectors.bin` + `vocab.json` too):
```powershell
# downloads ~128 MB GloVe once into scripts/vocab/glove-100.gz
curl.exe -L -o scripts/vocab/glove-100.gz `
  "https://github.com/RaRe-Technologies/gensim-data/releases/download/glove-wiki-gigaword-100/glove-wiki-gigaword-100.gz"
npm run feasibility   # sanity-check GloVe quality (gate)
npm run vectors       # filter + int8-quantize -> public/data/ (shares the hint-selection logic)
```
Curate the playable targets in `scripts/vocab/targets.txt` (concrete, single‑sense words — polysemous
words like "key" are auto‑dropped because their dominant sense is abstract).

## Data files (`public/data/`)
- `vectors.bin` — Int8Array of 40,000 × 100 normalized GloVe vectors (~3.8 MB).
- `vocab.json` — the 40k word list (row order = vector index).
- `targets.json` — curated targets, each with precomputed hints de‑duplicated by meaning and spelling.

## Verify
`scripts/gameplay.mjs` drives the app in Microsoft Edge via Playwright (both bodies × all reveal
mechanics, hints, win, give‑up, new‑word, leaderboard, body switching, wheel‑zoom, drag‑to‑rotate,
no‑stuck‑zoom, stale‑settings sanitize, OOV, a meaning‑level hint‑dedup assertion, and a mid‑reveal
body‑switch stress test) asserting **0 console errors**. `npm run test:hints` unit‑tests the hint
de‑dup heuristic.
