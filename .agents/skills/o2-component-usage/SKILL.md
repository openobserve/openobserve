---
name: o2-component-usage
description: Use O2 internal component library components in the OpenObserve web application, AND migrate existing Quasar components (q-btn, q-btn-toggle, q-btn-group, q-btn-dropdown, q-tabs, etc.) to O2 equivalents. Use this skill when writing new views or features, deciding which O2 component to use for a UI element, or performing a systematic Quasar to O2 migration across the codebase.
---

# O2 Component Usage & Migration Skill

Use this skill when **using** or **composing** O2 components in views, layouts, or feature components, and when **migrating** existing Quasar usages to O2.

> **Mandatory pre-condition**: Before using or replacing any component, verify it exists in [references/component-catalog.md](references/component-catalog.md). If it is not listed there, use the `o2-component-create` skill to build it first.

## Core Principle

**O2 components are the only correct way to render standard UI elements.** Never use a Quasar primitive (`q-btn`, `q-input`, `q-dialog`, etc.) when an O2 equivalent exists.

This applies equally to **native HTML elements** — `<button>`, `<input>`, `<select>`, `<textarea>`, `<a>` (used as a button), and similar interactive primitives must also be replaced with their O2 equivalents when one exists in the catalog. A raw `<button class="...">` is not acceptable when `OButton` (or its equivalent) exists.

For the full list of built components, their import paths, family groupings, and usage examples, see **[references/component-catalog.md](references/component-catalog.md)**.

## Usage Rules

1. **No UI decision overrides** — O2 components have baked-in design. Do not try to override border radius, color, or shape through props that don't exist.
2. **Pass only documented props** — check `OComponentName.types.ts` for accepted props. Only `size`, `variant`, and state props (`disabled`, `loading`) are permitted.
3. **Use slots as documented** — check the component file for slot names.
4. **Never mix old and new within a family** — do not use `OTabs` with `q-tab-panel`, or `OToggleGroup` with `q-btn`.
5. **No hardcoded styling or utility classes** — never add ad-hoc classes (e.g. `class="px-2 text-sm font-bold"`) directly to an O2 component to patch appearance. All visual control must come from the component's own `variant`, `size`, or other documented props. If the needed visual cannot be expressed through the component API, the component itself needs a new variant — use the `o2-component-create` skill to add it first.
6. **Preserve visual alignment on migration** — before replacing a Quasar component, note its current visual role and map it to the closest O2 `variant` and `size` prop. An unstyled O2 component that looks wrong is worse than a styled Quasar component.
7. **Also migrate native HTML elements** — treat `<button>`, `<input>`, `<select>`, `<textarea>`, `<a>` (used as controls) the same as Quasar components. If an O2 equivalent exists, replace the HTML element. If no O2 equivalent exists, keep the HTML element as-is (see rule below).
8. **HARD RULE — Always analyse style before replacing; any visual difference must become a variant.** Before making any replacement, inspect the element's existing inline styles, utility classes, and every scoped-CSS rule targeting it (via its class names). For each visual property that differs from the O2 component's default appearance, you must add a new `variant` to the O2 component using the `o2-component-create` skill first. Never start the replacement without confirming that every needed variant already exists. This rule has no exceptions.
9. **HARD RULE — Scoped CSS classes become variants, never stay at the usage level.** If the original element is targeted by a scoped `<style>` block (e.g. `.my-class { color: red }` applied as `class="my-class"`), that styling MUST be converted into a named variant inside the O2 component. Remove the scoped rule from the file and use the variant prop instead. Never leave scoped-CSS overrides pointing at an O2 component.

10. **Exception — Parent-controlled reveal / layout-only positioning is handled by a wrapper, not a variant.** If a scoped CSS rule triggers **on a parent's state** (e.g. `.parent:hover .my-class { opacity: 1 }`) or contains only layout/positioning properties (`margin`, `flex-shrink`, `position`, `opacity: 0` for hide/show) — wrap the O2 component in a plain `<span class="my-wrap">` and keep those rules on the wrapper class, not on the O2 component itself. The visibility / layout state of the wrapper is NOT a button variant.

11. **HARD RULE — Always audit child components too.** When a migration target is a parent component (e.g. a view, panel, or dialog), you MUST also inspect every child component it renders — whether through `<ChildComponent />` in the template or via dynamic slots. For every child component file: grep it for `q-btn`, `q-btn-dropdown`, `<button>`, `<input>`, `<select>`, `<textarea>`, `<a>` (used as a button) and apply the same migration rules. Do NOT consider a parent "done" while any of its rendered children still contain un-migrated elements.

