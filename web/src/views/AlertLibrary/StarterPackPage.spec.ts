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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref, shallowRef } from "vue";

import { fakeFlow } from "@/components/starterPacks/starterPackTestFlow";
import { staleSinceText } from "@/composables/starterPacks/usePackHealth";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

import StarterPackPage from "./StarterPackPage.vue";

const fake = vi.hoisted(() => ({
  flow: null as any,
  turn: null as any,
  updates: null as any,
  repair: null as any,
  packsOn: false,
  packId: "kubernetes",
  query: {} as Record<string, string>,
  push: null as any,
  replace: null as any,
  streams: [] as unknown[],
  replies: {} as Record<string, unknown>,
  snapshots: {} as Record<string, unknown>,
  toast: vi.fn(),
}));

vi.mock("@/constants/starterPacks", () => ({
  get STARTER_PACKS_ENABLED() {
    return fake.packsOn;
  },
}));
vi.mock("@/composables/starterPacks/useStarterPacks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/starterPacks/useStarterPacks")>()),
  useStarterPacks: () => ({
    readSnapshot: vi.fn(async (_pack: unknown, item: { itemId: string }) => {
      const found = fake.snapshots[item.itemId];
      if (found instanceof Error) throw found;
      return found ?? null;
    }),
    appendToInstall: vi.fn(async () => ({})),
  }),
}));
vi.mock("vue-router", () => ({
  useRoute: () => ({ query: fake.query, params: { pack: fake.packId } }),
  useRouter: () => ({
    push: fake.push,
    replace: fake.replace,
    resolve: () => ({ href: "/web/x" }),
  }),
}));
vi.mock("@/composables/starterPacks/useStarterPackFlow", () => ({
  useStarterPackFlow: () => fake.flow,
}));
vi.mock("@/composables/starterPacks/useTurnOnAlerts", () => ({
  useTurnOnAlerts: () => fake.turn,
}));
vi.mock("@/composables/starterPacks/usePackUpdates", () => ({
  usePackUpdates: () => fake.updates,
}));
vi.mock("@/composables/starterPacks/useRepairLater", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/starterPacks/useRepairLater")>()),
  useRepairLater: () => fake.repair,
}));
vi.mock("@/composables/starterPacks/useStarterPackMatcher", () => ({
  useStarterPackMatcher: () => ({ clusters: ref([]), check: vi.fn() }),
}));
vi.mock("@/composables/starterPacks/usePackHealth", async (importOriginal) => {
  const { shallowRef: vueShallowRef, ref: vueRef } = await import("vue");
  return {
    ...(await importOriginal<typeof import("@/composables/starterPacks/usePackHealth")>()),
    usePackHealth: () => {
      const streams = vueShallowRef<unknown[]>([]);
      return {
        staleStreams: vueRef(new Set()),
        staleSince: vueRef(null),
        streams,
        check: vi.fn(),
        checkStreams: vi.fn(async () => {
          streams.value = fake.streams;
        }),
      };
    },
  };
});
vi.mock("@/composables/alerts/useAlertLibrary", () => ({
  useAlertLibrary: () => ({ loadManifest: vi.fn(async () => ({ alerts: [] })) }),
}));
vi.mock("@/services/alerts.queries", () => ({
  alertHistoryQuery: () => ({ kind: "history" }),
  firingAlertsQuery: () => ({ kind: "firing" }),
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: fake.toast }));
vi.mock("@/composables/query/readQuery", () => ({
  readQuery: vi.fn(async (query: { kind?: string }) =>
    query?.kind ? (fake.replies[query.kind] ?? null) : [{ name: "Team folder" }],
  ),
}));

const t = i18n.global.t as (...args: unknown[]) => string;

