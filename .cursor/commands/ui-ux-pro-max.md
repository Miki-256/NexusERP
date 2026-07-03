# UI UX Pro Max

Apply the **UI UX Pro Max** design intelligence workflow to the user's request.

**User request (from text after this command):** Use everything the user typed after `/ui-ux-pro-max` as the UI/UX brief. If empty, ask what they want to design, build, review, or improve.

## Required setup

1. Read and follow `.cursor/skills/ui-ux-pro-max/SKILL.md` in full.
2. Use this project's search script path:
   ```bash
   python3 .cursor/skills/ui-ux-pro-max/scripts/search.py "<query>" --design-system [-p "Project Name"]
   ```
3. For NexusERP, default stack is **`nextjs`** (also use **`shadcn`** when working with UI components).

## Workflow (do not skip)

1. **Analyze** the brief: product type, industry, style keywords, target page/feature.
2. **Generate design system first** (required):
   ```bash
   python3 .cursor/skills/ui-ux-pro-max/scripts/search.py "<product> <industry> <keywords>" --design-system -p "NexusERP" -f markdown
   ```
3. **Supplement** with domain/stack searches only when needed (`--domain ux`, `--stack nextjs`, `--stack shadcn`).
4. **Implement** in the codebase using the design system — match existing NexusERP patterns, Tailwind/shadcn tokens, and component structure.
5. **Run the pre-delivery checklist** from the skill before finishing (contrast, hover states, cursor-pointer, no emoji icons, responsive breakpoints).

## Persist (optional)

If the user wants a reusable design system across sessions:
```bash
python3 .cursor/skills/ui-ux-pro-max/scripts/search.py "<query>" --design-system --persist -p "NexusERP" [--page "page-name"]
```

## Output

- Show the design system summary (pattern, colors, typography, effects, anti-patterns).
- Then implement or review the UI with concrete code changes aligned to that system.
