// Token radar round 3 — value model, farm plans and hold-out validation.
//
// Every number below is derived from the sealed snapshot at run time. No
// protocol name is ever special-cased: the same functions score every row.
//
//   calibrateMultiples  median mcap/TVL per category over live-token
//                       protocols, winsorized, shrunk to the global median
//   impliedValue        TVL x category multiple x growth x maturity
//   holdoutValidation   fit on half the live set, predict the other half,
//                       report median error + within-2x / within-5x counts
//   farmSteps           six concrete steps per protocol, branched on the
//                       protocol's own category, chain, TVL and age
//   buildBoard          40 watchlist rows + 160 early pre-token rows, ranked
//   dataScript          compact data.js for the dashboard (short keys)

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  winsor_low: number;
  winsor_high: number;
  shrink_n: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_floor: number;
  growth_cap: number;
  growth_weight: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  farm_threshold_usd: number;
  watch_threshold_usd: number;
}

export const MODEL: ModelConstants = {
  winsor_low: 0.01,
  winsor_high: 5,
  shrink_n: 3,
  multiple_floor: 0.03,
  multiple_cap: 1.2,
  growth_floor: -50,
  growth_cap: 100,
  growth_weight: 0.6,
  maturity_floor: 0.75,
  maturity_range: 0.45,
  maturity_days: 1095,
  unknown_age_days: 365,
  farm_threshold_usd: 50_000_000,
  watch_threshold_usd: 10_000_000,
};

export const MODEL_VERSION = 'radar-3-calibrated';
export const EARLY_ROWS = 160;
export const LIVE_ROWS = 24;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export type Verdict = 'FARM' | 'WATCH' | 'SKIP';

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  verdict: Verdict;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  r: number;
  s: string;
  n: string;
  c: string | null;
  ch: string[];
  t: number;
  g: number | null;
  a: number | null;
  v: number;
  mu: number;
  gm: number;
  mm: number;
  vd: Verdict;
  f: string[];
}

export interface LiveRow {
  s: string;
  n: string;
  c: string | null;
  ch: string[];
  t: number;
  m: number | null;
  g: number | null;
}

export interface CategoryStat {
  c: string;
  n: number;
  mult: number;
  total_implied: number;
}

export interface Validation {
  n_test: number;
  median_abs_pct: number;
  median_factor: number;
  within_2x: number;
  within_5x: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  verdicts: { FARM: number; WATCH: number; SKIP: number };
  total_implied: number;
  median_multiple: number;
  validation: Validation;
  categories: CategoryStat[];
  rows: RadarRow[];
  live: LiveRow[];
  live_all: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function median(values: number[]): number {
  const a = [...values].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)]!;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** Live-token protocols usable as comparables: a real market cap, real TVL, not an exchange. */
export function liveSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 1_000_000 && p.tvl_usd > 0 && p.category !== 'CEX',
  );
}

/**
 * calibrateMultiples: for each category, the median mcap/TVL of its live-token
 * protocols, each ratio winsorized to [winsor_low, winsor_high] so one freak
 * listing cannot set the multiple, then shrunk toward the global median:
 * multiple = (n * categoryMedian + shrink_n * globalMedian) / (n + shrink_n),
 * clamped to [multiple_floor, multiple_cap]. Thin categories lean on the
 * global median; thick ones speak for themselves.
 */
export function calibrateMultiples(
  live: SnapshotProtocol[],
  model: ModelConstants = MODEL,
): { multiples: Map<string, number>; global: number } {
  const ratios = live.map((p) => clamp(p.mcap_usd! / p.tvl_usd, model.winsor_low, model.winsor_high));
  const global = median(ratios);
  const byCat = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? '(none)';
    const arr = byCat.get(key) ?? [];
    arr.push(clamp(p.mcap_usd! / p.tvl_usd, model.winsor_low, model.winsor_high));
    byCat.set(key, arr);
  }
  const multiples = new Map<string, number>();
  for (const [key, arr] of byCat) {
    const m = (arr.length * median(arr) + model.shrink_n * global) / (arr.length + model.shrink_n);
    multiples.set(key, round4(clamp(m, model.multiple_floor, model.multiple_cap)));
  }
  return { multiples, global: round4(global) };
}