## Component Not in Catalog?

1. **Do NOT silently fall back to a raw `<div>` or any structureless wrapper.**
2. **Do NOT use a plain HTML element** (`<button>`, `<input>`, etc.) without design tokens as a substitute.
3. **Keep the original Quasar component or native HTML element untouched** — an unmodified `q-btn` is always better than an unstyled `<div>`.
4. To get O2 coverage: use the `o2-component-create` skill — complete the full Analysis → Design → Implement → Test → Validate workflow.
5. Once built, add it to [references/component-catalog.md](references/component-catalog.md), then return and perform the replacement.

> **Decision tree for every element you encounter:**
>
> - O2 equivalent exists in catalog → replace with O2 component (analyse style → add variant if needed first)
> - No O2 equivalent, element is a Quasar component → **keep as Quasar**, open `o2-component-create` task
> - No O2 equivalent, element is a native HTML element → **keep the HTML element as-is**, open `o2-component-create` task
> - NEVER convert anything to a plain `<div>` as a migration step

## Dark Mode

All O2 components automatically support dark mode via design tokens. No dark-mode conditionals or class overrides needed.

---

# Quasar to O2 Migration Workflow

Use this section when **migrating existing Quasar component usages** to O2 across the codebase.

## Golden Rule

> **Migrate all files for one Quasar component completely before moving to the next. Then ask for user verification once.**

Never partially migrate a component family. Never migrate multiple Quasar components in parallel.

---

## Pre-Condition: O2 Component Must Exist

**Before starting any migration step**, verify:

1. The O2 replacement component is listed in [references/component-catalog.md](references/component-catalog.md)
2. It has been built and merged into `web/src/lib/`
3. Its `.types.ts` documents the accepted props, slots, and emits

If the component does not exist: **STOP. Use `o2-component-create` skill to build it first.**

---

## Step 1 — Audit: Find All Usages

For each Quasar component to migrate, count all usages:

```
grep_search for "<q-{component-name}" across web/src/ (isRegexp: false)
```

Record: file path, number of usages per file, total count across all variants of the family.

**Child component expansion (REQUIRED):** For every parent file in your audit list, grep its template for `<ComponentName` imports and recursively add each child component's file to the audit list. A parent is not fully migrated until all files it renders — direct children, grandchildren, slot content — have also been audited and migrated. Do not stop at the top-level file.

---

## Step 2 — Build the Prop Mapping

Before touching any file, build a prop-to-prop mapping table for the specific Quasar component:

1. Open the O2 component's `.types.ts` to see what props, slots, and emits it accepts
2. For each Quasar prop in active use (from Step 1 audit), determine:
   - **Maps to O2 prop**: document the mapping
   - **Dropped (internal decision)**: document why (styling is now baked in)
   - **No O2 equivalent**: STOP — use `o2-component-create` to add the variant first

**Template**:

```
## Prop Mapping: q-{name} → O{Name}

| Quasar prop | O2 equivalent | Notes |
|-------------|---------------|-------|
| prop-a      | propA         | direct |
| flat        | variant="ghost" | baked in |
| color="..."  | (drop)       | tokens control color |
| [unsupported-prop] | ⚠ MISSING — must add variant to component | |
```

---

## Step 3 — Create or Update the Migration Tracker

The tracker lives at `quasar-{family}-migration.md` (root of the repo, outside `web/`).

**Tracker format:**

```markdown
# Quasar [Family] Migration Tracker

**Status legend:** `pending` | `in-progress` | `done` | `verified`

## Summary

| Quasar Component | O2 Replacement | Total Usages | Files | Status  |
| ---------------- | -------------- | ------------ | ----- | ------- |
| `q-{name}`       | `O{Name}`      | N            | N     | pending |

## 1. `q-{name}` -> `O{Name}`

| File      | Usages | Status  |
| --------- | ------ | ------- |
| `src/...` | 1      | pending |
```

After completing all files for a component: update its Summary row to `done`. After user confirms: update to `verified`.

---

## Step 4 — Read Each File Before Editing

For every file in the current component's list:

1. `read_file` the full component
2. Identify every `q-*` usage, all its props, slots, and event handlers
3. Apply the prop mapping from Step 2
4. Note script style: `<script setup lang="ts">` vs `export default defineComponent({...})`
5. Note any complex patterns: dynamic options, scoped slots, `v-close-popup`, `v-if`/`v-for`

---

## Step 5 — Replace

Replace in batches using `multi_replace_string_in_file`:

