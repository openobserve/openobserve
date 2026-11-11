# Product analytics events

How the UI records what users achieve. Events go through one helper,
`productAnalytics.track(event, properties)` in `web/src/services/product_analytics.ts`,
which sends a RUM action. RUM already records every click, page view and error on
its own, so a named event exists to say **what the user achieved**, not that they
pressed something.

## When a change needs an event

| Change | Event? |
|---|---|
| New feature, or a new primary action (create, save, run, import, export, share, install, delete) | **Required:** one outcome event per action |
| New routed page or drawer that is a feature on its own | **Required:** one `<feature>_opened` event |
| Change to a flow that already has events | Keep them working: same name, same properties, still fires on success |
| Bug fix, refactor, styling, copy, layout, backend-only change | **None** |
| Secondary controls (toggles, sorting, expanding a row, extra buttons) | **None**; autocapture covers clicks. Add one only when a known product question needs it |

Before adding an event, name the question it answers ("how many users who open X
go on to create one?"). No question, no event.

## Naming

- `object_action`, snake_case, past tense: `alert_created`, `dashboard_imported`,
  `funnel_saved`, `synthetic_test_run_triggered`.
- Prefix with the area when the object is ambiguous: `rum_session_replay_opened`,
  `security_detail_opened`.
- Never a generic name (`Button Click`, `clicked`, `action`); put variants in a
  property instead of new names (`dashboard_created` with `{ source: "template" }`).
- **Never rename or reuse an existing event name.** Saved funnels and dashboards
  query by name. If the meaning changes, add a new name and stop sending the old one.
- Search for an existing name before adding one: `rg 'track\("' web/src`.

## Where to call it

- Fire the outcome event **after the action succeeds**: in the mutation's
  `onSuccess`, or after the awaited API call resolves. Not in the click handler
  before the request, and not when it fails.
- Fire `<feature>_opened` once per open (in `onMounted` or when the drawer opens),
  not on every re-render or tab switch.
- Call the helper only; never call `openobserveRum.addAction` or another
  analytics SDK directly from a component.

```ts
import productAnalytics from "@/services/product_analytics";

onSuccess: (created) => {
  productAnalytics.track("alert_created", { source: "library", type: created.type });
},
```

## Properties

- A small, stable set of low-cardinality values: `source`, `type`, `mode`,
  `count`, `status`. Use the same key for the same meaning across events.
- **Never** personal data or free text: no emails, user or org names, query or
  SQL text, search input, URLs with parameters, IDs of customer resources, or
  secrets.
- Counts and enums, not raw lists.

## Review checklist

- [ ] New feature or primary action has one outcome event that fires on success.
- [ ] Name is `object_action`, past tense, not generic, and not a rename.
- [ ] Properties are low-cardinality and contain no personal data or free text.
- [ ] Fixes, refactors and styling-only changes add no events.
