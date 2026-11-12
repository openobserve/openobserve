import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { createStore } from "vuex";

import type { PackInstallRecord, StarterPack } from "./types";
import { StarterPackPermissionError } from "./types";
import { UNDO_WINDOW_US, useStarterPackFlow } from "./useStarterPackFlow";

const fake = vi.hoisted(() => ({
  installs: [] as PackInstallRecord[],
  installPack: vi.fn(),
  previewPack: vi.fn(),
  undoPack: vi.fn(),
  removePack: vi.fn(),
  push: vi.fn(async () => undefined),
  alerts: [] as Array<{ enabled: boolean }>,
}));

vi.mock("./useStarterPacks", () => ({
  useStarterPacks: () => ({
    installPack: fake.installPack,
    previewPack: fake.previewPack,
    undoPack: fake.undoPack,
    removePack: fake.removePack,
    listInstalls: async () => fake.installs,
  }),
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: fake.push }) }));
vi.mock("@/composables/query/readQuery", () => ({ readQuery: async () => fake.alerts }));

const PACK = {
  id: "kubernetes",
  alerts: ["a1"],
  savedViews: [],
  dashboards: [],
  nativeView: { feature: "kubernetes_monitoring", route: "infraKubernetes" },
} as unknown as StarterPack;

const record = (over: Partial<PackInstallRecord> = {}): PackInstallRecord => ({
  packId: "kubernetes",
  installId: "i1",
  status: "complete",
  installedAt: Date.now() * 1000,
  installedBy: "me@x",
  items: [
    { kind: "folder", itemId: "alerts", status: "created", id: "fa" },
    { kind: "dashboard", itemId: "overview", status: "created", id: "d1", folderId: "fd" },
    { kind: "alert", itemId: "a1", status: "created", id: "al1" },
  ],
  ...over,
});

const setup = (state: Record<string, unknown> = {}, pack: StarterPack = PACK) => {
  const store = createStore({
    state: { userInfo: { email: "me@x", role: "editor" }, zoConfig: { features: {} }, ...state },
  });
  let flow!: ReturnType<typeof useStarterPackFlow>;
  mount(
    defineComponent({
      setup() {
        flow = useStarterPackFlow("org", pack);
        return () => null;
      },
    }),
    { global: { plugins: [store] } },
  );
  return flow;
};

describe("repair answers", () => {
  it("keeps every answer for the next preview and the install", async () => {
    const flow = setup();
    await flow.chooseStream("k8s_events", { to: "edge" });
    expect(fake.previewPack).toHaveBeenLastCalledWith(PACK, {
      streams: { k8s_events: { to: "edge" } },
      fields: {},
    });
  });

  it("drops an older preview that finishes after a newer answer", async () => {
    const flow = setup();
    let finishOld!: (value: unknown) => void;
    fake.previewPack.mockImplementationOnce(() => new Promise((done) => (finishOld = done)));
    const older = flow.loadPreview();
    const newest = { items: [], names: {}, notIncluded: [] };
    fake.previewPack.mockResolvedValueOnce(newest);
    await flow.loadPreview();
    finishOld({ items: [], names: { old: "x" }, notIncluded: [] });
    await older;
    expect(flow.preview.value).toEqual(newest);
    expect(flow.previewState.value).toBe("ready");
  });

  it("refuses __name__ as a field", async () => {
    const flow = setup();
    fake.previewPack.mockClear();
    await flow.chooseField("x", "__name__");
    expect(fake.previewPack).not.toHaveBeenCalled();
  });

  it("sends a field change to every stream that has the column", async () => {
    const flow = setup();
    fake.previewPack.mockResolvedValue({
      items: [],
      names: {},
      notIncluded: [],
      bindings: [
        { stream: "a", from: "x", to: "y", tier: "alias" },
        { stream: "b", from: "x", to: "y", tier: "alias" },
      ],
      columns: { a: ["z"], b: ["y"] },
    });
    await flow.loadPreview();
    await flow.chooseField("x", "z");
    expect(fake.previewPack.mock.lastCall?.[1].fields).toEqual({ "a/x": "z" });
  });
});

