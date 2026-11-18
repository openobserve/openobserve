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
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

import StarterPackPage from "./StarterPackPage.vue";

const fake = vi.hoisted(() => ({
  flow: null as any,
  turn: null as any,
  isEnterprise: "false",
  isCloud: "false",
  packsOn: false,
  packs: null as any,
  query: {} as Record<string, string>,
  push: null as any,
  replace: null as any,
  stale: null as number | null,
  staleStreams: new Set<string>(),
  replies: {} as Record<string, unknown>,
  toast: vi.fn(),
}));

vi.mock("@/constants/starterPacks", () => ({
  get STARTER_PACKS_ENABLED() {
    return fake.packsOn;
  },
}));
vi.mock("@/composables/starterPacks/useStarterPacks", () => ({
  useStarterPacks: () => fake.packs,
}));
vi.mock("@/aws-exports", () => ({
  default: {
    get isEnterprise() {
      return fake.isEnterprise;
    },
    get isCloud() {
      return fake.isCloud;
    },
  },
}));
vi.mock("vue-router", () => ({
  useRoute: () => ({ query: fake.query, params: { pack: "kubernetes" } }),
  useRouter: () => ({ push: fake.push, replace: fake.replace }),
}));
vi.mock("@/composables/starterPacks/useStarterPackFlow", () => ({
  useStarterPackFlow: () => fake.flow,
}));
vi.mock("@/composables/starterPacks/useTurnOnAlerts", () => ({
  useTurnOnAlerts: () => fake.turn,
}));
vi.mock("@/composables/starterPacks/useStarterPackMatcher", () => ({
  useStarterPackMatcher: () => ({ clusters: ref(["eu"]), check: vi.fn() }),
}));
vi.mock("@/composables/starterPacks/usePackHealth", async (importOriginal) => {
  const { ref: vueRef } = await import("vue");
  return {
    ...(await importOriginal<typeof import("@/composables/starterPacks/usePackHealth")>()),
    usePackHealth: () => ({
      staleStreams: vueRef(fake.staleStreams),
      staleSince: vueRef(fake.stale),
      check: vi.fn(),
    }),
  };
});
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

const row = (enabled: boolean, over: Record<string, unknown> = {}) => ({
  id: "a",
  name: "Alert a",
  severity: "warning",
  enabled,
  alert: {
    stream_name: "s",
    stream_type: "metrics",
    destinations: ["chat"],
    trigger_condition: { frequency: 5, period: 5, operator: ">=", threshold: 85 },
  },
  ...over,
});

