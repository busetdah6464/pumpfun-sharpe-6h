// pumpfun-sharpe-6h — a launch sniper with a rug filter.
//
// The idea, in one paragraph: every pump.fun coin is born in a single
// CreateEvent, and the first few slots of its life say almost everything
// about whether it is a real launch or a rug waiting to happen. A real
// launch has a creator who put meaningful money in at creation, a handful
// of genuine early trades, only a few distinct buyers (not a Sybil bundle
// of wallets), and a creator who has not sold a token. A rug has the
// opposite shape: a creator who bought dust, or bought big and is already
// out, or dozens of wallets piling in at once. So this bot watches every
// coin from birth, buys only the ones whose first slots look honest, and
// then gets out fast — a quick take-profit, a stop-loss, a hard cap on
// how long any coin is held, and an instant exit the moment the creator
// sells. One buy per coin, one fixed size, no adding to losers, no
// splitting orders, no partial profit-taking: every extra mechanism tried
// on the dev window cost more in fees than it earned back.
//
// This is the Sharpe variant, so the size is small on purpose (0.10 SOL
// a coin): the ranking rewards steady hourly gains, and small equal bets
// keep any single hour from being dominated by one coin's exit.
//
// Determinism: the bot keeps all of its state in insertion-ordered maps
// fed only by the batch stream. No clock, no randomness, no I/O, no
// environment reads — the same batches always produce the same orders.

import type { Batch, BotState, OrderInput } from './vendor/agentfun-bot.ts';

/** Basis points in one whole: 10_000 bps = 100%. */
const BPS_DENOM = 10_000n;

/**
 * Every knob the sniper takes. Lamport amounts are bigints internally;
 * createStrategy also accepts plain numbers for them, because main.ts
 * passes number literals.
 */
export interface Params {
  /** Youngest age (slots since creation) at which a coin may be bought. */
  minAge: number;
  /** Oldest age (slots since creation) at which a coin may be bought. */
  maxAge: number;
  /** Trades that must have printed before an entry is considered. */
  minTrades: number;
  /** Smallest creator buy at creation (lamports) that still looks honest. */
  minDevBuy: bigint;
  /** Largest creator buy at creation (lamports) that still looks honest. */
  maxDevBuy: bigint;
  /** Fewest distinct non-creator buyers a launch must have. */
  minBuyers: number;
  /** Most distinct non-creator buyers a launch may have (Sybil guard). */
  maxBuyers: number;
  /** Least real SOL a curve must hold at decision time (lamports). */
  minRealSol: bigint;
  /** Most real SOL a curve may hold at decision time (lamports). */
  maxRealSol: bigint;
  /** SOL spent on each buy (lamports), before the 1% reserve cap. */
  stakeLamports: bigint;
  /** Smallest buy worth sending (lamports); smaller sizes are skipped. */
  minBuyLamports: bigint;
  /** Extra buys into a held coin; 0 means one buy per coin, ever. */
  maxAdds: number;
  /** Pieces a buy is split into; 1 means the whole stake in one order. */
  maxSplit: number;
  /** Pieces the base order uses; kept at 1 alongside maxSplit. */
  baseSplit: number;
  /** Take-profit threshold, in basis points above the entry cost. */
  tpBps: number;
  /** Stop-loss threshold, in basis points below the entry cost. */
  slBps: number;
  /**
   * Partial take-profit threshold, in basis points above the entry cost.
   * Set above any reachable move (1_000_000 = 10_000%) to disable it:
   * partials cost net on the dev window, so this variant never takes one.
   */
  tp1Bps: number;
  /** Longest a position is held, in slots from the fill that opened it. */
  maxHold: number;
  /** Sell everything at once when the creator sells any tokens. */
  exitOnDevSell: boolean;
  /** Slippage cap on every order, in basis points (10_000 = accept all). */
  buySlippageBps: number;
}

/** Defaults: the tuned values for this competition (main.ts overrides). */
export const DEFAULT_PARAMS: Params = {
  minAge: 0,
  maxAge: 10,
  minTrades: 4,
  minDevBuy: 500_000_000n,
  maxDevBuy: 2_500_000_000n,
  minBuyers: 0,
  maxBuyers: 10,
  minRealSol: 1_000_000_000n,
  maxRealSol: 30_000_000_000n,
  stakeLamports: 100_000_000n,
  minBuyLamports: 5_000_000n,
  maxAdds: 0,
  maxSplit: 1,
  baseSplit: 1,
  tpBps: 2500,
  slBps: 2000,
  tp1Bps: 1_000_000,
  maxHold: 10,
  exitOnDevSell: true,
  buySlippageBps: 10_000,
};

