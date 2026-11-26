# Strategy notes — pumpfun-sharpe-6h (6h Sharpe)

Base: the kit pilot sniper (`strategy.ts`), a launch sniper with a rug
filter — the same shared base as the 24h and 6h-PnL sibling entries, tuned
differently because the ranking here is the **hourly Sharpe ratio**, not
net PnL (with PnL > 0 still required for a prize). Tuning was done with
the pilot's own `tools/grid.ts` plus a Sharpe-proxy sweep (mean / std of
hourly realised PnL over the 6 hours) on the first 6h of the kit dev
window (2 Nov 2026, 23,986 events), preferring flat regions over the
single best cell. The final window is recorded *after* the deadline, so no
dev-window number is a promise — steadiness (most hours positive, tiny
drawdown) is the point.

## Why this tuning, not the PnL one

- **Smaller stake (0.05 SOL vs 0.20 SOL).** Sharpe divides the mean hourly
  return by its standard deviation, so halving the size halves both — but
  the *number* of independent bets stays the same, and smaller positions
  mean no single hour is dominated by one coin's exit. Stake 0.05 SOL
  gives the best Sharpe proxy (0.592); 0.025 SOL is steadier still but its
  net (+0.025 SOL) sits too close to zero for the PnL > 0 prize rule, and
  0.10 SOL is lumpier (0.10 SOL was not in the top Sharpe cells at all).
- **Tighter stop (−8% vs −20%).** The tight stop is the single biggest
  Sharpe lever in the sweep: it cuts losers before they can drag an hour
  negative, at the cost of sometimes selling a coin that would have
  bounced. SL 800 bps wins across every stake/TP/maxHold combination
  tried; SL 1200 and 2000 are both worse on Sharpe. TP stays +25%: the
  take-profit level barely matters for Sharpe once the stop is tight.
- **Same entry filter as the 6h PnL sibling** (creator ≥0.5 SOL, ≥4
  trades, ≤10 buyers, real SOL 1–30 SOL): in a 6h window only ~32 coins
  qualify, and the filter is what keeps the per-trade expected value
  positive. Loosening it further (≥3 trades) adds coins but drops net to
  +0.014 SOL — too close to zero for the prize rule.
- **No order splitting** (maxSplit 1): pieces burn extra tx fees and crowd
  the 16-orders-per-batch cap. Disabling splits lifts the Sharpe proxy
  from 0.562 to 0.592 and net from +0.048 to +0.055 SOL.
- **maxHold 10 slots** (5 is marginally worse on Sharpe, 20 lets losers
  bleed). No partial take-profit, no adds, no trailing stop — all tried on
  the 24h window, all cost net or robustness.

## How the bot decides, per batch

The SDK shim sends a `hello` once (caps, fees, capital: 10 SOL paper),
then one `batch` per slot: the slot number, new chain events, fills of our
earlier orders, and marks for live curves. `onBatch` returns this batch's
orders (buys first as `quote_lamports`, sells as `token_amount`, each with
a slippage cap). Exits are decided before entries, so a slot never spends
cash it just freed on a coin it is leaving. No probe mechanism is needed:
the filter itself clears the guardrail (32 coins on dev).

## Guardrails

- ≥20 distinct mints with round trips ≥0.01 SOL: **32** on dev.
- Max drawdown ≤50%: **0.001** on dev.
- Max 5 open positions: the bot never holds more than 5 (1 buy per coin,
  no adds; the cap is enforced by the SDK's `committedPositionCount`).
- Deterministic: no clock, no randomness, no I/O, iteration only over
  insertion-ordered maps fed by the batch stream.

## Risks

- The Sharpe proxy here uses *realised* hourly PnL; the real scorer's
  hourly Sharpe is computed from the equity curve (including open
  positions), so the exact number will differ. The tuning direction —
  small size, tight stop, many small bets — is what the metric rewards
  under either definition.
- A 6h window holds ~30 qualifying launches on dev; two of the six dev
  hours are slightly negative. On the final window, one bad hour (a rug
  just after entry) can sink the Sharpe even if net PnL stays positive.
- If the final window is much quieter than dev, the coin count could fall
  toward the 20-mint guardrail. On dev the margin is 32 vs 20.
