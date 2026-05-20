# IAM / Users Page — Quasar Removal Audit

## Summary

Audit of IAM (Identity & Access Management) pages on `feat/ux-revamp-main` vs `main`. The migration from Quasar to O* components has substantial coverage (q-page → div, q-table → OTable, q-dialog → ODialog, q-input → OInput, q-select → OSelect, q-form → OForm, q-icon → OIcon, q-card with side-dialog → ODrawer, useQuasar.notify → toast). However, several critical runtime bugs, broken interactions, dead Quasar CSS classes, and stale test assertions remain.

Most severe findings:
1. `ListOrganizations.vue` — Edit Organization button will throw `ReferenceError: props is not defined`.
2. `UpdateRole.vue` — Save button will throw `Cannot read 'validate' of null`.
3. `User.vue`, `ServiceAccountsList.vue` — Vue 3 invalid: two `v-model` directives on same child (`v-model:open` + `v-model`).
4. `OrganizationManagement.vue` — Revoke-contract icon name corrupted to `tw:block`.
5. `AddRole.vue` / `AddGroup.vue` — Error UI plumbed but never set; validation only blocks Save silently.
6. Multiple spec files still query `.q-input`, `.q-select`, `.q-splitter`, `.q-dialog` and stub `q-page`/`q-table`/`q-input` — tests will fail since the elements no longer exist.

## Files Audited

Views:
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/IdentityAccessManagement.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/User.vue` (no diff vs main)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/Invitations.vue` (no diff vs main)

Users:
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/iam/users/User.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/iam/users/AddUser.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/iam/users/UpdateRole.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/iam/users/MemberInvitation.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/iam/users/InvitationList.vue`

Roles:
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/iam/roles/AppRoles.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/iam/roles/AddRole.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/iam/roles/EditRole.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/iam/roles/PermissionsTable.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/iam/roles/EntityPermissionTable.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/iam/roles/RoleTable.vue` (new)

Groups:
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/iam/groups/AppGroups.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/iam/groups/AddGroup.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/iam/groups/EditGroup.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/iam/groups/GroupUsers.vue`, `GroupRoles.vue`, `GroupServiceAccounts.vue`

Organizations:
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/iam/organizations/AppOrganizations.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/iam/organizations/ListOrganizations.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/iam/organizations/AddUpdateOrganization.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/settings/OrganizationManagement.vue`

Service Accounts & Quota:
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/iam/serviceAccounts/ServiceAccountsList.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/iam/serviceAccounts/AddServiceAccount.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/iam/quota/Quota.vue`

Tests (sampled): `User.spec.ts`, `AppGroups.spec.ts`, `IdentityAccessManagement.spec.ts`, `OrganizationManagement.spec.ts`, `MemberInvitation.spec.js`, `InvitationList.spec.ts`.

## Critical Issues

### 1. `ListOrganizations.vue:367-382` — Runtime `ReferenceError: props is not defined`
The Edit-organization handler signature was changed from `(props)` to `(row)`, but two references inside still use `props.row.identifier` / `props.row.name`:

```js
const renameOrganization = (row: any) => {
  toBeUpdatedOrganization.value = { id: row.identifier, name: row.name, identifier: row.identifier };
  showAddOrganizationDialog.value = true;
  router.push({
    query: {
      action: "update",
      org_identifier: store.state.selectedOrganization.identifier,
      to_be_updated_org_id: props.row.identifier,   // <-- ReferenceError
      to_be_updated_org_name: props.row.name,        // <-- ReferenceError
    },
  });
};
```
Setup() has no `props` parameter. Clicking the row-level edit pencil throws and aborts navigation.

Fix: replace `props.row.identifier` → `row.identifier`, `props.row.name` → `row.name`.

**Solution:**
```diff
       query: {
         action: "update",
         org_identifier: store.state.selectedOrganization.identifier,
-        to_be_updated_org_id: props.row.identifier,
-        to_be_updated_org_name: props.row.name,
+        to_be_updated_org_id: row.identifier,
+        to_be_updated_org_name: row.name,
       },
```

### 2. `UpdateRole.vue:133, 166` — Save throws `Cannot read property 'validate' of null`
The Quasar `<q-form ref="updateUserForm">` was removed, but `onSubmit()` still calls `this.updateUserForm.validate().then(...)` and later `this.updateUserForm.resetValidation()`. `updateUserForm` is initialised as `ref(null)` (line 104) and never gets a DOM element bound. The whole submit chain is wrapped in this rejected promise. Effect: clicking Save on the Update User Role drawer does nothing visible while throwing in console, and the success/failure path never runs.

**Solution:**
```diff
 const onSubmit = () => {
-  updateUserForm.value.validate().then((valid: any) => {
-    if (!valid) return;
-    // existing API call …
-  });
+  // OForm/OInput handles inline validation; call the API directly.
+  // existing API call …
 };
-// remove updateUserForm.value.resetValidation() at line 166
+// drop updateUserForm ref entirely
```

### 3. `User.vue:132-148`, `ServiceAccountsList.vue:147-152` — Double `v-model` (Vue compile-time error)
Two `v-model` directives on a single component:

```html
<update-user-role
  v-model:open="showUpdateUserDialog"
  v-model="selectedUser"             <!-- duplicate v-model -->
  @updated="updateMember"