/** A lamport amount as it may arrive: bigint, safe integer, or digits. */
type LamportInput = bigint | number | string;

function asLamports(value: LamportInput): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

/**
 * Everything remembered about one coin, built up from the batch stream.
 * A coin is filed the first time any of its events is seen; the entry
 * filter reads this file, and the exit logic reads the position fields.
 */
interface CoinFile {
  /** The wallet that created the coin (from its CreateEvent). */
  creator: string;
  /** Slot of the CreateEvent; null when the coin was first met by trade. */
  bornSlot: number | null;
  /** The creator's buy in the birth slot, once that trade has been seen. */
  devBuy: bigint | null;
  /** True once any sell by the creator has printed. */
  devSold: boolean;
  /** Distinct wallets other than the creator that have bought so far. */
  buyers: Set<string>;
  /** A buy order already went out for this coin; one buy per coin, ever. */
  bought: boolean;
  /** Slot the opening buy filled, while a position in it is open. */
  entrySlot: number | null;
  /** Whether the partial take-profit already fired on this position. */
  tookHalf: boolean;
}

function blankFile(creator: string, bornSlot: number | null): CoinFile {
  return {
    creator,
    bornSlot,
    devBuy: null,
    devSold: false,
    buyers: new Set<string>(),
    bought: false,
    entrySlot: null,
    tookHalf: false,
  };
}

/**
 * Build the strategy. All lamport params are normalised to bigint here,
 * so callers may pass plain numbers (as main.ts does) or bigints.
 */
