---
name: eslint-error-handling
description: Playbook for resolving ESLint and TypeScript errors in the OpenObserve web/ frontend (Vue 3 + TS). Rule-by-rule fixes with before/after examples, plus conventions for typing (inline vs dedicated file), unused code, Vue-specific rules, casts, and formatting. Use when fixing lint/type-check errors or writing new web code so fixes are consistent with the codebase standard.
---

# ESLint & TypeScript Error Handling — `web/`

Stack: Vue 3 + TypeScript + ESLint flat config (`eslint.config.js`) + Prettier.
Gates: `npm run lint:ci` (ESLint; `-- --quiet` for errors-only) and `npm run type-check:app`
(`vue-tsc` against `tsconfig.app.json`) — both must stay at **0 errors**.
Rollout plan & rationale: see the lint & type-check strictness rollout design doc.

## 0. Golden rules (apply to every fix)

1. **Never use `any`.** No `: any`, `as any`, `any[]`, `<any>`. Enrich an interface,
   narrow with `unknown` + a type guard, or derive the type. If a value is truly
   dynamic, use `unknown` and narrow at use.
2. **Prefer declaration-site types over `as` casts.** Type the `ref`/variable/prop/
   function-return at its declaration so the cast disappears. Casts are a last resort.
3. **Type-only fixes must not change runtime behavior.** A cast/assertion is the right
   tool when the alternative alters behavior (adding `typeof`/`String()`/branches to
   satisfy the compiler is a behavior change — don't).
4. **Strict equality only** (`===`/`!==`, never `==`/`!=`).
5. **Comments: max 1–2 lines**, stating only the non-obvious constraint.
6. **Fix, don't suppress.** `// eslint-disable` / `@ts-expect-error` only for genuine
   false positives (e.g. an intentional control-char regex), with a reason after `--`.

## 1. Typing conventions — inline vs dedicated file

Decide *where a type lives* by scope, not habit:

| Situation | Where the type goes |
|---|---|
| Used in **one** function/block, small shape | **Inline** at the declaration: `const x: { id: string } = …` |
| A component's **props/emits/slots** | Inline in `defineProps<…>()` / a local `interface Props` in the same SFC; for a design-system component use its `*.types.ts` sibling |
| Shared by **2+ files** in the same feature | A `types.ts` (or `feature.types.ts`) next to the feature |
| **Cross-cutting** domain model (Stream, Alert, Dashboard, SearchObject…) | `src/ts/interfaces/*` (barrel `@/ts/interfaces`) |
| Mirrors a **backend API** response | Derive from the Rust struct and put it in `src/ts/interfaces/*`; name it after the BE type |

Rules of thumb:
- **Don't** create a file for a one-off shape — inline it.
- **Do** extract to a shared interface the moment a second file needs the same shape
  (duplicate inline shapes drift).
- Prefer **extending an existing interface** over inventing a parallel one (that's how
  the `StreamField` conflict happened — multiple incompatible shapes).
- For an empty-array field in a state literal, type the element at the declaration:
  `field: [] as string[]` (this is declaration-site typing, not a value cast).

```ts
// ❌ inline shape duplicated across files → they drift
function a(u: { id: string; name: string }) {}
function b(u: { id: string; name: string }) {}

// ✅ shared interface in src/ts/interfaces/user.ts
export interface User { id: string; name: string }
```

### 1.1 Typing an API response — ALWAYS check the backend, never `any`

When you hit `const res: any = await someService.call(...)` or
`(res as any).field`, do **not** cast — **trace the response to the Rust struct** and
mirror it as an interface. The backend is the source of truth for API shapes.

**Steps:**
1. **FE service → endpoint.** Open the service method to get the HTTP path.
   ```ts
   // web/src/services/stream.ts
   nameList: (org) => http().get(`/api/${org}/streams`)   // GET /api/{org}/streams
   ```
2. **Endpoint → Rust handler + struct.** Search the backend (repo root `src/`, Rust):
   ```
   grep -rn "streams" src/handler/http/request/stream/mod.rs   # find the handler
   grep -rn "pub struct ListStream" src/                        # find the response struct
   ```
   ```rust
   // src/common/meta/stream.rs
   pub struct ListStream { pub list: Vec<Stream>, pub total: usize }
   pub struct Stream { pub name: String, pub stream_type: StreamType,
                       pub schema: Vec<StreamField>, /* … */ }
   ```
3. **Mirror it as a TS interface** in `src/ts/interfaces/*` (reuse one if it already exists —
   `grep -rn "interface Stream" web/src/ts/interfaces` first). Map Rust → TS:
   `String→string`, `usize/i64/f64→number`, `bool→boolean`, `Vec<T>→T[]`,
   `Option<T>→T | undefined` (or `field?:`), `HashMap<K,V>→Record<K, V>`, enum→union.
   ```ts
   // web/src/ts/interfaces/stream.ts
   export interface ListStream { list: Stream[]; total: number }
   export interface Stream {
     name: string;
     stream_type: "logs" | "metrics" | "traces";
     schema: StreamField[];
   }
   ```
4. **Use it at the declaration** (the service returns `unknown`/`AxiosResponse`, so one
   boundary annotation, then no more casts):
   ```ts
   // ❌ const res: any = await StreamService.nameList(org);
   //    if (res.data.list.length) …           // untyped, cast-ridden
   // ✅
   const res = await StreamService.nameList(org);
   const data = res.data as ListStream;         // one boundary annotation
   if (data.list.length > 0) { data.list.map((s) => s.name); }  // fully typed
   ```

**Field names must match the wire format exactly** (usually `snake_case` from `serde`) —
don't rename to camelCase in the interface, or access silently returns `undefined`.
Only include the fields the FE actually reads; add more as needed.

### 1.2 Untyped API calls in this repo — find them & where the wins are

Only **18 / 57** service files declare any response type, so most calls come back `any`.
Find every untyped awaited API result (excludes dynamic `await import()` — those are module
imports, not API calls):

```bash
grep -rnE ':\s*any\s*=\s*await' web/src --include='*.ts' --include='*.vue' \
  | grep -v '.spec.' | grep -v 'await import('
```

At time of writing that's **~64 sites**, and they cluster hard — fix the hot functions once
(in their composable/service) and dozens of call sites become typed for free:

| Function | Call sites | Endpoint (trace this to the Rust struct) |
|---|---:|---|
| `getStreams` (useStreams) | **27** | `GET /api/{org}/streams` → `ListStream { list: Vec<Stream>, total }` |
| `getStream` (useStreams) | **8** | `GET /api/{org}/streams/{name}/schema` → `Stream` |
| `getDashboard` | 2 | `GET /api/{org}/dashboards/{id}` |
| `commonService.list_Folders` / `dashboardService.list_Folders` | 2 | `GET /api/{org}/folders` |
| long tail (users, roles, pipelines, reports, org settings, …) | 1 each | see each service file for its `url` |

Workflow: give `useStreams.getStreams` / `getStream` a real return type (via §1.1), delete the
`: any` at the 35 call sites, then work down the long tail. Type at the **source** (the
service/composable return), not at each call site.

## 2. Unused code — `@typescript-eslint/no-unused-vars` (the big bucket)

Single source of truth for unused code (core `no-unused-vars` and TS
`noUnusedLocals` stay off).

**DELETE is the default fix. `_`-prefix is a narrow last resort for FUNCTION
PARAMETERS ONLY** — never `_`-prefix an import, a local, or a function/const, because
that just *hides* dead code instead of removing it.

```ts
// ❌ unused import → remove it (or just the one specifier)
import { computed, ref, watch } from "vue"; // watch never used
import { computed, ref } from "vue";        // ✅

// ❌ unused local
const result = compute();                   // never read
compute();                                  // ✅ side-effect call → keep call, drop binding
                                            // ✅ no side effects → delete the line entirely

// ❌ unused standalone function/const — DELETE it (dead code)
const _getInitials = () => …;               // ❌ `_`-prefix does NOT make it "used"
// ✅ verify no caller (grep the name), then remove the whole declaration.

// PARAMETERS:
// ❌ unused TRAILING param → REMOVE it, don't `_`-prefix
arr.map((item, index) => item.id);          // index unused
arr.map((item) => item.id);                 // ✅ drop it
watch(src, (_newVal, _oldVal) => { … });    // ❌ both unused & trailing
watch(src, () => { … });                    // ✅ drop them
// ❌ unused DESTRUCTURED element (e.g. setup's ctx) → remove the key, don't rename
setup(props, { emit: _emit, expose }) {}    // ❌ emit unused
setup(props, { expose }) {}                 // ✅ drop `emit`
// ✅ `_`-prefix ONLY when a LATER param is used (can't drop) or a contract fixes arity:
arr.map((_item, index) => index);           // _item kept because index is used
```
In `.vue`, vue-tsc/eslint-vue already account for `<template>` usage, so a flagged
script var/function is genuinely dead — safe to remove.

## 3. Real-bug rules (Bucket 1 — fix each by hand)

```ts
// no-unsafe-optional-chaining — runtime throw
const n = obj?.list.length;        // ❌ obj?.list can be undefined, .length throws
const n = obj?.list?.length ?? 0;  // ✅

// no-self-assign
this.x = this.x;                   // ❌ dead / typo — did you mean another field?

// no-unreachable
return x; doStuff();               // ❌ doStuff() never runs — remove or reorder

// no-case-declarations — lexical decl leaks across cases
switch (k) { case 1: const a = 1; … }         // ❌
switch (k) { case 1: { const a = 1; … } }      // ✅ block-scope the case

// no-redeclare — merge or rename the duplicate declaration
// no-import-assign — never reassign an imported binding; copy to a local
```

```html
<!-- vue/no-mutating-props — never mutate a prop -->
<!-- ❌ --> <input @input="modelValue = $event" />
<!-- ✅ emit and let the parent own state -->
<input @input="$emit('update:modelValue', $event.target.value)" />

<!-- vue/require-v-for-key -->
<!-- ❌ --> <li v-for="item in items">{{ item }}</li>
<!-- ✅ --> <li v-for="item in items" :key="item.id">{{ item }}</li>

<!-- vue/no-use-v-if-with-v-for — don't combine on one element -->
<!-- ❌ --> <li v-for="i in items" v-if="i.active" />
<!-- ✅ filter in a computed, or wrap v-if on a <template> -->
```

```ts
// vue/no-ref-as-operand — forgot .value
const count = ref(0);
if (count > 5) {}        // ❌ compares the ref object
if (count.value > 5) {}  // ✅

// vue/return-in-computed-property / vue/no-side-effects-in-computed-properties
const total = computed(() => { items.push(x); });  // ❌ side effect + no return
const total = computed(() => items.reduce((a, b) => a + b, 0)); // ✅ pure + returns
```

### 3.1 More Vue rules (also in the backlog)

```html
<!-- vue/no-unused-components (81) — component imported/registered but never used
     in the template. Remove the import (script setup) or the components:{} entry. -->

<!-- vue/no-unused-vars (10) — a template-scoped var (v-for / v-slot) is never used -->
<!-- ❌ --> <li v-for="(item, i) in items">{{ item }}</li>   <!-- i unused -->
<!-- ✅ --> <li v-for="item in items">{{ item }}</li>        <!-- drop it -->

<!-- vue/require-v-for-key already in §3; vue/valid-v-for (1) — v-for must have valid
     syntax + a key on a real element (not on <template> without key on children) -->

<!-- vue/valid-attribute-name (1) — attribute name has illegal chars (e.g. a stray
     space/quote in a :prop name) → fix the attribute name -->

<!-- vue/no-parsing-error (2) — malformed template (unclosed tag, bad directive
     expression, duplicate attribute) → fix the markup; the message pinpoints it -->

<!-- vue/require-toggle-inside-transition (1) — <transition> needs a v-if/v-show/
     :key/dynamic-component child to actually transition -->
<!-- ✅ --> <transition><div v-if="open" /></transition>

<!-- vue/no-reserved-component-names (1) — don't name a component after an HTML/SVG
     element (e.g. `Button`, `Image`) → rename (e.g. `AppButton`) -->
```

```ts
// vue/no-dupe-keys (12) — the same key appears in two option groups
// (props + data/computed/methods), so one silently shadows the other.
props: { value: {} }, data: () => ({ value: 1 })   // ❌ rename one

// vue/require-valid-default-prop (5) — object/array prop defaults MUST be a factory
props: { items: { type: Array, default: [] } }              // ❌ shared ref
props: { items: { type: Array, default: () => [] } }        // ✅ factory

// vue/prefer-import-from-vue (1) — import Vue APIs from "vue", not "@vue/*"
import { ref } from "@vue/runtime-core";   // ❌
import { ref } from "vue";                 // ✅

// vue/valid-next-tick (1) — await nextTick() OR pass a callback; don't do both,
// and don't call it without using the result.
await nextTick();                          // ✅
```

## 4. Low-risk / mechanical (Bucket 2)

```ts
// no-prototype-builtins
if (obj.hasOwnProperty(k)) {}                              // ❌
if (Object.prototype.hasOwnProperty.call(obj, k)) {}      // ✅

// no-useless-escape — drop the needless backslash (prettier/--fix often handles it)
/\-/  →  /-/

// no-empty — FIRST ask: does the block do anything? If it does NOTHING,
// DELETE it — do not comment an empty block into existence.
if (a) { doX(); } else { }            // ❌ empty else that does nothing
if (a) { doX(); }                     // ✅ drop the dead branch entirely
// Only keep an empty block when it MUST exist (a catch that deliberately
// swallows, a required override) — then add a reason comment:
catch (e) {}                          // ❌
catch (e) { /* ignore: best-effort */ } // ✅ intentional no-op

// no-useless-catch — a catch that only rethrows adds nothing → remove the try/catch
// no-async-promise-executor — never pass an async fn to new Promise; hoist the body
new Promise(async (res) => { … });    // ❌
```

## 5. Why some rules stay OFF (don't "fix" these)

- **`no-undef`** — OFF permanently. TypeScript already checks undefined symbols; the rule
  can't see Vue macros / auto-imports / type-only refs (thousands of false positives).
- **core `no-unused-vars`** — OFF, superseded by the `@typescript-eslint` version.
- **`prettier/prettier`, `vue/max-attributes-per-line`, `vue/multi-word-component-names`**
  — formatting/opinion; owned by the formatter or a team decision, not this gate.

## 6. TypeScript compiler errors (`type-check:app`)

Enabled compiler flags (`tsconfig.app.json`): `strict: true` **+ `noImplicitReturns: true`**.
The gate is a hard **0**.

```ts
// TS7030 noImplicitReturns — make the IMPLICIT fall-off `undefined` explicit (pure no-op).
// The added return must equal today's runtime value — never invent a value, never add `break`.
function f(x: number) { if (x > 0) return "a"; }          // ❌
function f(x: number) { if (x > 0) return "a"; return undefined; } // ✅
// If a declared return type forbids undefined but a path legitimately falls off,
// widen it at the DECLARATION site (`: string` → `: string | undefined`) — not a cast.
```

**`noFallthroughCasesInSwitch` is intentionally OFF.** Unlike ESLint's `no-fallthrough`, the TS
flag has **no `// falls through` comment escape hatch**, so it cannot express deliberate
cascades (e.g. the cumulative dashboard schema-version migrations in
`convertDashboardSchemaVersion.ts`) without a behavior-risky refactor. ESLint's comment-aware
`no-fallthrough` already guards new code — keep intentional fallthrough marked `// falls through`.
(A version-bumping `if`-chain is the only behavior-preserving way to satisfy the TS flag; don't
retrofit it onto existing migration switches.)

### Cast anti-patterns → declaration-site

```ts
// ❌ cast at the use site
const t = ref(props.tab);            // Ref<string>
<Editor :lang="(t as 'sql'|'promql')" />

// ✅ type the source (prop + ref)
tab: { type: String as PropType<'sql'|'promql'|'custom'> }
const t = ref(props.tab);            // Ref<'sql'|'promql'|'custom'>
<Editor :lang="t" />

// ❌ (x as unknown as string) coercing an array key
colOrder[selectedStream as unknown as string]
// ✅ express the real operation
colOrder[selectedStream.join(",")]
```
Casts that are legitimately kept: `Array as PropType<T>` (required Vue syntax),
`as const`, `as unknown as X` at a genuine external boundary (reka-ui/DOM/JSON.parse/
3rd-party), and a narrowing assertion for a runtime invariant the compiler can't prove
(document it). Deriving an API type from the backend Rust struct beats any cast.

## 7. Formatting (Prettier)

Prettier is installed but **not yet enabled** (`prettier/prettier` is `off`, no repo config).
When adopted, the intended standard is `printWidth 80, semi, double quotes, trailingComma all,
tabWidth 2` (the codebase already targets 80). It's a **one-shot repo-wide reformat** (~2,100
files) + a `format` script, done as its own commit — not something to hand-apply per file.
Once enabled, Prettier owns whitespace/quotes/commas; ESLint owns correctness.