/>

<add-user
  v-model:open="showAddUserDialog"
  v-model="selectedUser"             <!-- duplicate v-model -->
  ...
/>

<add-service-account
  v-model:open="showAddUserDialog"
  v-model="selectedUser"             <!-- duplicate v-model -->
  @updated="addMember"
/>
```
Vue 3 expects a single default `v-model` plus optional `v-model:<arg>`. Having both `v-model` and `v-model:open` is supported only if the child component declares both `modelValue` + `open` as separate props with paired emits. None of `AddUser.vue`, `UpdateRole.vue`, `AddServiceAccount.vue` declare a default-modelValue with emits matching that pattern. `selectedUser` is propagated by `v-model` (default), but its child binds the value through the `modelValue` prop only — write-back is unused. Net effect: confusing/dead two-way binding that will mask state-sync bugs and trigger Vue warnings.

**Solution:**
```diff
 <update-user-role
   v-model:open="showUpdateUserDialog"
-  v-model="selectedUser"
+  :model-value="selectedUser"
   @updated="updateMember"
 />
 <add-user
   v-model:open="showAddUserDialog"
-  v-model="selectedUser"
+  :model-value="selectedUser"
   ...
 />
 <add-service-account
   v-model:open="showAddUserDialog"
-  v-model="selectedUser"
+  :model-value="selectedUser"
   @updated="addMember"
 />
```

### 4. `OrganizationManagement.vue:90` — Icon name corrupted to `tw:block`
```html
<OIcon name="tw:block" size="xs" />
```
This appears to be a search-and-replace mistake where `tw:` was prefixed to an icon name rather than to a CSS class. The Revoke Contract icon will fail to render and likely log an unknown-icon warning.

**Solution:**
```diff
-<OIcon name="tw:block" size="xs" />
+<OIcon name="block" size="xs" />
```
(`block` is a registered icon in `OIcon.icons.ts` mapping to `material-symbols/block-outline`.)

### 5. `AddRole.vue` / `AddGroup.vue` — Error state plumbed but never set
Both components define `showNameError` ref and pass it to OInput's `:error`. The only writer is `@update:model-value="showNameError = false"`. There is no path that sets it to `true` — neither `saveRole`/`saveGroup` nor any validation hook does. The visible error never appears. Save is just silently disabled when the regex fails (via `:disabled` on the button). Users who paste an invalid name into an enabled-state input get no inline feedback.

**Solution:**
```diff
 const saveRole = () => {
+  if (!/^[a-zA-Z0-9_]+$/.test(roleName.value)) {
+    showNameError.value = true;
+    nameErrorMessage.value = t("iam.roleNameInvalid");
+    return;
+  }
   // …existing save logic
 };
```
(Apply equivalent change in `saveGroup` of `AddGroup.vue`.)

### 6. `IdentityAccessManagement.vue:280` — `:deep(.q-splitter__before)` targets removed component
The splitter was migrated `q-splitter` → `OSplitter`, but the scoped CSS still selects `.q-splitter__before`. This rule never matches; the intended `overflow: visible` on the sidebar pane is gone. If the sidebar collapse/expand chevron clips visually, this is why.

**Solution:**
```diff
-:deep(.q-splitter__before) {
-  overflow: visible;
-}
+:deep(.o2-splitter-pane-before) {
+  overflow: visible;
+}
```
(Match the OSplitter's actual rendered class — verify against `web/src/lib/core/Splitter/OSplitter.vue`.)

## Logical Issues

### Drawer open-prop wiring (Add User, Update Role, Add Service Account)
The parent passes both `v-model:open` and `v-model` (see Critical #3). Because `selectedUser` is the default `modelValue`, every `v-model` change replaces the entire form snapshot mid-edit. Combined with the cancel handler that emits `update:open` only, the child can't reliably clear `selectedUser` on close. Effect: stale data in the drawer when reopened immediately after closing without a refetch.

**Solution:**
```diff
 <update-user-role
-  v-model:open="showUpdateUserDialog"
-  v-model="selectedUser"
+  :open="showUpdateUserDialog"
+  :model-value="selectedUser"
+  @update:open="(v) => { showUpdateUserDialog = v; if (!v) selectedUser = {}; }"
   @updated="updateMember"
 />
```

### `AddUser.vue` — `@update:open` cancel handler missing reset
Cancel emits `update:open` only; parent's hideForm (User.vue line 694) is unused (`hideForm` is defined but no longer wired to a `cancel:hideform` event). The URL action query (`action=add` / `action=update`) is not cleaned up unless `addMember` runs successfully. Effect: closing the drawer leaves stale `?action=add` in the URL.

**Solution:**
```diff
 <add-user
-  v-model:open="showAddUserDialog"
+  :open="showAddUserDialog"
+  @update:open="(v) => { showAddUserDialog = v; if (!v) hideForm(); }"
   ...
 />