/** The three multipliers and the implied value one protocol gets. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  multiples: Map<string, number>,
  global: number,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const multiple = multiples.get(p.category ?? '(none)') ?? global;
  const growthPct = clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, multiple, growthPct, growthMult, maturityMult, age };
}

/**
 * holdoutValidation: split the live set deterministically by slug order
 * (even positions train, odd positions test), fit the multiples on the train
 * half only, predict each test protocol's market cap from its TVL, and report
 * the median absolute percentage error, the median error factor (10 to the
 * median absolute log10 error) and how many predictions land within 2x / 5x.
 * A model that cannot predict the market caps it has seen is honest about it.
 */
export function holdoutValidation(snapshot: Snapshot, model: ModelConstants = MODEL): Validation {
  const live = liveSet(snapshot).sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const train = live.filter((_, i) => i % 2 === 0);
  const test = live.filter((_, i) => i % 2 === 1);
  const { multiples, global } = calibrateMultiples(train, model);
  const pctErrs: number[] = [];
  const logErrs: number[] = [];
  let within2 = 0;
  let within5 = 0;
  for (const p of test) {
    const { implied } = impliedValue(p, snapshot.as_of, multiples, global, model);
    const ratio = implied / p.mcap_usd!;
    pctErrs.push(Math.abs(implied - p.mcap_usd!) / p.mcap_usd!);
    logErrs.push(Math.abs(Math.log10(ratio)));
    if (ratio >= 0.5 && ratio <= 2) within2++;
    if (ratio >= 0.2 && ratio <= 5) within5++;
  }
  return {
    n_test: test.length,
    median_abs_pct: Math.round(median(pctErrs) * 1000) / 10,
    median_factor: Math.round(Math.pow(10, median(logErrs)) * 100) / 100,
    within_2x: within2,
    within_5x: within5,
  };
}

