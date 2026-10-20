# Test Setup Contract: Model Pricing Attribute Rules  (area: Management)

This contract describes the data/state the spec `tests/ui-testing/playwright-tests/Management/model-pricing-attribute-rules.spec.js`
must establish, and the **exact existing patterns** to copy. Do **not** invent new setup helpers — everything below
already exists in the repo.

## Data conditions the feature needs (derived from behaviors)
1. **A model whose non-default tier carries attribute rules** — to exercise the editor's rule UI, save round-trip,
   and drawer/`formatTierRule` display.
2. **A model whose pattern matches a test-model name, with a rule tier** — for Test-Match attribute matching
   against `POST /llm/models/test`.
3. **Two tiers with identical rules + equal priority** — to trigger `model-pricing-tier-tie-warning` (ranked mode).
4. **(Optional, cost-verification only)** An ingested LLM span carrying the target attribute key
   (e.g. `openai.response.service_tier`) — to prove a rule tier actually changes computed cost.
   (The existing OTLP helper does NOT include that attribute; see "Gotchas".)

**No streams/logs are required** for CRUD, editor, or Test-Match flows — the API endpoints are the fixture.

## Streams / data the spec must establish
Tag each item by SCOPE so the Engineer places it correctly:

- **`<model-with-rule-tier>`** **[per-test]** — a unique-named org model whose `tiers[1]` has `rules`.
  Fields: `name`, `match_pattern` (unique prefix), `enabled: true`,
  `tiers: [{ name:"Default", condition:null, prices:{input:…} }, { name:"Flex", condition:null,
  rules:[{ keys:["openai.response.service_tier","openai.request.service_tier"], op:"in", values:["flex"] }], prices:{input:…} }]`.
  Why: editor edit-prefill round-trip + drawer display.
- **`<model-for-test-match>`** **[per-test]** — same shape; `match_pattern` matches the test-model name the
  Test-Match dialog will type. Why: Workflow 3 (attribute → winning rule tier).
- **`<two-ambiguous-tiers>`** **[per-test]** — model with two non-default tiers whose `rules` are identical and
  `priority` equal (or both 0). Why: `model-pricing-tier-tie-warning` (ranked mode, `ranksTiers` true).

All are org models (`source: "org"` / omitted), so the standard create/delete helpers apply.

## How to create it (copy these EXACT patterns — do NOT invent setup)

### API helpers (copy from the existing spec)
- `apiCreateModel(body)`, `apiDeleteModel(id)`, `apiListModels()`, `defaultBody(name, pattern, prices)` —
  `tests/ui-testing/playwright-tests/Management/model-pricing.spec.js:27-75`.
- Auth/org: `getAuthHeaders()` and `getOrgIdentifier()` from `tests/ui-testing/playwright-tests/utils/cloud-auth.js`
  (already imported in that spec at line 7). `apiBase()` = `${ZO_BASE_URL}/api/${getOrgIdentifier()}/llm/models`.
- `defaultBody` returns only a Default tier — for rule tiers, pass a full body via `apiCreateModel({…})`
  exactly like Journey 10 (`model-pricing.spec.js:765-780`) does for multi-price models.

Concrete rule-tier create example (copy the *shape*; use a `Date.now()` unique name like the other journeys):

```js
const created = await apiCreateModel({
    name: `mp_rule_${Date.now()}`,
    match_pattern: `^mp_rule_${Date.now()}.*`, // NOTE: keep name & pattern prefix in sync
    enabled: true,
    tiers: [
        { name: 'Default', condition: null, prices: { input: 0.000002, output: 0.000008 } },
        {
            name: 'Flex tier',
            condition: null,
            rules: [{
                keys: ['openai.response.service_tier', 'openai.request.service_tier'],
                op: 'in',
                values: ['flex'],
            }],
            prices: { input: 0.000003 },
        },
    ],
});
```

Cleanup: `finally { if (createdId) await apiDeleteModel(createdId); }` (see `model-pricing.spec.js:153-155, 242-243`).

### UI navigation (copy from the page object)
- `tests/ui-testing/pages/generalPages/modelPricingPage.js` — `gotoModelPricingPage()`, `gotoEditorCreate()`,
  `gotoEditorEdit(modelId)`, `gotoEditorDuplicate(modelId)`, `fillName()`, `fillPattern()`, `addPriceRow(key, perMillion, tierIdx)`,
  `clickSave()`, `clickTestMatch()`, `fillTestMatchInput()`, `clickTestMatchRun()`, `verifyModelInList()`.
- The page object does **not** yet have rule selectors — the Engineer must add them (or use raw `data-test`
  locators). Use the `-field` suffix for OFormInput native inputs and `-trigger` for the OFormSelect, exactly as
  `addPriceRow` already does (`modelPricingPage.js:283-291`). See the Feature Design Doc "Selector Reference".

### Timing / hydration
- Editor prefill is async: after `gotoEditorEdit`, call `waitForEditorHydrated()` (page object, line 377) before
  asserting rule-row values (OForm silently blocks submit until the form hydrates).
- Save: use `clickSave()` (waits for the POST/PUT to `/llm/models`); do not hand-roll a `waitForTimeout`.

## Preconditions / toggles
- `modelPricing` feature gate must be unlocked (`isEnterprise || isCloud`) — the existing
  `model-pricing.spec.js` already runs against this environment, so no additional toggle is needed.
- `ORGNAME` env (`process.env['ORGNAME'] || 'default'`) drives `org_identifier` in the page-object navigation.

## Gotchas (so the Healer/Engineer don't rediscover them)
1. **Rule inputs are OForm fields** — the native `<input>` carries `data-test="…-field"`, and the operator is an
   OSelect **dropdown** (`…-trigger`), NOT a native `<select>`. Copy the `addPriceRow` interaction pattern.
2. **Default tier strips rules** — a rule on tier 0 is dropped by the editor (`i === 0` forces empty rules) and the
   backend rejects it (`validate_definition`: "default tier must come before any tier with rules"). Always attach
   rules to a non-default tier.
3. **Backend rejects a definition with no unrestricted tier** — if a `[per-test]` model is created with rules on
   every tier, `apiCreateModel` returns `null` (non-ok). Always include a `condition:null`/no-rule Default tier first.
4. **The existing OTLP span helper lacks the attribute** — `buildLlmOtlpPayload`
   (`model-pricing.spec.js:846-890`) does not emit `openai.response.service_tier`; a cost-verification test must add
   `{ key: 'openai.response.service_tier', value: { stringValue: 'flex' } }` to the span attributes before reuse,
   or skip attribute-rule cost verification (the rule feature is otherwise fully testable via CRUD + `/llm/models/test`).
5. **Test-Match blank attribute rows are not sent** — a half-typed key never changes the result; type the key first.
6. **Tie warning only appears in ranked mode** — `ranksTiers` is true only when a rule or non-zero priority exists;
   a two-rule-tier model with all-zero priorities still triggers the tie warning because rules count.