```

### `User.vue:498-503` — `updateUserActions` mutates rows but selection map keyed off `usersState.users`
The selection-id handler `handleSelectedIdsUpdate` (line 935) reads from `usersState.users` filtered by `enableDelete`. Meanwhile the rendered table receives `rows`. `rows.value = usersState.users` after `getOrgMembers` (line 463). However `updateUserActions` (line 497) mutates `usersState.users` items in place — `rows` references the same array, but no `tableKey` bump is forced for mutation-only changes. If `enableDelete` toggles asynchronously after first paint, the OTable does not re-render selection-disabled rows. Edge case but visible after role refresh.

**Solution:**
```diff
 const updateUserActions = () => {
   usersState.users.forEach((u) => {
     u.enableDelete = canDelete(u);
   });
+  // Force OTable to re-evaluate disabled-row state
+  rows.value = [...usersState.users];
+  tableKey.value++;
 };
```

### `User.vue:580-583` — `updateUser` function is dead
`updateUser` is exported but never used (no Vue listener references it). The actual edit flow runs via `addRoutePush` → `addUser`. Safe to remove. Same for `forceCloseRow`, `toggleExpand`, `fetchUserGroups`, `fetchUserRoles` (only invoked by `toggleExpand`) — all unused after Quasar's `expand` slot was removed.

**Solution:**
```diff
-const updateUser = (...) => { /* dead */ };
-const forceCloseRow = (...) => { /* dead */ };
-const toggleExpand = (...) => { /* dead */ };
-const fetchUserGroups = (...) => { /* dead */ };
-const fetchUserRoles = (...) => { /* dead */ };
```
Remove from the `return {}` block too.

### `AppRoles.vue:174` — `hideForm` defined but unused
After AddRole.vue migrated from `@cancel:hideform` to `v-model:open`, the parent's `hideForm` handler has no listener. Dead code.

**Solution:**
```diff
-const hideForm = () => { /* dead, no @cancel:hideform listener */ };
```
Remove from `setup()` and from the `return {}` block.

### `AppGroups.vue:260-262, 289-292` — `hideAddGroup`, `_deleteGroup` unused
Same pattern as above. Dead handlers.

**Solution:**
```diff
-const hideAddGroup = () => { /* dead */ };
-const _deleteGroup = () => { /* dead */ };
```
Remove from `setup()` and from the `return {}` block.

### `MemberInvitation.spec.js` — `findComponent('.q-select')` matches nothing
`MemberInvitation.vue` migrated to `OSelect`, so 16 calls to `wrapper.find('.q-input input')` and 2 calls to `wrapper.findComponent('.q-select')` in the spec no longer match real DOM. The component tests will fail.

**Solution:**
```diff
-wrapper.find('.q-input input')
+wrapper.findComponent(OInput).find('input')
-wrapper.findComponent('.q-select')
+wrapper.findComponent(OSelect)
```
Add `import OInput from "@/lib/forms/Input/OInput.vue"` and `import OSelect from "@/lib/forms/Select/OSelect.vue"` at the top.

### Validation logic on AddUser preserved via JS but lost UX feedback
`AddUser.vue:434-487` — All Quasar `:rules=[...]` were removed from the template. The validation logic was re-implemented inside `onSubmit()` using `toast()` calls. This means errors no longer appear inline below inputs. The user sees a toast that disappears. Accessibility regression: screen readers no longer announce per-field errors, only the toast.

**Solution:**
```diff
-<OInput v-model="formData.email" label="Email" />
+<OInput
+  v-model="formData.email"
+  label="Email"
+  :error="!!emailError"
+  :error-message="emailError"
+  @update:model-value="emailError = ''"
+/>
```
In `onSubmit`, set `emailError.value = t('iam.invalidEmail')` instead of/in addition to calling `toast()`.

### `AddUpdateOrganization.vue:189-249` — Dangling indentation/scope after `addOrganizationForm.validate()` removal
The `if(!organizationId)` block (line 192) is indented at the wrong depth (8 spaces extra) for a method body, suggesting code was left inside the closure pattern of `addOrganizationForm.validate().then(...)` which was removed. The code still parses, but readability suffers and `this.track(...)` at lines 250-253 runs unconditionally (even on validation failure path) — slight regression in analytics signal.

**Solution:**
```diff
 const onSubmit = () => {
+  if (!organizationName.value) return;  // guard like the old validate() did
   if (!organizationId) {
     // ...create flow (re-indent two levels left)
   } else {
     // ...update flow (re-indent)
   }
-  // unconditional track() call — runs even on validation failure
+  // track only on success — move into .then(success) of the service call
 };
```

## CSS / Layout Issues

### Dead Quasar classes (still in templates, render nothing under Tailwind v4 with `prefix(tw)`)

Confirmed Tailwind config: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/styles/tailwind.css:1` — `@import "tailwindcss" prefix(tw);`. Any class without `tw:` is not Tailwind.

- `Invitations.vue:18` — `tw:h-[100vh-128px]` is **malformed**. The expression `100vh-128px` is not valid CSS height. Intended: `tw:h-[calc(100vh-128px)]`. Currently silently dropped or rendered as garbage; the invitations container height collapses.

**Solution:**
```diff
-<div class="tw:h-[100vh-128px]">
+<div class="tw:h-[calc(100vh-128px)]">
```

- `ServiceAccountsList.vue:25` — `tw:full-width` is not Tailwind (no `full-width` utility in Tailwind v4). The header bar still gets `tw:flex tw:justify-between …` so layout survives, but the unwanted class noises CSS.

