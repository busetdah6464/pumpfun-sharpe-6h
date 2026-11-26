// pumpfun-sharpe-6h: a launch sniper for the 6h pump.fun Sharpe sprint.
// Entry for u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532 (make.fun).
//
// How it runs: the grader starts `node main.ts`. The vendored SDK shim
// (vendor/agentfun-bot.ts, a byte-identical copy of the kit file) sends one
// hello first, then one batch per slot. Each batch carries the slot, the new
// chain events, the fills of our earlier orders, and the marks (current
// reserves) for every live curve. Our onBatch answers with this batch's
// orders (at most hello.caps.max_orders_per_batch), and the SDK turns them
// into wire orders with client ids. No clock, no randomness, no I/O: the
// same batches always produce the same orders, so the two graded runs
// agree byte for byte.
//
// Strategy (strategy.ts, the kit pilot sniper, tuned here): watch every
// coin from its CreateEvent and buy only launches that pass the rug filter
// in their first slots — the creator bought in size at creation, several
// real trades already printed, few distinct buyers (no Sybil bundle),
// creator has not sold, real SOL in a healthy band. Take profit fast,
// cut losers, never hold past maxHold slots, exit at once when the creator
// sells. See STRATEGY.md for the tuning numbers and why each knob is set
// the way it is.
//
// This is the Sharpe variant: the ranking is the hourly Sharpe ratio, not
// net PnL (PnL still has to be above zero for a prize). So it trades the
// same filter as the 6h PnL sibling, but smaller (0.05 SOL per coin) and
// with a much tighter stop: small, steady, low-variance gains beat one
// moonshot when the score is a Sharpe ratio.

import { runBot } from './vendor/agentfun-bot.ts';
import { createStrategy, DEFAULT_PARAMS, type Params } from './strategy.ts';

// Tuned on the first 6h of the kit dev window (2 Nov 2026, 23,986 events)
// with the pilot's grid tool, ranking by an hourly-Sharpe proxy (mean /
// std of hourly realised PnL over the 6 hours), preferring flat, robust
// regions over the single best cell:
//   Sharpe proxy 0.592, net +0.055 SOL, 4 of 6 hours positive,
//   32 coins, 64 fills, max drawdown 0.001 — guardrails (20+ coins,
//   round trips >= 0.01 SOL, drawdown <= 50%) cleared, PnL > 0.
const PARAMS: Partial<Params> = {
  // Entry: buy only in the first 10 slots after creation, once at least
  // 4 trades printed and the creator's own create-slot buy was >= 0.5 SOL.
  minAge: 0,
  maxAge: 10,
  minTrades: 4,
  minDevBuy: 500_000_000,
  maxDevBuy: 2_500_000_000,
  // At most 10 distinct non-creator buyers before entry: a launch bundled
  // by many wallets in its first slots is a dump waiting to happen.
  minBuyers: 0,
  maxBuyers: 10,
  // Only curves holding 1–30 SOL of real SOL at decision time. The floor
  // is low on purpose: in a 6h window few launches qualify, and the
  // 1%-of-real-reserve cap still keeps every buy >= 0.01 SOL.
  minRealSol: 1_000_000_000,
  maxRealSol: 30_000_000_000,
  // Size: 0.05 SOL per coin — half the PnL sibling's stake. Smaller size
  // means smaller hourly swings, which is what the Sharpe ratio rewards.
  // One buy only (no adds, no order splitting — splits only burn extra tx
  // fees and crowd the 16-orders-per-batch cap).
  stakeLamports: 50_000_000,
  minBuyLamports: 5_000_000,
  maxAdds: 0,
  maxSplit: 1,
  baseSplit: 1,
  // Exits: +25% take profit, -8% stop (tight: losers are cut before they
  // can drag an hour negative), 10-slot max hold, out at once on a
  // creator sell. No partial take-profit (it cost net on the dev window).
  tpBps: 2500,
  slBps: 800,
  tp1Bps: 1_000_000,
  maxHold: 10,
  exitOnDevSell: true,
  buySlippageBps: 10_000,
};

const strategy = createStrategy({ ...DEFAULT_PARAMS, ...PARAMS });

await runBot({
  onBatch: (state, batch) => strategy.onBatch(state, batch),
});
