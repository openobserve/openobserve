// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * The scope filters must survive a TAB SWITCH, in both directions.
 *
 * Reported: "filter display across tabs is inconsistent, and sometimes it is
 * applied and sometimes not".
 *
 * Both halves are the same defect. Every DBM page seeds its filter refs from
 * `route.query` ONCE, in setup — and `DbmShell`'s `<keep-alive>` means setup
 * runs once per session per tab, not once per visit. `useDbmScopeSync` re-reads
 * the URL on activation for the TIME RANGE only, so:
 *
 *   • A tab visited BEFORE the filter was set keeps its stale (usually empty)
 *     refs forever. Its chips show nothing while the URL says otherwise, and
 *     its next load sends the stale scope — so the same URL renders different
 *     filters depending on which tabs you happened to open first. That is the
 *     "inconsistent display", and the "sometimes applied" is its other face:
 *     a tab NOT yet visited seeds correctly on first mount and looks right,
 *     which is why the bug appears intermittent rather than total.
 *
 *   • Clearing on one tab has the same asymmetry in reverse: the URL loses the
 *     param, but an already-mounted sibling still holds the value.
 *
 * `useDbmScopeFilters` owns the refs for the four event tabs, so the re-seed
 * belongs to it — that is what these tests pin. The three pages with hand-rolled
 * refs are covered by the source scan at the bottom.
 */

import { defineComponent, h, KeepAlive, nextTick } from "vue";
import { createMemoryHistory, createRouter, RouterView, useRoute } from "vue-router";
import { flushPromises, mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "acme" }, zoConfig: {} } }),
}));

// The composable builds chip labels through i18n; the identity stub keeps this
// suite about the SCOPE refs rather than about translation.
vi.mock("@/types/i18n", () => ({ useI18nTyped: () => ({ t: (k: string) => k }) }));

const { useDbmScopeFilters } = await import("@/composables/dbm/useDbmScopeFilters");

/**
 * A page as the real ones are built: it reads `route.query` ONCE at setup and
 * hands it to `useDbmScopeFilters`, and it is held by the shell's keep-alive.
 */
const probe = (name: string) =>
  defineComponent({
    name,
    setup() {
      const route = useRoute();
      const { models, requestParams } = useDbmScopeFilters({
        query: route.query,
        liveQuery: () => route.query,
        options: () => ({ system: ["postgresql", "mysql"], instance: ["postgres"] }),
        apply: () => {},
      });
      return () =>
        h(
          "div",
          { class: "probe" },
          JSON.stringify({
            system: models.system.value,
            instance: models.instance.value,
            sent: requestParams.value,
          }),
        );
    },
  });

/** Both pages behind ONE keep-alive — the shell's real topology. */
const makeApp = async (startQuery: Record<string, string>) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/a", name: "dbmActivity", component: probe("A") },
      { path: "/b", name: "dbmDeadlocks", component: probe("B") },
    ],
  });
  const Shell = defineComponent({
    setup: () => () =>
      h(RouterView, null, {
        default: ({ Component }: { Component: never }) =>
          h(KeepAlive, null, { default: () => (Component ? h(Component) : null) }),
      }),
  });
  router.push({ name: "dbmActivity", query: startQuery });
  await router.isReady();
  const wrapper = mount(Shell, { global: { plugins: [router] } });
  await flushPromises();
  return { router, wrapper };
};

const read = (wrapper: { find: (s: string) => { text: () => string } }) =>
  JSON.parse(wrapper.find(".probe").text());

/** Run a composable inside a real setup(), which `useI18n` requires. */
const inSetup = <T>(fn: () => T): T => {
  let out!: T;
  mount(defineComponent({ setup: () => ((out = fn()), () => null) }));
  return out;
};

