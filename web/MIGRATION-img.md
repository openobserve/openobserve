# q-img Migration — Design Doc

Tracks replacement of all `<q-img>` usages in `web/src` with the native `<img>` element. **No new component** will be introduced — every observed usage is a simple display image with no lazy-loading, aspect-ratio, or spinner features that `q-img` was designed for.

---

## TL;DR

- **9 template usages** across **6 files**, all reducible to plain `<img>`.
- **None of the q-img-specific features are used** anywhere: no `:ratio`, `placeholder-src`, `loading-show-delay`, `fit`, `position`, `spinner-color`, `@error`, `@load`, or fade transitions. Every usage just sets `src` + size.
- Plain `<img>` with `width` / `height` attrs (or equivalent CSS) prevents layout shift just like q-img's reserved-space wrapper does — no functional regression.
- No global QImg registration to remove (Quasar auto-registers internally; not present in `MainLayout.vue`).
- Two spec files have QImg stubs to drop, ESLint rule extension, and migration is mechanical.

---

## Replacement strategy

### Pattern A — Inline icon-sized image (`<img>` with width/height attrs)

For `<q-img height="14px" width="14px" :src="x" />`:

```html
<img :src="x" width="14" height="14" alt="" />
```

- `width` / `height` HTML attrs (unit-less, in pixels) reserve layout space before the image loads — same effect as q-img's wrapper.
- Add `alt=""` for decorative icons so screen readers skip them; otherwise pass a meaningful alt.

### Pattern B — Sized illustration with inline `style`

For `<q-img :src="x" style="width: 125px;" />`:

```html
<img :src="x" alt="" style="width: 125px" />
```

- Where the original used `style="width: Npx; margin: ..."`, keep the same inline style on the new `<img>`.
- Browser will scale height proportionally when only width is given.

### Pattern C — Logo display with class + alt

For the settings page custom-logo blocks:

```html
<img
  data-test="setting_ent_custom_logo_img"
  :src="`data:image; base64, ${store.state.zoConfig.custom_logo_img}`"
  :alt="t('settings.logoLabel')"
  style="max-width: 150px; max-height: 31px"
  class="q-mx-md"
/>
```

- All q-img attributes (`data-test`, `:alt`, `style`, `class`) pass through one-for-one onto the native `<img>`.

---

## Capability audit — why no OImg component

| `q-img` feature | Used in codebase? | Native `<img>` equivalent | Verdict |
|---|---|---|---|
| `src` | Yes (all 9) | `:src` attribute | Native |
| `width` / `height` | Yes (3 usages as separate attrs, others inline style) | `width` / `height` attributes (unit-less) | Native |
| `alt` | Yes (2 usages — General.vue logos) | `alt` attribute | Native |
| `class`, `style`, `data-test` | Yes (pass-through) | Native attribute inheritance | Native |
| `ratio` (aspect-ratio preservation) | No | `aspect-ratio` CSS / setting both w&h | Not needed |
| `placeholder-src` | No | n/a | Not needed |
| `loading` (lazy) / `loading-show-delay` | No | `loading="lazy"` attribute | Not needed |
| `fit` (object-fit) | No | `object-fit` CSS | Not needed |
| `position` (object-position) | No | `object-position` CSS | Not needed |
| `spinner-color` / `spinner-size` | No | n/a | Not needed |
| `@error` / `@load` handlers | No | native DOM events | Not needed |
| Fade transition | No | `transition` CSS | Not needed |
| `no-spinner` / `no-default-spinner` | No | n/a | Not needed |
| `no-transition` | No | n/a | Not needed |

All 9 usages are static, eagerly-loaded display images. The q-img wrapper (positioned `<div>` + inner `<img>` + spinner overlay + transitions) adds DOM weight and runtime cost without any feature benefit here. Native `<img>` is leaner and identical in effect.

---

## Occurrence inventory

> Total: **9 template usages**, **6 files**.

### Pattern A — Inline icon-sized images (3 usages)

| Status | File | Line | Current | Replacement |
|---|---|---|---|---|
| `[x]` | `plugins/logs/JsonPreview.vue` | 146 | `<q-img height="14px" width="14px" :src="getBtnLogo" />` | `<img :src="getBtnLogo" width="14" height="14" alt="" />` |
| `[x]` | `plugins/logs/JsonPreview.vue` | 156 | `<q-img height="14px" width="14px" :src="regexIcon" />` | `<img :src="regexIcon" width="14" height="14" alt="" />` |
| `[x]` | `plugins/logs/JsonPreview.vue` | 204 | `<q-img :src="regexIconForContextMenu" class="q-mr-sm" style="width: 14px; height: 14px" />` | `<img :src="regexIconForContextMenu" class="q-mr-sm" style="width: 14px; height: 14px" alt="" />` |