**Solution:**
```diff
-class="tw:full-width tw:flex tw:justify-between ..."
+class="tw:w-full tw:flex tw:justify-between ..."
```

- `Quota.vue:111`, `OrganizationManagement.vue:141-142`, `User.vue:1015-1066`, `InvitationList.vue:352-385` — `float-right`, `bg-primary`, `text-white`, `text-gray-700`, `bg-white`, `border-gray-3`, `text-positive`, `relative-position`, `q-mt-lg`, `text-bold`, `cursor-pointer`, `no-wrap`, `items-center`, `q-px-md`, `q-py-sm`, `q-mr-md`, `q-ml-xs`, `q-pa-sm`, `full-height`, `full-width` — all are former Quasar utilities. Without Quasar's CSS shipped, these are dead. Visual impact varies by component.

**Solution:**
```diff
-class="float-right bg-primary text-white q-mt-lg text-bold cursor-pointer items-center q-pa-sm full-width"
+class="tw:float-right tw:bg-[var(--o2-primary)] tw:text-white tw:mt-6 tw:font-bold tw:cursor-pointer tw:items-center tw:p-2 tw:w-full"
```
(Apply the standard Quasar→Tailwind translations across all listed files.)

- `EditGroup.vue:18, 25` — still uses `full-height` and `q-py-sm`-derived classes for layout. The new `tw:flex tw:flex-col` works but `full-height` style is gone.

**Solution:**
```diff
-class="full-height q-py-sm tw:flex tw:flex-col"
+class="tw:h-full tw:py-2 tw:flex tw:flex-col"
```

- `User.vue:1015-1066` — `.confirmBody`, `.confirmActions`, `.q-btn`, `.invite-user`, `.inputHint` scoped styles reference SCSS vars `$dark-page`, `$light-text`, `$input-bg`. The dialogs were migrated to ODialog so `.confirmBody`/`.confirmActions` no longer target rendered elements — dead.

**Solution:**
```diff
-<style scoped lang="scss">
-.confirmBody { background: $dark-page; ... }
-.confirmActions { ... }
-.q-btn { ... }
-</style>
+<style scoped lang="scss">
+// Only retain rules that target elements actually rendered by ODialog/OButton.
+</style>
```

### Component-local styles still target legacy q-* selectors

- `Quota.vue:1735-1757` — `.q-table`, `.q-table--dark .thead-sticky`, `.q-table__bottom`, `.q-table__control` — dead, q-table is now OTable.
- `AppGroups.vue:347-361` — same dead `.q-table--dark .thead-sticky` block.
- `PermissionsTable.vue:361-364` — `.q-table--bordered`, `.q-table__card` — dead.
- `ListOrganizations.vue:450` — `.q-table` rule — dead.
- `InvitationList.vue:352-385` — `.confirmBody`, `.q-btn`, `.confirmActions` — orphaned (no q-btn now); SCSS variables `$dark-page`, `$light-text` may not resolve in scope.

**Solution:**
```diff
-.q-table { ... }
-.q-table--dark .thead-sticky { ... }
-.q-table__bottom { ... }
-.q-table--bordered { ... }
-.q-table__card { ... }
-.confirmBody { background: $dark-page; }
-.confirmActions { ... }
-.q-btn { ... }
```
Remove all dead Quasar selector rules from the scoped style blocks; rely on OTable's own styles or use `:deep(.o2-table-…)` selectors if overrides are needed.

### Inline class name still uses Quasar grid

- `User.vue:26`, `AppRoles.vue:23`, `AppGroups.vue:23`, `InvitationList.vue:21`, `OrganizationManagement.vue:21`, `Quota.vue:29`, `ServiceAccountsList.vue:29`, `ListOrganizations.vue:26` — all keep `class="q-table__title …"`. The class has no styles attached after Quasar removal but is then combined with `tw:font-[600]` so the heading still bolds. Cosmetic dead class, not broken.

**Solution:**
```diff
-<div class="q-table__title tw:font-[600] ...">
+<div class="tw:font-semibold ...">
```
Drop `q-table__title` everywhere — it has no styles attached.

### Width/positioning sample issues

- `User.vue:41, 48` — wrappers for invite button / add-user button still have `class="tw:w-1/2"`. With the parent's `tw:gap-3` and previously two columns this was Quasar `col-6`. In the new layout (flex with auto-width search input), `tw:w-1/2` forces ~50% width on the action wrapper that contains a single small primary button, expanding empty space.

**Solution:**
```diff
-<div class="tw:w-1/2">
+<div class="tw:w-auto">
   <OButton ... />
 </div>
```

- `OrganizationManagement.vue:24-33` — search OInput has no width constraint (`tw:ml-auto no-border o2-search-input`). With long title, the input collapses to natural button width unless `o2-search-input` adds width. Verify global stylesheet still supplies `.o2-search-input` width.

**Solution:**
```diff
-class="tw:ml-auto no-border o2-search-input"
+class="tw:ml-auto tw:w-64 o2-search-input"
```

- `Quota.vue:81` — OInput class `no-border input-width o2-search-input` — combines design-system class names with `o2-search-input`. The `input-width` and `no-border` are not Tailwind v4 either; rely on a legacy global stylesheet.