export function createStrategy(raw: Params) {
  const params: Params = {
    ...raw,
    minDevBuy: asLamports(raw.minDevBuy as unknown as LamportInput),
    maxDevBuy: asLamports(raw.maxDevBuy as unknown as LamportInput),
    minRealSol: asLamports(raw.minRealSol as unknown as LamportInput),
    maxRealSol: asLamports(raw.maxRealSol as unknown as LamportInput),
    stakeLamports: asLamports(raw.stakeLamports as unknown as LamportInput),
    minBuyLamports: asLamports(raw.minBuyLamports as unknown as LamportInput),
  };

  /** Every coin ever seen, in first-seen order. */
  const files = new Map<string, CoinFile>();
  /**
   * Coins still inside their entry window, in creation order. Entries are
   * only ever scanned from this set, so a batch costs work proportional
   * to the handful of newborn coins, not to every coin in the window.
   */
  const watch = new Set<string>();

  /**
   * Fold one batch's chain events into the coin files. Creates open a
   * file and put the coin on the watch list; trades fill in the creator's
   * birth-slot buy, the creator-sold flag, and the distinct-buyer set.
   */
  function noteEvents(batch: Batch): void {
    for (const ev of batch.events) {
      if (ev.event === 'CreateEvent') {
        const known = files.get(ev.mint);
        if (known !== undefined) {
          // First met through a trade or a mark; the create fills in the
          // birth slot and the creator, and starts the entry window now.
          known.creator = ev.creator;
          known.bornSlot = ev.slot;
        } else {
          files.set(ev.mint, blankFile(ev.creator, ev.slot));
        }
        watch.add(ev.mint);
      } else if (ev.event === 'TradeEvent') {
        let file = files.get(ev.mint);
        if (file === undefined) {
          file = blankFile(ev.creator, null);
          files.set(ev.mint, file);
        }
        if (ev.user === file.creator) {
          if (ev.is_buy) {
            // The creator's own buy at creation: the single trade in the
            // birth slot. Later creator buys are not the launch buy and
            // do not change the read on the coin.
            if (file.devBuy === null && file.bornSlot !== null && ev.slot === file.bornSlot) {
              file.devBuy = BigInt(ev.sol_amount);
            }
          } else {
            file.devSold = true;
          }
        } else if (ev.is_buy) {
          file.buyers.add(ev.user);
        }
      } else {
        // CompleteEvent: the curve migrated; it leaves the watch list
        // and can never be entered. Positions in it are closed by the
        // harness itself, so there is nothing else to do here.
        watch.delete(ev.mint);
      }
    }
  }

  /**
   * Fold one batch's fills into the position bookkeeping. A filled buy
   * opens the holding clock; a rejected or failed buy frees the coin for
   * another try inside its entry window; a sell that empties the position
   * (or a harness close) clears the clock.
   */
  function noteFills(state: BotState, batch: Batch): void {
    for (const fill of batch.fills) {
      const file = files.get(fill.mint);
      if (file === undefined) continue;
      if (fill.side === 'buy') {
        if (fill.status === 'filled') {
          file.entrySlot = fill.slot;
          file.tookHalf = false;
        } else {
          // Rejected or failed: no tokens arrived, so the one-buy rule
          // releases and the coin may be tried again while it is young.
          file.bought = false;
          file.entrySlot = null;
        }
      } else if (!state.positions.has(fill.mint)) {
        // The sell emptied the position, or the harness closed it
        // (complete / flatten / write-off): the holding clock stops.
        file.entrySlot = null;
        file.tookHalf = false;
      }
    }
  }

  /** Drop watched coins whose entry window has closed. */
  function pruneWatch(slot: number): void {
    for (const mint of watch) {
      const file = files.get(mint);
      if (file === undefined) {
        watch.delete(mint);
        continue;
      }
      if (file.bornSlot !== null && slot - file.bornSlot > params.maxAge) {
        watch.delete(mint);
      }
    }
  }

  /**
   * Mark value of a holding in lamports: tokens times the curve's current
   * price (virtual SOL per virtual token). Integer division truncates,
   * which only ever understates the value by less than a lamport.
   */
  function markValue(
    virtualQuote: bigint,
    virtualTokens: bigint,
    tokens: bigint,
  ): bigint | null {
    if (virtualTokens <= 0n) return null;
    return (tokens * virtualQuote) / virtualTokens;
  }

  /**
   * Decide exits for every open position. Exits run before entries, so a
   * slot never spends cash it just freed on a coin it is leaving. Each
   * position is sold whole except for the (disabled) partial take-profit.
   * Returns the sell orders, in position order.
   */
  function decideExits(state: BotState, slot: number, budget: { left: number; reserved: bigint }): OrderInput[] {
    const sells: OrderInput[] = [];
    const txFee = state.txFeeLamports();
    for (const [mint, holding] of state.positions) {
      if (budget.left <= 0) break;
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      // A sell for this coin is already in flight (fills land two slots
      // after the decision): sending another one for the same tokens
      // would only come back rejected, so wait for the fill.
      let sellPending = false;
      for (const pending of state.pending.values()) {
        if (pending.order.side === 'sell' && pending.order.mint === mint) {
          sellPending = true;
          break;
        }
      }
      if (sellPending) continue;
      const tokens = holding.token_amount;
      const cost = holding.cost_lamports;
      if (tokens <= 0n || cost <= 0n) continue;
      const file = files.get(mint);

      let sellAll = false;
      let sellHalf = false;

      // The creator selling is the rug signal: out at once, whole.
      if (file !== undefined && file.devSold && params.exitOnDevSell) {
        sellAll = true;
      }

      if (!sellAll) {
        const value = markValue(curve.virtual_quote_reserves, curve.virtual_token_reserves, tokens);
        if (value !== null) {
          const scaled = value * BPS_DENOM;
          if (scaled >= cost * (BPS_DENOM + BigInt(params.tpBps))) {
            sellAll = true; // Take profit: up tpBps over the entry cost.
          } else if (scaled <= cost * (BPS_DENOM - BigInt(params.slBps))) {
            sellAll = true; // Stop loss: down slBps under the entry cost.
          } else if (
            file !== undefined &&
            !file.tookHalf &&
            params.tp1Bps > 0 &&
            scaled >= cost * (BPS_DENOM + BigInt(params.tp1Bps))
          ) {
            // Partial take-profit. With tp1Bps at 1_000_000 this needs a
            // 100x move and never fires; it is here so the knob is real.
            sellHalf = true;
          }
        }
      }

      // Time stop: never hold past maxHold slots from the opening fill.
      if (!sellAll && !sellHalf && file !== undefined && file.entrySlot !== null) {
        if (slot - file.entrySlot >= params.maxHold) sellAll = true;
      }

      if (sellAll) {
        sells.push({ side: 'sell', mint, token_amount: tokens, max_slippage_bps: params.buySlippageBps });
        budget.left -= 1;
        budget.reserved += txFee;
      } else if (sellHalf) {
        const half = tokens / 2n;
        if (half > 0n) {
          sells.push({ side: 'sell', mint, token_amount: half, max_slippage_bps: params.buySlippageBps });
          budget.left -= 1;
          budget.reserved += txFee;
          if (file !== undefined) file.tookHalf = true;
        }
      }
    }
    return sells;
  }

  /**
   * Decide entries from the watch list, in creation order. A coin is
   * bought only when every part of the rug filter passes at decision
   * time; the buy is the fixed stake, capped at 1% of the curve's real
   * SOL reserve, and skipped when the cap would make it too small.
   */
  function decideEntries(state: BotState, slot: number, budget: { left: number; reserved: bigint }): OrderInput[] {
    const buys: OrderInput[] = [];
    const txFee = state.txFeeLamports();
    let room = state.hello.caps.max_open_positions - state.committedPositionCount();
    if (room <= 0) return buys;

    for (const mint of watch) {
      if (budget.left <= 0 || room <= 0) break;
      const file = files.get(mint);
      const curve = state.curves.get(mint);
      if (file === undefined || curve === undefined || curve.complete) continue;
      if (file.bornSlot === null) continue;

      // Age window: only the first maxAge slots after creation.
      const age = slot - file.bornSlot;
      if (age < params.minAge || age > params.maxAge) continue;
      // Enough genuine trades have printed.
      if (curve.trades < params.minTrades) continue;
      // The creator's birth-slot buy must sit in the honest band.
      if (file.devBuy === null || file.devBuy < params.minDevBuy || file.devBuy > params.maxDevBuy) continue;
      // The creator must not have sold anything.
      if (file.devSold) continue;
      // Buyer count must sit in the band: not a Sybil bundle.
      if (file.buyers.size < params.minBuyers || file.buyers.size > params.maxBuyers) continue;
      // Real SOL in the curve must sit in the band.
      const real = curve.real_quote_reserves;
      if (real < params.minRealSol || real > params.maxRealSol) continue;
      // One buy per coin, and never while already holding or buying it.
      if (file.bought || state.positions.has(mint)) continue;
      let buyPending = false;
      for (const pending of state.pending.values()) {
        if (pending.order.side === 'buy' && pending.order.mint === mint) {
          buyPending = true;
          break;
        }
      }
      if (buyPending) continue;

      // Size: the fixed stake, capped at 1% of the real reserve.
      let size = params.stakeLamports;
      const cap = state.maxBuyLamports(mint);
      if (size > cap) size = cap;
      if (size < params.minBuyLamports) continue;

      // Split the stake when the params ask for it; this tuning keeps
      // one piece, so the loop below runs exactly once here.
      const pieces = Math.max(1, params.maxSplit);
      const each = size / BigInt(pieces);
      if (each < params.minBuyLamports) continue;
      let sent = false;
      for (let i = 0; i < pieces; i++) {
        if (budget.left <= 0 || room <= 0) break;
        // The first piece carries the integer-division remainder.
        const piece = i === 0 ? size - each * BigInt(pieces - 1) : each;
        if (piece < params.minBuyLamports) continue;
        // Cash on hand must cover the buy and its transaction fee.
        if (state.freeCashLamports() - budget.reserved - piece - txFee < 0n) continue;
        buys.push({ side: 'buy', mint, quote_lamports: piece, max_slippage_bps: params.buySlippageBps });
        budget.left -= 1;
        budget.reserved += piece + txFee;
        sent = true;
      }
      // One buy decision per coin, split or not; never add afterwards.
      if (sent) {
        file.bought = true;
        room -= 1;
        watch.delete(mint);
      }
    }
    return buys;
  }

  /**
   * One batch, one answer. Fold the batch in, decide exits first, then
   * entries, and return this batch's orders. maxAdds is honoured by
   * construction: a coin is bought at most once, and no order ever adds
   * to a position that is already open.
   */
  function onBatch(state: BotState, batch: Batch): OrderInput[] {
    const slot = batch.slot;
    noteEvents(batch);
    noteFills(state, batch);
    pruneWatch(slot);

    const budget = { left: state.hello.caps.max_orders_per_batch, reserved: 0n };
    const sells = decideExits(state, slot, budget);
    const buys = decideEntries(state, slot, budget);
    return [...sells, ...buys];
  }

  return { onBatch };
}
