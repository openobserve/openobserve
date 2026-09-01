# Why these patches exist

Both patches fix the **same upstream bug in two different libraries**: a cleanup
function is created but never invoked, so listeners registered at mount survive
unmount. Each orphaned listener holds its component's setup scope and, through a
template ref, the entire detached page tree — so one leaked listener per
navigation retains a whole page.

They are applied by `patch-package` through the `postinstall` script in
`web/package.json`.

---

## Upgrades are allowed — the install fails loudly instead

These packages are **not pinned**. They upgrade normally, including through the
weekly `npm-update` workflow.

`patch-package` binds a patch file to one exact version
(`@tanstack+vue-form+1.33.3.patch` applies to 1.33.3), so any bump invalidates
the patch. That is fine, because `postinstall` runs with:

```
patch-package --error-on-fail --error-on-warn
```

`--error-on-warn` is the important half. Without it, a version bump where the
patch still applies only prints a warning and exits 0 — the patch quietly stops
matching and the leak comes back unnoticed. With it, **any** drift is a non-zero
exit and the install fails.

So when one of these is upgraded:

- `npm ci` fails in the PR's CI checks with a patch-package error naming the
  package. (The `npm-update` workflow itself only runs
  `npm install --package-lock-only`, which skips scripts — the red check appears
  on the PR it opens, not in the workflow.)
- Local installs fail the same way.

**What to do when that happens** — do not just delete the patch to get green:

1. Check whether upstream has released the fix. For `@tanstack/vue-form` that is
   https://github.com/TanStack/form/pull/2364 — once it ships, **delete the
   patch** rather than regenerating it.
2. Otherwise re-apply the change to the new source and run
   `npx patch-package <name>` to regenerate the patch at the new version.
3. Re-verify the leak is actually still fixed (see *Verifying* below). A patch
   can apply cleanly to reorganised upstream code and no longer do anything.

---

## `@tanstack/vue-form`

**Upstream PR:** https://github.com/TanStack/form/pull/2364 — delete this patch
once that lands in a release.

`useForm` does:

```js
onMounted(formApi.mount)
```

`FormApi.mount()` returns a teardown function. Vue — unlike React's
`useEffect` — **ignores a value returned from `onMounted`**, so the teardown is
never called. `mount()` registers three listeners on the module-level
`formEventClient` singleton (`request-form-state`, `request-form-reset`,
`request-form-force-submit`) plus a devtools store subscription, and those live
for the lifetime of the document. The listener closures capture the `FormApi`
and, through `this.options`, the options object the component supplied — so the
component's scope is retained too.

It cannot be worked around in our own code: `useForm` captures `formApi.mount`
**by value** when registering the hook, so wrapping `mount` on the returned
instance afterwards is never seen.

The patch holds the teardown and invokes it from `onUnmounted`. `react-form`
already behaves this way via `useIsomorphicLayoutEffect(formApi.mount, [])`.

**Measured impact:** the Streams route retained **4,051 → 0** DOM nodes per
navigation. It was the worst-affected route in the product, roughly 6× the
dashboard list.

---

## `vue-draggable-next`

The component imports only `onMounted`, registers no unmount hook, and never
calls `.destroy()` on the `Sortable` instance it creates. Sortable keeps every
live instance's element in a module-level `sortables` array, and the component
also sets `targetDomElement.__draggable_component__ = proxy` — so the retained
element walks straight back to the component tree.

The patch destroys the Sortable instance on unmount and deletes the
`__draggable_component__` back-reference.

**Note:** this was one of *two* independent retainers holding the Logs page
tree; the other was monaco's `addCommand` (fixed in
`web/src/components/CodeQueryEditor.vue`). Removing either alone changed the
node count by exactly zero — the count only drops once the last retainer goes.
So do not read "reverting this changed nothing" as evidence it is unnecessary.

---

## Verifying a patch still works

The leak is only visible across real navigations, so unit tests will not catch a
regression here. To check by hand:

1. Build and serve the production bundle (`npx vite build --base=/web/`).
2. Open DevTools → Memory, navigate `Home → Streams → Home` a few times, forcing
   GC before and after.
3. Compare `Memory.getDOMCounters().nodes`. It should be flat; growth of ~1,000+
   nodes per navigation means a patch is no longer doing its job.
