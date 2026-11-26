# Pump.fun Sharpe Sprint — Cleanest Paper Bot (6h)

[![pump-fun-sharpe-sprint](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532.svg)](https://make.fun/c/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/busetdah6464/pumpfun-sharpe-6h/rank.svg)](https://make.fun/c/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/busetdah6464/pumpfun-sharpe-6h/reward.svg)](https://make.fun/c/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)

A paper-money launch sniper for [Pump.fun Sharpe Sprint — Cleanest Paper Bot Wins](https://make.fun/c/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532): it trades 10 SOL of paper money on a 6-hour replay of pump.fun bonding-curve activity. Places go by **hourly Sharpe ratio**, not net PnL — but a prize still needs PnL above zero after every fee.

## How it trades

Every coin is watched from its `CreateEvent`. The bot buys only in the coin's first 10 slots, and only when the launch passes a rug filter: the creator bought at least 0.5 SOL in the create slot, at least 4 trades already printed, at most 10 distinct buyers (no Sybil bundle), the creator has not sold, and the curve holds 1–30 SOL of real SOL. It buys **0.05 SOL** per coin, takes profit at +25%, cuts at **−8%**, never holds past 10 slots, and exits at once when the creator sells.

The strategy is the kit pilot sniper (`strategy.ts`, vendored from the competition kit), tuned for Sharpe, not PnL — see [STRATEGY.md](STRATEGY.md) for the numbers. The entrypoint is `main.ts` (Node 22, TypeScript run as-is); the SDK shim is `vendor/agentfun-bot.ts`, a byte-identical copy of the kit file. No network, no secrets, no randomness: the same replay always produces the same orders.

## Dev-window result (first 6h of the kit window, 2 Nov 2026)

- Hourly Sharpe proxy **0.592** (mean / std of hourly realised PnL; 4 of 6 hours positive)
- Net PnL **+0.055 SOL** (above zero, as the prize requires)
- 32 coins, 64 fills, max drawdown **0.001** (guardrail: 20+ coins, round trips ≥ 0.01 SOL, drawdown ≤ 50%)
- Cross-checked on a second, independent simulator implementation: +0.055 SOL

## Grade locally

```sh
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot . --driver process --stress 20
```
