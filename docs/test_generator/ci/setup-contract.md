# Test Setup Contract: Enterprise Billing Plans Pricing Cards  (area: Management)

> Spec: `tests/ui-testing/playwright-tests/Management/billingPlansPricing.spec.js`
> The Engineer implements the setup; the Healer/Refiner consult this instead of blind-scanning.
> **This feature needs NO stream/ingestion setup.** Every data condition is an **API response** or
> an **external pricing JSON document** — established by `page.route` mocks, not ingestion.

## Environment / auth
- **Cloud-only.** The `/billings` route is registered only when
  `config.isCloud == "true" || config.isEnterprise == "true"` (`web/src/router/index.ts:30-34`).
  Put `test.skip(!isCloudEnvironment(), 'Billing is Cloud-only')` at the top of every `describe`,
  exactly as `tests/ui-testing/playwright-tests/Onboarding/billing.spec.js:32` does.
- **Org identifier**: `getOrgIdentifier()` from `tests/ui-testing/playwright-tests/utils/cloud-auth.js`.
- **Login/navigation**: `navigateToBase(page)` from `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js`,
  then navigate directly to `/web/billings/plans?org_identifier=${getOrgIdentifier()}`.
  Reference: `Onboarding/billing.spec.js:25-29` (`openBillingFromRail`) and `:82-84` (direct plans URL).
- **Route mocks must be registered BEFORE navigation** — all fetches fire in `plans.vue mounted()`.

## Conditions each test must establish (tagged by SCOPE)

| SCOPE | Condition | How (exact helper/route) |
|-------|-----------|--------------------------|
| `[per-test]` | **Billing provider + subscription type** | `page.route(/\/billings\/list_subscription(\?.*)?$/, ...)` — copy `pinBillingState` from `Onboarding/billing.spec.js:10-23`; extend it to also return `subscription_type` (that helper currently only pins `provider`). |
| `[per-test]` | **Pricing data (features/options/price)** — THE critical item | Mock the external `siteURL.pricingJsonUrl` = `https://openobserve.ai/pricing.json` (`web/src/constants/config.ts:30`) via `page.route('https://openobserve.ai/pricing.json', route => route.fulfill({ json: <pricingDoc> }))`. This is a browser `fetch`, cross-origin, and Playwright `page.route` intercepts it. |
| `[per-test]` | **Pricing error state** | Do NOT register the pricing.json route (or fulfill with `route.abort()` / non-2xx) → `fetchPricingData` catch sets `pricingError=true`. |
| `[per-test]` | **AI credits card** | `page.route(/\/api\/[^/]+\/ai\/usage(\?.*)?$/, ...)` → fulfill `{ credits_used, credits_limit, credits_remaining, mode, requires_additional_credits, used_by_feature:{chat,incident,incident_reanalysis} }`. |
| `[per-test]` | **Child-org managed billing** | `page.route(/\/billing_group\/membership(\?.*)?$/, ...)` → fulfill `{ membership: { payer_org_id, payer_org_name, ... } }` (only read when `config.isCloud === "true"`). |
| `[per-test]` | **Paid AI usage switch** | `page.route(/\/api\/[^/]+\/quota\/ai_credits\/paid_overage(\?.*)?$/, ...)` (GET, `web/src/services/paidOverage.ts:30`) → fulfill `{ feature:"ai_credits", billing_status: "eligible", organization:{org_id:"default",enabled:false,can_manage:true}, payer:null, effective:false }`. |
| `[shared/read-only]` | **Trial expiry** (for trial-strip cases) | `pinBillingState` already routes `/api/[^/]+/settings` to inject `free_trial_expiry` — `Onboarding/billing.spec.js:11-17`. |

### Pricing JSON shapes to mock (copy these EXACTLY)
Derived from `web/src/enterprise/components/billings/plans.spec.ts` "pricing JSON" describe
(`newJson` / `oldJson`). The page maps these in `plans.vue fetchPricingData` (lines 272-319).

