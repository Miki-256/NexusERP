# Support report template

Multi-issue **health audit** template. For a **single incident or RCA**, use [incident-report-template.md](incident-report-template.md) instead.

Copy and fill this template at the end of every audit.

```markdown
# NexusERP Support Report

**Date:** YYYY-MM-DD  
**Scope:** [full app | auth | onboarding | admin | area user named]  
**Auditor mode:** Audit only (no fixes applied)

## Executive summary

[2–4 sentences: overall health, count by severity, top priority action]

## Health checks

| Check | Result | Notes |
|-------|--------|-------|
| `npm run build` | ✅ / ❌ | |
| `npm run lint` | ✅ / ❌ / ⚠️ warnings | |
| Env vars present | ✅ / ❌ | names only |
| Dev server smoke | ✅ / ❌ / skipped | |

## Issues

### SUP-001 — [Short title]

- **Severity:** P1 / P2 / P3 / P4
- **Area:** [auth | onboarding | admin | supabase | ui | …]
- **Status:** Open
- **Symptom:** What the user or system experiences
- **Evidence:** File paths, logs, command output (brief)
- **Root cause:** Best current hypothesis
- **Proposed fix:** Concrete steps (no code yet)
- **Verify:** How to confirm fix worked

### SUP-002 — …

[Repeat for each finding]

## Passed checks

- [Things verified OK — builds, flows, RPCs present, etc.]

## Recommended fix order

1. SUP-00X (P1) — …
2. SUP-00Y (P2) — …

---

**Next step:** Reply with `fix SUP-00X` to approve a fix, `skip SUP-00X` to defer, or `re-run audit`.
```

## Issue ID rules

- Prefix: `SUP-`
- Number sequentially within the report
- Re-audit: new IDs for new findings; reference prior IDs if verifying fixes

## Status values

| Status | Meaning |
|--------|---------|
| Open | Reported, not acted on |
| Confirmed | User approved fix |
| Fixed | Fix applied and verified |
| Skipped | User deferred |
| Blocked | Cannot fix without user input or external access |
