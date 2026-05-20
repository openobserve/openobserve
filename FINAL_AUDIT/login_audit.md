# Login / Auth Page — Quasar Removal Audit

## Summary

The Login / Auth pages were migrated from Quasar primitives (`<q-form>`, `<q-input>`, `<q-checkbox>`, `useQuasar().notify`) to in-house O* components (`OInput`, `OCheckbox`, `OButton`) and the new `toast()` helper. Migration is mostly clean and class names were converted to Tailwind `tw:` prefix style, but several **functional regressions** slipped through:

1. **CRITICAL: Enter-key submit is broken on the Login form** — the surrounding `<q-form @submit.prevent="">` was deleted and not replaced with a native `<form>` or any `@keyup.enter` handler. Users can no longer press Enter to log in; they must click the button.
2. **CRITICAL: Inline field validation is gone on GetStarted.vue** — the `:rules="[(val) => val.length > 0 || 'This field is required']"` props on the two `q-input`s were dropped during the migration, so the per-field error UI no longer appears (only a toast on submit).
3. **Wrong toast variant for errors in `views/Login.vue`** — the `catch` branch in `VerifyAndCreateUser` uses `variant: "loading"` for the error message, which renders a never-dismissing spinner instead of an error.
4. **Stale Quasar mocks in `Login.spec.ts`** — the test file still mocks `useQuasar`, `$q.notify`, and `loginform.value.resetValidation` and asserts on a `mockNotify` that the new component never calls. Multiple tests will silently fail.
5. **One leftover Quasar utility class** — `relative-position` on `web/src/views/Login.vue:20`.
6. **Two dead `.q-field__label` SCSS blocks** still ship (login-inputs scope in `Login.vue`/`SsoLogin.vue`); harmless but should be removed.

## Files Audited

- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/Login.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/Invitations.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/login/Login.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/login/SsoLogin.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/login/GetStarted.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/login/Login.spec.ts`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/login/SsoLogin.spec.ts`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/login/GetStarted.spec.ts`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/services/auth.ts` (no diff)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/services/auth.spec.ts` (no diff)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/iam/users/InvitationList.vue` (bonus spot-check only — owned by IAM agent)

## Critical Issues

### 1. Enter-key login submission no longer works (`web/src/components/login/Login.vue`)

The original markup wrapped the inputs in a `<q-form ref="loginform" @submit.prevent="">`, which gave Enter-to-submit behaviour for free (Quasar wires keyboard handling). In the migration the form element was removed entirely (lines 128–158) and replaced with `<div class="tw:flex tw:flex-col tw:gap-3">`. The submit button still carries `type="submit"`, but with no surrounding `<form>` element that attribute is dead. There is no `@keyup.enter` listener on either `OInput`.

Net effect: keyboard users / power users pressing Enter in either field get no feedback and the form does not submit. Same issue mirrored in `SsoLogin.vue:44-77` (the internal-user login fallback inside the SSO screen).

**Solution:**
```diff
- <div class="tw:flex tw:flex-col tw:gap-3">
+ <form class="tw:flex tw:flex-col tw:gap-3" @submit.prevent="onSignIn">
    <OInput v-model="username" ... />
    <OInput v-model="password" type="password" ... />
    <OButton type="submit" ...>{{ t('login.signIn') }}</OButton>
- </div>
+ </form>
```

### 2. Error path in `VerifyAndCreateUser` uses `variant: "loading"` (`web/src/views/Login.vue:391-394`)

```
.catch((error) => {
  toast({
    variant: "loading",
    message: "Error while verifying user...",
  });
  if (error.status === 403) this.signout();
});
```

Per `web/src/lib/feedback/Toast/useToast.ts` line 19-26, `loading` variant has `timeout: 0` (persistent) and displays a spinner. This was previously `$q.notify({ spinner: true, message: "Error while verifying user..." })` — also incorrect on `main`, but at least Quasar's spinner notify auto-dismissed. The new toast will persist indefinitely. Should be `variant: "error"`.

