# TanStack Query (Vue Query) — Users CRUD Implementation Guide

A step-by-step guide for introducing [`@tanstack/vue-query`](https://tanstack.com/query/latest/docs/framework/vue/overview)
into the OpenObserve web frontend, using **Users CRUD** as the first pilot module.
TanStack Devtools are enabled as part of this rollout so we can inspect the cache
while migrating.

> **Scope:** This is the reference for the *first* Vue Query integration in the app.
> The Users module is intentionally the pilot — once this pattern is proven, other
> domains (streams, alerts, dashboards…) follow the same recipe.

> **Status: ✅ Implemented** (pilot). Installed `@tanstack/vue-query@^5` and
> `@tanstack/vue-query-devtools@^6` (devDependency). Files touched:
> - [`web/src/main.ts`](../src/main.ts) — `QueryClient` + `VueQueryPlugin` registered, `queryClient` exported.
> - [`web/src/App.vue`](../src/App.vue) — `<VueQueryDevtools>` mounted, gated on `import.meta.env.DEV` (**on in dev now**).
> - [`web/src/composables/iam/useUsers.ts`](../src/composables/iam/useUsers.ts) — new composable: `usersKeys` factory, `usersQuery`, and create / update / updateExistingUser / delete / bulkDelete mutations. Create/update accept an optional `org` (the add-user dialog can target a different org); invalidation always hits the current org's list.
> - [`web/src/components/iam/users/User.vue`](../src/components/iam/users/User.vue) — list now sourced from `usersQuery` (a `watch` on the cached data runs the existing row-normalisation via `applyUsers`); `getOrgMembers()` is now a thin `usersQuery.refetch()` wrapper; single + bulk delete go through `useMutation`.
> - [`web/src/components/iam/users/AddUser.vue`](../src/components/iam/users/AddUser.vue) — **create + edit + add-existing-user** now go through the `useUsers()` mutations (`mutateAsync`), so the list cache is invalidated + refetched automatically.
> - Specs (`User.spec.ts`, `User.spec.js`, `AddUser.spec.js`) updated to provide a test `QueryClient` via `VueQueryPlugin`.
>
> **Full CRUD is now on TanStack Query:** read (`usersQuery`), create/edit
> (`AddUser.vue` → create/update/updateExisting mutations), and delete/bulk-delete
> (`User.vue` → delete mutations). Every mutation invalidates `['users', orgId]`,
> which refetches the list and re-normalises the table via the watch.
>
> **Still on the old path:** `UpdateRole.vue` updates an *org member's role* via
> `organizationsService.update_member_role` (a different domain/endpoint, not the
> users API), so it was left unchanged.
>
> **Cache-first roles (shared list ↔ edit):** the org roles map is cached under
> `['users', orgId, 'roles']` via `ensureAllUserRoles()` (uses
> `queryClient.ensureQueryData` with a 5-min `staleTime`). The **list** fills this
> cache with one batched `getAllUserRoles` call; the **edit dialog** then reuses
> the same entry to populate `custom_role` with **no extra request** — it only
> hits the API (`getAllUserRoles`, or a single-user `getUserRoles` fallback if the
> user isn't in the map) when the cache is missing or stale. Because
> `invalidateUsers()` matches by prefix, any user mutation also invalidates this
> roles entry, so it refetches after an edit.

---

## 1. Current state (before this change)

| Item | Status |
|---|---|
| `@tanstack/vue-query` | ❌ **Not installed** (other `@tanstack/*` packages already exist: `vue-form`, `vue-table`, `vue-virtual`) |
| `QueryClient` / `VueQueryPlugin` | ❌ Not configured anywhere |
| Users service | ✅ [`web/src/services/users.ts`](../src/services/users.ts) — plain axios promise wrappers |
| Users component | ✅ [`web/src/components/iam/users/User.vue`](../src/components/iam/users/User.vue) — calls the service directly, manually re-fetches after every mutation |
| Org identifier | `store.state.selectedOrganization.identifier` |

**Today's data flow** (the pattern we are replacing):

```
User action → axios call → toast → manual getOrgMembers() refetch → mutate usersState.users → rerender
```

Problems: no caching, no request de-duplication, no stale-while-revalidate, manual
loading/error refs everywhere, and every mutation hand-writes a refetch.

**Target data flow:**

```
User action → useMutation → onSuccess: queryClient.invalidateQueries(['users', orgId]) → auto refetch + cache update
```

---

## 2. Install the dependencies

Run from the `web/` directory (all npm commands run from `web/`):

```bash
cd web
npm install @tanstack/vue-query
npm install -D @tanstack/vue-query-devtools
```

- `@tanstack/vue-query` — the core Vue 3 adapter (`useQuery`, `useMutation`, `QueryClient`).
- `@tanstack/vue-query-devtools` — the floating in-app debugger panel. Installed as a
  **devDependency** so it is tree-shaken out of production builds.

> Pin versions to match the repo's Vue 3.5 / Vite 7 setup. Vue Query v5+ is required
> for Vue 3.5. Note the v5 rename: `cacheTime` → `gcTime`, `isLoading` semantics changed
> (use `isPending` for "no data yet").

---

## 3. Register the plugin + QueryClient in `main.ts`

Edit [`web/src/main.ts`](../src/main.ts). The app is currently bootstrapped as:

```typescript
const app = createApp(App);
const router = createRouter(store);

app.use(i18n);
app.use(store).use(router);
```

Add the QueryClient and register the plugin **after** `store`/`router` (the client can
read the store when it is created):

```typescript
import { VueQueryPlugin, QueryClient } from "@tanstack/vue-query";

// ... existing bootstrap ...
const app = createApp(App);
const router = createRouter(store);

// Single shared QueryClient for the whole app.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,   // 5 min — data is "fresh" this long, no refetch
      gcTime: 1000 * 60 * 10,     // 10 min — unused cache entries garbage-collected
      retry: 1,                    // retry failed queries once
      refetchOnWindowFocus: false, // OpenObserve tabs stay open long; avoid surprise refetches
    },
  },
});

app.use(i18n);
app.use(store).use(router);
app.use(VueQueryPlugin, { queryClient });
```

Exporting `queryClient` lets non-component code (e.g. the org-switch handler) call
`queryClient.clear()` / `invalidateQueries` directly.

---

## 4. Enable the TanStack Devtools (debugger)

The devtools mount as a floating panel. Add them **once**, high in the tree — the
project root component is `App.vue`.

Edit [`web/src/App.vue`](../src/App.vue) template:

```vue
<template>
  <!-- existing app root markup -->
  <router-view />

  <!-- TanStack Query debugger — dev only -->
  <VueQueryDevtools v-if="showQueryDevtools" />
</template>

<script setup lang="ts">
import { VueQueryDevtools } from "@tanstack/vue-query-devtools";

// Show only in dev builds. import.meta.env.DEV is true under `npm run dev`.
const showQueryDevtools = import.meta.env.DEV;
</script>
```

> **Turn it on for now:** the request is to keep the debugger visible during this
> rollout. `import.meta.env.DEV` keeps it on for `npm run dev` and off in prod
> builds automatically. If you want it in a specific preview/staging build too,
> gate it on a config flag (e.g. `config.isEnterprise` or a custom env var) instead
> of `import.meta.env.DEV`.

If `App.vue` uses the Options API and you don't want to convert it, register the
component locally and add the same `<VueQueryDevtools>` tag in the template.

After this step, run `npm run dev` and you should see the floating TanStack logo
button (bottom of the screen). Clicking it opens the query cache inspector.

---

## 5. Define query keys and a users composable

Create [`web/src/composables/iam/useUsers.ts`](../src/composables/iam/useUsers.ts).
This is the single place that wraps the users service in Vue Query. Components never
touch `usersService` directly anymore.

**Why a factory for keys?** Every users query/mutation is scoped to the current org.
Centralising the key shape means org-based invalidation is one line and there is no
risk of cross-org cache leaks.

```typescript
// Copyright 2026 OpenObserve Inc.
import { computed } from "vue";
import { useStore } from "vuex";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import usersService from "@/services/users";

// ---- Query key factory (namespaced by org) ----
export const usersKeys = {
  all: (orgId: string) => ["users", orgId] as const,
  detail: (orgId: string, email: string) => ["users", orgId, email] as const,
  roles: (orgId: string) => ["users", orgId, "roles"] as const,
};

const useUsers = () => {
  const store = useStore();
  const queryClient = useQueryClient();

  // Reactive org id — queries re-run automatically when the user switches orgs
  // because the key changes.
  const orgId = computed(() => store.state.selectedOrganization.identifier);

  // ---- READ: list org users ----
  const usersQuery = useQuery({
    // key is reactive; when orgId changes, Vue Query refetches for the new org
    queryKey: computed(() => usersKeys.all(orgId.value)),
    queryFn: async () => {
      const res = await usersService.orgUsers(orgId.value);
      return res.data.data; // unwrap axios + API envelope
    },
    // don't fire until an org is selected
    enabled: computed(() => !!orgId.value),
  });

  // ---- CREATE ----
  const createUser = useMutation({
    mutationFn: (payload: any) => usersService.create(payload, orgId.value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: usersKeys.all(orgId.value) });
    },
  });

  // ---- UPDATE ----
  const updateUser = useMutation({
    mutationFn: ({ email, payload }: { email: string; payload: any }) =>
      usersService.update(payload, orgId.value, email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: usersKeys.all(orgId.value) });
    },
  });

  // ---- DELETE (single) ----
  const deleteUser = useMutation({
    mutationFn: (email: string) => usersService.delete(orgId.value, email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: usersKeys.all(orgId.value) });
    },
  });

  // ---- DELETE (bulk) ----
  const bulkDeleteUsers = useMutation({
    mutationFn: (emails: string[]) =>
      usersService.bulkDelete(orgId.value, { ids: emails }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: usersKeys.all(orgId.value) });
    },
  });

  return {
    // list state
    users: usersQuery.data,
    isLoading: usersQuery.isPending,
    isError: usersQuery.isError,
    error: usersQuery.error,
    refetch: usersQuery.refetch,
    // mutations
    createUser,
    updateUser,
    deleteUser,
    bulkDeleteUsers,
  };
};

export default useUsers;
```

> **Types:** the service currently uses `data: any`. Per the FE rules, avoid `any` in
> new code — define a `User` interface (email, role, first/last name, etc.) in
> `web/src/types/` and type `queryFn`'s return and the mutation payloads. Left as `any`
> above only to mirror the existing service surface; tighten it as part of this work.

---

## 6. Wire the composable into `User.vue`

In [`web/src/components/iam/users/User.vue`](../src/components/iam/users/User.vue),
replace the manual fetch/refetch machinery.

**Before** (illustrative):

```typescript
const getOrgMembers = () => {
  return new Promise((resolve, reject) => {
    usersService.orgUsers(store.state.selectedOrganization.identifier)
      .then((res) => { usersState.users = res.data.data.map(...); rows.value = usersState.users; })
      .catch((err) => { /* toast */ });
  });
};

const deleteUser = async () => {
  usersService.delete(store.state.selectedOrganization.identifier, deleteUserEmail)
    .then(async () => { toast(...); await getOrgMembers(); });
};
```

**After:**

```typescript
import useUsers from "@/composables/iam/useUsers";

const { users, isLoading, isError, createUser, updateUser, deleteUser, bulkDeleteUsers } = useUsers();

// `rows` now derives from the query cache instead of a manual ref
const rows = computed(() => (users.value ?? []).map((data: any) => ({ /* row shape */ })));

// delete — no manual refetch; invalidation in the composable handles it
const onDeleteUser = () => {
  deleteUser.mutate(deleteUserEmail, {
    onSuccess: () => toast({ message: "User deleted successfully." }),
    onError: () => toast({ variant: "error", message: "Failed to delete user." }),
  });
};

// create (from AddUser @updated)
const addMember = (payload: any) => {
  createUser.mutate(payload, {
    onSuccess: () => toast({ message: "User added successfully." }),
  });
};
```

Key changes:

- Delete the `getOrgMembers()` promise helper and every `await getOrgMembers()` after a
  mutation — invalidation refetches automatically.
- `isLoading` / `isError` come from the query; remove the hand-rolled loading refs.
- The child components (`AddUser.vue`, `UpdateUserRole.vue`) can keep emitting `@updated`;
  the parent just calls the corresponding mutation. **Or** migrate them to call the
  composable directly in a later pass.

---

## 7. Invalidate on org switch

When the user changes organization, all `['users', oldOrgId, …]` entries become stale
for the new context. Because the query key includes `orgId` and is reactive, Vue Query
already refetches for the *new* org automatically. To also drop the old org's cached
data, clear it in the org-switch handler (wherever `store.dispatch("setSelectedOrganization", …)`
happens):

```typescript
import { queryClient } from "@/main";

// after switching org
queryClient.removeQueries({ queryKey: ["users"] }); // drop all users caches
```

---

## 8. Verify

```bash
cd web
npm run lint          # ESLint + Prettier autofix
npm run type-check    # vue-tsc, no emit
npm run test:unit -- src/components/iam/users/User.spec.ts --reporter=verbose
```

Manual check with `npm run dev`:

1. Open the Users page → confirm the network tab shows **one** `GET /api/{org}/users`.
2. Navigate away and back within the `staleTime` window → **no** new request (served from cache).
3. Create/delete a user → observe the automatic refetch in the network tab.
4. Open the **TanStack Devtools** panel (floating button) → confirm the
   `["users", "<org>"]` query appears, its status, and that mutations flip it to
   `stale` / `fetching`.
5. Switch org → confirm a fresh fetch for the new org and the old cache is gone.

---

## 9. Testing notes

For unit tests, mount the component inside a `VueQueryPlugin` provider with a test
`QueryClient` (retries off, no cache carry-over between tests):

```typescript
import { VueQueryPlugin, QueryClient } from "@tanstack/vue-query";

const testQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 } },
});

wrapper = mount(User, {
  global: {
    plugins: [store, router, [VueQueryPlugin, { queryClient: testQueryClient }]],
  },
});
```

- Keep mocking `@/services/users` (per the testing rules) — Vue Query just orchestrates
  the calls; the service is still the boundary you mock.
- Use `await flushPromises()` after triggering a mutation to let the invalidation +
  refetch settle before asserting on rows.
- Create a fresh `QueryClient` per test (or `queryClient.clear()` in `afterEach`) so cache
  never leaks between tests.

---

## 10. Rollout checklist

- [ ] `npm install @tanstack/vue-query` + `-D @tanstack/vue-query-devtools`
- [ ] `QueryClient` + `VueQueryPlugin` registered in `main.ts` (exported client)
- [ ] `<VueQueryDevtools>` added to `App.vue`, gated on `import.meta.env.DEV` (**on for now**)
- [ ] `useUsers.ts` composable with `usersKeys` factory (org-scoped keys)
- [ ] `User.vue` migrated: query for list, mutations for create/update/delete/bulk-delete
- [ ] Manual `getOrgMembers()` refetches removed
- [ ] Org-switch clears/invalidates the users cache
- [ ] `User` type defined in `web/src/types/`; `any` removed from new code
- [ ] `npm run lint` + `npm run type-check` clean
- [ ] Unit tests updated to provide a test `QueryClient`
- [ ] License header `// Copyright 2026 OpenObserve Inc.` on all new/changed files

---

### Appendix — Users service method reference

From [`web/src/services/users.ts`](../src/services/users.ts) (methods relevant to CRUD):

| Method | Signature | HTTP |
|---|---|---|
| `orgUsers` | `(org_identifier)` | `GET /api/{org}/users` |
| `list` | `(page_num, page_size, sort_by, desc, name)` | `GET /api/users?…` (paginated) |
| `create` | `(data, org_identifier)` | `POST /api/{org}/users` |
| `update` | `(data, org_identifier, user_email)` | `PUT /api/{org}/users/{email}` |
| `delete` | `(org_identifier, user_email)` | `DELETE /api/{org}/users/{email}` |
| `bulkDelete` | `(org_identifier, { ids })` | `DELETE /api/{org}/users/bulk` |
| `getRoles` | `(org_identifier)` | `GET /api/{org}/users/roles` |
| `getAllUserRoles` | `(orgId)` | `GET /api/{org}/users/roles/all` |

All return an axios `Promise<AxiosResponse>` via the shared `http()` wrapper
([`web/src/services/http.ts`](../src/services/http.ts)), which handles base URL,
`withCredentials`, and 401 token-refresh interceptors.
