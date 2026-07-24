# i18n Enforcement — Session Handoff Guide

> **Scratch file** — this is a local handoff note, not part of the feature. It's
> untracked; delete it before opening the PR (or keep it, your call). A `.md` file
> is not touched by the i18n lint (that only scans `src/**/*.vue`).

You are in the worktree **`.claude/worktrees/i18n-lint-enforcement`**, branch
**`feat/i18n-lint-enforcement`** (branched from `origin/main`, base commit
`36ab1b21b8`). This branch adds ESLint-enforced i18n hygiene. The goal now:
**fix every violation so the gate goes green, then open a PR.**

> ⚠️ A Claude session started in THIS folder has different project memory than the
> main repo. This guide is the source of truth — point Claude at it first.

---

## 0. First thing in this window

No `node_modules` yet (fresh worktree checkout):

```bash
cd web
npm ci        # installs deps incl. @intlify/eslint-plugin-vue-i18n
```

Until this runs, ESLint won't resolve and you won't see editor squiggles.

---

## 1. What this branch changed

Commit `36ab1b21b8` — 4 files:
- `web/eslint.config.js` — the rules + the `TEXT_ATTRS` list + a custom local rule
- `web/package.json` + `web/package-lock.json` — adds `@intlify/eslint-plugin-vue-i18n`
- `.claude/skills/ui-architect/SKILL.md` — documents the standard (rule 6)

**Three ESLint rules, all `error` (they fail `lint:ci` → block the build):**

| Rule | Catches | Example that FAILS |
|---|---|---|
| `@intlify/vue-i18n/no-missing-keys` | `t('x.y')` key missing from en-US.json | `{{ t('common.loading') }}` when `common.loading` isn't defined |
| `vue/no-bare-strings-in-template` | text nodes **+ static text props** | `<div>Save</div>`, `<OButton label="Save" />` |
| `local/no-bare-bound-text-props` (custom) | **bound literal** text props | `<OInput :placeholder="'Search'" />` |

**Passes (correct usage):** `{{ t('common.save') }}`, `:label="t('x')"`,
`:label="row.name"` (dynamic), `:label="'—'"` (punctuation-only).

**The component-prop standard:** `TEXT_ATTRS` in `eslint.config.js` is the single
list of props that carry user-facing text (`label`, `placeholder`, `hint`,
`tooltip`, `message`, `content`, `help-text`, `*-button-label`, …). It feeds both
the static and bound rules. **When a component takes UI text through a new prop
name, add it to `TEXT_ATTRS`.**

**Exemptions (already configured):**
- SQL/PromQL syntax guides (`src/plugins/{logs,traces,metrics}/SyntaxGuide*.vue`) — bare-string rules off.
- Spec/test files — `no-missing-keys` off.

---

## 2. See the backlog (~1584 errors to clear)

```bash
cd web
npm run lint:ci                       # full gate; exits 1 until clean
```

Breakdown at handoff time:
- **24** missing keys (`no-missing-keys`)
- **1518** text nodes + static props (`vue/no-bare-strings-in-template`)
- **42** bound props (`local/no-bare-bound-text-props`)

Useful slices:

```bash
# Per-rule counts + per-file offenders (JSON)
npx eslint "src/**/*.vue" --no-fix -f json > /tmp/lint.json
node -e 'const r=require("/tmp/lint.json");const c={},f={};for(const x of r)for(const m of x.messages){if(!m.ruleId)continue;c[m.ruleId]=(c[m.ruleId]||0)+1;if(/i18n|bare/.test(m.ruleId))f[x.filePath.replace(/.*web./,"")]=(f[x.filePath.replace(/.*web./,"")]||0)+1;}console.log(c);console.log(Object.entries(f).sort((a,b)=>b[1]-a[1]).slice(0,20));'

# Just the missing keys
npx eslint "src/**/*.vue" --no-fix -f json | node -e 'const r=JSON.parse(require("fs").readFileSync(0));const s=new Set();for(const x of r)for(const m of x.messages)if(m.ruleId==="@intlify/vue-i18n/no-missing-keys")s.add(m.message.match(/.([\w.]+)./)[1]);console.log([...s].sort().join("\n"));'
```

The 24 missing keys (add each to `web/src/locales/languages/en-US.json`):
`about.license_key_required`, `alerts.alertName`, `alerts.dedup`, `alerts.duration`,
`alerts.endTime`, `alerts.isSilenced`, `alerts.noDestinations`, `alerts.retries`,
`alerts.startTime`, `alerts.timestamp`, `alerts.type`, `common.getStartedRUM`,
`common.loading`, `common.success`, `correlation.other`,
`correlation.unstableDimensionTooltip`, `dashboard.promqlChartConfig`,
`dashboard.refreshToApplyVariableChanges`, `logStream.deleteField`,
`panel.collapseFields`, `pipeline.failedToLoadPipeline`, `search.vrlOnlyForTable`,
`settings.correlation.identityConfigNoSets`, `synthetics.authNetwork.removeCookie`,
`synthetics.authNetwork.removeHeader`, `synthetics.authNetwork.removeVariable`,
`traces.servicesCatalog.noStreamsDetected` (a couple live in `.ts` files, caught
in the editor but not by `lint:ci`'s `.vue`-only scope).

---

## 3. How to fix each kind

- **Missing key** → add it to `web/src/locales/languages/en-US.json` (nested, e.g.
  `common.loading` = `"Loading…"`). **Never hand-edit the other locale files** —
  they're auto-generated from en-US on merge to main.
- **Text node** `<div>Delete node</div>` → `<div>{{ t('some.key') }}</div>` + add key.
- **Static prop** `label="Save"` → `:label="t('some.key')"` + add key.
- **Bound literal** `:label="'Save'"` → `:label="t('some.key')"` + add key.
- Make sure `t` is in scope: `const { t } = useI18n();` in `<script setup>` (most
  components already have it).
- **Genuinely code, not prose** (rare) → add the file to the SyntaxGuide exemption
  block in `eslint.config.js`, with a one-line reason.
- **New text-carrying prop name the linter doesn't know** → add it to `TEXT_ATTRS`.

Suggested order: **(1)** the 24 missing keys (fast, unblocks that rule), **(2)**
the hardcoded text, file-by-file (mechanical). 1518+42 is a lot — consider a
multi-agent workflow to fan out across files if you want to parallelize.

---

## 4. Conventions (this repo)

- **Commits: NO `Co-Authored-By: Claude` trailer.** Keep messages clean; the repo
  squash-merges.
- Keep this work isolated from `feat/alerts-summary-stats` (the original branch —
  it has unrelated in-progress work).
- CI gate this rides on is the existing `npm run lint:ci` step (already in
  `build-pr-image.yml` / `playwright.yml`), plus `lint:tokens`, `lint:styles`,
  `lint:token-purity`, `lint:design:strict`.

---

## 5. Resume with Claude — paste this to start

```
Read I18N_ENFORCEMENT_GUIDE.md at the repo root, then continue the i18n cleanup on
this branch (feat/i18n-lint-enforcement). Start by running `cd web && npm ci`, then
`npm run lint:ci` to confirm the current count. First fix the 24 missing keys by
adding them to en-US.json, then work through the hardcoded-text violations
file-by-file. Follow the fix rules in the guide. Don't add a Claude co-author
trailer to commits.
```