The success-path "Please wait while creating new user…" toast (lines 365-368) is correct in intent (`variant: "loading"`), and its returned `dismiss()` is called after `addNewUser` resolves (line 375) — that one works.

**Solution:**
```diff
  .catch((error) => {
    toast({
-     variant: "loading",
+     variant: "error",
      message: "Error while verifying user...",
    });
    if (error.status === 403) this.signout();
  });
```

### 3. Validation rules silently dropped (`web/src/components/login/GetStarted.vue:38-51`)

Original `q-input` elements had:

```
:rules="[(val) => val.length > 0 || 'This field is required']"
```

These are gone after migration. The new `OInput` exposes `errorMessage`/`error` props but `GetStarted.vue` never sets them. The form falls back to a single `toast("Please fill all the fields")` only after the user clicks submit — no inline indication of which field is empty, no live validation as the user fixes it. The visible `*` after the label is now cosmetic only.

**Solution:**
```diff
+ const nameError = ref("");
+ const emailError = ref("");
+ const validate = () => {
+   nameError.value = !name.value ? "This field is required" : "";
+   emailError.value = !email.value ? "This field is required" : "";
+   return !nameError.value && !emailError.value;
+ };

- <OInput v-model="name" />
+ <OInput v-model="name" :error="!!nameError" :error-message="nameError" @update:model-value="nameError = ''" />
```

## Logical Issues

### 4. Dead `selected()` method crashes if ever invoked (`web/src/components/login/Login.vue:443-445`)

```
selected(item: any) {
  toast(`Selected suggestion "${item.label}"`);
},
```

`toast()` expects a `ToastOptions` **object** with a `message` field (see `useToast.ts:40-41`: `const variant: ToastVariant = options.variant ?? "default"` — runs `??` on a string). On `main` this method called `this.$q.notify(string)`, which Quasar accepted. The method appears unused in the template, but it is a regression and a latent bug.

**Solution:**
```diff
  selected(item: any) {
-   toast(`Selected suggestion "${item.label}"`);
+   toast({ message: `Selected suggestion "${item.label}"` });
  },
```

### 5. Unused `loginform` ref left in `setup()` (`web/src/components/login/Login.vue:202`)

`const loginform = ref();` is declared but never assigned (no `ref="loginform"` in the template anymore) and is no longer returned from setup. Dead code — safe but noisy.

**Solution:**
```diff
- const loginform = ref();
```

### 6. SSO button on `SsoLogin.vue` has no `@click` (pre-existing, not a regression)

The "Login with SSO" `OButton` at `web/src/components/login/SsoLogin.vue:16-33` has no click handler. Same on `main` (confirmed via `git show main:…`). The `onSignIn` function (line 102-104) is also a stub: `console.log("onSignIn")`. This component is apparently unused in production — `web/src/views/Login.vue` mounts `<login>` (the `Login.vue` component), not `SsoLogin.vue`. Worth flagging for cleanup but not part of the migration regression set.

**Solution:**
```diff
- <OButton variant="primary">Login with SSO</OButton>
+ <OButton variant="primary" @click="onSsoSignIn">Login with SSO</OButton>
// OR delete SsoLogin.vue if confirmed unused
```

## CSS / Layout Issues

### 7. Quasar utility class still present in template

`web/src/views/Login.vue:20`:

```
<div class="tw:flex relative-position tw:px-3 tw:pt-2">
```

`relative-position` is a Quasar class. Should be `tw:relative`.

**Solution:**
```diff
- <div class="tw:flex relative-position tw:px-3 tw:pt-2">
+ <div class="tw:flex tw:relative tw:px-3 tw:pt-2">
```

### 8. Conflicting Tailwind font-weight classes

`web/src/components/login/Login.vue:36`:

```
class="tw:text-xl tw:font-semibold tw:font-bold tw:p-0 tw:cursor-pointer tw:mr-2 tw:w-full"
```

`font-semibold` (600) and `font-bold` (700) both target the same `font-weight` property. The later class wins, but it is sloppy migration noise — choose one.

