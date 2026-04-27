---
mode: agent
description: Redirects to the canonical skill location. Use /component-audit from the skills folder.
---

> **This file has moved.**
>
> The canonical prompt is now at:
> `.agents/skills/o2-component-migrate/component-audit.prompt.md`
>
> It is registered as a workspace slash command via `.vscode/settings.json`:
>
> ```json
> { "chat.promptFilesLocations": [".agents/skills"] }
> ```
>
> Use `/component-audit` — VS Code will pick it up from the skills folder, making it
> available across all AI tools, not just Copilot.

You are running a component migration audit for the OpenObserve frontend (`web/src/`).

Read the user's request and determine which mode to run:

- **`find`** — find all files that currently use a component pattern
- **`diff`** — compare what changed in the current branch vs `main` (migration progress)
- **`status`** — show per-file migration status (migrated / mixed / not started)

If no mode is specified, run **`diff`** for the Tabs migration (the current branch migrates `q-tabs → OTabs`).

---

## Default patterns (Tabs migration)

- Old pattern: `q-tabs`, `<q-tab`, `q-tab-panel`, `<q-tab-panels`
- New pattern: `OTabs`, `OTab`, `OTabPanel`, `OTabPanels`, `ORouteTab`

If the user specifies a different component (e.g. "buttons"), adapt the patterns accordingly using the migration guide below.

---

## How to run the analysis

Use the grep_search tool (not a terminal command) to gather data. Then format all output as **Markdown tables**.

### For `diff` mode

1. Use `run_in_terminal` with `git diff --name-only main..HEAD` to get changed files in this branch.
2. For each changed `.vue`/`.ts` file, use `grep_search` to count old pattern occurrences in current HEAD.
3. Use `run_in_terminal` with `git show main:"<filepath>"` to get the base content, then count old pattern occurrences in base.
4. Calculate: `removed = base_count - head_count`, `added = new_pattern_head_count`.
5. Classify each file:
   - ✅ **Migrated** — old pattern gone, new pattern added
   - ⚠️ **Partial** — old pattern reduced but still present
   - ➕ **New only** — only new pattern added
6. Output in the table format below.

### For `find` mode

Run `grep_search` across `web/src/` for the pattern. Group results by module (first 2 path segments after `src/`). Output as table.

### For `status` mode

Run `grep_search` for both old and new patterns separately. For each file that has either, determine its status. Output as table.

---

## Required output format

### diff output

```
## Migration Report: `<old>` → `<new>`
Branch: `<current branch>` vs `main`

### Summary

| Metric                        | Count |
|-------------------------------|-------|
| Files changed                 | N     |
| Old usages removed            | N     |
| New usages added              | N     |
| ✅ Fully migrated              | N     |
| ⚠️ Partially migrated (mixed)  | N     |
| ❌ Remaining old-only files    | N     |

### Per-file Results

| File | Old (base) | Old (now) | New (now) | Removed | Status |
|------|-----------|----------|---------|---------|--------|
| src/components/alerts/AlertList.vue | 4 | 0 | 8 | 4 | ✅ Migrated |
| src/components/common/sidebar/FolderList.vue | 4 | 2 | 10 | 2 | ⚠️ Partial |

### Still Needs Migration

| File | Old usages remaining | Priority |
|------|---------------------|---------|
| src/components/alerts/AlertHistoryDrawer.vue | 2 | High |
```

### find output

```
## Component Usage: `<pattern>`

### By Module

| Module | Files | Usages |
|--------|-------|--------|
| src/components/alerts | 3 | 7 |
| src/components/dashboards | 8 | 21 |
| **TOTAL** | **N** | **N** |

### All Files

| File | Usages |
|------|--------|
| src/components/alerts/AlertList.vue | 3 |
```

### status output

```
## Migration Status: `<old>` → `<new>`

| File | Has Old | Has New | Status |
|------|---------|---------|--------|
| src/components/alerts/AlertList.vue | ❌ | ✅ | ✅ Migrated |
| src/components/common/sidebar/FolderList.vue | ✅ | ✅ | ⚠️ Mixed |
| src/views/OldPage.vue | ✅ | ❌ | ❌ Not started |

### Summary

| Status | Count |
|--------|-------|
| ✅ Migrated | N |
| ⚠️ Mixed | N |
| ❌ Not started | N |
```

---

## Common component patterns reference

| Component family | Old patterns                                      | New patterns                                            |
| ---------------- | ------------------------------------------------- | ------------------------------------------------------- |
| Tabs             | `q-tabs`, `<q-tab`, `q-tab-panel`, `q-tab-panels` | `OTabs`, `OTab`, `OTabPanel`, `OTabPanels`, `ORouteTab` |
| Button           | `q-btn`, `QBtn`                                   | `OButton`, `OButtonGroup`                               |
| Separator        | `q-separator`                                     | `OSeparator`                                            |
| Dialog           | `q-dialog`, `QDialog`                             | `OModal`                                                |
| Input            | `q-input`                                         | `OInput`                                                |

---

Now perform the analysis based on what the user asked for, and present results in the table format above.