## 8. Workflow

1. `npm run type-check:app` → fix type errors first (types unblock lint clarity).
2. `npm run lint:ci -- --quiet` → must be 0 errors (warnings are the ratchet backlog, allowed).
3. For a bucket rollout: fix all of a rule's violations, then flip it `warn → error` (§9).
4. The type-check gate is a hard **0** (any `error TS` fails); any ESLint **error** fails
   `lint:ci`. Warnings are the ratchet backlog — don't add new ones.

## 9. Gradual rollout — flipping a rule `warn → error`

The config keeps the backlog as `warn` so CI never blocks. To **enforce** a rule permanently,
drive its count to zero, then flip it. **Never flip a rule that still has violations** (that
turns the whole `lint:ci` gate red on every PR), and **never flip everything at once** (2,700+
errors). One rule (or one small bucket) per PR.

**Per-rule procedure**
1. Count a rule's violations:
   ```bash
   npx eslint "src/**/*.{js,ts,vue}" --rule '{"<rule-id>":"error"}' -f unix 2>/dev/null \
     | grep -c "<rule-id>"
   ```
2. Fix every one using its section above (§2–§6).
3. Re-run → the rule reports 0.
4. In `eslint.config.js`, change that rule from `"warn"` to `"error"`.
5. `npm run lint:ci` must exit 0. Commit.

