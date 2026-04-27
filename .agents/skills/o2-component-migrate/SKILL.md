---
name: o2-component-migrate
description: Replace Quasar components with O2 library components across the OpenObserve web codebase. Use when migrating q-tabs→OTabs, q-btn→OButton, or any other Quasar primitive to its O2 equivalent across all modules. Includes commands to audit component usage, analyze branch migration progress, and safely replace components module-by-module. Also use when asked "how many places was X replaced in this branch" or "which files still use q-*".
---

# O2 Component Migration Skill

Use this skill when:

- **Replacing** Quasar components with O2 equivalents across the codebase
- **Auditing** — "how many places does this component appear?"
- **Branch analysis** — "how many places was q-tabs replaced in this branch?"
- **Checking progress** — "which modules still use q-btn?"
- **Planning** — "what files do I need to touch to migrate OSelect?"

---

## Audit — Slash Command (Primary Method)

Use the `/component-audit` slash command in any AI chat tool (Copilot, Claude, Cursor, etc.). The prompt lives in the skills folder so it is tool-agnostic.

**Location**: `.agents/skills/o2-component-migrate/component-audit.prompt.md`  
**Registered via**: `.vscode/settings.json` → `"chat.promptFilesLocations": [".agents/skills"]`

```
/component-audit
```

> Runs diff analysis for the current branch (defaulting to Tabs migration).

```
/component-audit diff q-btn → OButton
```

> Analyze Button migration progress.

```
/component-audit find OTabs
```

> Find all files currently using OTabs.

```
/component-audit status q-tabs → OTabs
```

> Show per-file migration status across the whole codebase.

### Output tables (all modes)

**diff** — migration progress in current branch:

| File                                         | Old (base) | Old (now) | New (now) | Removed | Status      |
| -------------------------------------------- | ---------- | --------- | --------- | ------- | ----------- |
| src/components/alerts/AlertList.vue          | 4          | 0         | 8         | 4       | ✅ Migrated |
| src/components/common/sidebar/FolderList.vue | 4          | 2         | 10        | 2       | ⚠️ Partial  |

**find** — current usages grouped by module:

| Module                    | Files | Usages |
| ------------------------- | ----- | ------ |
| src/components/alerts     | 3     | 7      |
| src/components/dashboards | 8     | 21     |

**status** — migration status per file:

| File                                         | Has Old | Has New | Status      |
| -------------------------------------------- | ------- | ------- | ----------- |
| src/components/alerts/AlertList.vue          | ❌      | ✅      | ✅ Migrated |
| src/components/common/sidebar/FolderList.vue | ✅      | ✅      | ⚠️ Mixed    |

---

## Audit — CLI Alternative

A Node.js script at `web/scripts/component-audit.mjs` provides the same analysis via terminal:

```bash
cd web
# Find usages
node scripts/component-audit.mjs find --pattern "OTabs|OTab" --dir src

# Branch diff analysis
node scripts/component-audit.mjs diff --from "q-tabs|q-tab" --to "OTabs|OTab"

# Per-file status
node scripts/component-audit.mjs status --from "q-tabs" --to "OTabs"

# Markdown table output for PR descriptions
node scripts/component-audit.mjs diff --from "q-tabs|q-tab" --to "OTabs|OTab" --format markdown
```

---

## Migration Workflow

### Step 1 — Confirm O2 family is complete

Use `/component-audit find OTabs` (or grep) to verify all family members exist in `web/src/lib/`. If not, build them first with the `o2-component-create` skill.

### Step 2 — Audit current usage

```
/component-audit find q-tabs
```

Or via CLI: `node scripts/component-audit.mjs find --pattern "q-tabs" --dir src`

### Step 3 — Migrate module by module

Migrate one module folder at a time. After each module:

1. Run `/component-audit find q-tabs` or grep to confirm old pattern is gone from that module
2. Run vitest for that folder: `npx vitest run src/components/[module]`
3. Visually toggle `store.state.theme` between `'dark'` and `'light'` to verify dark mode works

### Step 4 — Analyze branch progress

```
/component-audit diff
```

Or: `node scripts/component-audit.mjs diff --from "q-tabs|q-tab" --to "OTabs|OTab" --format markdown`

Use the Markdown table output for PR descriptions.

### Step 5 — Final cleanup

```bash
# Confirm zero old usages remain
node scripts/component-audit.mjs find --pattern "q-tabs" --dir src
# Should return: "No usages found."
```

---

## Module-by-Module Replacement Pattern

When replacing inside a `.vue` file:

### q-tabs → OTabs

```vue
<!-- ❌ Before -->
<q-tabs
  v-model="activeTab"
  dense
  inline-label
  indicator-color="transparent"
  align="left"
>
  <q-tab name="logs" label="Logs" />
  <q-tab name="metrics" label="Metrics" />
</q-tabs>
<q-tab-panels v-model="activeTab" animated>
  <q-tab-panel name="logs" class="tw:p-0">...</q-tab-panel>
  <q-tab-panel name="metrics" class="tw:p-0">...</q-tab-panel>
</q-tab-panels>

<!-- ✅ After -->
<OTabs v-model="activeTab" dense align="left">
  <OTab name="logs" label="Logs" />
  <OTab name="metrics" label="Metrics" />
</OTabs>
<OTabPanels v-model="activeTab">
  <OTabPanel name="logs">...</OTabPanel>
  <OTabPanel name="metrics">...</OTabPanel>
</OTabPanels>
```

### Imports — add at top of `<script setup>`

```ts
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
```

### Quasar → O2 prop/event mapping

| Quasar                          | O2                                | Notes      |
| ------------------------------- | --------------------------------- | ---------- |
| `q-tabs`                        | `OTabs`                           |            |
| `q-tab`                         | `OTab`                            |            |
| `q-tab-panels`                  | `OTabPanels`                      |            |
| `q-tab-panel`                   | `OTabPanel`                       |            |
| `indicator-color="transparent"` | (remove — default is none)        |            |
| `indicator-color="primary"`     | (remove — default is primary)     |            |
| `active-color`                  | (remove — baked into design)      |            |
| `no-caps`                       | (remove — baked in, no uppercase) |            |
| `inline-label`                  | (remove — default layout)         |            |
| `dense`                         | `dense`                           | ✅ Same    |
| `align`                         | `align`                           | ✅ Same    |
| `vertical`                      | `orientation="vertical"`          | ⚠️ Renamed |
| `@update:model-value`           | `@update:modelValue`              | ✅ Same    |
| `q-btn`                         | `OButton`                         |            |
| `q-btn-group`                   | `OButtonGroup`                    | (if built) |
| `q-dialog`                      | `OModal`                          | (if built) |
| `q-tooltip`                     | `OTooltip`                        | (if built) |

---

## Generating a Migration Report

Use the slash command for a Markdown table ready to paste into a PR:

```
/component-audit diff
```

Or via CLI:

```bash
node scripts/component-audit.mjs diff \
  --from "q-tabs|q-tab[^-]|q-tab-panel" \
  --to "OTabs|OTab[^P]|OTabPanel" \
  --format markdown
```

---

## References

| When                                       | File                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| Slash command (primary audit tool)         | `.agents/skills/o2-component-migrate/component-audit.prompt.md` → `/component-audit` |
| CLI audit tool (alternative)               | `web/scripts/component-audit.mjs`                                                    |
| Building or auditing O2 components         | `.agents/skills/o2-component-create/SKILL.md`                                        |
| Component families — what belongs together | `.agents/skills/o2-component-create/references/component-guide.md`                   |
| Quasar → O2 prop mapping detail            | [references/migration-guide.md](references/migration-guide.md)                       |