const row = (id: string, enabled: boolean, over: Record<string, unknown> = {}) => ({
  id,
  folderId: "f1",
  name: `alert_${id}`,
  severity: "warning",
  enabled,
  alert: { stream_name: "kube_pod_info", stream_type: "metrics", destinations: ["chat"] },
  ...over,
});
const recordItem = (kind: string, itemId: string, over: Record<string, unknown> = {}) => ({
  kind,
  itemId,
  status: "created",
  id: `${itemId}-id`,
  folderId: "f1",
  ...over,
});
const installedRecord = (items: unknown[] = [], over: Record<string, unknown> = {}) => ({
  packId: "kubernetes",
  installId: "i1",
  status: "complete",
  installedBy: "a@example.com",
  installedAt: 1,
  version: "1.0.0",
  items: [
    { kind: "folder", itemId: "alerts", status: "created", id: "alerts-folder" },
    recordItem("alert", "k8s/a", { id: "a" }),
    recordItem("dashboard", "overview"),
    recordItem("savedView", "v1"),
    ...items,
  ],
  ...over,
});

const PASS = { template: "<div><slot /></div>" };
const OTableStub = {
  props: ["data", "columns", "rowSection"],
  emits: ["row-click"],
  template: `<div>
    <slot name="toolbar" /><slot name="toolbar-trailing" />
    <template v-for="(row, index) in data" :key="index">
      <slot v-if="rowSection && (index === 0 || rowSection(data[index - 1]) !== rowSection(row))" name="group-header" :section-key="rowSection(row)" />
      <div data-test="table-row" @click="$emit('row-click', row)">
        <div v-for="col in columns" :key="col.id"><slot :name="'cell-' + col.id" :row="row" /></div>
      </div>
    </template>
    <slot v-if="!data.length" name="empty" />
  </div>`,
};

