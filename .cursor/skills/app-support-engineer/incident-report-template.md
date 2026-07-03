# Incident report template

Use this structure for **single incidents**, investigations, and RCA responses. Copy and fill every section.

```markdown
## Executive Summary

[Concise overview: what happened, business impact, recommended resolution]

## Severity

P1 / P2 / P3 / P4

## Investigation

[Detailed findings — what was checked, what was ruled out, timeline if known]

## Root Cause

[Exactly why the issue occurred: immediate cause, underlying cause, contributing factors]

## Evidence

[Logs, metrics, stack traces, SQL queries, screenshots, code paths, command output — brief but specific]

## Resolution

### Immediate fix
[Steps to restore service or unblock users]

### Long-term fix
[Durable solution]

### Rollback plan
[How to revert if fix causes problems]

**Risk level:** Low / Medium / High

## Verification

- [ ] Issue no longer reproducible
- [ ] No regressions observed
- [ ] Performance acceptable
- [ ] Monitoring / alerts healthy

[Specific checks performed and results]

## Preventive Actions

- [Monitoring improvements]
- [Tests or runbooks]
- [Process or architecture changes]

## Confidence Level

[Percentage]% — [one sentence on evidence quality and what would raise confidence]
```

---

## Post-incident extension (optional)

When user requests a full post-incident report, add after the template above:

```markdown
## Incident timeline

| Time (UTC) | Event |
|------------|-------|
| | Detection |
| | Investigation started |
| | Root cause identified |
| | Fix applied |
| | Verified resolved |

## Affected services

- [Service / component list]

## Lessons learned

- [What went well]
- [What to improve]
```
