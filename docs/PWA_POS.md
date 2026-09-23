# Nexus POS — PWA / PWABuilder

Installable Progressive Web App for the POS kiosk. Used to generate Android test packages via [PWABuilder](https://www.pwabuilder.com/).

## Public URL

Paste into PWABuilder:

`https://nexus-erp-preprod.vercel.app/pos`

## Assets

| Path | Purpose |
|------|---------|
| `/pos-manifest.json` | Web app manifest |
| `/sw.js` | Service worker (network-first navigations) |
| `/offline.html` | Offline fallback |
| `/icons/icon-192.png` | Any icon 192 |
| `/icons/icon-512.png` | Any icon 512 |
| `/icons/icon-maskable-512.png` | Maskable icon |
| `/icons/apple-touch-icon.png` | iOS home screen |

## Checklist after deploy

1. Open `/pos` on Chrome Android — Install / Add to Home Screen.
2. [PWABuilder](https://www.pwabuilder.com/) → paste URL → Report Card.
3. **Download Test Package** (Android) → share APK with testers.

## Later: Play Store / TWA

When PWABuilder gives a signing certificate SHA-256, add Digital Asset Links at:

`apps/web/public/.well-known/assetlinks.json`

(Not required for the first test package.)