export function verdictFor(implied: number, model: ModelConstants = MODEL): Verdict {
  if (implied >= model.farm_threshold_usd) return 'FARM';
  if (implied >= model.watch_threshold_usd) return 'WATCH';
  return 'SKIP';
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { multiples, global } = calibrateMultiples(liveSet(snapshot), model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples, global, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    verdict: verdictFor(s.implied, model),
    model: {
      base_multiple: s.multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Gas for one transaction on the protocol's first chain: Ethereum is dear, L2s and Solana are cheap. */
function gasFor(chain: string): { tx: string; week: string } {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return { tx: 'about $8 of gas', week: 'about $8 of gas a week' };
  if (c === 'solana') return { tx: 'under $0.10 of gas', week: 'under $0.10 of gas a week' };
  if (c === 'bitcoin' || c === 'tron') return { tx: 'about $2 of gas', week: 'about $2 of gas a week' };
  return { tx: 'about $1 of gas', week: 'about $1 of gas a week' };
}

/** Farm capital tier from the protocol's own TVL: bigger books, bigger positions. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 250_000_000) return 250;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** Hold window from the protocol's age: younger books need a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

interface Branch {
  primary: string;
  weekly: string;
  second: string;
}

/** The category branch: the primary action, the weekly qualifying action and the second position. */
function branchFor(p: SnapshotProtocol, capital: number, chain: string): Branch {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return {
      primary: `Supply $${capital} of USDC to ${name} on ${chain} as collateral and borrow a small amount against it`,
      weekly: `adjust the borrow or repay a little each week so the position shows fresh activity`,
      second: `open a second, smaller supply position in a different asset on ${name}`,
    };
  if (c.includes('dex'))
    return {
      primary: `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the position open`,
      weekly: `swap a small amount through ${name} each week and collect the fees`,
      second: `add $${Math.round(capital / 2)} of liquidity to a second ${name} pool on another chain it runs on`,
    };
  if (c.includes('bridge'))
    return {
      primary: `Bridge $${capital} of USDC into ${chain} through ${name} and use the bridged funds in its app`,
      weekly: `bridge a small amount back or onward through ${name} each week`,
      second: `route a second $${Math.round(capital / 2)} transfer through ${name} on a different source chain`,
    };
  if (c.includes('liquid staking') || c.includes('liquid restaking') || c.includes('restak') || c.includes('staking'))
    return {
      primary: `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and hold the receipt token`,
      weekly: `restake the receipt token's rewards through ${name} each week`,
      second: `stake a second $${Math.round(capital / 2)} tranche through ${name} after the first has aged two weeks`,
    };
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options'))
    return {
      primary: `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position on ${chain}`,
      weekly: `open and close one small position on ${name} each week to keep volume on the account`,
      second: `place a second small order on a different market ${name} lists, sized under $${Math.round(capital / 2)}`,
    };
  if (c.includes('rwa'))
    return {
      primary: `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farming wallet`,
      weekly: `claim and re-mint the asset's yield through ${name} each week`,
      second: `mint a second $${Math.round(capital / 2)} tranche once the first has earned for a month`,
    };
  if (c.includes('stable') || c.includes('algo'))
    return {
      primary: `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it`,
      weekly: `swap a small amount in and out of the stable asset on ${name} each week`,
      second: `deposit a second $${Math.round(capital / 2)} into ${name}'s savings or staking module`,
    };
  if (c.includes('launchpad'))
    return {
      primary: `Stake $${capital} through ${name} on ${chain} to qualify for its launches and join the next sale`,
      weekly: `vote or check in on ${name}'s launch board each week while qualified`,
      second: `join a second ${name} launch with $${Math.round(capital / 2)} once the first allocation lands`,
    };
  if (c.includes('prediction'))
    return {
      primary: `Fund $${capital} on ${name} and place one researched market position on ${chain}`,
      weekly: `place one small market position on ${name} each week, never more than $${Math.round(capital / 5)}`,
      second: `open a second position on a different ${name} market with $${Math.round(capital / 2)}`,
    };
  if (c.includes('insurance'))
    return {
      primary: `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active`,
      weekly: `check ${name}'s active cover and claims board each week while the policy runs`,
      second: `buy a second $${Math.round(capital / 2)} cover on a different pool ${name} underwrites`,
    };
  if (c.includes('yield aggregator') || c.includes('yield'))
    return {
      primary: `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the shares`,
      weekly: `harvest and re-deposit the vault's yield through ${name} each week`,
      second: `deposit $${Math.round(capital / 2)} into a second ${name} vault with a different strategy`,
    };
  if (c.includes('curator') || c.includes('allocator') || c.includes('onchain capital'))
    return {
      primary: `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares`,
      weekly: `review the vault's allocation report on ${name} each week and re-deposit any yield`,
      second: `allocate $${Math.round(capital / 2)} to a second ${name} vault run by a different curator`,
    };
  if (c.includes('basis') || c.includes('leveraged farm') || c.includes('farm'))
    return {
      primary: `Deposit $${capital} into ${name}'s main strategy on ${chain} and keep the position open`,
      weekly: `harvest the strategy's rewards on ${name} each week and compound them`,
      second: `add $${Math.round(capital / 2)} to a second ${name} strategy with a different underlying`,
    };
  if (c.includes('synthetic'))
    return {
      primary: `Mint $${capital} of ${name}'s synthetic asset on ${chain} against USDC collateral`,
      weekly: `adjust the collateral ratio on ${name} each week so the position stays healthy`,
      second: `mint a second $${Math.round(capital / 2)} synthetic position on another asset ${name} supports`,
    };
  if (c.includes('liquidity manager'))
    return {
      primary: `Deposit $${capital} into a ${name} managed vault on ${chain} and keep the shares`,
      weekly: `check the vault's rebalancing report on ${name} each week`,
      second: `deposit $${Math.round(capital / 2)} into a second ${name} vault on another chain`,
    };
  if (c.includes('payment'))
    return {
      primary: `Route $${capital} of payments through ${name} on ${chain} and keep the receipts`,
      weekly: `make one small payment through ${name} each week from the farming wallet`,
      second: `route a second $${Math.round(capital / 2)} payment through ${name} to a different recipient`,
    };
  if (c.includes('nft'))
    return {
      primary: `List or trade with $${capital} of volume on ${name}'s marketplace on ${chain}`,
      weekly: `make one small trade on ${name} each week and keep the receipts`,
      second: `trade a second $${Math.round(capital / 2)} item on a different ${name} collection`,
    };
  if (c.includes('index'))
    return {
      primary: `Buy $${capital} of ${name}'s index token on ${chain} and hold it`,
      weekly: `rebalance the holding through ${name} each week when its weights move`,
      second: `buy $${Math.round(capital / 2)} of a second ${name} index with a different basket`,
    };
  if (c.includes('governance'))
    return {
      primary: `Lock $${capital} through ${name} on ${chain} to gain voting weight and vote on the next proposal`,
      weekly: `vote on each new ${name} proposal while the lock runs`,
      second: `lock a second $${Math.round(capital / 2)} tranche to extend the voting weight`,
    };
  if (c.includes('privacy'))
    return {
      primary: `Use $${capital} through ${name}'s private transfer on ${chain} and keep the receipts`,
      weekly: `make one small private transfer through ${name} each week`,
      second: `run a second $${Math.round(capital / 2)} transfer through ${name} on another supported chain`,
    };
  if (c.includes('token locker'))
    return {
      primary: `Lock $${capital} of tokens through ${name} on ${chain} for the longest term it offers`,
      weekly: `check the lock's vesting schedule on ${name} each week while it runs`,
      second: `lock a second $${Math.round(capital / 2)} tranche with a different unlock date`,
    };
  if (c.includes('chain'))
    return {
      primary: `Bridge $${capital} of USDC to ${name}'s chain and use it in two of its native apps`,
      weekly: `make one transaction on ${name}'s chain each week from the farming wallet`,
      second: `deploy $${Math.round(capital / 2)} into a second native app on ${name}'s chain`,
    };
  return {
    primary: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open`,
    weekly: `make one qualifying action on ${name} each week, such as a deposit, a swap or a vote`,
    second: `open a second $${Math.round(capital / 2)} position in ${name} once the first has aged two weeks`,
  };
}

/**
 * farmSteps: six steps, each an action with a cost and a time, derived from
 * the protocol's own record (category branch, first chain's gas, TVL tier
 * capital, age-based hold). No two categories farm the same way.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const b = branchFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `${b.primary}.`,
      cost: `$${capital} of capital and ${gas.tx}`,
      time: '15 minutes to set up',
    },
    {
      text: `Do this weekly: ${b.weekly}.`,
      cost: gas.week,
      time: '10 minutes a week',
    },
    {
      text: `${b.second}. Hold the first position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; never pay anyone to claim for you.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, then unwind in reverse order: close the second position first, then the first.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      s: p.slug,
      n: p.name,
      c: p.category,
      ch: p.chains,
      t: p.tvl_usd,
      m: p.mcap_usd,
      g: p.change_7d,
    }));
}

function radarRow(row: BoardRow): RadarRow {
  return {
    r: row.rank,
    s: row.slug,
    n: row.name,
    c: row.category,
    ch: row.chains,
    t: row.tvl_usd,
    g: row.change_7d,
    a: row.age_days,
    v: row.implied_value_usd,
    mu: row.model.base_multiple,
    gm: row.model.growth_multiplier,
    mm: row.model.maturity_multiplier,
    vd: row.verdict,
    f: row.farm_steps,
  };
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const { multiples, global } = calibrateMultiples(liveSet(snapshot), model);
  const verdicts = { FARM: 0, WATCH: 0, SKIP: 0 };
  let totalImplied = 0;
  const catMap = new Map<string, { n: number; total: number }>();
  for (const r of board) {
    verdicts[r.verdict]++;
    totalImplied += r.implied_value_usd;
    const key = r.category ?? '(none)';
    const e = catMap.get(key) ?? { n: 0, total: 0 };
    e.n++;
    e.total += r.implied_value_usd;
    catMap.set(key, e);
  }
  const categories: CategoryStat[] = [...catMap.entries()]
    .map(([c, e]) => ({ c, n: e.n, mult: multiples.get(c) ?? global, total_implied: e.total }))
    .sort((a, b) => b.total_implied - a.total_implied);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    verdicts,
    total_implied: totalImplied,
    median_multiple: global,
    validation: holdoutValidation(snapshot, model),
    categories,
    rows: board.map(radarRow),
    live,
    live_all: liveSet(snapshot)
      .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
      .map((p) => ({ s: p.slug, n: p.name, c: p.category, ch: p.chains, t: p.tvl_usd, m: p.mcap_usd, g: p.change_7d })),
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: short keys, farm steps included, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