1. Update imports: remove Quasar (if explicit), add O2 imports
2. **If Options API** (`defineComponent`): register the components in `components: {}` — this is MANDATORY or Vue silently ignores the import and renders nothing
3. **HARD: Analyse the full visual style before replacing** — this step is BLOCKING. For every element being replaced:
   - Note Quasar props: `color`, `flat`, `outline`, `dense`, `size`, `round`, `icon`, etc.
   - Note all CSS classes on the element (both utility and scoped-CSS class names)
   - Read every rule in the file's `<style scoped>` block that targets those class names
   - Map each visual property to the nearest O2 `variant`, `size`, or documented prop
   - For any visual difference not covered by an existing variant: **STOP, use `o2-component-create` to add the variant first, then resume**
   - Only proceed with the replacement once every needed variant exists
4. **HARD: Scoped CSS → variant, never a retained class** — if the original element had a scoped-CSS class (e.g. `.search-btn { border-radius: 0 }`), that rule MUST become a named variant in the O2 component. Delete the scoped rule from the file and use the new variant prop. Do not leave scoped rules targeting O2 components.
5. **No hardcoded compensating classes** — if the O2 component looks slightly off after replacement, do NOT fix it by adding `class="..."` or `style="..."` to the element. Instead: (a) pick a better O2 variant, or (b) if no variant fits, add the missing variant to the component source via the `o2-component-create` skill first, then use it.
6. Replace each template usage with O2 equivalent — includes native HTML elements (`<button>`, `<input>`, etc.) that have O2 equivalents
7. Keep all business logic, `v-model`, `v-if`, `v-for`, `@click` handlers intact — only replace the component tags and props
8. **If no O2 equivalent exists**: do NOT replace with `<div>`. Leave the original Quasar component or HTML element unchanged and log a `o2-component-create` task for it.

**`components:` registration for Options API (CRITICAL):**

```ts
// If components: {} already exists — add to it:
components: { ExistingComponent, ONewComponent },

// If components: {} does not exist — add it after name: "..."
export default defineComponent({
  name: "MyComponent",
  components: { ONewComponent },  // ← ADD THIS
  setup() { ... }
})
```

> **`<script setup>` files do NOT need `components: {}` — imported components are auto-registered.**
> **Options API files ALWAYS need `components: {}` — forgetting it means the component silently does nothing in the browser.**

**Per-file checklist:**

- [ ] Detected script style (`<script setup>` vs `defineComponent`)
- [ ] Old `<q-*>` tag (or native HTML element) removed — or confirmed kept because no O2 equivalent exists
- [ ] O2 component imported
- [ ] **If Options API: O2 components registered in `components: {}`** ← NEVER skip this
- [ ] **HARD: Every scoped-CSS class targeting this element has been read and its rules audited**
- [ ] **HARD: All visual differences (props, utility classes, scoped-CSS rules) have been mapped to variants — no variant is missing before replacement starts**
- [ ] **HARD: All scoped-CSS rules that targeted the replaced element have been deleted from `<style scoped>`** — they now live as variants in the O2 component
- [ ] Quasar visual style analysed and mapped to O2 variant/size ← NEVER leave unstyled
- [ ] All used props mapped (see prop mapping table from Step 2)
- [ ] All slots mapped
- [ ] All event handlers mapped
- [ ] Quasar-only props removed (styling props, layout props baked into the O2 component)
- [ ] **No hardcoded `class` or `style` added to patch appearance** — variant props only
- [ ] **Text and icon colours are visibly readable** — open in browser and confirm no labels or icons look washed-out
- [ ] **Git diff visual review** — for every removed `q-*` line or HTML element, verify the replacement has an equivalent variant
- [ ] **Elements with no O2 equivalent were left unchanged** (Quasar or HTML) — NOT converted to `<div>`

---

## Step 6 — Update Tracker After Each File

After replacing a file, update its row in the migration tracker from `pending` to `done`.

---

## Step 7 — Ask for Verification

After all files for one Quasar component are done:

1. Update the Summary row from `in-progress` to `done`
2. Report: "Migrated `q-[component]` across N files. Please verify in the browser before I continue with the next component."
3. **Wait for user confirmation** before starting the next Quasar component

After user confirms: update the row to `verified`, then proceed to the next component.

---

## Iterative Improvement Rule

If during replacement a Quasar usage (or native HTML element) is found that the O2 component cannot fully cover:

1. **STOP the replacement immediately** — do not add inline styles, scoped CSS, or workarounds
2. Document the missing pattern (which visual property is not covered by any existing variant)
3. Use the `o2-component-create` skill to add the missing variant to the O2 component
4. Only then resume the replacement

**Never fix a missing case at the usage level.** The component must be updated first.