**Solution:**
```diff
-class="no-border input-width o2-search-input"
+class="tw:w-64 o2-search-input"
```

### OTooltip used as sibling (likely wrong)

`OrganizationManagement.vue:61, 71, 81, 91, 101, 112` and `ServiceAccountsList.vue:98` — `<OTooltip :content="..." />` is placed as a child of `<OButton>` or `<OBadge>` without a target/wrapping pattern. Depending on OTooltip's API (typically wraps trigger or uses portal+target), these tooltips will either render in the wrong spot, never appear, or hover-bind to the wrong element. Worth verifying against OTooltip's component contract.

**Solution:**
```diff
-<OButton variant="ghost" size="icon-xs-circle" @click="...">
-  <OIcon name="event" size="xs" />
-  <OTooltip content="Extend Contract" />
-</OButton>
+<OTooltip content="Extend Contract">
+  <OButton variant="ghost" size="icon-xs-circle" @click="...">
+    <OIcon name="event" size="xs" />
+  </OButton>
+</OTooltip>
```
OTooltip wraps the trigger; the icon/button stays inside the slot.

## Component Migration Issues

| Old (Quasar) | New (O*) | Concerns |
|---|---|---|
| `<q-page>` | `<div class="tw:rounded-md tw:p-0">` | OK across files |
| `<q-table>` | `<OTable>` | Selection model changed from `v-model:selected` (objects) to `:selected-ids` + `@update:selected-ids` (strings). User.vue, ServiceAccountsList.vue, AppGroups.vue have helper computeds. AppGroups stores `selectedGroups` separately even though `selectedGroupNames` is what OTable uses — duplicate state. |
| `<q-dialog>` | `<ODialog>` / `<ODrawer>` | Confirmation dialogs migrated correctly. Side dialogs (forms) became ODrawer with `:open` + `update:open`. Double v-model bug in parents (Critical #3). |
| `<q-input>` | `<OInput>` | Validation rules (`:rules`) DROPPED across AddUser, AddRole, AddGroup, AddUpdateOrganization, AddServiceAccount. Replaced with JS-side `onSubmit` checks; inline visual error feedback lost. |
| `<q-select>` | `<OSelect>` | Search/filter prop interfaces changed: `use-input` + `@filter` → `searchable`. The `filterFn` function in AddUser.vue (lines 406-417) is dead — no `@filter` event exists on OSelect. |
| `<q-form ref="...">` | plain `<OForm>` or nothing | Both UpdateRole (Critical #2) and AddServiceAccount removed the form but kept `updateUserForm` ref/calls. AddServiceAccount uses `@click="onSubmit"` so no validate() call — safe. UpdateRole crashes. |
| `<q-icon>` | `<OIcon>` | Icon names changed (cancel → cancel, visibility_off → visibility-off, manage_accounts → manage-accounts). Apparent typo: `tw:block` in OrganizationManagement.vue (Critical #4). |
| `<q-tooltip>` | `<OTooltip>` | API mismatch in OrganizationManagement.vue, ServiceAccountsList.vue (sibling/orphan placement). |
| `<q-toggle>` | `<OSwitch>` | AddUser.vue line 113 — OK migration. |
| `<q-checkbox>` | `<OCheckbox>` | EntityPermissionTable.vue OK. PermissionsTable.vue rewrote checkbox structure. |
| `<q-circular-progress>` / `<q-spinner-hourglass>` | `<OSpinner>` | OK in EditRole.vue, PermissionsTable.vue, Quota.vue. |
| `<q-virtual-scroll>` | plain `<div>` (PermissionsTable) | Virtual scrolling LOST. With many resources (50+) the permissions table will render every row eagerly. Performance regression for large RBAC datasets. |
| `<q-separator>` | `<OSeparator>` | OK in EditGroup, EditRole. |

### Other migration leftovers in templates

- `EditGroup.vue:18` — root div still has `full-height` Quasar class.

**Solution:**
```diff
-<div class="full-height tw:flex tw:flex-col">
+<div class="tw:h-full tw:flex tw:flex-col">
```

- `EditRole.vue:117`, `Quota.vue:185-192`, `OrganizationManagement.vue` — many `no-border`, `o2-search-input-icon-dark`, `el-border-radius`, `el-border` classes that rely on legacy global SCSS. If those globals were preserved, fine; if not, the visual borders/colors go missing.

**Solution:**
```diff
-class="no-border el-border el-border-radius o2-search-input-icon-dark"
+class="tw:border tw:border-[var(--o2-border-color)] tw:rounded-md"
```
(Or verify each legacy class still exists in `app.scss` — if it does, keep; if not, port to tokens.)

## Test File Issues

Tests are still anchored to Quasar selectors and stubs even though templates no longer render them. These tests will break under CI.

### `web/src/views/IdentityAccessManagement.spec.ts:475`
```js
it("should render q-splitter", () => {
  expect(wrapper.find(".q-splitter").exists()).toBe(true);
});
```
`q-splitter` was replaced with `OSplitter`. Assertion will FAIL.

**Solution:**
```diff
-it("should render q-splitter", () => {
-  expect(wrapper.find(".q-splitter").exists()).toBe(true);
-});
+it("should render OSplitter", () => {
+  expect(wrapper.findComponent(OSplitter).exists()).toBe(true);
+});
```
Add `import OSplitter from "@/lib/core/Splitter/OSplitter.vue"` at top.

### `web/src/components/iam/users/User.spec.ts:209-243`
Still stubs `q-page`, `q-table`, `q-input`, `q-checkbox`. Template now uses `OTable`/`OInput`/`OCheckbox`. Stubs are no-ops; tests of selection/header rendering will silently pass nothing, then real assertions on `q-checkbox-stub` will FAIL.

**Solution:**
```diff
 stubs: {
-  "q-page": true,
-  "q-table": true,
-  "q-input": true,
-  "q-checkbox": true,
+  OTable: true,
+  OInput: true,
+  OCheckbox: true,
 },
```
Update selectors from `q-checkbox-stub` to `o-table-stub` / `o-checkbox-stub` (or use `findComponent`).

### `web/src/components/iam/groups/AppGroups.spec.ts:146`
```js
const searchInput = wrapper.find('[data-test="iam-groups-search-input"] .q-input');
```
Search input is now an `OInput` — `.q-input` class absent. FAILS.

**Solution:**
```diff
-const searchInput = wrapper.find('[data-test="iam-groups-search-input"] .q-input');
+const searchInput = wrapper.find('[data-test="iam-groups-search-input"] input');
```

### `web/src/components/settings/OrganizationManagement.spec.ts:239-267`
Stubs `q-table`, `q-input`, `q-btn` but template no longer renders any of them. Stubs unused → most form/integration tests behave incorrectly.

**Solution:**
```diff
 stubs: {
-  "q-table": true,
-  "q-input": true,
-  "q-btn": true,
+  OTable: true,
+  OInput: true,
+  OButton: true,
 },
```

### `web/src/components/iam/users/InvitationList.spec.ts:121`
Stubs `q-table-pagination-stub` for component `QTablePagination`. Component was removed from the template. The stub is harmless but indicates stale specs.

**Solution:**
```diff
 stubs: {
-  QTablePagination: true,
+  // removed — OTable handles pagination internally
 },
```

### `web/src/components/iam/users/MemberInvitation.spec.js`
17+ assertions of `wrapper.find('.q-input input')` and `wrapper.findComponent('.q-select')`. All FAIL after migration to OInput / OSelect — there is no `.q-input` wrapper, and `.q-select` is not the class OSelect renders.

**Solution:**
```diff
-wrapper.find('.q-input input')
+wrapper.findComponent(OInput).find('input')
-wrapper.findComponent('.q-select')
+wrapper.findComponent(OSelect)
```
Bulk find/replace the 17+ occurrences; import `OInput` and `OSelect` at the top of the spec.

### `web/src/components/iam/roles/AppRoles.spec.ts:458-463` (intentional)
This one is correct — it asserts `.q-dialog` does NOT exist after migration (the test was updated). Mentioned to show that some tests were updated, but most were not.

## Recommendations

Prioritized:

1. **(P0) Fix the runtime crashers:**
   - `ListOrganizations.vue:378-379`: change `props.row.identifier`/`props.row.name` → `row.identifier`/`row.name`.
   - `UpdateRole.vue:133, 166`: remove the dead `.validate()`/`.resetValidation()` calls (the form is gone); execute the API call directly.
   - `User.vue:132-148`, `ServiceAccountsList.vue:147-152`: remove the trailing `v-model="selectedUser"` from `<update-user-role>`, `<add-user>`, `<add-service-account>` — keep only `v-model:open`. Pass the row data via an explicit prop (`:model-value="selectedUser"` if needed) or via the existing watcher reset.
   - `OrganizationManagement.vue:90`: rename icon `tw:block` → `block` (no Tailwind prefix on icon names).
   - `Invitations.vue:18`: replace `tw:h-[100vh-128px]` with `tw:h-[calc(100vh-128px)]`.

2. **(P1) Restore validation UX:**
   - In `AddRole.vue` / `AddGroup.vue`, set `showNameError.value = true` and populate `nameErrorMessage` inside `saveRole`/`saveGroup` when validation fails (before the silent early return).
   - In `AddUser.vue`, surface the toast-based errors inline by passing `:error`/`:error-message` props per-field rather than only `toast()`.

3. **(P1) Refactor selection & dead helpers:**
   - Drop `hideForm`, `_deleteGroup`, `_deleteRole`, `hideAddGroup`, `updateUser`, `toggleExpand`, `fetchUserGroups`, `fetchUserRoles`, `forceCloseRow`, `filterFn` (in AddUser) — none are wired to the new template.
   - Verify OTooltip is correctly placed (it likely needs `<OTooltip><template #trigger>...</template></OTooltip>` or `target` prop) across `OrganizationManagement.vue` and `ServiceAccountsList.vue`.

4. **(P1) Update spec files in lockstep:**
   - Replace q-* stubs with O* stubs in `User.spec.ts`, `InvitationList.spec.ts`, `OrganizationManagement.spec.ts`.
   - Replace selectors `.q-input`, `.q-select`, `.q-splitter`, `.q-dialog` with the corresponding O-component class selectors or use `wrapper.findComponent(OInput)`.
   - `IdentityAccessManagement.spec.ts:475`: assert `OSplitter` presence (not `.q-splitter`).
   - `MemberInvitation.spec.js`: rewrite all `.q-input input` selectors to OInput's actual rendered DOM (`input` or `wrapper.findComponent(OInput).find('input')`).

5. **(P2) Cleanup dead CSS:**
   - Remove `:deep(.q-splitter__before)` rule in `IdentityAccessManagement.vue:280`; if `overflow: visible` is still needed on the sidebar slot, target `OSplitter`'s class.
   - Remove orphaned `.q-table`, `.q-table--dark`, `.q-btn`, `.confirmBody`, `.confirmActions` blocks in `Quota.vue`, `AppGroups.vue`, `PermissionsTable.vue`, `ListOrganizations.vue`, `User.vue`, `InvitationList.vue`.
   - Strip legacy Quasar utilities (`full-width`, `full-height`, `row`, `items-center` without `tw:`, `q-mt-*`, `bg-primary`, `text-positive`, `text-bold`, etc.) from templates — they no longer style anything.

6. **(P2) Performance / Accessibility:**
   - `PermissionsTable.vue`: replace the eager `<div>` render with a virtual scroller (OTable should handle ≥50 rows). On organizations with hundreds of resources, this page now eagerly renders all checkbox rows.
   - `AddUser.vue`: per-field validation via `:error-message` restores screen-reader announcement; current toast-only flow is not accessible.

7. **(P2) URL state hygiene:**
   - When the AddUser/UpdateRole/AddUpdateOrganization drawer closes via Cancel, ensure `router.replace` clears the stale `?action=add|update` query (`User.vue:hideForm` is the right helper but isn't called). Hook this into `@update:open=(v) => !v && hideForm()`.


## Class-Level Styling Audit

### 1. Quasar Class Leftovers
| File:Line | Class | Replacement | Layer |
|---|---|---|---|
| `web/src/components/settings/OrganizationManagement.vue:21` | `q-table__title` | `tw:text-lg tw:font-semibold` | File-scoped |
| `web/src/components/iam/quota/Quota.vue:29` | `q-table__title` | `tw:text-lg tw:font-semibold` | File-scoped |
| `web/src/components/iam/roles/AppRoles.vue:23` | `q-table__title` | `tw:text-lg tw:font-semibold` | File-scoped |
| `web/src/components/iam/organizations/ListOrganizations.vue:26` | `q-table__title` | `tw:text-lg tw:font-semibold` | File-scoped |
| `web/src/components/iam/users/InvitationList.vue:21` | `q-table__title` | `tw:text-lg tw:font-semibold` | File-scoped |
| `web/src/components/iam/users/User.vue:26` | `q-table__title` | `tw:text-lg tw:font-semibold` | File-scoped |
| `web/src/components/iam/groups/AppGroups.vue:23` | `q-table__title` | `tw:text-lg tw:font-semibold` | File-scoped |
| `web/src/components/iam/serviceAccounts/ServiceAccountsList.vue:29` | `q-table__title` | `tw:text-lg tw:font-semibold` | File-scoped |
| `web/src/components/iam/quota/Quota.vue:1681-1699` | `.q-field__inner/__control/__container/__label` (in `<style>`) | Drop / target `OInput` slots | File-scoped |
| `web/src/components/iam/quota/Quota.vue:1735-1769` | `.q-table*` (in `<style>`) | Drop / target `OTable` selectors | File-scoped |
| `web/src/components/iam/quota/Quota.vue:1769,1774` | `.q-placeholder` | Drop (dead) | File-scoped |
| `web/src/components/iam/groups/AppGroups.vue:357-358` | `.q-table--dark .thead-sticky/.tfoot-sticky` | Drop / re-target to dark token | File-scoped |
| `web/src/components/iam/organizations/ListOrganizations.vue:450` | `.q-table` | Drop / target `OTable` | File-scoped |
| `web/src/components/iam/users/User.vue:1043` | `.q-btn` | Drop (`OButton` styling) | File-scoped |
| `web/src/components/iam/users/InvitationList.vue:375` | `.q-btn` | Drop (`OButton` styling) | File-scoped |
| `web/src/components/iam/roles/PermissionsTable.vue:361-368` | `.q-table--bordered/.q-table__card/.q-virtual-scroll__padding` | Drop | File-scoped |

### 2. Bare Quasar Utility Classes
| File:Line | Class | Replacement | Layer |
|---|---|---|---|
| `web/src/components/iam/quota/Quota.vue:111` | `float-right` | `tw:float-right` | File-scoped |
| `web/src/components/iam/roles/PermissionsTable.vue:60` | `relative-position bg-white` | `tw:relative tw:bg-white` | File-scoped |
| `web/src/components/iam/users/AddUser.vue:200` | `bg-primary text-white` | `tw:bg-[var(--o2-primary)] tw:text-white` | File-scoped |
| `web/src/components/iam/serviceAccounts/ServiceAccountsList.vue:25` | `tw:full-width` (invalid Tailwind class) | `tw:w-full` | File-scoped |
| `web/src/components/iam/serviceAccounts/ServiceAccountsList.vue:79` | `text-weight-medium` | `tw:font-medium` | File-scoped |
| `web/src/components/iam/groups/EditGroup.vue:18` | `full-height` | `tw:h-full` | File-scoped |

### 3. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
|---|---|---|---|
| `web/src/components/iam/serviceAccounts/ServiceAccountsList.vue:25` | `tw:full-width` | `tw:w-full` | File-scoped |

### 4. Quasar CSS Variables
*(none found)*

### 5. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
|---|---|---|---|
| `web/src/views/IdentityAccessManagement.vue:280` | `:deep(.q-splitter__before)` | Remove or retarget `OSplitter`'s before class | File-scoped |

### 6. Quasar SCSS Variables in Scoped Styles
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| `web/src/components/iam/organizations/ListOrganizations.vue:452` | `$border-color` | `var(--o2-border-input)` | File-scoped |
| `web/src/components/iam/users/User.vue:1030` | `$dark-page` | `var(--o2-bg-secondary)` | File-scoped |
| `web/src/components/iam/users/InvitationList.vue:362` | `$dark-page` | `var(--o2-bg-secondary)` | File-scoped |

### 7. Quasar Directives
*(none found)*

### 8. Icon Migration
*(none found)*

### 9. Inline `style=` Hot Spots
| File:Line | Inline style | Suggested home |
|---|---|---|
| `web/src/components/iam/organizations/ListOrganizations.vue:20`, `web/src/components/iam/quota/Quota.vue:23`, `web/src/components/iam/users/User.vue:20`, `web/src/components/iam/groups/AppGroups.vue:18`, `web/src/components/iam/roles/AppRoles.vue:18`, `web/src/components/iam/serviceAccounts/ServiceAccountsList.vue:22` | `min-height: inherit; height: calc(100vh - var(--navbar-height))` (6 dupes) | Move to a `.iam-page-shell` partial in `app.scss` |
| `web/src/components/iam/organizations/ListOrganizations.vue:24` | `position: sticky; top: 0; z-index: 1000` | `tw:sticky tw:top-0 tw:z-[1000]` |
| `web/src/components/iam/organizations/ListOrganizations.vue:50`, `web/src/components/iam/groups/AppGroups.vue:50`, `web/src/components/iam/serviceAccounts/ServiceAccountsList.vue:55` | `height: calc(100vh - var(--navbar-height) - 92px)` | Variable in shared partial |
| `web/src/components/iam/quota/Quota.vue:68` | `font-weight: 200; opacity: 0.7` (OIcon) | Tokenized class on OIcon |
| `web/src/components/iam/quota/Quota.vue:102` | `padding: 0px` | `tw:p-0` |
| `web/src/components/iam/quota/Quota.vue:152` | `:style="{ backgroundColor: editTable ? ... : 'transparent' }"` (theme-dependent) | Use CSS var `--color-edit-bg` toggled by `html.dark` |
| `web/src/components/iam/serviceAccounts/ServiceAccountsList.vue:195-199,204` | `padding`, `border-radius`, `font-family`, `flex` (4 sites) | Promote to scoped class `.service-account-token` |
| `web/src/components/iam/groups/EditGroup.vue:24`, `web/src/components/iam/groups/GroupRoles.vue:30`, `web/src/components/iam/groups/GroupServiceAccounts.vue:27`, `web/src/components/iam/groups/GroupUsers.vue:27` | `font-size: 14px/18px` (5 dupes) | `tw:text-sm` / `tw:text-lg` |
| `web/src/components/iam/groups/EditGroup.vue:63` | `z-index: 2` | `tw:z-[2]` |
| `web/src/components/iam/roles/EntityPermissionTable.vue:18` | dynamic `height` + transition | Scoped class `.entity-permission-collapse` |
| `web/src/views/IdentityAccessManagement.vue:9,13` | `height: 100%`, `height: calc(...)` | Shared `.iam-page-shell` |

### 10. Duplicate Style Blocks (candidates for partial)
| Files | Duplicated block | Suggested partial |
|---|---|---|
| `Quota.vue:1735-1769`, `AppGroups.vue:357-358` | `.q-table--dark .thead-sticky / .tfoot-sticky` overrides | One global rule via `html.dark .thead-sticky` in `app.scss` (or delete) |
| `User.vue:1030`, `InvitationList.vue:362` | `color: $dark-page` block | `_iam-list.scss` partial |
| `User.vue:20`, `AppGroups.vue:18`, `AppRoles.vue:18`, `ListOrganizations.vue:20`, `ServiceAccountsList.vue:22`, `Quota.vue:23` | `tw:rounded-md tw:p-0` + viewport-height inline-style | `.iam-page-shell` utility |
| `GroupUsers.vue:21`, `GroupRoles.vue:20`, `GroupServiceAccounts.vue:21` | filter-bar wrapper `card-container tw:flex-shrink-0 ...` | `.iam-filter-bar` partial |

### 11. Layer Summary
- Global (`app.scss`) changes needed: 2 (page-shell utility, list-row color)
- Component-level partial changes: 3 (`_iam-list.scss`, `_iam-page-shell.scss`, `_iam-filter-bar.scss`)
- File-level scoped changes: ~28 (Quasar `.q-*` deletions, bare utility class → `tw:` conversions, inline styles)

