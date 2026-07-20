# Arifpay → Telebirr (NexusERP)

Third-party payment gateway for Ethiopian mobile money. Prefer this over direct Ethio Telecom Fabric APIs for faster POS go-live.

- Merchant site: https://arifpay.net/
- Developer portal: https://developer.arifpay.net/
- Dashboard API keys: https://dashboard.arifpay.net/app/api

## What was added

| Piece | Path |
|-------|------|
| Client | `apps/web/src/lib/payments/arifpay.ts` |
| Initiate Telebirr | `POST /api/payments/arifpay/telebirr` |
| Notify webhook | `POST /api/webhooks/arifpay/[organizationId]` |
| POS button | Payment modal → Mobile money → Telebirr → **Request Telebirr via Arifpay** |

Flow:

1. Cashier enters phone + amount, clicks **Request Telebirr via Arifpay**
2. Nexus creates an Arifpay checkout session (`TELEBIRR_USSD`) and calls DirectPay
3. Customer approves on their phone
4. Arifpay notifies `/api/webhooks/arifpay/{orgId}`
5. Nexus runs `confirm_payment_webhook` (same path as manual mobile-money confirm)
6. Cashier completes the sale with the filled **reference** (or completes first with pending if `pos_mobile_pending_webhook` is on)

## Environment

```bash
# Required for live/sandbox calls
ARIFPAY_API_KEY=
ARIFPAY_BENEFICIARY_ACCOUNT=   # merchant settlement account number
ARIFPAY_BENEFICIARY_BANK=      # bank code from Arifpay (e.g. AWINETAA)

# Defaults
ARIFPAY_SANDBOX=true           # set false for production
# ARIFPAY_BASE_URL=https://gateway.arifpay.net/v0
# ARIFPAY_MERCHANT_EMAIL=finance@yourdomain.com

# Show POS button (must be set for the browser bundle)
NEXT_PUBLIC_ARIFPAY_ENABLED=true
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
```

Notify URL registered automatically as:

`{NEXT_PUBLIC_APP_URL}/api/webhooks/arifpay/{organizationId}`

## Setup checklist

1. Create merchant + developer account at Arifpay
2. Enable Telebirr / `TELEBIRR_USSD` on the merchant
3. Copy API key + settlement bank details into Vercel / `.env.local`
4. Set `NEXT_PUBLIC_ARIFPAY_ENABLED=true` and redeploy
5. In org Settings, keep **mobile money pending until webhook** enabled for production
6. Sandbox test: POS → Mobile money → Telebirr → Request → approve → Complete sale

## Notes

- Manual Transaction ID entry still works without Arifpay (legacy).
- Direct Ethio Telecom Fabric integration remains optional later.
- Confirm notify payload fields with Arifpay support if confirmations do not match; parser accepts common `nonce` / `sessionId` / `paymentStatus` shapes.