const CELLS = ["name", "state", "threshold", "fired", "actions"];
const render = async () => {
  const wrapper = mount(StarterPackPage, {
    global: {
      plugins: [i18n, store],
      stubs: {
        OPageLayout: {
          template:
            "<div><slot name='title-prefix' /><slot name='subtitle' /><slot name='title-trail' /><slot name='actions' /><slot /></div>",
        },
        OTable: {
          props: ["data"],
          data: () => ({ cells: CELLS }),
          template: `<div><div v-for="row in data" :key="row.id" data-test="row"><div v-for="cell in cells" :key="cell" :data-test="'cell-' + cell"><slot :name="'cell-' + cell" :row="row" /></div></div><slot v-if="!data.length" name="empty" /></div>`,
        },
        StarterPackDrawer: true,
        StarterPackDetailsDrawer: true,
        StarterPackUndoDialog: true,
        StarterPackFindMore: true,
        StarterPackRepairChip: true,
        TurnOnAlertsDrawer: true,
        QuickMuteDialog: true,
        OIcon: true,
        ODrawer: {
          props: ["open"],
          template: "<div v-if='open'><slot /><slot name='footer' /></div>",
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
};
const has = (wrapper: any, id: string) => wrapper.find(`[data-test="${id}"]`).exists();
const text = (wrapper: any, id: string) => wrapper.get(`[data-test="${id}"]`).text();
const turnOnDrawer = (wrapper: any) => wrapper.findComponent({ name: "TurnOnAlertsDrawer" });

describe("StarterPackPage", () => {
  const zoConfig = store.state.zoConfig;

  beforeEach(() => {
    fake.isEnterprise = "false";
    fake.isCloud = "false";
    fake.packsOn = false;
    fake.query = { org_identifier: "org" };
    fake.push = vi.fn(async () => undefined);
    fake.replace = vi.fn(async () => undefined);
    fake.stale = null;
    fake.staleStreams = new Set();
    fake.replies = {};
    fake.toast.mockClear();
    fake.packs = {
      checkUpdates: vi.fn(async () => []),
      applyUpdates: vi.fn(async () => undefined),
      revertUpdates: vi.fn(async () => undefined),
      appendToInstall: vi.fn(async () => undefined),
    };
    fake.flow = fakeFlow({ record: shallowRef({ items: [], installedBy: "a@example.com" }) });
    fake.turn = {
      rows: shallowRef([row(true)]),
      loadState: ref("ready"),
      load: vi.fn(),
      forbidden: ref(false),
      setThreshold: vi.fn(),
      turnOff: vi.fn(),
      chosenRows: computed(() => []),
    };
  });
  afterEach(() => {
    store.state.zoConfig = zoConfig;
  });

  describe("header", () => {
    it("goes back to Starter Packs from the breadcrumb", async () => {
      const wrapper = await render();
      await wrapper.get('[data-test="starter-pack-page-back"]').trigger("click");
      expect(fake.push).toHaveBeenCalledWith({
        name: "starterPacks",
        query: { org_identifier: "org" },
      });
    });

    it("shows how many alerts are off in the chip and offers Turn on", async () => {
      fake.turn.rows.value = [row(false), row(false, { id: "b" })];
      const wrapper = await render();
      expect(text(wrapper, "starter-pack-page-chip")).toBe(
        t("starterPacks.page.chipOff", { count: 2 }, 2),
      );
      expect(has(wrapper, "starter-pack-page-turn-on-btn")).toBe(true);
    });

    it("says the alerts are off before saying the data stopped", async () => {
      fake.stale = Date.UTC(2026, 10, 12, 9, 40) * 1000;
      fake.turn.rows.value = [row(false)];
      expect(text(await render(), "starter-pack-page-chip")).toBe(
        t("starterPacks.page.chipOff", { count: 1 }, 1),
      );
    });

    it("puts a stale pack's last data time in the chip, never a banner", async () => {
      fake.stale = Date.UTC(2026, 10, 12, 9, 40) * 1000;
      const wrapper = await render();
      expect(text(wrapper, "starter-pack-page-chip")).toContain(
        t("starterPacks.page.chipNoData", { since: "" }).trim(),
      );
      expect(wrapper.findComponent({ name: "OBanner" }).exists()).toBe(false);
    });

    it("has no Turn off all action; each row switch covers it", async () => {
      expect(has(await render(), "starter-pack-page-turn-off-all-btn")).toBe(false);
    });

    it("lists a stream without a known type with no type", async () => {
      fake.turn.rows.value = [{ ...row(true), alert: { stream_name: "s", destinations: [] } }];
      const wrapper = await render();
      await wrapper.get('[data-test="starter-pack-page-pack-details-btn"]').trigger("click");
      const drawer = wrapper.findComponent({ name: "StarterPackDetailsDrawer" });
      expect(drawer.props("streams")).toEqual([{ name: "s", type: "" }]);
    });

    it("closes Pack details when another drawer or dialog opens", async () => {
      fake.turn.rows.value = [row(false)];
      const wrapper = await render();
      const drawer = () => wrapper.findComponent({ name: "StarterPackDetailsDrawer" });
      const open = async () => {
        await wrapper.get('[data-test="starter-pack-page-pack-details-btn"]').trigger("click");
        expect(drawer().props("open")).toBe(true);
      };
      await open();
      await wrapper.get('[data-test="starter-pack-page-edit-threshold-btn"]').trigger("click");
      expect(drawer().props("open")).toBe(false);
      (wrapper.vm as any).editRow = null;
      await open();
      await wrapper.get('[data-test="starter-pack-page-remove-btn"]').trigger("click");
      expect(drawer().props("open")).toBe(false);
      wrapper.findComponent({ name: "StarterPackUndoDialog" }).vm.$emit("update:open", false);
      await open();
      await wrapper.get('[data-test="starter-pack-page-turn-on-btn"]').trigger("click");
      expect(drawer().props("open")).toBe(false);
    });

    it("closes Pack details when the update, Find more or repair drawer opens", async () => {
      fake.packsOn = true;
      const wrapper = await render();
      const drawer = () => wrapper.findComponent({ name: "StarterPackDetailsDrawer" });
      const open = async () => {
        await wrapper.get('[data-test="starter-pack-page-pack-details-btn"]').trigger("click");
        expect(drawer().props("open")).toBe(true);
      };
      await open();
      (wrapper.vm as any).updateOpen = true;
      await flushPromises();
      expect(drawer().props("open")).toBe(false);
      (wrapper.vm as any).updateOpen = false;
      await open();
      wrapper.findComponent({ name: "StarterPackFindMore" }).vm.$emit("opened");
      await flushPromises();
      expect(drawer().props("open")).toBe(false);
      await open();
      wrapper.findComponent({ name: "StarterPackRepairChip" }).vm.$emit("opened");
      await flushPromises();
      expect(drawer().props("open")).toBe(false);
    });

    it("opens the Pack details drawer with the pack's streams", async () => {
      const wrapper = await render();
      await wrapper.get('[data-test="starter-pack-page-pack-details-btn"]').trigger("click");
      const drawer = wrapper.findComponent({ name: "StarterPackDetailsDrawer" });
      expect(drawer.props("open")).toBe(true);
      expect(drawer.props("streams")).toEqual([{ name: "s", type: "metrics" }]);
    });

    it("links a newer catalog version from the chip", async () => {
      fake.packsOn = true;
      fake.flow = fakeFlow({
        record: shallowRef({
          installId: "i1",
          version: "1",
          installedBy: "a@example.com",
          items: [],
        }),
      });
      fake.packs.checkUpdates.mockResolvedValue([{ itemId: "a", rows: [] }]);
      const wrapper = await render();
      expect(text(wrapper, "starter-pack-page-chip")).toBe(t("starterPacks.page.chipUpdate"));
      expect(has(wrapper, "starter-pack-page-update-btn")).toBe(true);
    });
  });

  describe("view only", () => {
    beforeEach(() => {
      fake.flow = fakeFlow({
        canManage: ref(false),
        record: shallowRef({ items: [], installedBy: "a@example.com" }),
      });
    });

    it("moves Copy link for an admin into the header and marks the pack View only", async () => {
      const wrapper = await render();
      expect(has(wrapper, "starter-pack-page-copy-link-btn")).toBe(true);
      expect(has(wrapper, "starter-pack-page-pack-details-btn")).toBe(true);
      expect(has(wrapper, "starter-pack-page-remove-btn")).toBe(false);
      expect(text(wrapper, "starter-pack-page-chip")).toBe(t("starterPacks.page.chipViewOnly"));
    });

    it("leaves only Open on each row", async () => {
      const wrapper = await render();
      expect(has(wrapper, "starter-pack-page-row-switch")).toBe(false);
      expect(has(wrapper, "starter-pack-page-edit-threshold-btn")).toBe(false);
      expect(has(wrapper, "starter-pack-page-open-alert-btn")).toBe(true);
    });

    it("treats a refused write as view only", async () => {
      fake.flow = fakeFlow({ record: shallowRef({ items: [] }) });
      fake.turn.forbidden.value = true;
      expect(has(await render(), "starter-pack-page-copy-link-btn")).toBe(true);
    });
  });

  describe("alert rows", () => {
    it("reads the title row as N of M on and who it notifies", async () => {
      fake.turn.rows.value = [row(true), row(false, { id: "b" })];
      expect(text(await render(), "starter-pack-page-alerts-meta")).toBe(
        t("starterPacks.page.alertsNotifies", { on: 1, total: 2, destinations: "chat" }),
      );
    });

    it("names each alert by its library title and keeps the saved name on hover", async () => {
      fake.flow = fakeFlow({
        record: shallowRef({ items: [] }),
        alertTitle: (id: string) => `Title ${id}`,
      });
      const title = (await render()).get('[data-test="starter-pack-page-alert-title"]');
      expect(title.text()).toBe("Title a");
      expect(title.attributes("title")).toBe("Alert a");
    });

    it("shows the threshold in words", async () => {
      expect(text(await render(), "cell-threshold")).toBe(
        t("starterPacks.page.thresholdFor", {
          op: t("starterPacks.page.opAbove"),
          value: 85,
          period: 5,
        }),
      );
    });

    it("marks a firing alert Firing, a stale one No data and an off one Off", async () => {
      fake.turn.rows.value = [row(true), row(true, { id: "b" }), row(false, { id: "c" })];
      fake.replies.firing = { list: [{ alert_id: "a", last_outcome: "firing" }] };
      fake.staleStreams = new Set(["s"]);
      const wrapper = await render();
      expect(has(wrapper, "starter-pack-page-state-firing")).toBe(true);
      expect(has(wrapper, "starter-pack-page-state-noData")).toBe(true);
      expect(has(wrapper, "starter-pack-page-state-off")).toBe(true);
    });

    it("turns an alert off straight from its switch", async () => {
      const wrapper = await render();
      wrapper.findComponent({ name: "OSwitch" }).vm.$emit("update:modelValue", false);
      await flushPromises();
      expect(fake.turn.turnOff).toHaveBeenCalledWith([expect.objectContaining({ id: "a" })]);
      expect(turnOnDrawer(wrapper).props("open")).toBe(false);
    });

    it("opens the Turn on drawer preselected to the alert switched on", async () => {
      fake.turn.rows.value = [row(false)];
      const wrapper = await render();
      wrapper.findComponent({ name: "OSwitch" }).vm.$emit("update:modelValue", true);
      await flushPromises();
      expect(turnOnDrawer(wrapper).props("open")).toBe(true);
      expect(turnOnDrawer(wrapper).props("preselectIds")).toEqual(["a"]);
      expect(fake.turn.turnOff).not.toHaveBeenCalled();
    });

    it("keeps an Off alert's switch off after its Turn on drawer closes without turning it on", async () => {
      fake.turn.rows.value = [row(false)];
      const wrapper = await render();
      const button = () => wrapper.get('[data-test="starter-pack-page-row-switch-btn"]');
      await button().trigger("click");
      await flushPromises();
      expect(turnOnDrawer(wrapper).props("open")).toBe(true);
      expect(button().attributes("aria-checked")).toBe("false");
      turnOnDrawer(wrapper).vm.$emit("update:open", false);
      await flushPromises();
      expect(button().attributes("aria-checked")).toBe("false");
    });

    it("keeps the switch on and says so when turning off fails", async () => {
      fake.turn.turnOff.mockResolvedValue(false);
      const wrapper = await render();
      await wrapper.get('[data-test="starter-pack-page-row-switch-btn"]').trigger("click");
      await flushPromises();
      expect(fake.turn.turnOff).toHaveBeenCalled();
      expect(
        wrapper.get('[data-test="starter-pack-page-row-switch-btn"]').attributes("aria-checked"),
      ).toBe("true");
      expect(fake.toast).toHaveBeenCalledWith({
        variant: "error",
        message: t("starterPacks.page.turnOffFailed"),
      });
    });

    it("asks for a number instead of saving a blank threshold", async () => {
      const wrapper = await render();
      await wrapper.get('[data-test="starter-pack-page-edit-threshold-btn"]').trigger("click");
      (wrapper.vm as any).thresholdDraft = "";
      await flushPromises();
      wrapper.findComponent({ name: "ODialog" }).vm.$emit("click:primary");
      await flushPromises();
      expect(fake.turn.setThreshold).not.toHaveBeenCalled();
      expect(wrapper.findComponent({ name: "OInput" }).props("errorMessage")).toBe(
        t("starterPacks.page.thresholdNotNumber"),
      );
    });

    it("says so when saving a threshold fails", async () => {
      fake.turn.setThreshold.mockResolvedValue(false);
      const wrapper = await render();
      await wrapper.get('[data-test="starter-pack-page-edit-threshold-btn"]').trigger("click");
      wrapper.findComponent({ name: "ODialog" }).vm.$emit("click:primary");
      await flushPromises();
      expect(fake.turn.setThreshold).toHaveBeenCalledWith("a", 85, { count: false });
      expect(fake.toast).toHaveBeenCalledWith({
        variant: "error",
        message: t("starterPacks.page.thresholdFailed"),
      });
    });

    it("marks an alert that fired and notified nobody on its row", async () => {
      fake.turn.rows.value = [{ ...row(true), alert: { stream_name: "s", destinations: [] } }];
      fake.replies.history = { total: 4 };
      const wrapper = await render();
      expect(text(wrapper, "cell-fired")).toContain("4");
      expect(has(wrapper, "starter-pack-page-silent-fired")).toBe(true);
    });

    it("opens the alert in All Alerts", async () => {
      const wrapper = await render();
      await wrapper.get('[data-test="starter-pack-page-open-alert-btn"]').trigger("click");
      expect(fake.push).toHaveBeenCalledWith(
        expect.objectContaining({ name: "alertDetail", params: { alert_id: "a" } }),
      );
    });

    it("offers no Mute where downtimes are off", async () => {
      expect(has(await render(), "starter-pack-page-mute-btn")).toBe(false);
    });

    it("offers Mute on Cloud when downtimes are on", async () => {
      fake.isCloud = "true";
      store.state.zoConfig = { ...zoConfig, downtimes_enabled: true };
      expect(has(await render(), "starter-pack-page-mute-btn")).toBe(true);
    });
  });

  it("opens the Turn on drawer from the Library card link", async () => {
    fake.query = { org_identifier: "org", turnOn: "1" };
    fake.turn.rows.value = [row(false)];
    const wrapper = await render();
    expect(turnOnDrawer(wrapper).props("open")).toBe(true);
    expect(fake.replace).toHaveBeenCalled();
  });

  it("keeps the Turn on link when there is nothing to turn on", async () => {
    fake.query = { org_identifier: "org", turnOn: "1" };
    const wrapper = await render();
    expect(turnOnDrawer(wrapper).props("open")).toBe(false);
    expect(fake.replace).not.toHaveBeenCalled();
  });

  it("gives an admin Set up in… when the pack is not installed", async () => {
    fake.flow = fakeFlow({ isAdmin: ref(true) });
    const wrapper = await render();
    expect(has(wrapper, "starter-pack-page-folder-select")).toBe(true);
    expect(has(wrapper, "starter-pack-page-setup-btn")).toBe(true);
    expect(text(wrapper, "starter-pack-page-chip")).toBe(t("starterPacks.page.chipNotSetUp"));
  });

  it("hides the folder picker from anyone else", async () => {
    fake.flow = fakeFlow();
    expect(has(await render(), "starter-pack-page-folder-select")).toBe(false);
  });

  it("shows a load failure as an empty state with Retry", async () => {
    fake.flow = fakeFlow({ loadFailed: ref(true) });
    const wrapper = await render();
    expect(has(wrapper, "starter-pack-page-error")).toBe(true);
    expect(has(wrapper, "starter-pack-page-section-alerts")).toBe(false);
    expect(text(wrapper, "starter-pack-page-chip")).toBe(t("starterPacks.page.loadFailed"));
  });

  describe("dashboards and views", () => {
    const withItems = (items: unknown[]) =>
      fakeFlow({ record: shallowRef({ items, installedBy: "a@example.com" }) });

    it("lists the dashboards and saved views the install made and opens each", async () => {
      fake.flow = withItems([
        { kind: "alert", itemId: "a", status: "created", id: "x" },
        { kind: "dashboard", itemId: "overview", status: "created", id: "d1", folderId: "f1" },
        { kind: "savedView", itemId: "events", status: "existing", id: "v1" },
        { kind: "dashboard", itemId: "nodes", status: "skipped" },
      ]);
      const wrapper = await render();
      const rows = wrapper.findAll('[data-test="starter-pack-page-view-row"]');
      expect(rows.map((item) => item.text())).toEqual([
        expect.stringContaining("name-overview"),
        expect.stringContaining("name-events"),
      ]);
      const open = wrapper.findAll('[data-test="starter-pack-page-view-open-btn"]');
      await open[0].trigger("click");
      expect(fake.push).toHaveBeenCalledWith({
        name: "viewDashboard",
        query: { org_identifier: "org", dashboard: "d1", folder: "f1", pack: "kubernetes" },
      });
      await open[1].trigger("click");
      expect(fake.push).toHaveBeenCalledWith({
        name: "logs",
        query: { org_identifier: "org", stream_type: "logs", stream: "k8s_events" },
      });
    });

    it("hides the section when the install made no dashboard or view", async () => {
      fake.flow = withItems([
        { kind: "alert", itemId: "a", status: "created", id: "x" },
        { kind: "dashboard", itemId: "overview", status: "failed" },
      ]);
      const wrapper = await render();
      expect(has(wrapper, "starter-pack-page-section-views")).toBe(false);
    });
  });

  describe("with every alert skipped", () => {
    it("says how many alerts setup skipped for missing data", async () => {
      fake.flow = fakeFlow({
        record: shallowRef({
          items: [
            { kind: "alert", itemId: "a", status: "skipped" },
            { kind: "alert", itemId: "b", status: "skipped" },
            { kind: "dashboard", itemId: "overview", status: "skipped" },
          ],
        }),
      });
      fake.turn.rows.value = [];
      const wrapper = await render();
      expect(text(wrapper, "starter-pack-page-alerts-skipped")).toContain(
        t("starterPacks.page.alertsSkipped", { count: 2 }, 2),
      );
    });

    it("counts alerts setup left out for missing data", async () => {
      fake.flow = fakeFlow({
        record: shallowRef({
          items: [{ kind: "dashboard", itemId: "overview", status: "created" }],
        }),
        preview: shallowRef({
          notIncluded: [
            { kind: "alert", itemId: "a", name: "A", reason: "no_data" },
            { kind: "alert", itemId: "b", name: "B", reason: "no_data" },
            { kind: "alert", itemId: "c", name: "C", reason: "already_have" },
            { kind: "dashboard", itemId: "d", name: "D", reason: "no_data" },
          ],
        }),
      });
      fake.turn.rows.value = [];
      const wrapper = await render();
      expect(text(wrapper, "starter-pack-page-alerts-skipped")).toContain(
        t("starterPacks.page.alertsSkipped", { count: 2 }, 2),
      );
    });

    it("counts an alert once when the record skipped it and the preview leaves it out", async () => {
      fake.flow = fakeFlow({
        record: shallowRef({ items: [{ kind: "alert", itemId: "a", status: "skipped" }] }),
        preview: shallowRef({
          notIncluded: [{ kind: "alert", itemId: "a", name: "A", reason: "no_data" }],
        }),
      });
      fake.turn.rows.value = [];
      const wrapper = await render();
      expect(text(wrapper, "starter-pack-page-alerts-skipped")).toContain(
        t("starterPacks.page.alertsSkipped", { count: 1 }, 1),
      );
    });

    it("says the alerts failed to load, with Retry, instead of the skipped count", async () => {
      fake.flow = fakeFlow({
        record: shallowRef({ items: [{ kind: "alert", itemId: "a", status: "skipped" }] }),
      });
      fake.turn.rows.value = [];
      fake.turn.loadState.value = "error";
      const wrapper = await render();
      expect(has(wrapper, "starter-pack-page-alerts-skipped")).toBe(false);
      expect(text(wrapper, "starter-pack-page-alerts-load-failed")).toContain(
        t("starterPacks.turnOn.loadFailed"),
      );
      fake.turn.load.mockClear();
      await wrapper
        .get(
          '[data-test="starter-pack-page-alerts-load-failed"] [data-test="o2-empty-state-action-primary"]',
        )
        .trigger("click");
      expect(fake.turn.load).toHaveBeenCalledWith({ count: false });
    });

    it("keeps the plain empty table when nothing was skipped", async () => {
      fake.turn.rows.value = [];
      const wrapper = await render();
      expect(has(wrapper, "starter-pack-page-alerts-skipped")).toBe(false);
    });
  });

  describe("with a newer catalog version", () => {
    const update = {
      itemId: "a",
      name: "Alert a",
      fromHash: "v1",
      hash: "v2",
      rows: [{ field: "description", yours: "old", library: "new", outcome: "updated" }],
      base: { description: "old" },
      next: { description: "new" },
    };
    const installed = (items: unknown[]) =>
      fakeFlow({
        record: shallowRef({ installId: "i1", version: "1", installedBy: "a@example.com", items }),
      });

    beforeEach(() => {
      fake.packsOn = true;
    });

    it("offers the update and shows each changed field in the drawer", async () => {
      fake.flow = installed([{ kind: "alert", itemId: "a", status: "created", id: "x" }]);
      fake.packs.checkUpdates.mockResolvedValue([update]);
      const wrapper = await render();
      expect(fake.packs.checkUpdates).toHaveBeenCalledWith(fake.flow.pack, "i1");
      await wrapper.get('[data-test="starter-pack-page-update-btn"]').trigger("click");
      await flushPromises();
      const changed = wrapper.get('[data-test="starter-pack-update-row-description"]').text();
      expect(changed).toContain("old");
      expect(changed).toContain("new");
      await wrapper.get('[data-test="starter-pack-update-apply-btn"]').trigger("click");
      await flushPromises();
      expect(fake.packs.applyUpdates).toHaveBeenCalledWith(fake.flow.pack, "i1", [update]);
      expect(has(wrapper, "starter-pack-update-drawer")).toBe(false);
    });

    it("reverts an applied update and checks again", async () => {
      const applied = { fromHash: "v1", rows: update.rows };
      fake.flow = installed([
        { kind: "alert", itemId: "a", status: "created", id: "x", update: applied },
      ]);
      const wrapper = await render();
      fake.packs.checkUpdates.mockClear();
      await wrapper.get('[data-test="starter-pack-page-revert-btn"]').trigger("click");
      await flushPromises();
      expect(fake.packs.revertUpdates).toHaveBeenCalledWith(fake.flow.pack, "i1");
      expect(fake.flow.load).toHaveBeenCalled();
      expect(fake.packs.checkUpdates).toHaveBeenCalledTimes(1);
    });
  });
});