**New schema (price block + pricing options):**
```js
{
  data: [{ cloud: [
    {
      title: "Cloud Professional",
      pricingOptions: [
        { label: "Pay as you go", price: "$0.70", period: "/GB ingested", note: "No commitment, billed monthly", badge: "" },
        { label: "Annual contract", price: "$0.50", period: "/GB ingested", note: "12-month commitment", badge: "Save 28%" },
      ],
      features: [
        { title: "Logs, Metrics, Traces, RUM, Session Replay, Error tracking" },
        { title: "Ingestion, pay as you go", price: "$0.70 per GB", isSubItem: true, inPriceBlock: true },
        { title: "Ingestion, annual contract", price: "$0.50 per GB", isSubItem: true, inPriceBlock: true },
        { title: "Query", price: "$0.01 per GB", isSubItem: true },
      ],
      additionalInfo: "",
    },
    { title: "Enterprise", price: "Custom", priceNote: "volume discounts, BYOB", features: [{ title: "Pipelines" }, { title: "SLAs" }] },
  ]}],
}
```
→ Pro renders 2 option tiles (badge "Save 28%" on option 1), Enterprise renders price block
`billing-plans-enterprise-price` with "On discount" + "Custom" + "volume discounts, BYOB".

**Old schema (no pricing options, no enterprise price):**
```js
{
  data: [{ cloud: [
    { title: "Cloud Professional", price: "$0.50", period: "/GB ingested",
      priceNote: "+ $0.01/GB queried · billed monthly",
      additionalInfo: "*Includes 30% discount for annual commitment",
      features: [ { title: "Logs, Metrics, Traces, RUM, Session Replay, Error tracking" },
                  { title: "Ingestion", price: "$0.50 per GB*", isSubItem: true },
                  { title: "Query", price: "$0.01 per GB", isSubItem: true } ] },
    { title: "Enterprise", features: [{ title: "Pipelines" }, { title: "SLAs" }] },
  ]}],
}
```
→ Pro renders no price block + `billing-plans-pro-additional-info`; Enterprise renders no price
block, "On discount" tag in header only.

### `list_subscription` response shapes
`plans.vue loadSubscription` reads `data.provider`, `data.subscription_type`, `data.customer_id`.
- Free org → `{ subscription_type: "" }` ⇒ Pro shows `billing-plans-pro-subscribe-btn`.
- Paid org → `{ subscription_type: "pay-as-you-go", provider: "stripe" }` ⇒ Pro shows `billing-plans-pro-cancel-btn` + "Subscribed" tag.
- AWS → `{ subscription_type: "", provider: "aws" }` ⇒ Pro shows AWS-managed message (no button).
- Azure → `provider: "azure"` ⇒ Azure-managed message.
- Contract → `subscription_type: "external-contract"` ⇒ Contract-managed message.

## Timing / wait strategy
- After `page.goto(.../billings/plans...)`, wait for a stable card selector instead of a fixed sleep,
  e.g. `await expect(page.locator('[data-test="billing-plans-pro-subscribe-btn"], [data-test="billing-plans-pro-cancel-btn"]').first()).toBeVisible()`
  or `await page.waitForURL(/\/billings\/plans/)`. `loadSubscription` + `fetchPricingData` resolve
  independently and set `loading=false` only after `loadSubscription` completes.
- When exercising the pricing error→retry transition, after re-registering the pricing.json route
  click `billing-pricing-retry` and `expect` the price/feature selector to appear (the retry calls
  `fetchPricingData` which re-reads the same mocked URL).

## Gotchas (so the Healer/Engineer don't rediscover them)
- **Do NOT rely on live `https://openobserve.ai/pricing.json`.** It is external, unauthenticated,
  not under test control, and may be unreachable from CI. Mock it. If the mock is missing the test
  fails nondeterministically (sometimes 10s abort → error state, sometimes real content).
- The pricing fetch is `fetch(...)` (not axios) — the mock target is the full URL
  `https://openobserve.ai/pricing.json`, not `/pricing.json`.
- `fetchMembership` (→ child-org panel) returns early unless `config.isCloud === "true"`; in a cloud
  env it runs, so mock `/billing_group/membership` OR the real endpoint must return null. If you only
  want the pricing cards, do NOT mock membership (real orgs are not child orgs by default).
- `billing-pricing-retry` exists on BOTH cards (same `data-test`) — use `.first()` when clicking.
- "Subscribed"/"On discount" tags and the AI-card wrapper have **no `data-test`** — assert via
  `getByText('Subscribed')`, `getByText('On discount')`, `getByText('AI credits')`.
- `page.route` mocks must be torn down: `afterEach` → `page.unrouteAll({ behavior: 'ignoreErrors' })`
  (`Onboarding/billing.spec.js:40-42`) so an in-flight mocked fetch does not fail the test after assertions.
- Subscribe/manage click navigates away (`window.location.href`). To keep the test deterministic,
  mock the downstream URL endpoints (`hosted_subscription_url`, `billing_portal`) and assert the
  navigation/redirect rather than a new page render. Note the "resume" branch is dead (see feature
  doc wiring trap: `listSubscriptionResponse.card` is never populated).
