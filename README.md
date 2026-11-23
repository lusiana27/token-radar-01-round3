# token-radar-01-round3

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/lusiana27/token-radar-01-round3/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/lusiana27/token-radar-01-round3/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: 200 pre-token protocols ranked by implied value, each with a 6-step farm plan with cost + time. The board covers all 40 watchlist protocols plus 160 early finds below the $50M floor — and says honestly how well its model predicts the market.

## The board at a glance

- **200 rows** (40 watchlist + 160 early), ranked 1–200 by implied value.
- **Verdicts: 23 FARM (≥ $50M) / 79 WATCH (≥ $10M) / 98 SKIP** — the split is printed on the dashboard, not hidden.
- **Top implied value: $2.65B** (Steakhouse Financial, Risk Curators).
- **Total implied value: $9.81B** across the board.
- **Live-token table**: top 24 by market cap, shown at market value — never modelled — and used as comparables for the category multiples.

## The model

Implied value is computed from the sealed snapshot only — no hardcoded names:

```
implied = TVL × category multiple × growth × maturity
```

- **Category multiple**: winsorized median mcap/TVL of live-token protocols in the same category (ratios clipped to 0.01–5×), shrunk toward the global median (0.342×) with 3 pseudo-observations, clamped to 0.03–1.2×. Thin categories lean on the global median; thick ones speak for themselves.
- **Growth**: 1 + clamped 7-day TVL change (−50%…+100%) × 0.6.
- **Maturity**: 0.75 + up to 0.45 over 3 years listed (unknown age = 365 days).
- **Verdicts**: FARM ≥ $50M, WATCH ≥ $10M, SKIP below.

### Hold-out validation (printed on the dashboard)

The multiples are fit on half the live-token set (even slugs) and used to predict the other half (51 protocols): **median absolute error 97.3%, typical prediction 3.9× off, 16/51 within 2× and 31/51 within 5×** of the actual market cap. mcap/TVL varies widely even inside a category, so the ranking is a guide, not a price target — and the dashboard says so in plain words.

## The dashboard

- Sortable/filterable full board (search, category, chain, verdict, min TVL) and a detail view per protocol with the full implied-value working, live comparables, farm plan and risks.
- Farm plans are branched on the protocol's own category (22 branches: lending, Dexs, bridges, staking, RWA, launchpads, …), chain gas, TVL-tier capital ($50–$500) and age-based hold (30–90 days) — no two categories farm the same way.
- `detail.html` opens the #1 protocol's detail view; `filtered.html` opens the board filtered to the 23 FARM rows.
- "Records no token" means the snapshot records no market cap, CoinGecko id or symbol — it is not proof a protocol has no token. Implied value is this entry's own claim, never a price target and never a prediction that a token will launch.

## Run it

Node 22+, no dependencies, no network:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to>/snapshot.json
```

This writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. Run it twice: the outputs are byte-identical.

## Files

- `main.ts` — entrypoint: reads the snapshot, writes the board, data and dossier.
- `lib/model.ts` — `calibrateMultiples`, `impliedValue`, `holdoutValidation`, `farmSteps`, `buildBoard`.
- `dashboard/` — static page (`index.html`, `detail.html`, `filtered.html`, `app.css`, `app.js`), renders `data.js` with no network.
- `vendor/makefun-board.ts` — make.fun dossier library from the kit.
- `screenshots/` — board, detail and filtered views of the dashboard.

<sub>Entered on [make.fun](https://make.fun/?ref=j11vkafs&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
