# JK international manual payments — Render environment setup

Scope: draft PR #8. Do **not** remove live checkout/payment variables before the new PR is approved, deployed, and all older payment attempts are settled.

## New settings to add to Render
Open **My Workspace → jk-turnitin-telegram-bot → Environment**. Set:

| Environment variable | Value | Purpose |
| --- | --- | --- |
| `WORLDWIDE_BINANCE_ID` | `1203517288` | Binance Pay recipient User ID |
| `WORLDWIDE_BINANCE_NAME` | `JohnKaptain` | Display name/username shown to customers (customer must verify in Binance) |
| `WORLDWIDE_MPESA_NUMBER` | `+254741924396` | Kenyan M-Pesa destination for international remittances |

The code reads these via `process.env` when the bot starts; changing a value requires Render to restart/deploy the service to pick it up. These are non-secret public payee identifiers; do not put payment credentials or Binance API keys into this workflow. The PR currently supplies those recipient values as defaults if no environment setting exists; explicit Render settings are preferable.

**Important:** saving environment changes may restart or redeploy a live Render service. Coordinate the three settings with the controlled deployment of this PR, not during an unrelated production session.

## KEEP — critical active features
Do **not** delete these solely to eliminate card/checkout payments:

- `INTASEND_SECRET_KEY`, `INTASEND_PUBLISHABLE_KEY`, `INTASEND_TEST` and `INTASEND_API_BASE` — IntaSend also handles the existing Kenyan M-Pesa STK payment and status queries.
- `INTERNATIONAL_PAYMENT_ENABLED` — controls the new international menu.
- `INTERNATIONAL_CHECK_PRICE_USD`, `INTERNATIONAL_SIMILARITY_ONLY_PRICE` — still calculate international Binance USDT report prices (USD-price numerical parity is a deliberate pricing policy, not an FX quote).
- Existing Kenyan price and M-Pesa configuration (e.g. `CHECK_PRICE_KES`, `RECHECK_PRICE_KES`, `SIMILARITY_ONLY_PRICE_KES` and the till/STK settings).
- `TZ_OTHER_PROOF_WAIT_MINUTES` — the new/manual reminder currently reuses the existing timer even though the old Tanzania payment button is hidden.
- All Telegram, webhook, provider, security, storage, report and operational settings.

## RETIRE ONLY AFTER deployment + pending-payment reconciliation
These settings apply to legacy international bank/Tanzania options. They are **candidates for removal**, not safe-to-delete-now entries:

- `INTERNATIONAL_METHODS_TEXT`
- `INTERNATIONAL_BANK_FALLBACK_ENABLED`
- `INTERNATIONAL_BANK_NAME`
- `INTERNATIONAL_BANK_ACCOUNT_NUMBER`
- `INTERNATIONAL_BANK_ACCOUNT_NAME`
- `TZ_OTHER_PAYMENT_ENABLED`
- `TZ_OTHER_SAFARICOM_NUMBER`
- `TZ_OTHER_AIRTEL_NUMBER`
- `TZ_OTHER_RECIPIENT_NAME`
- `TZ_OTHER_CURRENCY`
- `INTERNATIONAL_CURRENCY` (legacy fallback/config logging)

These remain referenced by the retained legacy handlers in draft PR #8. Removing values prematurely may make old orders show built-in fallback recipient data, creating a payment-misdirection risk. First verify there are **no outstanding bank/Tanzania payments** and remove the retired branches through a separate, tested patch. Only then remove the corresponding Render keys. `TZ_OTHER_PROOF_WAIT_MINUTES` also needs a code refactor before retiring it.

## Operational safeguards
1. Confirm in your Binance account that User ID `1203517288` corresponds to recipient `JohnKaptain` and that its permitted business/USDT use fits your jurisdiction.
2. Keep a screenshot/list of **variable names only** before cleanup. Never share API keys, bot tokens, or other environment values.
3. A receipt or transaction ID does not prove payment. The administrator must verify actual incoming funds, exact currency, amount, payee and transaction reference before confirming.
4. Draft PR #8 is **not** a deployed change; production still uses its current international checkout until explicit merge and Render deployment.