describe("useDbmScopeFilters seeds from the URL it is given", () => {
  it("seeds every dimension present in the query", () => {
    const seen = inSetup(() =>
      useDbmScopeFilters({
        query: { system: "postgresql", instance: "postgres", namespace: "public" },
        options: () => ({}),
        apply: () => {},
      }),
    );
    expect(seen.models.system.value).toBe("postgresql");
    expect(seen.models.instance.value).toBe("postgres");
    expect(seen.requestParams.value).toEqual({
      system: "postgresql",
      instance: "postgres",
      namespace: "public",
    });
  });

  it("only sends the dimensions the endpoint accepts", () => {
    const seen = inSetup(() =>
      useDbmScopeFilters({
        query: { system: "postgresql", namespace: "public" },
        dimensions: ["instance", "system"],
        options: () => ({}),
        apply: () => {},
      }),
    );
    expect(seen.requestParams.value, "namespace must not reach Table health").toEqual({
      system: "postgresql",
    });
  });
});

describe("a kept-alive tab re-reads the scope when the reader returns", () => {
  /**
   * THE BUG. Tab B is mounted (and kept alive) while the URL has no filter.
   * The reader goes to tab A, sets `system=postgresql`, and comes back. B's
   * refs are still the ones it seeded on its first setup.
   */
  it("adopts a filter set on a sibling tab while it was cached", async () => {
    const { router, wrapper } = await makeApp({ period: "12h" });

    // Visit B once so it mounts and is retained with an EMPTY scope.
    await router.push({ name: "dbmDeadlocks", query: { period: "12h" } });
    await flushPromises();
    expect(read(wrapper).system, "B starts unfiltered").toBeNull();

    // Back to A, where the reader picks an engine; the URL now carries it.
    await router.push({ name: "dbmActivity", query: { period: "12h" } });
    await flushPromises();

    await router.push({ name: "dbmDeadlocks", query: { period: "12h", system: "postgresql" } });
    await flushPromises();
    await nextTick();

    const state = read(wrapper);
    expect(state.system, "the returning tab must adopt the URL's filter").toBe("postgresql");
    expect(state.sent.system, "and must SEND it, not just display it").toBe("postgresql");
  });

  /** The mirror: a filter CLEARED elsewhere must not linger here. */
  it("drops a filter cleared on a sibling tab while it was cached", async () => {
    const { router, wrapper } = await makeApp({ period: "12h", system: "postgresql" });

    await router.push({
      name: "dbmDeadlocks",
      query: { period: "12h", system: "postgresql" },
    });
    await flushPromises();
    expect(read(wrapper).system).toBe("postgresql");

    await router.push({ name: "dbmActivity", query: { period: "12h", system: "postgresql" } });
    await flushPromises();

    await router.push({ name: "dbmDeadlocks", query: { period: "12h" } });
    await flushPromises();
    await nextTick();

    const state = read(wrapper);
    expect(state.system, "a cleared filter must not linger on a cached tab").toBeNull();
    expect(state.sent.system, "and must not keep narrowing the read").toBeUndefined();
  });
});

describe("useDbmOwnFilterSync re-seeds a page's own refs", () => {
  it("adopts and clears from the live URL on activation", async () => {
    const { ref } = await import("vue");
    const { useDbmOwnFilterSync } = await import("@/composables/dbm/useDbmScopeFilters");

    const systemFilter = ref<string | null>(null);
    let query: Record<string, unknown> = { system: "postgresql" };

    const page = defineComponent({
      name: "OwnRefPage",
      setup() {
        useDbmOwnFilterSync(() => query, { system: systemFilter });
        return () => h("div", String(systemFilter.value));
      },
    });
    const host = defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => h(page) }),
    });

    const wrapper = mount(host);
    await nextTick();
    expect(systemFilter.value, "adopts what the URL says on activation").toBe("postgresql");

    // A sibling tab clears it; this page is re-activated.
    query = {};
    wrapper.unmount();
    const again = mount(host);
    await nextTick();
    expect(systemFilter.value, "a cleared param must clear the ref").toBeNull();
    again.unmount();
  });
});

/**
 * No DBM list page may go back to seeding its scope only in setup.
 *
 * The defect is invisible to types and to any single-page test — it needs two
 * tabs and a keep-alive to show up — so this scan is what keeps a new page (or
 * a refactor of an old one) from silently reintroducing it.
 */