describe("useStarterPackFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake.installs = [];
    fake.alerts = [];
    fake.previewPack.mockResolvedValue({ items: [], names: {}, notIncluded: [] });
  });

  it("completes setup, excludes what the preview left out, and lands on the built-in view", async () => {
    fake.previewPack.mockResolvedValue({
      items: [],
      names: {},
      notIncluded: [
        { itemId: "no", reason: "no_data" },
        { itemId: "gone", reason: "unavailable" },
        { itemId: "mine", reason: "already_have" },
        { itemId: "plan", reason: "needs_plan" },
      ],
    });
    fake.installPack.mockResolvedValue(record());
    const flow = setup();
    expect(await flow.install()).toBe(true);
    expect(fake.installPack.mock.calls[0][1].exclude).toEqual(["no", "gone", "plan"]);
    await flow.land();
    expect(fake.push).toHaveBeenCalledWith({
      name: "viewDashboard",
      query: { org_identifier: "org", dashboard: "d1", folder: "fd", pack: "kubernetes" },
    });
  });

  it("adds the ids the user unticked to the ones the preview left out", async () => {
    fake.previewPack.mockResolvedValue({
      items: [],
      names: {},
      notIncluded: [{ itemId: "no", reason: "no_data" }],
    });
    fake.installPack.mockResolvedValue(record());
    const flow = setup();
    await flow.install(undefined, { exclude: ["v1", "no"] });
    expect(fake.installPack.mock.calls[0][1].exclude).toEqual(["no", "v1"]);
    expect(fake.installPack.mock.calls[0][1].enableAlerts).toBe(false);
  });

  it("asks for started alerts and counts them on without a re-read", async () => {
    fake.installPack.mockResolvedValue(record());
    const flow = setup();
    await flow.install(undefined, { enableAlerts: true });
    expect(fake.installPack.mock.calls[0][1].enableAlerts).toBe(true);
    expect(flow.alertsOn.value).toBe(1);
    expect(flow.enabledAlertIds.value.has("al1")).toBe(true);
    expect(flow.remindAlerts.value).toBe(false);
  });

  it("keeps alerts silent by default", async () => {
    fake.installPack.mockResolvedValue(record());
    const flow = setup();
    await flow.install();
    expect(fake.installPack.mock.calls[0][1].enableAlerts).toBe(false);
    expect(flow.alertsOn.value).toBe(0);
  });

  it("counts alerts off from the alerts the install created", async () => {
    const items = record().items;
    fake.installs = [
      record({ items: [...items, { kind: "alert", itemId: "a2", status: "failed" }] }),
    ];
    const flow = setup();
    await flow.load();
    expect(flow.alertsTotal.value).toBe(1);
    expect(flow.alertsOff.value).toBe(1);
  });

  it("lands on the pack dashboard when the plan has no Kubernetes view", async () => {
    fake.installPack.mockResolvedValue(record());
    const flow = setup({ zoConfig: { features: { kubernetes_monitoring: "locked" } } });
    await flow.install();
    await flow.land();
    expect(fake.push).toHaveBeenCalledWith({
      name: "viewDashboard",
      query: { org_identifier: "org", dashboard: "d1", folder: "fd", pack: "kubernetes" },
    });
  });

  it("lands a pack without a built-in view on its dashboard whatever the plan", async () => {
    fake.installPack.mockResolvedValue(record({ packId: "hosts" }));
    const flow = setup({}, { ...PACK, id: "hosts", nativeView: undefined });
    await flow.install();
    expect(flow.licensed.value).toBe(false);
    await flow.land();
    expect(fake.push).toHaveBeenCalledWith({
      name: "viewDashboard",
      query: { org_identifier: "org", dashboard: "d1", folder: "fd", pack: "hosts" },
    });
  });

  it("names a refused setup separately from a failed one", async () => {
    fake.installPack.mockRejectedValueOnce(new StarterPackPermissionError());
    const flow = setup();
    expect(await flow.install()).toBe(false);
    expect(flow.forbidden.value).toBe(true);
    fake.installPack.mockRejectedValueOnce(new Error("down"));
    await flow.install();
    expect(flow.forbidden.value).toBe(false);
    expect(flow.installFailed.value).toBe(true);
    expect(flow.running.value).toBe(false);
  });

  it("shows partial progress, then failed items, then retry to complete", async () => {
    const incomplete = record({
      status: "incomplete",
      items: [
        { kind: "alert", itemId: "a1", status: "created", id: "1" },
        { kind: "alert", itemId: "a2", status: "failed" },
      ],
    });
    fake.installPack.mockImplementationOnce(async (_pack, { onProgress }) => {
      onProgress({ ...incomplete, status: "installing" });
      return incomplete;
    });
    const flow = setup();
    expect(await flow.install()).toBe(false);
    expect(flow.failed.value).toHaveLength(1);
    expect(flow.interrupted.value).toBe(true);
    fake.installPack.mockResolvedValueOnce(record());
    expect(await flow.install()).toBe(true);
    expect(flow.interrupted.value).toBe(false);
  });

  it("treats an install record left unfinished as interrupted on return", async () => {
    fake.installs = [
      record({ installId: "old" }),
      record({ installId: "i2", status: "installing" }),
    ];
    const flow = setup();
    await flow.load();
    expect(flow.record.value?.installId).toBe("i2");
    expect(flow.interrupted.value).toBe(true);
  });

  it("offers Undo to the installer or an admin for 24 hours only", async () => {
    fake.installs = [record({ installedBy: "other@x" })];
    const other = setup();
    await other.load();
    expect(other.canUndo.value).toBe(false);
    const admin = setup({ userInfo: { email: "me@x", role: "admin" } });
    await admin.load();
    expect(admin.canUndo.value).toBe(true);

    fake.installs = [record({ installedAt: Date.now() * 1000 - UNDO_WINDOW_US - 1 })];
    const late = setup();
    await late.load();
    expect(late.canUndo.value).toBe(false);
    expect(late.canManage.value).toBe(true);
  });

  it("clears the install after Undo and keeps failures retryable", async () => {
    fake.installs = [record()];
    const flow = setup();
    await flow.load();
    fake.undoPack.mockResolvedValueOnce({
      removed: [],
      kept: [{ kind: "alert", itemId: "a1", reason: "delete_failed" }],
    });
    expect(await flow.undo()).toBe(false);
    expect(flow.removalFailed.value).toBe(true);

    fake.installs = [];
    fake.undoPack.mockResolvedValueOnce({ removed: [{}], kept: [] });
    expect(await flow.undo()).toBe(true);
    expect(flow.record.value).toBeNull();
  });

  it("lands an unlicensed org on the dashboard it already has when nothing is left to create", async () => {
    fake.previewPack.mockResolvedValue({
      items: [
        { kind: "dashboard", itemId: "overview", status: "existing", id: "d9", folderId: "f9" },
      ],
      names: {},
      notIncluded: [],
    });
    const flow = setup({ zoConfig: { features: { kubernetes_monitoring: "locked" } } });
    await flow.loadPreview();
    await flow.land();
    expect(fake.push).toHaveBeenCalledWith({
      name: "viewDashboard",
      query: { org_identifier: "org", dashboard: "d9", folder: "f9", pack: "kubernetes" },
    });
  });

  it("falls back to the dashboards list when no dashboard fits", async () => {
    const flow = setup({ zoConfig: { features: { kubernetes_monitoring: "locked" } } });
    await flow.land();
    expect(fake.push).toHaveBeenCalledWith({
      name: "dashboards",
      query: { org_identifier: "org" },
    });
  });

  it("leaves a record without an installer to admins", async () => {
    fake.installs = [record({ installedBy: undefined })];
    const flow = setup({ userInfo: {} });
    await flow.load();
    expect(flow.canManage.value).toBe(false);
  });

  it("removes through removePack after the window", async () => {
    fake.installs = [record({ installedAt: 1 })];
    fake.removePack.mockResolvedValueOnce({ removed: [], kept: [] });
    const flow = setup();
    await flow.load();
    fake.installs = [];
    expect(await flow.remove()).toBe(true);
    expect(fake.removePack).toHaveBeenCalledWith(PACK);
    await flushPromises();
    expect(flow.installed.value).toBe(false);
  });
});
