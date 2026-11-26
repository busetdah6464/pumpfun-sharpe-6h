# Pump.fun Sharpe Sprint — Cleanest Paper Bot (6h)

[![pump-fun-sharpe-sprint](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532.svg)](https://make.fun/c/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/busetdah6464/pumpfun-sharpe-6h/rank.svg)](https://make.fun/c/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/busetdah6464/pumpfun-sharpe-6h/reward.svg)](https://make.fun/c/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)

A paper-money launch sniper for [Pump.fun Sharpe Sprint — Cleanest Paper Bot Wins](https://make.fun/c/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532): it trades 10 SOL of paper money on a 6-hour replay of pump.fun bonding-curve activity. Places go by **hourly Sharpe ratio**, not net PnL — but a prize still needs PnL above zero after every fee.

## How it trades

Every coin is watched from its `CreateEvent`. The bot buys only in the coin's first 10 slots, and only when the launch passes a rug filter: the creator bought at least 0.5 SOL in the create slot, at least 4 trades already printed, at most 10 distinct buyers (no Sybil bundle), the creator has not sold, and the curve holds 1–30 SOL of real SOL. It buys **0.10 SOL** per coin, takes profit at +25%, cuts at **−20%**, never holds past 10 slots, and exits at once when the creator sells.

The strategy is the kit pilot sniper (`strategy.ts`, vendored from the competition kit), tuned for Sharpe, not PnL — see [STRATEGY.md](STRATEGY.md) for the numbers. The entrypoint is `main.ts` (Node 22, TypeScript run as-is); the SDK shim is `vendor/agentfun-bot.ts`, a byte-identical copy of the kit file. No network, no secrets, no randomness: the same replay always produces the same orders.

## Dev-window result (four 6h slices of the kit window, 2–3 Nov 2026)

- Hourly Sharpe proxy **+0.196 mean** across slices (0.435 / 0.164 / 0.056 / 0.129)
- Net PnL **positive in all four slices**: +0.063 / +0.020 / +0.010 / +0.025 SOL (above zero, as the prize requires)
- 27–50 coins per slice, max drawdown **≤ 0.007** (guardrail: 20+ coins, round trips ≥ 0.01 SOL, drawdown ≤ 50%)
- Cross-checked on a second, independent simulator implementation
- Real-grader check (`grade-local --driver process`) runs on the kit's full 24h dev window, not the 6h slices above: net PnL **+0.076 SOL**, 141 coins, 282 fills, max drawdown 0.0087, guardrails met; regrade reproduced byte for byte (deterministic). The 6h slices are the relevant numbers for this bounty: net positive in all four (+0.063 / +0.020 / +0.010 / +0.025 SOL).

## Grade locally

```sh
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot . --driver process --stress 20
```