**Regenerate the live backlog any time**
```bash
npx eslint "src/**/*.{js,ts,vue}" -f json 2>/dev/null | node -e '
const d=JSON.parse(require("fs").readFileSync(0,"utf8"));const by={};
for(const f of d)for(const m of f.messages)if(m.severity===1)by[m.ruleId]=(by[m.ruleId]||0)+1;
for(const[r,c]of Object.entries(by).sort((a,b)=>b[1]-a[1]))console.log(String(c).padStart(5),r);'
```

**Recommended order** (ascending effort; counts are a snapshot — regenerate for live numbers):

| # | Bucket | Rules (see section) | ~count | How |
|---|---|---|---:|---|
| — | **Done** | 4 zero-violation rules already at `error` (`no-shadow-restricted-names`, `vue/valid-v-else-if`, `vue/no-deprecated-v-bind-sync`, `vue/no-v-text-v-html-on-component`) | 0 | already enforced |
| 1 | Real bugs (§3, §3.1) | no-unreachable, no-self-assign, no-redeclare, no-case-declarations, no-unsafe-optional-chaining, no-import-assign, vue/no-dupe-keys, vue/no-ref-as-operand, vue/return-in-computed-property, vue/no-side-effects-in-computed-properties, vue/require-valid-default-prop, vue/require-v-for-key, vue/no-use-v-if-with-v-for, vue/valid-*, vue/no-parsing-error, vue/no-reserved-component-names, vue/require-toggle-inside-transition | ~90 | fix by hand → flip each to `error` |
| 2 | Mechanical (§4) | no-prototype-builtins (128), no-useless-escape (78), no-useless-catch (29), no-async-promise-executor (17), no-empty (16) | ~270 | mostly trivial |
| 3 | Vue correctness (§3, §3.1) | vue/no-mutating-props (228), vue/no-unused-components (81), vue/no-unused-vars (10) | ~320 | real refactors; ratchet down |
| 4 | Unused code (§2) | `@typescript-eslint/no-unused-vars` (2,072) | ~2,072 | `eslint-plugin-unused-imports` autofix + `_`-prefix; **ratchet**, not one PR |

**TypeScript flags** (separate track, `tsconfig.app.json`, §6): `noImplicitReturns` (60) →
`noFallthroughCasesInSwitch` (8; migration-switch refactor first) → `noUnusedLocals`/
`noUnusedParameters` only if TS (not ESLint) owns unused. `noUncheckedIndexedAccess` is a no‑op
until `strictNullChecks` (its own future initiative).

Full rationale, research, and per-bucket detail live in the lint & type-check strictness rollout design doc.
