# Navigation & Menus (where a new page gets listed)

Building a page is only half the job — a new screen isn't reachable until it's
**registered as a route** and **surfaced in navigation**, and it must be
**gated** so it only appears in the environments (OSS / cloud / enterprise) and
for the roles that should see it. This file is the authoritative how-to for all
of that. Do not hand-roll a `<router-link>` sidebar item or a bespoke menu —
every navigation surface here is data-driven from one of a few files.

## Table of contents

- [The mental model: three navigation surfaces](#the-mental-model-three-navigation-surfaces)
- [Deciding where a new page goes](#deciding-where-a-new-page-goes)
- [1. Register the route](#1-register-the-route)
- [2a. Top-level left-rail item](#2a-top-level-left-rail-item)
- [2b. Sub-page under Settings / IAM (SectionRail)](#2b-sub-page-under-settings--iam-sectionrail)
- [2c. Flyout child under a rail group (Data / Dashboards)](#2c-flyout-child-under-a-rail-group-data--dashboards)
- [3. Cloud / enterprise / RBAC gating (mandatory)](#3-cloud--enterprise--rbac-gating-mandatory)
- [4. i18n for menu labels](#4-i18n-for-menu-labels)
- [Add-a-page checklists](#add-a-page-checklists)

---

## The mental model: three navigation surfaces

The left navigation is assembled from a **flat list of top-level items**, which a
grouping layer then reshapes into three visual shapes:

1. **Plain rail item** — an icon tile on the left rail that navigates on click
   (Home, Logs, Metrics, Traces, Alerts, Incidents, Actions, AI, IAM,
   Management).
2. **Rail group with a hover flyout** — one tile that navigates to a primary page
   on click *and* reveals a submenu of related pages on hover (currently **Data**
   → Streams/Pipelines/Functions/Enrichment/Ingestion, and **Dashboards** →
   Dashboards/Reports).
3. **In-page section sub-nav (`SectionRail`)** — a secondary left sidebar *inside*
   a page that switches between sub-sections via `<router-view>` (used by
   **Settings/Management** and **IAM**).

These are produced by three files — learn which one owns each surface:

| Surface | Owner file |
| --- | --- |
| Flat top-level list (the rail items) | `web/src/layouts/MainLayout.vue` → `linksList` ref |
| Reshaping flat list → groups + flyouts | `web/src/lib/core/Navbar/navGroups.ts` → `NAV_GROUPS` |
| Settings sub-nav | `web/src/components/settings/index.vue` → `settingsItems` |
| IAM sub-nav | `web/src/views/IdentityAccessManagement.vue` → sections array |
| Routes (by domain) | the router composables in [§1](#1-register-the-route) |

> The rail renderer is `web/src/lib/core/Navbar/ONavbar.vue` (+ `ONavGroup.vue` in
> the same folder, and `MenuLink.vue` at `web/src/components/MenuLink.vue`) and the
> item type is `NavItem` in
> `web/src/lib/core/Navbar/ONavbar.types.ts`. You almost never edit these — you
> edit the **data** files above.

---

## Deciding where a new page goes

Same spatial grammar as the dialog/drawer/page decision — match the surface to
what the page *is*:

| The page is… | Put it… | Edit |
| --- | --- | --- |
| A top-level product area (its own concern, reached often) | a **plain rail item** | `MainLayout.vue` `linksList` + a route |
| One of several related data destinations | a **flyout child** under an existing rail group | `navGroups.ts` `NAV_GROUPS` + a route |
| An admin / configuration screen | a **sub-page under Settings** | `settings/index.vue` `settingsItems` + a route |
| An access-control screen | a **sub-page under IAM** | `IdentityAccessManagement.vue` + a route |

A new page **always** needs step 1 (a route). It then needs **exactly one** of
2a / 2b / 2c to be reachable from navigation. Don't register it in two surfaces.

---

## 1. Register the route

Routes are split by domain across composables, merged in
`web/src/router/index.ts` (which also picks OSS vs cloud/enterprise route sets
and installs the global `beforeEach` that sets `document.title` from
`meta.title`). Add your route to the composable that owns its domain:

| Domain | Composable file | Owns |
| --- | --- | --- |
| Core product (logs, metrics, traces, dashboards, streams, alerts, pipeline…) | `web/src/composables/shared/router.ts` (`useRoutes()` → `homeChildRoutes`) | most in-app pages |
| Settings / Management | `web/src/composables/shared/useManagementRoutes.ts` | `/settings/*` |
| IAM | `web/src/composables/shared/useEnterpriseRoutes.ts` | `/iam/*`, incidents, actions |
| Ingestion | `web/src/composables/shared/useIngestionRoutes.ts` | `/ingestion/*` |
| Cloud/enterprise-only (AI, billings, marketplace) | `web/src/enterprise/composables/router.ts` (`useEnvRoutes()`) | env-specific pages |

**Route shape** (from `shared/router.ts`):

```ts
{
  path: "logs",
  name: "logs",                          // unique; referenced by nav + hasRoute gating
  component: () => import("@/plugins/logs/Index.vue"),  // lazy — always
  meta: { keepAlive: true, title: "Logs" },            // title → browser tab
  beforeEnter(to, from, next) { routeGuard(to, from, next); },  // authed pages
}
```

- **Always lazy-load** the component (`() => import(...)`), never a static import.
- Set `meta.title` (browser tab) and `meta.keepAlive` (whether `<keep-alive>`
  caches the view between visits).
- Add `beforeEnter: routeGuard` for pages behind auth. For environment-only
  redirects, a `beforeEnter` can check `store.state.zoConfig.build_type` etc.
- Nested sub-pages (e.g. a `/pipelines/add` under `/pipelines`) go in the
  parent's `children: [...]`.
- The route `name` is the join key everywhere else — the rail item's `name`, the
  flyout child's `name`, and the SectionRail `to: { name }` all reference it, and
  flyout/section links are filtered through `router.hasRoute(name)` so a
  gated-out route automatically drops its nav entry.

---

## 2a. Top-level left-rail item

The flat rail list is `linksList` in `web/src/layouts/MainLayout.vue`. Each entry
is a `NavItem`:

```ts
interface NavItem {
  title: string;    // display label — pass t("menu.xxx") (translated at build time)
  icon: string;     // OIcon registry name
  link: string;     // route path — navigation + active-state matching
  name: string;     // route name — ordering, gating, hasRoute checks
  exact?: boolean;  // only "home" uses this
  display?: boolean; // per-item show/hide (e.g. admin-only)
  hide?: boolean;
  badge?: number;
}
```

Real entries (`MainLayout.vue`):

```js
{ title: t("menu.search"), icon: "search", link: "/logs", name: "logs" },
{ title: t("menu.iam"),   icon: "manage-accounts", link: "/iam",
  display: store.state?.currentuser?.role == "admin", name: "iam" },
```

**To add an always-on rail item:** push a `NavItem` into `linksList`, add the
`menu.*` i18n key ([§4](#4-i18n-for-menu-labels)), and register the route
([§1](#1-register-the-route)). **If it's conditional**, splice it in from a
computed gate instead — see [§3](#3-cloud--enterprise--rbac-gating-mandatory).

Don't over-populate the rail — a top-level tile is for a genuine product area. A
related destination should be a **flyout child** (2c) or a **Settings sub-page**
(2b) instead.

---

## 2b. Sub-page under Settings / IAM (SectionRail)

Settings/Management and IAM render an in-page secondary sidebar via
`web/src/components/common/SectionRail.vue`, driven by a declarative array. The
chosen section renders through `<router-view>`.

**Settings** (`web/src/components/settings/index.vue` → `settingsItems`, bucketed
into `sectionGroups`). Item shape:

```js
{
  key: "cipher-keys",
  label: t("settings.cipherKeys"),
  description: t("settings.cipherKeysDesc"),
  icon: "key",
  to: { name: "cipherKeys", query: { org_identifier: org } },
  visible: isEnt,                    // gating — see §3; omit for always-on
  dataTest: "management-cipher-key-tab",
  group: "Access & Security",        // which sectionGroups bucket it lands in
}
```

`SectionRail` filters on `item.visible !== false`, so a gated section is hidden by
setting `visible` to the same predicate the route uses.

**IAM** (`web/src/views/IdentityAccessManagement.vue`) uses the identical
`SectionRail` pattern (users, service accounts, tokens, groups, roles, quota, …).

**To add a Settings sub-page:**
1. Add a route child in `useManagementRoutes.ts` (IAM → `useEnterpriseRoutes.ts`).
2. Add an item to `settingsItems` with `key / label / description / icon / to /
   group` (+ `visible` if gated).
3. Add the `settings.*` i18n keys.

Settings is intentionally a **plain rail link** (no hover flyout) — its in-page
`SectionRail` is where users switch sections. Don't also add it to `navGroups.ts`.

---

## 2c. Flyout child under a rail group (Data / Dashboards)

Rail groups and their hover flyouts are defined **only** in
`web/src/lib/core/Navbar/navGroups.ts` via `NAV_GROUPS`. A group is one tile that
navigates to `parentLink` on click and shows a flyout of `children` on hover; it
`absorbs` several flat top-level `name`s (removing them from the rail).

```ts
{
  key: "data",
  title: "Data",
  icon: "database",
  parentLink: "/streams",                          // where clicking the tile lands
  absorbs: ["streams", "pipeline", "ingestion"],   // top-level names it replaces
  placeAfter: "incidentList",                       // emit the tile after this item
  children: [
    { titleKey: "menu.index", icon: "window", name: "logstreams", requires: "streams" },
    { titleKey: "function.streamPipeline", icon: "lan", name: "pipelines",
      requires: "pipeline", gate: "streamPipelines" },   // gated flyout child
    { titleKey: "function.header", icon: "function", name: "functionList", requires: "pipeline" },
    { titleKey: "menu.ingestion", icon: "data-plus-line", name: "ingestion", requires: "ingestion" },
  ],
}
```

`SubnavChild` fields: `titleKey` (i18n key), `icon`, `name` (route name — the
navigation target, filtered through `router.hasRoute`), `category` (optional
header inside the flyout), `tab` (query-param sub-views), `requires` (include only
when that top-level item is present), `gate` (visibility predicate key — see §3).

**To add a flyout child:** add a `SubnavChild` to the relevant `NAV_GROUPS`
entry's `children` (and ensure its route `name` exists). The flyout is meant to
**mirror the target page's own `SectionRail` exactly** — same label key, icon,
and gate — so the two never disagree. Edit only this one file to move an item.

---

## 3. Cloud / enterprise / RBAC gating (mandatory)

Every new nav entry must decide *where it shows*. There are two gating inputs:

**Build-time flags** — `web/src/aws-exports.ts` default export `config`, string
`"true"`/`"false"`:
- `config.isCloud` (`VITE_OPENOBSERVE_CLOUD`)
- `config.isEnterprise` (`VITE_OPENOBSERVE_ENTERPRISE`)
- `config.showLLMUI` (`VITE_OPENOBSERVE_LLM_UI`)
- plan/env constants: `freePlan`, `paidPlan`, `enterprisePlan`, `environment`.

**Runtime feature flags** — from the backend `/config` response in Vuex
`store.state.zoConfig`: `actions_enabled`, `incidents_enabled`,
`online_evals_enabled`, `rbac_enabled`, `service_account_enabled`,
`model_pricing_enabled`, `service_streams_enabled`, `custom_hide_menus`,
`meta_org`, `build_type`, … Meta-org check:
`store.state.selectedOrganization?.identifier === zoConfig.meta_org` (via
`useIsMetaOrg`).

**Canonical gating expressions** (copy these — don't invent new shapes):

- Enterprise **or** cloud + a runtime flag (most common):
  ```js
  const isFeatureEnabled = computed(() =>
    (config.isEnterprise == "true" || config.isCloud == "true") &&
    Boolean(store.state.zoConfig?.online_evals_enabled));
  ```
- Enterprise only: `config.isEnterprise == "true"`
- Cloud only: `config.isCloud == "true"`
- Admin-only rail item: `display: store.state?.currentuser?.role == "admin"`.

**How each surface applies the gate:**

| Surface | Mechanism |
| --- | --- |
| Rail top-level item | splice into `linksList` from a computed gate; `filterMenus()` also drops any `name` listed in `zoConfig.custom_hide_menus`, or with `hide`/`display:false` |
| Route | conditional `push`/guarded block in the composable (e.g. `useManagementRoutes.ts` pushes enterprise-only routes only when `isEnterprise`), or a `beforeEnter` redirect |
| Flyout child | a `gate` key resolved by `GATE_PREDICATES` in `navGroups.ts` (e.g. `rbac`, `enterprise`, `enterpriseMeta`, `storage`, `streamPipelines`) |
| SectionRail sub-page | a `visible:` expression on the item (e.g. `visible: isEnt && meta`) |

**Keep the three in sync.** A flyout `gate`, the route's push condition, and the
page's SectionRail `visible` must express the **same** rule — otherwise the rail
offers a link the page hides (or vice-versa). `GATE_PREDICATES` exists precisely
to mirror each page's own `visible` condition; when you add a gated sub-page,
reuse or add the matching predicate rather than duplicating raw booleans.

---

## 4. i18n for menu labels

Menu labels use the **`menu.*`** namespace in
`web/src/locales/languages/en-US.json` (add keys only here — other locales mirror
it). Reference them as `t("menu.xxx")` in `linksList` (rail) or as `titleKey`
strings in `navGroups.ts` (flyout children may also use feature namespaces like
`function.header`). SectionRail items translate `label`/`description` directly
(`t("settings.cipherKeys")`).

---

## Add-a-page checklists

**New top-level rail item**
- [ ] Route added to the right composable ([§1](#1-register-the-route)), lazy
      `component`, `meta.title`.
- [ ] `NavItem` in `MainLayout.vue` `linksList` (spliced from a computed gate if
      conditional).
- [ ] `menu.*` key in `en-US.json`.
- [ ] Gating decided ([§3](#3-cloud--enterprise--rbac-gating-mandatory)); if
      hideable via config, `name` respected by `custom_hide_menus`.

**New Settings / IAM sub-page**
- [ ] Route child in `useManagementRoutes.ts` (IAM → `useEnterpriseRoutes.ts`).
- [ ] Item in `settingsItems` / IAM sections: `key / label / description / icon /
      to / group` (+ `visible` if gated).
- [ ] i18n keys added.
- [ ] Not also added to `navGroups.ts` (Settings/IAM are plain rail links).

**New flyout child under Data / Dashboards**
- [ ] Route `name` exists.
- [ ] `SubnavChild` in the `NAV_GROUPS` entry (`titleKey / icon / name /
      requires` + `gate` if gated), mirroring the page's own SectionRail.

**Every case**
- [ ] Reachable from exactly **one** nav surface.
- [ ] Gate expressed identically across route + nav entry (+ SectionRail
      `visible` / flyout `gate`).
