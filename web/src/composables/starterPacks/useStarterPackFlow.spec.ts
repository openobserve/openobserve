import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { createStore } from "vuex";

import type { PackInstallRecord, StarterPack } from "./types";
import { StarterPackBusyError, StarterPackPermissionError } from "./types";
import { UNDO_WINDOW_US, useStarterPackFlow } from "./useStarterPackFlow";

const fake = vi.hoisted(() => ({
  installs: [] as PackInstallRecord[],
  listError: null as unknown,
  installPack: vi.fn(),
  previewPack: vi.fn(),
  undoPack: vi.fn(),
  removePack: vi.fn(),
  refreshResources: vi.fn(),
  markRemoved: vi.fn(),
  push: vi.fn(async () => undefined),
  alerts: [] as Array<{ enabled: boolean }>,
}));

vi.mock("./useStarterPacks", () => ({
  useStarterPacks: () => ({
    installPack: fake.installPack,
    previewPack: fake.previewPack,
    undoPack: fake.undoPack,
    removePack: fake.removePack,
    listInstalls: async () => {
      if (fake.listError) throw fake.listError;
      return fake.installs;
    },
  }),
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: fake.push }) }));
vi.mock("@/composables/query/readQuery", () => ({ readQuery: async () => fake.alerts }));
vi.mock("@/composables/useOrgResources", () => ({ refreshOrgResources: fake.refreshResources }));
vi.mock("./useBrowserMatches", () => ({
  useBrowserMatches: () => ({ markRemoved: fake.markRemoved }),
}));

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
    fake.listError = null;
    fake.alerts = [];
    fake.previewPack.mockResolvedValue({ items: [], names: {}, notIncluded: [] });
  });

  it("has no counts before the preview, then counts what the popup would create", async () => {
    const flow = setup();
    expect([flow.dashboardCount.value, flow.alertCount.value, flow.viewCount.value]).toEqual([
      null,
      null,
      null,
    ]);
    fake.previewPack.mockResolvedValue({
      items: [
        { kind: "folder", itemId: "alerts", status: "pending" },
        { kind: "dashboard", itemId: "overview", status: "pending" },
        { kind: "alert", itemId: "a1", status: "pending" },
        { kind: "alert", itemId: "a2", status: "existing" },
      ],
      names: {},
      notIncluded: [{ kind: "savedView", itemId: "events", name: "Events", reason: "no_data" }],
    });
    await flow.loadPreview();
    expect([flow.dashboardCount.value, flow.alertCount.value, flow.viewCount.value]).toEqual([
      1, 1, 0,
    ]);
  });

  it("links each created item to its own page, and each kind to its list in the pack folder", async () => {
    const pack = {
      ...PACK,
      savedViews: [
        {
          id: "events",
          name: "Events",
          search: { data: { stream: { streamType: "logs", selectedStream: ["k8s_events"] } } },
        },
      ],
    } as unknown as StarterPack;
    fake.installs = [
      record({
        items: [
          { kind: "folder", itemId: "dashboards", status: "created", id: "fd" },
          { kind: "dashboard", itemId: "overview", status: "created", id: "d1", folderId: "fd" },
          { kind: "alert", itemId: "a1", status: "created", id: "al1", folderId: "fa" },
          { kind: "savedView", itemId: "events", status: "created", id: "v1" },
        ],
      }),
    ];
    const flow = setup({}, pack);
    await flow.load();
    const [dashboard, alert, view] = flow.items.value;
    expect(flow.itemRoute(dashboard)).toEqual({
      name: "viewDashboard",
      query: { org_identifier: "org", dashboard: "d1", folder: "fd" },
    });
    expect(flow.itemRoute(alert)).toEqual({
      name: "alertDetail",
      params: { alert_id: "al1" },
      query: { org_identifier: "org", folder: "fa" },
    });
    expect(flow.itemRoute(view)).toEqual({
      name: "logs",
      query: { org_identifier: "org", stream_type: "logs", stream: "k8s_events" },
    });
    expect(flow.dashboardsRoute.value).toEqual({
      name: "dashboards",
      query: { org_identifier: "org", folder: "fd" },
    });
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
      query: { org_identifier: "org", dashboard: "d1", folder: "fd" },
    });
  });

  it("counts the plan the user saw before the install record is first written", async () => {
    fake.previewPack.mockResolvedValue({
      items: [
        { kind: "folder", itemId: "alerts", status: "pending" },
        { kind: "dashboard", itemId: "overview", status: "pending" },
        { kind: "alert", itemId: "a1", status: "pending" },
        { kind: "alert", itemId: "a2", status: "pending" },
        { kind: "savedView", itemId: "v1", status: "existing" },
      ],
      names: {},
      notIncluded: [],
    });
    let finish!: (value: PackInstallRecord) => void;
    fake.installPack.mockImplementationOnce(() => new Promise((done) => (finish = done)));
    const flow = setup();
    await flow.loadPreview();
    const running = flow.install(undefined, { exclude: ["a2"] });
    await flushPromises();
    expect(flow.toCreate.value.map(({ itemId }) => itemId)).toEqual(["overview", "a1"]);
    expect(flow.made.value).toEqual([]);
    finish(record());
    await running;
    expect(flow.toCreate.value.map(({ itemId }) => itemId)).toEqual(["overview", "a1"]);
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

  it("asks for started alerts and counts them on", async () => {
    fake.installPack.mockResolvedValue(record());
    fake.alerts = [{ alert_id: "al1", enabled: true }] as any;
    const flow = setup();
    await flow.install(undefined, { enableAlerts: true });
    expect(fake.installPack.mock.calls[0][1].enableAlerts).toBe(true);
    expect(flow.alertsOn.value).toBe(1);
    expect(flow.enabledAlertIds.value.has("al1")).toBe(true);
  });

  it("re-reads which pack alerts are on once the install finishes", async () => {
    const items = [
      ...record().items,
      { kind: "alert" as const, itemId: "a2", status: "existing" as const, id: "al2" },
      { kind: "alert" as const, itemId: "a3", status: "existing" as const, id: "al3" },
    ];
    fake.installPack.mockResolvedValue(record({ items }));
    fake.alerts = [
      { alert_id: "al1", enabled: true },
      { alert_id: "al2", enabled: true },
      { alert_id: "al3", enabled: false },
    ] as any;
    const flow = setup();
    await flow.install(undefined, { enableAlerts: true });
    expect([...flow.enabledAlertIds.value].sort()).toEqual(["al1", "al2"]);
  });

  it("keeps alerts it just created on when the tag search has not caught up", async () => {
    fake.installPack.mockResolvedValue(record());
    fake.alerts = [] as any;
    const flow = setup();
    await flow.install(undefined, { enableAlerts: true });
    expect(flow.enabledAlertIds.value.has("al1")).toBe(true);
  });

  it("passes the chosen destination to the install", async () => {
    fake.installPack.mockResolvedValue(record());
    const flow = setup();
    await flow.install(undefined, { enableAlerts: true, destination: "oncall" });
    expect(fake.installPack.mock.calls[0][1].destination).toBe("oncall");
  });

  it("never carries an earlier choice into an ordinary install", async () => {
    fake.installPack.mockResolvedValue(record());
    const flow = setup();
    await flow.install(undefined, { exclude: ["v1"], enableAlerts: true, destination: "oncall" });
    await flow.install();
    const second = fake.installPack.mock.calls[1][1];
    expect(second.enableAlerts).toBe(false);
    expect(second.destination).toBeUndefined();
    expect(second.exclude).not.toContain("v1");
  });

  it("retries an interrupted install with the choice stored on its record", async () => {
    fake.installs = [record({ status: "incomplete", enableAlerts: true, destination: "oncall" })];
    fake.installPack.mockResolvedValue(record());
    const flow = setup();
    await flow.load();
    expect(await flow.retry()).toBe(true);
    const retry = fake.installPack.mock.calls[0][1];
    expect(retry.enableAlerts).toBe(true);
    expect(retry.destination).toBe("oncall");
  });

  it("retries a record without a stored choice with alerts off", async () => {
    fake.installs = [record({ status: "incomplete" })];
    fake.installPack.mockResolvedValue(record());
    const flow = setup();
    await flow.load();
    await flow.retry();
    const retry = fake.installPack.mock.calls[0][1];
    expect(retry.enableAlerts).toBe(false);
    expect(retry.destination).toBeUndefined();
  });

  it("keeps alerts silent by default", async () => {
    fake.installPack.mockResolvedValue(record());
    const flow = setup();
    await flow.install();
    expect(fake.installPack.mock.calls[0][1].enableAlerts).toBe(false);
    expect(flow.alertsOn.value).toBe(0);
  });

  it("counts only the alerts the install created", async () => {
    const items = record().items;
    fake.installs = [
      record({ items: [...items, { kind: "alert", itemId: "a2", status: "failed" }] }),
    ];
    const flow = setup();
    await flow.load();
    expect(flow.alertsTotal.value).toBe(1);
  });

  it("lands on the pack dashboard when the plan has no Kubernetes view", async () => {
    fake.installPack.mockResolvedValue(record());
    const flow = setup({ zoConfig: { features: { kubernetes_monitoring: "locked" } } });
    await flow.install();
    await flow.land();
    expect(fake.push).toHaveBeenCalledWith({
      name: "viewDashboard",
      query: { org_identifier: "org", dashboard: "d1", folder: "fd" },
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
      query: { org_identifier: "org", dashboard: "d1", folder: "fd" },
    });
  });

  it("names items from the pack itself until the preview has loaded", async () => {
    const pack = {
      ...PACK,
      alerts: ["lib/cpu", "lib/bare"],
      dashboards: [{ id: "host_metrics", title: "Host Metrics" }],
      savedViews: [{ id: "events", name: "Events" }],
      bundledAlerts: [{ entry: { id: "lib/cpu", title: "High CPU" }, file: {} }],
    } as unknown as StarterPack;
    fake.previewPack.mockRejectedValueOnce(new Error("down"));
    const flow = setup({}, pack);
    await flow.loadPreview();
    expect(["host_metrics", "events", "lib/cpu", "lib/bare"].map(flow.nameOf)).toEqual([
      "Host Metrics",
      "Events",
      "High CPU",
      "lib/bare",
    ]);
  });

  it("names a Library alert from the cached Library before the preview has loaded", () => {
    const pack = { ...PACK, alerts: ["lib/cpu"] } as unknown as StarterPack;
    const manifest = { alerts: [{ id: "lib/cpu", title: "Host high CPU usage" }] };
    const flow = setup({ alertLibrary: { manifest } }, pack);
    expect(flow.nameOf("lib/cpu")).toBe("Host high CPU usage");
  });

  const refused = Object.assign(new Error("http"), { response: { status: 403 } });

  it("calls a refused preview forbidden, not a load error to retry", async () => {
    fake.previewPack.mockRejectedValueOnce(refused);
    const flow = setup();
    await flow.loadPreview();
    expect(flow.previewState.value).toBe("forbidden");
    expect(flow.forbidden.value).toBe(true);
    fake.previewPack.mockRejectedValueOnce(new Error("down"));
    await flow.loadPreview();
    expect(flow.previewState.value).toBe("error");
  });

  it("calls a refused record read forbidden, not a load failure", async () => {
    fake.listError = refused;
    const flow = setup();
    await flow.load();
    expect(flow.forbidden.value).toBe(true);
    expect(flow.loadFailed.value).toBe(false);
    fake.listError = new Error("down");
    await flow.load();
    expect(flow.loadFailed.value).toBe(true);
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

  it("names who is already setting the pack up, and clears it on the next setup", async () => {
    fake.installPack.mockRejectedValueOnce(new StarterPackBusyError("first@x"));
    const flow = setup();
    expect(await flow.install()).toBe(false);
    expect(flow.busyBy.value).toBe("first@x");
    expect(flow.installFailed.value).toBe(false);
    expect(flow.forbidden.value).toBe(false);
    fake.installPack.mockResolvedValueOnce(record());
    await flow.install();
    expect(flow.busyBy.value).toBeNull();
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

  it("names who started an unfinished setup when it was not this user", async () => {
    fake.installs = [record({ status: "incomplete", installedBy: "other@x" })];
    const other = setup();
    await other.load();
    expect(other.interrupted.value).toBe(true);
    expect(other.interruptedBy.value).toBe("other@x");

    fake.installs = [record({ status: "incomplete", installedBy: undefined })];
    const unknown = setup();
    await unknown.load();
    expect(unknown.interruptedBy.value).toBe("");

    fake.installs = [record({ status: "incomplete" })];
    const own = setup();
    await own.load();
    expect(own.interruptedBy.value).toBeNull();
    fake.installs = [record()];
    const done = setup();
    await done.load();
    expect(done.interruptedBy.value).toBeNull();
  });

  it("shows this user's own unfinished setup over someone else's", async () => {
    fake.installs = [
      record({ installId: "theirs", status: "incomplete", installedBy: "other@x" }),
      record({ installId: "mine", status: "incomplete" }),
    ];
    const flow = setup();
    await flow.load();
    expect(flow.record.value?.installId).toBe("mine");
    expect(flow.interruptedBy.value).toBeNull();
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

  it("reads the plan again after an Undo that kept an edited item", async () => {
    fake.installs = [record()];
    fake.previewPack.mockResolvedValueOnce({
      items: [
        { kind: "dashboard", itemId: "overview", status: "existing", id: "d1" },
        { kind: "alert", itemId: "a1", status: "existing", id: "al1" },
      ],
      names: {},
      notIncluded: [],
    });
    const flow = setup();
    await flow.load();
    await flow.loadPreview();
    fake.undoPack.mockResolvedValueOnce({
      removed: [{ kind: "alert", itemId: "a1" }],
      kept: [{ kind: "dashboard", itemId: "overview", reason: "changed" }],
    });
    const after = {
      items: [
        { kind: "dashboard", itemId: "overview", status: "existing", id: "d1" },
        { kind: "alert", itemId: "a1", status: "pending" },
      ],
      names: {},
      notIncluded: [],
    };
    fake.previewPack.mockResolvedValueOnce(after);
    fake.installs = [];
    expect(await flow.undo()).toBe(true);
    expect(flow.preview.value).toEqual(after);
    expect(flow.previewState.value).toBe("ready");
    expect(flow.alertCount.value).toBe(1);
  });

  it("gives the header chip the pack back only once Undo cleared the install", async () => {
    fake.markRemoved.mockClear();
    fake.installs = [record()];
    const flow = setup();
    await flow.load();
    fake.undoPack.mockResolvedValueOnce({
      removed: [],
      kept: [{ kind: "alert", itemId: "a1", reason: "delete_failed" }],
    });
    await flow.undo();
    expect(fake.markRemoved).not.toHaveBeenCalled();

    fake.installs = [];
    fake.undoPack.mockResolvedValueOnce({ removed: [{}], kept: [] });
    await flow.undo();
    expect(fake.markRemoved).toHaveBeenCalledWith("kubernetes");
  });

  it("asks for no plan after an Undo on a surface that never showed one", async () => {
    fake.installs = [record()];
    const flow = setup();
    await flow.load();
    fake.undoPack.mockResolvedValueOnce({ removed: [{}], kept: [] });
    await flow.undo();
    expect(fake.previewPack).not.toHaveBeenCalled();
  });

  it("counts the items a failed folder left unmade as failed, so they can be retried", async () => {
    fake.installPack.mockResolvedValueOnce(
      record({
        status: "incomplete",
        items: [
          { kind: "folder", itemId: "alerts", status: "failed" },
          { kind: "dashboard", itemId: "overview", status: "pending" },
          { kind: "alert", itemId: "a1", status: "pending" },
        ],
      }),
    );
    const flow = setup();
    expect(await flow.install()).toBe(false);
    expect(flow.failed.value.map(({ itemId }) => itemId)).toEqual(["overview", "a1"]);
    expect(flow.toCreate.value).toHaveLength(2);
    fake.installPack.mockResolvedValueOnce(record());
    expect(await flow.retry()).toBe(true);
    expect(flow.failed.value).toHaveLength(0);
  });

  it("counts a failed folder that blocked nothing as the failure, so Retry is offered", async () => {
    fake.installPack.mockResolvedValueOnce(
      record({
        status: "incomplete",
        items: [
          { kind: "folder", itemId: "alerts", status: "failed" },
          { kind: "dashboard", itemId: "overview", status: "existing", id: "d1" },
          { kind: "alert", itemId: "a1", status: "skipped" },
        ],
      }),
    );
    const flow = setup();
    expect(await flow.install()).toBe(false);
    expect(flow.failed.value.map(({ kind, itemId }) => [kind, itemId])).toEqual([
      ["folder", "alerts"],
    ]);
    expect(flow.items.value.some(({ kind }) => kind === "folder")).toBe(false);
  });

  it("refreshes the org's resources check after every install, undo and remove", async () => {
    const flow = setup();
    fake.installPack.mockResolvedValueOnce(record());
    await flow.install();
    expect(fake.refreshResources).toHaveBeenLastCalledWith("org");
    fake.installPack.mockRejectedValueOnce(new Error("down"));
    await flow.install();
    expect(fake.refreshResources).toHaveBeenCalledTimes(2);
    fake.undoPack.mockResolvedValueOnce({ removed: [{}], kept: [] });
    await flow.undo();
    expect(fake.refreshResources).toHaveBeenCalledTimes(3);
    fake.removePack.mockResolvedValueOnce({ removed: [{}], kept: [] });
    await flow.remove();
    expect(fake.refreshResources).toHaveBeenCalledTimes(4);
    expect(fake.refreshResources.mock.calls.every(([org]) => org === "org")).toBe(true);
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
      query: { org_identifier: "org", dashboard: "d9", folder: "f9" },
    });
  });

  it("stays put when the pack made no dashboard", async () => {
    const flow = setup({ zoConfig: { features: { kubernetes_monitoring: "locked" } } });
    await flow.land();
    expect(fake.push).not.toHaveBeenCalled();
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