**Solution:**
```diff
- class="tw:text-xl tw:font-semibold tw:font-bold tw:p-0 tw:cursor-pointer tw:mr-2 tw:w-full"
+ class="tw:text-xl tw:font-bold tw:p-0 tw:cursor-pointer tw:mr-2 tw:w-full"
```

### 9. `tw:gap-3` without `tw:flex` on parent (`web/src/components/login/SsoLogin.vue:45`)

```
<div class="tw:gap-3">
  <OInput ... />
  <OInput ... />
  ...
</div>
```

`gap` only applies to flex/grid containers. The siblings won't be spaced. Mirror the fix used in `Login.vue:128` (`tw:flex tw:flex-col tw:gap-3`).

**Solution:**
```diff
- <div class="tw:gap-3">
+ <div class="tw:flex tw:flex-col tw:gap-3">
```

### 10. Dead `.q-field__label` SCSS blocks

- `web/src/components/login/SsoLogin.vue:108-115`
- A similar block was already removed from `Login.vue`, but the `class="login-inputs"` (line 126) and `class="o2-input login-inputs"` (SsoLogin line 44) wrappers are now orphan hooks since the `.q-field__label` selectors are dead inside O* components.

**Solution:**
```diff
- <style lang="scss" scoped>
- .login-inputs {
-   .q-field__label { ... }   /* dead block — selectors never match */
- }
- </style>
```

### 11. Spinner image positioning (`web/src/components/login/Login.vue:103-110`, `SsoLogin.vue:24-31`)

```
<div class="tw:flex tw:items-center tw:justify-center tw:w-full tw:text-center tw:relative">
  <img class="tw:absolute" style="width: 30px; left: 16px" :src="..." />
```

`tw:text-center` on a flex container is redundant (children center horizontally via `justify-center`). Cosmetic.

**Solution:**
```diff
- <div class="tw:flex tw:items-center tw:justify-center tw:w-full tw:text-center tw:relative">
+ <div class="tw:flex tw:items-center tw:justify-center tw:w-full tw:relative">
```

## Component Migration Issues

### 12. `<q-form>` removed but no native `<form>` substitute (`Login.vue`, `SsoLogin.vue`)

Already covered as Critical Issue 1. The submit button keeps `type="submit"` (Login.vue:152, SsoLogin.vue:70) which is misleading — there is no enclosing form. Either:
- Wrap inputs in a native `<form @submit.prevent="onSignIn">`, or
- Drop `type="submit"` and add `@keyup.enter="onSignIn"` to both `OInput`s.

The native `<form>` approach also restores accessibility behaviours (Enter submission, screen-reader form-role semantics, password-manager autofill heuristics).

**Solution:** See Critical Issue 1 — wrap inputs and submit button in `<form @submit.prevent="onSignIn">` and remove orphan `type="submit"` from `OButton` if not wrapping.

### 13. Quasar notify → toast mapping loses semantic colour

Several call sites translated `$q.notify({ color: "negative"/"positive"/"warning", ... })` into bare `toast({ message })`, dropping the colour and visual urgency:

- `web/src/components/login/Login.vue:398-400` — "Invalid login response" message now `default` variant (no error styling).
- `web/src/components/login/Login.vue:405-409` — "Invalid username or password" now `default`.
- `web/src/components/login/Login.vue:413-416` — "Please fill all the fields…" catch handler now `default`.
- `web/src/components/login/Login.vue:250-253` — empty-field warning (originally `color: "warning"`) now `default`. Note: the `position: "top-center"` is passed but original used Quasar's `position: "top"` — confirm OToast supports `top-center` (it does per `OToast.types.ts`).
- `web/src/components/login/GetStarted.vue:114-117, 128-131, 133-136` — all three notifications lost their `negative`/`positive` colour and look identical now.

Should add `variant: "error"` / `variant: "success"` / `variant: "warning"` as appropriate.

