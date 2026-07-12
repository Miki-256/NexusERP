# EFM Wave 11 — Fixed Assets Multi-Book

**Status:** Complete (code) — apply migrations `00152` → `00153` on Supabase.

Wave 11 adds parallel depreciation books (financial, tax, custom) with per-book profiles, optional non-GL tax tracking, and book comparison reporting.

## Deliverables

| Item | Migration / file | Notes |
|------|------------------|-------|
| Multi-book schema | `20260618000152_efm_wave11_fa_multibook.sql` | Books, profiles, book_id on depreciation |
| Multi-book RPCs | `20260618000153_efm_wave11_fa_multibook_rpcs.sql` | Depreciation, comparison, extended register |
| Assets tab | `fixed-assets-tab.tsx` | Book comparison, book filter, multi-book detail |

## RPCs (Wave 11)

| RPC | Purpose |
|-----|---------|
| `ensure_default_fa_books` | Seed FIN (GAAP, posts GL) + TAX (memo only) |
| `list_fa_books` | Active depreciation books |
| `upsert_fa_book` | Create custom non-primary book |
| `upsert_asset_book_profile` | Override life/salvage/method per book |
| `get_fa_book_comparison` | Org-wide NBV by book |
| `get_fixed_asset_book_detail` | Per-asset book breakdown + history |
| `list_fixed_assets` | **Updated** — includes `books[]` per asset |
| `register_fixed_asset` | **Updated** — creates book profiles |
| `run_depreciation_batch` | **Extended** — all books; optional `p_book_id`; GL only when `posts_to_gl` |
| `dispose_fixed_asset` | **Updated** — marks all book profiles disposed |

## Model

- **Financial (FIN)** — primary book; posts Dr 6510 / Cr 1590 to GL.
- **Tax (TAX)** — shorter default life (60% of financial); tracks depreciation without GL posting.
- **Methods** — `straight_line` or `double_declining` per book profile.
- Existing depreciation rows backfilled to FIN book on migration.

## Apply migrations

```bash
# After Wave 10 (00150–00151):
# 00152 — EFM Wave 11 schema
# 00153 — EFM Wave 11 RPCs
npm run db:push
```

## Verify

```bash
npm run verify:supabase
npm run test:integration
npm run typecheck
```

## UI surfaces

- **Financials → Assets** — book comparison, book-filtered register, multi-book asset detail

## Next wave

**EFM Wave 12 — Executive dashboards & drill-down** (complete). See [EFM_WAVE12.md](./EFM_WAVE12.md).

**EFM Wave 13 — Automation, notifications, scheduled reports.**

See `docs/EFM_ROADMAP.md`.
