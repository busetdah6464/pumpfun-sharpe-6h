# Strategy notes — pumpfun-sharpe-6h (6h Sharpe)

Base: the kit pilot sniper (`strategy.ts`), a launch sniper with a rug
filter — the same shared base as the 24h and 6h-PnL sibling entries, tuned
differently because the ranking here is the **hourly Sharpe ratio**, not
net PnL (with PnL > 0 still required for a prize). Tuning was done with
the pilot's own `tools/grid.ts` plus a Sharpe-proxy sweep (mean / std of
hourly realised PnL) on **all four 6h slices** of the kit dev window
(2–3 Nov 2026), requiring net PnL > 0 in every slice — not just the first
one. The final window is recorded *after* the deadline, so no dev-window
number is a promise — steadiness (net positive in every slice, tiny
drawdown) is the point.

## The tuning that was rejected — and why

- **Tight stop (−8%) + small stake (0.05 SOL)** looked like the obvious
  Sharpe tuning and was best on the *first* 6h slice alone (Sharpe proxy
  0.592, net +0.055 SOL). Checked on the other three 6h slices it falls
  apart: net −0.032 / −0.048 / −0.001 SOL, Sharpe proxy −0.51 / −0.62 /
  −0.07. The tight stop cuts losers before they can recover while the
  +25% take-profit rarely lands, so the strategy bleeds fees in most
  regimes. It was rejected.
- **Smaller stake is not steadier either**: 0.025 SOL has the lowest
  hourly variance in absolute terms but its net (+0.025 SOL on the first
  slice) sits too close to zero for the PnL > 0 prize rule, and its Sharpe
  proxy is worse than 0.05 SOL because the fixed per-order tx fee
  (105,000 lamports) eats a bigger share of a small position.
- **What survived all four slices**: the same +25% / −20% exits as the PnL
  sibling, 10-slot max hold, and a 0.10 SOL stake — half the PnL
  sibling's size. Mean Sharpe proxy +0.196 (0.435 / 0.164 / 0.056 /
  0.129), net positive in all four slices (+0.063 / +0.020 / +0.010 /
  +0.025 SOL). The Sharpe edge here comes from the smaller size, not from
  cutting losers earlier: halving the stake halves the absolute hourly
  swings and the absolute drawdown, while the per-trade expected value
  stays positive.

## Why this tuning, not the PnL one

- **Half the stake (0.10 SOL vs 0.20 SOL).** Sharpe divides the mean
  hourly return by its standard deviation, so halving the size halves
  both — but the *number* of independent bets stays the same, and no
  single hour is dominated by one coin's exit. Stake 0.10 SOL is the
  largest size that still keeps the worst slice's drawdown at 0.007 and
  every slice's net above zero; 0.20 SOL (the PnL sibling) has a better
  mean Sharpe proxy on this data (+0.253) only because the fixed tx fee
  matters less at bigger size — but it also doubles the absolute hourly
  swings, and on an unseen window that variance is what the Sharpe ratio
  punishes.
- **Same entry filter as the 6h PnL sibling** (creator ≥0.5 SOL, ≥4
  trades, ≤10 buyers, real SOL 1–30 SOL): in a 6h window only ~30 coins
  qualify, and the filter is what keeps the per-trade expected value
  positive. Loosening it further (≥3 trades) adds coins but drops net to
  +0.014 SOL on the first slice — too close to zero for the prize rule.
- **No order splitting** (maxSplit 1): pieces burn extra tx fees and crowd
  the 16-orders-per-batch cap.
- **maxHold 10 slots** (5 is worse on Sharpe in 2 of 4 slices and much
  worse in one). No partial take-profit, no adds, no trailing stop — all
  tried on the 24h window, all cost net or robustness.

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
  small size, many small bets, positive expected value per trade — is what
  the metric rewards under either definition.
- The mean Sharpe proxy across slices is only +0.196, and one slice is
  barely positive (+0.056). On the final window, one bad hour (a rug just
  after entry) can sink the Sharpe even if net PnL stays positive.
- If the final window is much quieter than dev, the coin count could fall
  toward the 20-mint guardrail. On dev the margin is 27–50 coins per
  slice vs 20.