**Solution:**
```diff
- toast({ message: "Invalid login response" });
+ toast({ variant: "error", message: "Invalid login response" });
- toast({ message: "Please fill all the fields" });
+ toast({ variant: "warning", message: "Please fill all the fields", position: "top-center" });
- toast({ message: "Login successful" });
+ toast({ variant: "success", message: "Login successful" });
```

## Test File Issues

### 14. `web/src/components/login/Login.spec.ts` — broken expectations

- Lines 24-34: still mocks `quasar`'s `useQuasar` with `mockNotify`. The component no longer imports from `quasar`.
- Line 99, 108: still provides `$q: { notify: mockNotify }` to the wrapper. Unused by the new component.
- Lines 112-115: still defines `loginform.value.resetValidation` on the wrapper. Component no longer references it.
- Lines 310-343: three tests assert `expect(mockNotify).toHaveBeenCalled()` for empty-username/password cases — these now call `toast()` instead, so `mockNotify` will never fire. The tests will FAIL.
- Lines 414, 998: same `wrapper.vm.$q = { notify: mockNotify }` injection — dead.

Rewrite needed: mock `@/lib/feedback/Toast/useToast` and assert on its `toast` export instead.

**Solution:**
```diff
- vi.mock("quasar", () => ({ useQuasar: () => ({ notify: mockNotify }) }));
+ const mockToast = vi.fn();
+ vi.mock("@/lib/feedback/Toast/useToast", () => ({
+   useToast: () => ({ toast: mockToast, dismiss: vi.fn() }),
+   toast: mockToast,
+ }));
- expect(mockNotify).toHaveBeenCalled();
+ expect(mockToast).toHaveBeenCalled();
```

### 15. `web/src/components/login/GetStarted.spec.ts` — broken expectations

- Lines 15-25: still mocks `useQuasar`. Unused.
- Lines 199-203, 271-275, 319-323: assertions of the form `expect(mockNotify).toHaveBeenCalledWith({ message: ..., color: 'negative'|'positive' })`. The component now calls `toast({ message: ... })` with no `color`. Both the spy target and the payload shape are wrong. Tests will FAIL.

**Solution:**
```diff
- expect(mockNotify).toHaveBeenCalledWith({ message: "...", color: 'negative' });
+ expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
+   message: expect.any(String),
+   variant: "error",
+ }));
```

### 16. `web/src/components/login/SsoLogin.spec.ts` — OK