**If no O2 equivalent component exists at all:** do NOT replace with a `<div>`. Leave the original untouched and log an `o2-component-create` task.

### Scoped CSS Audit Rule (HARD)

Before replacing any element, search the file's `<style scoped>` block for every class name on that element. For each rule found:

- If the rule changes a property already controlled by an O2 variant → pick the correct variant, delete the scoped rule
- If the rule changes a property not yet modelled → add a new variant to the O2 component via `o2-component-create`, use it, delete the scoped rule
- **Never leave a scoped rule that targets an O2 component in the file** — scoped CSS at the usage level is a design-system violation

---

## Migration Sequencing

When migrating an entire component family, order migrations by **smallest surface area first**:

1. Start with the component that has fewest usages / simplest prop surface
2. Migrate it completely and get user verification
3. Only then move to the next component

This minimises risk and keeps each migration reviewable.

---

## Common Pitfalls

| Pitfall                                                            | Fix                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Options API file: not registering in `components: {}`**          | Vue silently ignores the import — component renders as unknown element. Always add to `components: {}` for `defineComponent` files.                                                                                                                                                      |
| **Leaving style-only props on O2 component**                       | O2 components have no style override props. Remove `color`, `flat`, `rounded`, etc. Map to `variant` or drop entirely.                                                                                                                                                                   |
| **Adding inline `class` or `style` to patch appearance**           | Never paper over missing variants with inline styles. Update the O2 component via `o2-component-create` to add the missing variant, then use it.                                                                                                                                         |
| **Mixing O2 and Quasar within the same family**                    | Full family replacement in one commit per file. Never use `OTabs` with `q-tab-panel`.                                                                                                                                                                                                    |
| **Leaving `v-close-popup` on items**                               | Remove it — O2 overlay components (ODropdown, etc.) auto-close via their `@select` / close mechanisms.                                                                                                                                                                                   |
| **Missing outer border after group migration**                     | Some Quasar group components had CSS borders from `quasar-overrides.scss`. Check the visual diff and apply the project's border utility class (`el-border`) to the wrapper if needed.                                                                                                    |
| **Icon looks washed-out after migration**                          | `OIcon` renders in `currentColor`. If the parent has a light/muted text token, the icon inherits it. Fix the parent's semantic text token — never add a hardcoded color to the icon.                                                                                                     |
| **Text / icon colours look too faint or invisible**                | Root cause: the O2 component's inactive/rest state uses a muted token. Fix order: (1) verify correct variant is set; (2) verify parent's text token is strong enough; (3) if the token value itself is the problem, update it in `component.css` + `dark.css`. Never use inline classes. |
| **Quasar spacing classes (`q-ml-md`, `q-mr-sm`) on O2 components** | Replace with Tailwind equivalents: `q-ml-sm` → `tw:ml-2`, `q-ml-md` → `tw:ml-4`, `q-mr-sm` → `tw:mr-2`. Prefer removing margin and letting the parent `tw:gap-*` handle spacing uniformly.                                                                                               |
| **Forgetting to import O2 component**                              | Always add import in `<script setup>` or `<script>` alongside the replacement.                                                                                                                                                                                                           |
| **Dynamic options not migrated**                                   | If the original used `:options` with a computed array, convert to `v-for` on the O2 child item component.                                                                                                                                                                                |
| **Native HTML element (`<button>`, `<input>`) left unreplaced**    | Treat HTML elements the same as Quasar components — if an O2 equivalent exists, replace it. Audit its styles and scoped-CSS rules the same way as for Quasar.                                                                                                                            |
| **No O2 equivalent → replacing with `<div>`**                      | **FORBIDDEN.** A `<div>` has no semantics or tokens. Leave the original Quasar component or HTML element in place and open an `o2-component-create` task.                                                                                                                                |
| **Scoped CSS left on file after O2 replacement**                   | Every scoped rule that targeted the replaced element must be deleted. Its visual intent must live as a variant inside the O2 component. A scoped rule pointing at an O2 component is a design-system violation.                                                                          |
| **Starting replacement before all variants exist**                 | The style-audit → variant-creation step is BLOCKING. Do not write a single replacement line until every visual difference has a corresponding O2 variant ready to use.                                                                                                                   |

---

## References

| When                                           | File                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| Built components, import paths, usage examples | [references/component-catalog.md](references/component-catalog.md) |
| Build a new O2 component                       | `.agents/skills/o2-component-create/SKILL.md`                      |
| Audit component usage in codebase              | `web/scripts/component-audit.mjs`                                  |
| Active migration tracker                       | `quasar-{family}-migration.md` (repo root)                         |