describe("every list page re-reads its scope when the reader returns", () => {
  const viewsDir = join(dirname(fileURLToPath(import.meta.url)), "../../views/DatabaseMonitoring");
  const read = (file: string) => readFileSync(join(viewsDir, file), "utf8");

  /** The four that own their scope through the shared composable. */
  it.each([
    "ActivityPage.vue",
    "DeadlocksPage.vue",
    "BlockedQueriesPage.vue",
    "TableHealthPage.vue",
  ])("%s passes liveQuery to useDbmScopeFilters", (file) => {
    const source = read(file);
    expect(source).toContain("liveQuery: () => route.query");
    // Adopting is only half of it: without a refetch the chip moves and the
    // rows do not, which is the state the screenshots caught.
    expect(source, `${file} must refetch when it adopts a new scope`).toContain(
      "onScopeAdopted: () => void load()",
    );
  });

  /** The three that keep hand-rolled refs. */
  it.each(["DatabasesPage.vue", "QueriesPage.vue", "SamplesPage.vue"])(
    "%s re-seeds its own refs via useDbmOwnFilterSync",
    (file) => {
      const source = read(file);
      // Prettier splits the call across lines once the model map grows, so
      // match the call and its live-query argument rather than one spelling.
      expect(source).toMatch(/useDbmOwnFilterSync\(\s*\(\) => route\.query/);
      // ...and it must RELOAD, or the chip moves while the rows do not.
      expect(source, `${file} must refetch when it adopts a new scope`).toContain(
        "() => void load()",
      );
    },
  );
});

describe("adopting a filter must also refetch under it", () => {
  /**
   * Re-seeding the refs updates the CHIP. It does not, on its own, change the
   * rows: the page's read already happened under the old scope, and the fleet
   * union it built is still in `rows`. That is the state the screenshots
   * caught — a chip reading `engine postgresql` above a table listing MySQL,
   * MariaDB and SQL Server, and the same tab showing 1 row on one visit and 4
   * on the next depending on which scope its last load ran under.
   *
   * So the sync must tell the page the scope moved, and the page must reload.
   */
  it("calls onChange when the URL scope differs from the refs", async () => {
    const { ref } = await import("vue");
    const { useDbmOwnFilterSync } = await import("@/composables/dbm/useDbmScopeFilters");

    const systemFilter = ref<string | null>(null);
    const reloaded = vi.fn();
    const query: Record<string, unknown> = { system: "postgresql" };

    const page = defineComponent({
      setup() {
        useDbmOwnFilterSync(() => query, { system: systemFilter }, reloaded);
        return () => h("div");
      },
    });
    mount(defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => h(page) }) }));
    await nextTick();

    expect(systemFilter.value).toBe("postgresql");
    expect(reloaded, "adopting a new scope must refetch under it").toHaveBeenCalledTimes(1);
  });

  it("does NOT reload when the URL matches what the page already holds", async () => {
    const { ref } = await import("vue");
    const { useDbmOwnFilterSync } = await import("@/composables/dbm/useDbmScopeFilters");

    const systemFilter = ref<string | null>("postgresql");
    const reloaded = vi.fn();
    const query: Record<string, unknown> = { system: "postgresql" };

    const page = defineComponent({
      setup() {
        useDbmOwnFilterSync(() => query, { system: systemFilter }, reloaded);
        return () => h("div");
      },
    });
    mount(defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => h(page) }) }));
    await nextTick();

    // Every tab switch would otherwise refetch — the storm keep-alive exists
    // to prevent.
    expect(reloaded).not.toHaveBeenCalled();
  });

  it("reloads the four composable-driven tabs too", async () => {
    const reloaded = vi.fn();
    const probeWithApply = defineComponent({
      setup() {
        const query: Record<string, unknown> = { system: "mysql" };
        const { models } = useDbmScopeFilters({
          query: {},
          liveQuery: () => query,
          options: () => ({}),
          apply: () => {},
          onScopeAdopted: reloaded,
        });
        return () => h("div", String(models.system.value));
      },
    });
    mount(
      defineComponent({
        setup: () => () => h(KeepAlive, null, { default: () => h(probeWithApply) }),
      }),
    );
    await nextTick();

    expect(reloaded, "an adopted scope must refetch on the event tabs as well").toHaveBeenCalled();
  });
});