### Pattern B — Empty-state / illustration images (4 usages)

| Status | File | Line | Current | Replacement |
|---|---|---|---|---|
| `[x]` | `components/logstream/AssociatedRegexPatterns.vue` | 339 | `<q-img :src="getImageURL('images/regex_pattern/no_applied_pattern.svg')" style="width: 125px;" />` | `<img :src="getImageURL('images/regex_pattern/no_applied_pattern.svg')" style="width: 125px" alt="" />` |
| `[x]` | `components/settings/NoRegexPatterns.vue` | 22 | `<q-img :src="getImageURL('images/regex_pattern/no_data_regex_pattern.svg')" style="width: 125px; margin: 20vh auto 1rem" />` | `<img :src="getImageURL('images/regex_pattern/no_data_regex_pattern.svg')" style="width: 125px; margin: 20vh auto 1rem" alt="" />` |
| `[x]` | `components/shared/grid/NoPanel.vue` | 19 | `<q-img :src="getImageURL('images/common/clipboard_icon.svg')" style="width: 230px; margin: 5vh auto 2rem" />` | `<img :src="getImageURL('images/common/clipboard_icon.svg')" style="width: 230px; margin: 5vh auto 2rem" alt="" />` |
| `[x]` | `components/shared/grid/NoOrganizationSelected.vue` | 22 | `<q-img :src="getImageURL('images/common/selectOrganization.svg')" style="width: 200px; height: 200px; margin-top: 20vh;" />` | `<img :src="getImageURL('images/common/selectOrganization.svg')" style="width: 200px; height: 200px; margin-top: 20vh" alt="" />` |

### Pattern C — Settings page logos (2 usages)

| Status | File | Line | Current | Replacement |
|---|---|---|---|---|
| `[x]` | `components/settings/General.vue` | 243 | `<q-img data-test="setting_ent_custom_logo_img" :src="..." :alt="t('settings.logoLabel')" style="max-width: 150px; max-height: 31px" class="q-mx-md" />` | `<img data-test="setting_ent_custom_logo_img" :src="..." :alt="t('settings.logoLabel')" style="max-width: 150px; max-height: 31px" class="q-mx-md" />` |
| `[x]` | `components/settings/General.vue` | 316 | same pattern, dark-mode logo (`setting_ent_custom_logo_dark_img`) | same pattern with dark-mode src |

---

## Out-of-scope / test fixtures

| File | Reason |
|---|---|
| `src/components/settings/NoRegexPatterns.spec.ts:50` | Test stub `QImg: { template: "<img ... />", props: [...] }`. Once parent template is migrated, this stub is unused — remove it. |
| `src/components/settings/General.spec.ts:207` | Same — stub becomes dead after parent migration. |

---

## Post-migration cleanup

1. Drop the `QImg` stubs from `NoRegexPatterns.spec.ts:50` and `General.spec.ts:207`.
2. Add `q-img` to the ESLint `vue/no-restricted-html-elements` rule in `web/eslint.config.js` alongside the existing `q-avatar` / `q-badge` / `q-chip` entries:
   ```js
   {
     element: 'q-img',
     message: 'Use a native <img> element instead of <q-img>. q-img features (lazy load, aspect-ratio, spinner) are not used anywhere in this codebase.'
   }
   ```
3. **No QImg import or component registration to remove** — Quasar auto-registers q-img as a global tag, and `MainLayout.vue` doesn't list it.

---

## Accessibility note

For decorative SVG illustrations (empty-state graphics, icon-sized logos in menu items), use `alt=""` — explicitly empty alt tells screen readers to skip the image. For meaningful images (the settings page custom logo), use a descriptive alt — the existing `:alt="t('settings.logoLabel')"` already does this and carries over unchanged.

---

## Status legend

| Symbol | Meaning |
|---|---|
| `[x]` | Not started |
| `[x]` | Done |
| `[!]` | Special handling — see note |

## Progress summary

| Pattern | Total usages | Done | Remaining |
|---|---|---|---|
| A — Icon-sized image | 3 | 0 | 3 |
| B — Empty-state illustration | 4 | 0 | 4 |
| C — Settings logo | 2 | 0 | 2 |
| **Total** | **9** | **0** | **9** |

| Cleanup | Status |
|---|---|
| Remove QImg stub from `NoRegexPatterns.spec.ts` | `[x]` |
| Remove QImg stub from `General.spec.ts` | `[x]` |
| Add `q-img` to ESLint restricted-syntax | `[x]` |

_Update this table as files are completed._