This file does not assert on notify behaviour (the component's `onSignIn` is a no-op `console.log`). The Quasar mock import was removed and `installQuasar()` was added. Should still pass.

**Solution:** No change required.

## Recommendations

In priority order:

1. **Restore Enter-to-submit on the Login form.** Easiest path: wrap the `OInput`s + submit `OButton` in a native `<form @submit.prevent="onSignIn">`. Repeat in `SsoLogin.vue`. (Critical Issue 1.)
2. **Fix the error-toast variant in `views/Login.vue:391-394`** — change `variant: "loading"` to `variant: "error"`. While there, audit the rest of the toast call sites to set explicit `variant: "error"` / `"success"` / `"warning"` to restore the lost colour semantics (Issue 13).
3. **Restore inline validation on `GetStarted.vue`** — bind `OInput`'s `errorMessage`/`error` props to local computed refs that mirror the old `rules` logic. At minimum, mark the field with `error` when validation fails on submit so users see which field is the problem. (Critical Issue 3.)
4. **Rewrite `Login.spec.ts` and `GetStarted.spec.ts`** to mock and assert against `@/lib/feedback/Toast/useToast` instead of `useQuasar`/`mockNotify`. Drop the `loginform`/`resetValidation` mock plumbing. (Issues 14, 15.)
5. **Clean up Quasar leftovers**:
   - Replace `relative-position` with `tw:relative` in `views/Login.vue:20`.
   - Remove duplicate `tw:font-semibold tw:font-bold` in `Login.vue:36`.
   - Add `tw:flex tw:flex-col` to `SsoLogin.vue:45` (the `tw:gap-3` parent).
   - Delete dead `.q-field__label { ... }` SCSS block in `SsoLogin.vue:108-115` and the orphan `.login-inputs` wrappers.
   - Delete dead `.q-btn` selector in `InvitationList.vue:375-378`.
6. **Delete dead `loginform` ref** in `Login.vue:202` and the unused `selected()` method (lines 443-445). If `selected()` is kept, fix the `toast()` call to pass an object: `toast({ message: \`Selected suggestion "${item.label}"\` })`.
7. **Decide the fate of `SsoLogin.vue`** — it appears to be an orphan with no `@click` on its SSO button and a stub `onSignIn`. Either wire it up or remove it; right now it is dead surface area.

## Class-Level Styling Audit

### 1. Quasar Class Leftovers
| File:Line | Class | Replacement | Layer |
|---|---|---|---|
| InvitationList.vue:21 | `q-table__title` | drop / use `tw:text-base tw:font-semibold` | file-scoped |
| InvitationList.vue:375 | `.q-btn` selector | remove dead selector | file-scoped |
| SsoLogin.vue:109 | `.q-field__label` selector | remove dead selector | file-scoped |
| Login.vue:20 | `relative-position` | `tw:relative` | file-scoped |

### 2. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
|---|---|---|---|
| *(none found)* | | | |

### 3. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| *(none found)* | | | |

### 4. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
|---|---|---|---|
| InvitationList.vue:375 | `.q-btn` selector | remove | file-scoped |
| SsoLogin.vue:109 | `.q-field__label` | remove | file-scoped |

### 5. Quasar SCSS Variables in Scoped Styles
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| InvitationList.vue:362 | `$dark-page` | `var(--o2-bg-page)` | file-scoped |
| InvitationList.vue:366 | `$light-text` | `var(--o2-text-secondary)` | file-scoped |

### 6. Quasar Directives
| File:Line | Directive | Action |
|---|---|---|
| *(none found)* | | |

### 7. Icon Migration
| File:Line | Issue | Fix |
|---|---|---|
| *(none found)* | | |

### 8. Inline `style=` Hot Spots
| File:Line | Inline style | Suggested home |
|---|---|---|
| GetStarted.vue:6 | `display:flex; justify-content:start; align-items:end; height:100%` | `tw:flex tw:justify-start tw:items-end tw:h-full` |
| GetStarted.vue:7 | `margin-bottom:34px; margin-left:32px` | scoped `.get-started-brand` class |
| GetStarted.vue:8 | mixed `margin-bottom`, `height`, `margin-left` | scoped class |
| GetStarted.vue:10 | typography overrides | scoped `.get-started-title` class |
| GetStarted.vue:24 | `height:64px` | `tw:h-16` |
| GetStarted.vue:43,50 | `width:100%` | `tw:w-full` |
| Login.vue:19 | `max-width:400px; padding-top:100px` | scoped `.login-shell` class |
| Login.vue:46 | `max-width:150px; max-height:31px` | scoped `.login-logo` class |
| Login.vue:52,68 | `height:auto` | drop (default) |
| Login.vue:90 | `font-size:22px` | `tw:text-[22px]` or `.login-heading` |
| Login.vue:99 | `width:400px` | `tw:w-[400px]` |
| Login.vue:107 | `width:30px; left:16px` | scoped class |
| Login.vue:118 | `text-decoration:underline` | `tw:underline` |
| SsoLogin.vue:3 | `height:150px` | scoped class |

### 9. Duplicate Style Blocks
| Files | Duplicated block | Suggested partial |
|---|---|---|
| Login.vue:103 / SsoLogin.vue:24 | identical `tw:flex tw:items-center tw:justify-center tw:w-full tw:text-center tw:relative` divider row | extract `.sso-divider` class |

### 10. Layer Summary
- Global (`app.scss`) changes needed: 0
- Component-level partial changes: 1 (sso-divider shared between Login + SsoLogin)
- File-level scoped changes: ~22 (4 q-* leftovers, 2 SCSS vars, 1 relative-position, 14 inline styles)