const render = async () => {
  const wrapper = mount(StarterPackPage, {
    global: {
      plugins: [i18n, store],
      stubs: {
        OPageLayout: {
          props: ["title", "back"],
          template:
            "<div><span data-test='layout-title'>{{ title }}</span><a data-test='layout-back' :data-to='back?.to?.name' :data-org='back?.to?.query?.org_identifier' /><slot name='title' /><slot name='subtitle' /><slot name='title-trail' /><slot name='actions' /><slot /></div>",
        },
        OTable: OTableStub,
        OTabPanels: PASS,
        OTabPanel: PASS,
        ODropdown: { template: "<div><slot name='trigger' /><slot /></div>" },
        ODropdownItem: {
          emits: ["select"],
          template: "<button @click=\"$emit('select')\"><slot /></button>",
        },
        ShareButton: { template: "<button data-test='starter-pack-page-share-btn' />" },
        FitItems: {
          props: ["items"],
          template: "<span><span v-for='item in items' :key='item'>{{ item }}</span></span>",
        },
        StarterPackDrawer: true,
        StarterPackUndoDialog: true,
        StarterPackUpdateDrawer: true,
        StarterPackRepairPanel: true,
        TurnOnAlertsDrawer: true,
        LibraryDrawer: true,
        ODrawer: true,
        OIcon: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
};
const has = (wrapper: any, id: string) => wrapper.find(`[data-test="${id}"]`).exists();
const text = (wrapper: any, id: string) => wrapper.get(`[data-test="${id}"]`).text();

describe("StarterPackPage", () => {
  beforeEach(() => {
    fake.packsOn = false;
    fake.packId = "kubernetes";
    fake.query = { org_identifier: "org" };
    fake.push = vi.fn(async () => undefined);
    fake.replace = vi.fn(async () => undefined);
    fake.streams = [{ name: "kube_pod_info", type: "metrics", state: "receiving", lastUs: 1 }];
    fake.replies = {};
    fake.snapshots = {
      overview: {
        title: "Kubernetes Overview",
        description: "Cluster use",
        tabs: [{ panels: [{}, {}] }],
      },
      v1: { view_name: "Kubernetes events" },
    };
    fake.toast.mockClear();
    fake.flow = fakeFlow({
      record: shallowRef(installedRecord()),
      items: computed(() => fake.flow.record.value.items.filter((i: any) => i.kind !== "folder")),
      failed: computed(() =>
        fake.flow.record.value.items.filter((i: any) => i.status === "failed"),
      ),
      canUndo: ref(false),
    });
    fake.turn = {
      rows: shallowRef([row("a", false), row("b", true)]),
      loadState: ref("ready"),
      load: vi.fn(),
      forbidden: ref(false),
    };
    fake.updates = {
      available: ref(false),
      canRevert: ref(false),
      needsDashboard: ref(false),
      state: ref("idle"),
      check: vi.fn(),
      revert: vi.fn(),
      addDashboard: vi.fn(),
    };
    fake.repair = {
      issue: shallowRef(null),
      undoable: shallowRef(null),
      busy: ref(false),
      failed: ref(false),
      check: vi.fn(),
      apply: vi.fn(),
      undo: vi.fn(),
    };
  });

  describe("header", () => {
    it("shows the pack name with a back link to Starter Packs", async () => {
      const wrapper = await render();
      expect(text(wrapper, "layout-title")).toBe("Kubernetes");
      const back = wrapper.get('[data-test="layout-back"]');
      expect(back.attributes("data-to")).toBe("starterPacks");
      expect(back.attributes("data-org")).toBe("org");
    });

    it("offers Remove, Turn on, Share and More while alerts are paused", async () => {
      const wrapper = await render();
      expect(text(wrapper, "starter-pack-page-turn-on-btn")).toBe(
        t("starterPacks.turnOn.submit", { count: 1 }, 1),
      );
      for (const id of ["remove-btn", "share-btn", "more-btn"])
        expect(has(wrapper, `starter-pack-page-${id}`)).toBe(true);
      expect(has(wrapper, "starter-pack-page-update-btn")).toBe(false);
      expect(has(wrapper, "starter-pack-page-pack-details-btn")).toBe(false);
    });

    it("drops Turn on once every alert is active", async () => {
      fake.turn.rows.value = [row("a", true)];
      expect(has(await render(), "starter-pack-page-turn-on-btn")).toBe(false);
    });

    it("leaves a view-only user with Share alone", async () => {
      fake.flow.canManage.value = false;
      const wrapper = await render();
      expect(has(wrapper, "starter-pack-page-share-btn")).toBe(true);
      for (const id of ["remove-btn", "turn-on-btn", "more-btn"])
        expect(has(wrapper, `starter-pack-page-${id}`)).toBe(false);
      expect(text(wrapper, "starter-pack-page-status")).toBe(
        t("starterPacks.page.status.viewOnly"),
      );
    });

    it("shows Review update and the Update available tag beside the status", async () => {
      fake.packsOn = true;
      fake.updates.available.value = true;
      const wrapper = await render();
      expect(has(wrapper, "starter-pack-page-update-btn")).toBe(true);
      expect(has(wrapper, "starter-pack-page-update-tag")).toBe(true);
      expect(text(wrapper, "starter-pack-page-status")).toBe(t("starterPacks.page.status.ready"));
    });

    it("hides the Update available tag from a view-only user, who cannot review it", async () => {
      fake.packsOn = true;
      fake.updates.available.value = true;
      fake.flow.canManage.value = false;
      const wrapper = await render();
      expect(has(wrapper, "starter-pack-page-update-tag")).toBe(false);
      expect(fake.updates.check).not.toHaveBeenCalled();
    });

    it("keeps Undo setup and Revert update in the More menu", async () => {
      fake.packsOn = true;
      fake.flow.canUndo.value = true;
      fake.updates.canRevert.value = true;
      const wrapper = await render();
      expect(has(wrapper, "starter-pack-page-more-undo")).toBe(true);
      await wrapper.get('[data-test="starter-pack-page-revert-btn"]').trigger("click");
      expect(fake.updates.revert).toHaveBeenCalled();
    });
  });

  describe("status tag", () => {
    it("reads Ready while alerts are only paused", async () => {
      expect(text(await render(), "starter-pack-page-status")).toBe(
        t("starterPacks.page.status.ready"),
      );
    });

    it("reads Firing when a pack alert fires now", async () => {
      fake.replies.firing = { list: [{ alert_id: "b", enabled: true, last_outcome: "firing" }] };
      expect(text(await render(), "starter-pack-page-status")).toBe(
        t("starterPacks.page.status.firing"),
      );
    });

    it("reads Needs attention when a stream never received data", async () => {
      fake.streams = [{ name: "kube_pod_info", type: "metrics", state: "never", lastUs: null }];
      expect(text(await render(), "starter-pack-page-status")).toBe(
        t("starterPacks.page.status.attention"),
      );
    });
  });

  describe("notices", () => {
    it("puts the partly failed error ahead of the paused warning", async () => {
      fake.flow.record.value = installedRecord([
        recordItem("alert", "k8s/c", { status: "failed", id: undefined }),
      ]);
      const wrapper = await render();
      expect(has(wrapper, "starter-pack-page-notice-failed")).toBe(true);
      expect(has(wrapper, "starter-pack-page-notice-paused")).toBe(false);
      expect(text(wrapper, "starter-pack-page-notice-failed")).toContain("1 of 4 items");
      expect(text(wrapper, "starter-pack-page-status")).toBe(
        t("starterPacks.page.status.attention"),
      );
    });

    it("explains paused alerts with no button of its own", async () => {
      const wrapper = await render();
      const notice = wrapper.get('[data-test="starter-pack-page-notice-paused"]');
      expect(notice.text()).toContain("1 alert is paused");
      expect(notice.text()).toContain("CPU, memory or pods");
      expect(has(wrapper, "starter-pack-page-notice-paused-action")).toBe(false);
    });

    it("says a stream stopped and points at the collector", async () => {
      fake.turn.rows.value = [row("a", true)];
      fake.streams = [{ name: "kube_pod_info", type: "metrics", state: "stopped", lastUs: 5 }];
      const wrapper = await render();
      expect(text(wrapper, "starter-pack-page-notice-stopped")).toContain("kube_pod_info");
      await wrapper.get('[data-test="starter-pack-page-notice-stopped-action"]').trigger("click");
      expect(fake.push).toHaveBeenCalledWith({
        name: "ingestFromKubernetes",
        query: { org_identifier: "org" },
      });
    });

    it("names the longest-stopped stream, counts the rest and dates it from the oldest", async () => {
      fake.turn.rows.value = [row("a", true)];
      const oldest = Date.UTC(2026, 10, 9, 8, 0) * 1000;
      const recent = Date.UTC(2026, 10, 14, 10, 59) * 1000;
      fake.streams = [
        { name: "kube_pod_info", type: "metrics", state: "stopped", lastUs: recent },
        { name: "k8s_events", type: "logs", state: "stopped", lastUs: oldest },
        { name: "kube_node_info", type: "metrics", state: "stopped", lastUs: recent },
      ];
      const notice = text(await render(), "starter-pack-page-notice-stopped");
      expect(notice).toContain(
        t(
          "starterPacks.page.notice.stoppedMore",
          { stream: "k8s_events", count: 2, since: staleSinceText(oldest) },
          2,
        ),
      );
    });
  });

  describe("summary strip", () => {
    it("counts active alerts out of all, with the paused ones as the sub", async () => {
      const tile = text(await render(), "starter-pack-page-tile-alerts");
      expect(tile).toContain("1 / 2");
      expect(tile).toContain(t("starterPacks.page.strip.paused", { count: 1 }));
    });

    it("says None in this pack when the install made no alerts", async () => {
      fake.turn.rows.value = [];
      const tile = text(await render(), "starter-pack-page-tile-alerts");
      expect(tile).toContain(t("starterPacks.page.strip.none"));
    });

    it("names the longest-stopped stream in the Streams tile", async () => {
      const oldest = Date.UTC(2026, 10, 9, 8, 0) * 1000;
      fake.streams = [
        { name: "kube_pod_info", type: "metrics", state: "receiving", lastUs: Date.now() * 1000 },
        { name: "k8s_events", type: "logs", state: "stopped", lastUs: oldest },
      ];
      expect(text(await render(), "starter-pack-page-tile-streams")).toContain(
        t("starterPacks.page.strip.stoppedSince", {
          stream: "k8s_events",
          since: staleSinceText(oldest),
        }),
      );
    });

    it("counts the streams receiving data", async () => {
      fake.streams = [
        { name: "kube_pod_info", type: "metrics", state: "receiving", lastUs: 1 },
        { name: "k8s_events", type: "logs", state: "unknown", lastUs: null },
      ];
      expect(text(await render(), "starter-pack-page-tile-streams")).toContain("1 / 2");
    });
  });

  describe("contents", () => {
    it("groups the items by type with links to the real lists", async () => {
      const wrapper = await render();
      for (const kind of ["alert", "dashboard", "savedView"])
        expect(has(wrapper, `starter-pack-page-group-${kind}`)).toBe(true);
      expect(has(wrapper, "starter-pack-page-open-in-alerts")).toBe(true);
      expect(has(wrapper, "starter-pack-page-open-in-dashboards")).toBe(true);
      const names = wrapper
        .findAll('[data-test="starter-pack-page-row-name"]')
        .map((n) => n.text());
      expect(names).toEqual(["alert_a", "alert_b", "Kubernetes Overview", "Kubernetes events"]);
    });

    it("sorts a firing alert first in its group", async () => {
      fake.turn.rows.value = [row("a", true), row("b", true)];
      fake.replies.firing = { list: [{ alert_id: "b", enabled: true, last_outcome: "firing" }] };
      const wrapper = await render();
      const first = wrapper.findAll('[data-test="starter-pack-page-row-name"]')[0];
      expect(first.text()).toBe("alert_b");
      expect(has(wrapper, "starter-pack-page-state-firing")).toBe(true);
    });

    it("filters by search and offers to clear an empty result", async () => {
      const wrapper = await render();
      await wrapper.get('[data-test="starter-pack-page-search"] input').setValue("nothing-matches");
      await flushPromises();
      expect(wrapper.findAll('[data-test="starter-pack-page-row-name"]')).toHaveLength(0);
      expect(text(wrapper, "starter-pack-page-contents-empty")).toContain("nothing-matches");
    });

    it("shows only one type when the toggle picks it", async () => {
      const wrapper = await render();
      const toggle = wrapper.findComponent({ name: "OToggleGroup" });
      toggle.vm.$emit("update:modelValue", "dashboard");
      await flushPromises();
      const names = wrapper
        .findAll('[data-test="starter-pack-page-row-name"]')
        .map((n) => n.text());
      expect(names).toEqual(["Kubernetes Overview"]);
    });

    it("marks an item edited since setup and one still as installed", async () => {
      fake.flow.record.value = installedRecord();
      fake.flow.record.value.items[2].sourceHash = "not-the-current-hash";
      const wrapper = await render();
      expect(has(wrapper, "starter-pack-page-row-edited")).toBe(true);
    });

    it("says Couldn't check when a body read fails, unlike a deleted item", async () => {
      fake.snapshots.overview = new Error("boom");
      fake.snapshots.v1 = null;
      const wrapper = await render();
      expect(wrapper.findAll('[data-test="starter-pack-page-row-read-failed"]')).toHaveLength(1);
    });

    it("opens the item drawer on a row click", async () => {
      const wrapper = await render();
      await wrapper.findAll('[data-test="table-row"]')[2].trigger("click");
      await flushPromises();
      const drawer = wrapper.findComponent({ name: "StarterPackItemDrawer" });
      expect(drawer.props("open")).toBe(true);
      expect(drawer.props("row")).toMatchObject({ kind: "dashboard", panels: 2 });
    });

    it("opens an alert row in the Library drawer in installed mode", async () => {
      const wrapper = await render();
      await wrapper.findAll('[data-test="table-row"]')[0].trigger("click");
      await flushPromises();
      expect(wrapper.findComponent({ name: "LibraryDrawer" }).attributes("installed")).toBe("true");
    });

    it("says the alert's data is unchecked when its stream read failed or has no health yet", async () => {
      fake.streams = [{ name: "kube_pod_info", type: "metrics", state: "unknown", lastUs: null }];
      let wrapper = await render();
      await wrapper.findAll('[data-test="table-row"]')[0].trigger("click");
      await flushPromises();
      expect(wrapper.findComponent({ name: "LibraryDrawer" }).props("dataState")).toBe("unknown");
      fake.streams = [];
      wrapper = await render();
      await wrapper.findAll('[data-test="table-row"]')[0].trigger("click");
      await flushPromises();
      const drawer = wrapper.findComponent({ name: "LibraryDrawer" });
      expect(drawer.props("dataState")).toBe("unknown");
      expect(drawer.props("subtitle")).toBe("k8s/a · Kubernetes · Kubernetes pack");
    });
  });

  describe("streams and fields", () => {
    it("lists never received and couldn't check streams in their own words", async () => {
      fake.streams = [
        { name: "kube_pod_info", type: "metrics", state: "never", lastUs: null },
        { name: "k8s_events", type: "logs", state: "unknown", lastUs: null },
      ];
      const wrapper = await render();
      expect(text(wrapper, "starter-pack-page-stream-state-never")).toBe(
        t("starterPacks.page.streams.never"),
      );
      expect(text(wrapper, "starter-pack-page-stream-state-unknown")).toBe(
        t("starterPacks.page.streams.unknown"),
      );
    });

    it("maps each renamed field once with every stream it holds in", async () => {
      fake.flow.record.value = installedRecord([], {
        bindings: [
          { stream: "s1", from: "k8s_node_name", to: "node", tier: "alias" },
          { stream: "s2", from: "k8s_node_name", to: "node", tier: "alias" },
          { stream: "s1", from: "message", to: "body_note", tier: "chosen" },
        ],
      });
      const wrapper = await render();
      expect(wrapper.findAll('[data-test^="starter-pack-page-field-tier-"]')).toHaveLength(2);
      expect(has(wrapper, "starter-pack-page-field-tier-chosen")).toBe(true);
    });

    it("shows Change disabled with the reason once the pack is set up", async () => {
      fake.flow.record.value = installedRecord([], {
        bindings: [{ stream: "s1", from: "k8s_node_name", to: "node", tier: "alias" }],
      });
      const wrapper = await render();
      expect(
        wrapper.get('[data-test="starter-pack-page-field-change"]').attributes(),
      ).toHaveProperty("aria-disabled");
      expect(text(wrapper, "starter-pack-page-field-locked")).toBe(
        t("starterPacks.page.fields.lockedHelp"),
      );
    });

    it("shows no Change to a view-only user", async () => {
      fake.flow.canManage.value = false;
      fake.flow.record.value = installedRecord([], {
        bindings: [{ stream: "s1", from: "k8s_node_name", to: "node", tier: "alias" }],
      });
      const wrapper = await render();
      expect(has(wrapper, "starter-pack-page-field-change")).toBe(false);
      expect(has(wrapper, "starter-pack-page-field-locked")).toBe(false);
    });

    it("says nothing was renamed when the data uses the pack's names", async () => {
      expect(text(await render(), "starter-pack-page-field-empty")).toBe(
        t("starterPacks.page.fields.empty"),
      );
    });
  });

  describe("about", () => {
    it("counts what the install made, not what setup would still make", async () => {
      expect(text(await render(), "starter-pack-page-about-adds")).toContain(
        "1 dashboard, 2 alerts, 1 saved view",
      );
    });

    it("counts every pack alert in the cost, paused ones too", async () => {
      fake.turn.rows.value = [row("a", false)];
      const wrapper = await render();
      expect(text(wrapper, "starter-pack-page-about")).toMatch(
        /About [\d,]+ background queries a day/,
      );
      expect(text(wrapper, "starter-pack-page-about")).not.toContain("About 0 ");
    });
  });

  describe("not set up", () => {
    const realFetch = globalThis.fetch;
    beforeEach(() => {
      globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404 })) as never;
      fake.flow.record.value = null;
      fake.flow.preview.value = {
        items: [{ kind: "alert", itemId: "k8s/a", status: "pending" }],
        names: { "k8s/a": "Alert A" },
        notIncluded: [],
        bindings: [],
        questions: [],
        flavours: {},
        repairs: [],
      };
    });
    // unstubAllGlobals would also drop the setup file's ResizeObserver stub.
    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    // The pack's dashboard JSON loads by dynamic import, which takes more than a microtask flush.
    const renderSettled = async () => {
      const wrapper = await render();
      await vi.waitFor(() => expect(has(wrapper, "starter-pack-page-loading")).toBe(false));
      return wrapper;
    };

    it("offers Set up next to the folder choice, with an info notice", async () => {
      fake.flow.isAdmin.value = true;
      const wrapper = await renderSettled();
      expect(has(wrapper, "starter-pack-page-setup-btn")).toBe(true);
      expect(
        wrapper.findComponent('[data-test="starter-pack-page-setup-btn"]').props("iconLeft"),
      ).toBe("add");
      expect(has(wrapper, "starter-pack-page-folder-select")).toBe(true);
      expect(has(wrapper, "starter-pack-page-remove-btn")).toBe(false);
      expect(has(wrapper, "starter-pack-page-notice-not-set-up")).toBe(true);
      expect(text(wrapper, "starter-pack-page-status")).toBe(
        t("starterPacks.page.status.notSetUp"),
      );
      expect(has(wrapper, "starter-pack-page-state-willBeCreated")).toBe(true);
    });

    it("lets an admin change a field before setup", async () => {
      fake.flow.isAdmin.value = true;
      fake.flow.preview.value = {
        ...fake.flow.preview.value,
        bindings: [{ stream: "s1", from: "k8s_node_name", to: "node", tier: "alias" }],
      };
      const wrapper = await renderSettled();
      expect(
        wrapper.get('[data-test="starter-pack-page-field-change"]').attributes(),
      ).not.toHaveProperty("aria-disabled");
      expect(has(wrapper, "starter-pack-page-field-locked")).toBe(false);
    });

    it("disables Set up for someone who cannot manage packs", async () => {
      fake.flow.isAdmin.value = false;
      const wrapper = await renderSettled();
      expect(wrapper.get('[data-test="starter-pack-page-setup-btn"]').attributes()).toHaveProperty(
        "aria-disabled",
      );
    });
  });

  it("holds the status, notices and rows as skeletons until the first load ends", async () => {
    let finish = () => {};
    fake.turn.load = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const wrapper = await render();
    expect(has(wrapper, "starter-pack-page-loading")).toBe(true);
    expect(has(wrapper, "starter-pack-page-status")).toBe(false);
    expect(has(wrapper, "starter-pack-page-notice-paused")).toBe(false);
    finish();
    await flushPromises();
    expect(has(wrapper, "starter-pack-page-loading")).toBe(false);
    expect(has(wrapper, "starter-pack-page-status")).toBe(true);
  });

  it("names a mistyped pack instead of showing another one", async () => {
    fake.packId = "kubernetez";
    const wrapper = await render();
    expect(text(wrapper, "starter-pack-page-not-found")).toContain("kubernetez");
    expect(has(wrapper, "starter-pack-page-not-found-icon")).toBe(true);
    expect(has(wrapper, "starter-pack-page-tabs")).toBe(false);
  });

  it("shows the load error with a retry", async () => {
    fake.flow.loadFailed.value = true;
    expect(has(await render(), "starter-pack-page-error")).toBe(true);
  });

  it("says so when a change is refused mid-action, then goes view only", async () => {
    const wrapper = await render();
    fake.turn.forbidden.value = true;
    await flushPromises();
    expect(fake.toast).toHaveBeenCalledWith({
      variant: "error",
      message: t("starterPacks.page.forbidden"),
    });
    expect(text(wrapper, "starter-pack-page-status")).toBe(t("starterPacks.page.status.viewOnly"));
  });
});
