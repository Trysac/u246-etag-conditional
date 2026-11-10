# Project record: etag-conditional

## Objective

ETags and conditional requests for TypeScript APIs per RFC 9110: strong and weak comparison, If-Match, If-None-Match and date preconditions in the standard order, with 304 and 412 results

State the measurable outcome this utility must deliver and who it is for.

## Scope

In scope:

- The public API documented in the README.

Out of scope:

- List what this utility deliberately does not do.

## Timeline

| Date | Milestone |
|---|---|
| 2026 | Repository created from the factory utility template. |

## Effort metrics

Measured values only. Leave "pending measurement" until a real figure is recorded; never estimate here.

| Metric | Value | Source |
|---|---|---|
| Tokens (input / output) | 633866 / 86827 | factory ledger |
| Hours (human) | pending measurement | time log |
| Cost (USD) | 0.1308 | factory ledger |

## Factory run u246 (measured from API usage)

| Date (UTC) | Phase | Model | Batch | Input | Output | Cache write | Cache read | Cost (USD) |
|---|---|---|---|---|---|---|---|---|
| 2026-11-10 | generation | deepseek-v4-pro | yes | 1993 | 20860 | 0 | 3584 | 0.0427 |
| 2026-11-10 | generation | deepseek-v4-pro | yes | 73 | 25685 | 0 | 5504 | 0.0510 |
| 2026-11-10 | fix-1 | deepseek-flash | no | 18400 | 3661 | 0 | 154624 | 0.0054 |
| 2026-11-10 | audit | deepseek-flash | no | 24449 | 16402 | 0 | 227584 | 0.0142 |
| 2026-11-10 | fix-2 | deepseek-flash | no | 15890 | 4219 | 0 | 165376 | 0.0054 |
| 2026-11-10 | docs | deepseek-flash | no | 16133 | 16000 | 0 | 256 | 0.0120 |

Total: $0.1308. Prices: deepseek line, as measured by its adapter. Providers serve the current version of each model id, so the date tells which version answered; versions, launch stages and price sources per line are in the factory's model register (docs/MODELS.md).
