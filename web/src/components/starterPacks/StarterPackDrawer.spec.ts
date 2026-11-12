import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { nextTick, ref, shallowRef } from "vue";

import i18n from "@/locales";

import StarterPackDrawer from "./StarterPackDrawer.vue";
import { fakeFlow, PACK } from "./starterPackTestFlow";

const render = (flow = fakeFlow()) =>
  mount(StarterPackDrawer, {
    props: { flow, clusters: ["staging-eu-1"], open: true },
    global: {
      plugins: [i18n],
      stubs: {
        ODialog: {
          props: ["title", "subTitle", "open"],
          template:
            '<div v-if="open" data-test="stub-dialog"><span data-test="stub-dialog-title">{{ title }}</span><span data-test="stub-dialog-sub">{{ subTitle }}</span><slot name="header" /><slot /><slot name="footer" /></div>',
        },
        OTooltip: {
          props: ["disabled"],
          template:
            '<div><slot /><div v-if="!disabled" data-test="stub-tip"><slot name="content" /></div></div>',
        },
        OIcon: true,
        StarterPackAdaptedRows: true,
      },
    },
  });
type Wrapper = ReturnType<typeof render>;
const has = (wrapper: Wrapper, id: string) => wrapper.find(`[data-test="${id}"]`).exists();
const group = (wrapper: Wrapper, id: string) =>
  wrapper.get(`[data-test="starter-pack-drawer-group-${id}"]`);
const submit = (wrapper: Wrapper) => wrapper.get('[data-test="starter-pack-drawer-submit-btn"]');
const groupCheck = (wrapper: Wrapper, id: string) =>
  group(wrapper, id).get('[data-test="starter-pack-drawer-group-check"] [role="checkbox"]');
const rowChecks = (wrapper: Wrapper, id: string) =>
  group(wrapper, id).findAll('[data-test="starter-pack-drawer-row-check"] [role="checkbox"]');

const PREVIEW = {
  panels: { kept: 12, dropped: 3 },
  items: [
    { kind: "folder", itemId: "dashboards", status: "pending" },
    { kind: "dashboard", itemId: "overview", status: "pending" },
    { kind: "alert", itemId: "a1", status: "pending" },
    { kind: "alert", itemId: "a2", status: "pending" },
    { kind: "savedView", itemId: "v1", status: "pending" },
  ],
  names: {},
  notIncluded: [
    { kind: "alert", itemId: "a3", name: "Disk full", reason: "no_data" },
    { kind: "alert", itemId: "a4", name: "Mine", reason: "already_have" },
  ],
};
const ready = (over: Record<string, unknown> = {}) =>
  fakeFlow({ preview: shallowRef(PREVIEW), ...over });

const QUESTION = {
  want: "kube_pod_info",
  kind: "confirm",
  candidates: [],
  answer: { from: "kube_pod_info", to: "kube_pod_info_prod" },
};
const BINDINGS = [
  { stream: "s", from: "k8s_cluster", to: "cluster_name", tier: "alias" },
  { stream: "s", from: "k8s_namespace", to: "namespace", tier: "alias" },
];
const adaptedFlow = (over: Record<string, unknown>) =>
  ready({
    pack: { ...PACK, flavours: [{ id: "otel", titleKey: "starterPacks.kubernetes.flavourOtel" }] },
    preview: shallowRef({ ...PREVIEW, ...over }),
  });
const adaptedMeta = (wrapper: Wrapper) =>
  group(wrapper, "adapted").get('[data-test="starter-pack-drawer-group-meta"]');
const adaptedShown = (wrapper: Wrapper) =>
  group(wrapper, "adapted").find("starter-pack-adapted-rows-stub").exists();

describe("StarterPackDrawer", () => {
  it("shows one card per group with the alerts open and a counted setup button", () => {
    const wrapper = render(ready());
    expect(group(wrapper, "view").text()).toContain("Kubernetes view");
    expect(group(wrapper, "dashboard").text()).toContain("12 panels fit your data");
    expect(group(wrapper, "alert").text()).toContain("2 · silent until you turn them on");
    expect(
      group(wrapper, "alert").findAll('[data-test="starter-pack-drawer-alert-row"]'),
    ).toHaveLength(2);
    expect(has(wrapper, "starter-pack-drawer-dashboard-row")).toBe(false);
    expect(group(wrapper, "savedView").text()).toContain("Saved views in Logs");
    expect(group(wrapper, "not").text()).toContain("1 item left out");
    expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
      "Kubernetes starter pack · built for staging-eu-1",
    );
    expect(submit(wrapper).text()).toBe("Set up Kubernetes monitoring (4)");
    expect(wrapper.get('[data-test="starter-pack-drawer-reach-line"]').text()).toContain(
      "All clusters · 1 seen so far: staging-eu-1",
    );
  });

  it("keeps an item with no data yet in Not included, unselectable, with its reason", async () => {
    const wrapper = render(ready());
    await group(wrapper, "not").find("div").trigger("click");
    const row = group(wrapper, "not").get('[data-test="starter-pack-drawer-not-row"]');
    expect(row.text()).toContain("Disk full");
    expect(row.text()).toContain("Not seen yet");
    expect(row.find('[role="checkbox"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("Disk full: no data for it seen yet");
    expect(wrapper.text()).not.toContain("Mine");
  });

  it("leaves an unticked row out of the install and drops the count", async () => {
    const flow = ready();
    const wrapper = render(flow);
    await rowChecks(wrapper, "alert")[0].trigger("click");
    expect(submit(wrapper).text()).toBe("Set up Kubernetes monitoring (3)");
    await submit(wrapper).trigger("click");
    await flushPromises();
    expect(flow.install).toHaveBeenCalledWith(undefined, {
      exclude: ["a1"],
      enableAlerts: false,
    });
  });

  it("ticks a whole group from its header and shows a part-ticked group as mixed", async () => {
    const wrapper = render(ready());
    expect(groupCheck(wrapper, "alert").attributes("aria-checked")).toBe("true");
    await rowChecks(wrapper, "alert")[1].trigger("click");
    expect(groupCheck(wrapper, "alert").attributes("aria-checked")).toBe("mixed");
    await groupCheck(wrapper, "alert").trigger("click");
    expect(rowChecks(wrapper, "alert").map((box) => box.attributes("aria-checked"))).toEqual([
      "true",
      "true",
    ]);
    await groupCheck(wrapper, "alert").trigger("click");
    expect(rowChecks(wrapper, "alert").map((box) => box.attributes("aria-checked"))).toEqual([
      "false",
      "false",
    ]);
    expect(submit(wrapper).text()).toBe("Set up Kubernetes monitoring (2)");
  });

  it("disables setup when nothing is ticked", async () => {
    const wrapper = render(ready());
    for (const id of ["dashboard", "alert", "savedView"]) {
      await groupCheck(wrapper, id).trigger("click");
    }
    expect(submit(wrapper).attributes("disabled")).toBeDefined();
  });

  it("starts the alerts on creation when the switch is on", async () => {
    const flow = ready();
    const wrapper = render(flow);
    await wrapper.get('[data-test="starter-pack-drawer-start-alerts-btn"]').trigger("click");
    expect(group(wrapper, "alert").text()).toContain(
      "2 · run on creation, notify no one until a destination is added",
    );
    await submit(wrapper).trigger("click");
    await flushPromises();
    expect(flow.install).toHaveBeenCalledWith(undefined, { exclude: [], enableAlerts: true });
  });

  it("keeps the reach line true once alerts start, with or without a cluster scope", async () => {
    const scoped = render(ready());
    await scoped.get('[data-test="starter-pack-drawer-start-alerts-btn"]').trigger("click");
    expect(scoped.get('[data-test="starter-pack-drawer-reach-line"]').text()).toBe(
      "Alert scope: All clusters · 1 seen so far: staging-eu-1 · Background queries: each started alert runs on its own schedule",
    );
    const plain = render(ready({ pack: { ...PACK, clusterScoped: false } }));
    expect(plain.get('[data-test="starter-pack-drawer-reach-line"]').text()).toBe(
      "Background queries: None for now",
    );
    await plain.get('[data-test="starter-pack-drawer-start-alerts-btn"]').trigger("click");
    expect(plain.get('[data-test="starter-pack-drawer-reach-line"]').text()).toBe(
      "Background queries: each started alert runs on its own schedule",
    );
  });

  it("disables the start switch once no alert is ticked", async () => {
    const wrapper = render(ready());
    await groupCheck(wrapper, "alert").trigger("click");
    expect(
      wrapper.get('[data-test="starter-pack-drawer-start-alerts-btn"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("shows a severity pill and the bundled description on an alert row", () => {
    const pack = {
      ...PACK,
      bundledAlerts: [{ entry: { id: "a1", severity: "critical", description: "CPU above 90%" } }],
    };
    const wrapper = render(ready({ pack }));
    const [first, second] = group(wrapper, "alert").findAll(
      '[data-test="starter-pack-drawer-alert-row"]',
    );
    expect(first.get('[data-test="starter-pack-drawer-alert-severity"]').text()).toBe("Critical");
    expect(first.element.parentElement?.textContent).toContain("CPU above 90%");
    expect(second.element.parentElement?.querySelector('[data-test="stub-tip"]')).toBeNull();
  });

  it("strikes out an item whose name is in use and says the existing one is kept", async () => {
    const preview = {
      ...PREVIEW,
      items: [
        ...PREVIEW.items.slice(0, 4),
        { kind: "savedView", itemId: "v1", status: "existing" },
      ],
    };
    const wrapper = render(fakeFlow({ preview: shallowRef(preview) }));
    expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
      "1 item skipped · your existing one is kept",
    );
    await group(wrapper, "savedView").find("div").trigger("click");
    const row = group(wrapper, "savedView").get('[data-test="starter-pack-drawer-savedView-row"]');
    expect(row.text()).toContain("Skipped");
    expect(row.find(".line-through").exists()).toBe(true);
    expect(
      group(wrapper, "savedView").find('[data-test="starter-pack-drawer-group-check"]').exists(),
    ).toBe(false);
    expect(
      group(wrapper, "savedView").get('[data-test="starter-pack-drawer-name-in-use"]').text(),
    ).toContain("name-v1 already exists · yours is kept");
    expect(submit(wrapper).text()).toBe("Set up Kubernetes monitoring (3)");
  });

  it("leads with the dashboard and names its folder on a plan without the native page", () => {
    const wrapper = render(ready({ licensed: ref(false) }));
    expect(has(wrapper, "starter-pack-drawer-group-view")).toBe(false);
    expect(wrapper.findAll("section")[0].attributes("data-test")).toBe(
      "starter-pack-drawer-group-dashboard",
    );
    expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
      "Saved in the folder Kubernetes (starter pack)",
    );
    expect(group(wrapper, "not").text()).toContain("2 items left out");
  });

  it("shows skeleton cards and a disabled button while checking the data", () => {
    const flow = fakeFlow({ previewState: ref("loading") });
    const wrapper = render(flow);
    expect(wrapper.findAll('[data-test="starter-pack-drawer-loading"]')).toHaveLength(4);
    expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
      "Checking which items fit your data",
    );
    expect(submit(wrapper).attributes("disabled")).toBeDefined();
  });

  it("loads the preview on open and offers Retry when it fails", async () => {
    const flow = fakeFlow({ previewState: ref("idle") });
    render(flow);
    expect(flow.loadPreview).toHaveBeenCalledOnce();
    const failed = fakeFlow({ previewState: ref("error") });
    const wrapper = render(failed);
    await wrapper.get('[data-test="starter-pack-drawer-retry-btn"]').trigger("click");
    expect(failed.loadPreview).toHaveBeenCalledTimes(2);
  });

  it("offers only the admin link, without tick-boxes, when setup was refused", async () => {
    const wrapper = render(ready({ forbidden: ref(true) }));
    expect(wrapper.find('[role="checkbox"]').exists()).toBe(false);
    expect(has(wrapper, "starter-pack-drawer-start-alerts")).toBe(false);
    expect(has(wrapper, "starter-pack-drawer-submit-btn")).toBe(false);
    expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
      "You can't create alerts in this org",
    );
    await wrapper.get('[data-test="starter-pack-drawer-copy-link-btn"]').trigger("click");
    expect(wrapper.emitted("copy-link")).toHaveLength(1);
  });

  it("shows a set-up pack as done with each alert's real state and no tick-boxes", async () => {
    const items = [
      { kind: "dashboard", itemId: "overview", status: "created", id: "d1" },
      { kind: "alert", itemId: "a1", status: "created", id: "al1" },
      { kind: "alert", itemId: "a2", status: "created", id: "al2" },
    ];
    const flow = fakeFlow({
      installed: ref(true),
      canUndo: ref(false),
      items: ref(items),
      made: ref(items),
      toCreate: ref(items),
      enabledAlertIds: shallowRef(new Set(["al1"])),
      record: shallowRef({ installedBy: "aisha@x", installedAt: 1, items }),
    });
    const wrapper = render(flow);
    expect(wrapper.find('[role="checkbox"]').exists()).toBe(false);
    expect(group(wrapper, "alert").text()).toContain("1 on · 1 silent");
    const rows = group(wrapper, "alert").findAll('[data-test="starter-pack-drawer-alert-row"]');
    expect(rows.map((row) => row.text())).toEqual(["name-a1On", "name-a2Silent"]);
    expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toContain(
      "Installed by aisha@x",
    );
    expect(wrapper.get('[data-test="starter-pack-progress-scope"]').text()).toBe(
      "Alert scope: All clusters · 1 seen so far: staging-eu-1",
    );
    expect(has(wrapper, "starter-pack-page-remove-btn")).toBe(true);
    expect(has(wrapper, "starter-pack-progress-undo-btn")).toBe(false);
    await wrapper.get('[data-test="starter-pack-drawer-open-btn"]').trigger("click");
    await flushPromises();
    expect(flow.land).toHaveBeenCalled();
  });

  it("hides the scope line on a set-up pack without a cluster scope", () => {
    const items = [{ kind: "alert", itemId: "a1", status: "created", id: "al1" }];
    const wrapper = render(
      fakeFlow({
        installed: ref(true),
        items: ref(items),
        made: ref(items),
        pack: { ...PACK, clusterScoped: false },
      }),
    );
    expect(has(wrapper, "starter-pack-progress-scope")).toBe(false);
  });

  it("says started alerts notify no one until a destination is added", () => {
    const created = [
      { kind: "alert", itemId: "a1", status: "created" },
      { kind: "alert", itemId: "a2", status: "created" },
    ];
    const done = (alertsOff: number) =>
      render(
        fakeFlow({
          interrupted: ref(true),
          toCreate: ref(created),
          made: ref(created),
          alertsOff: ref(alertsOff),
        }),
      );
    const started = done(0);
    expect(started.get('[data-test="stub-dialog-sub"]').text()).toBe(
      "2 of 2 created · alerts run but notify no one until a destination is added",
    );
    expect(started.get('[data-test="starter-pack-progress-alerts-note"]').text()).toBe(
      "running · notify no one until a destination is added",
    );
    const silent = done(2);
    expect(silent.get('[data-test="stub-dialog-sub"]').text()).toBe(
      "2 of 2 created · alerts are silent until you turn them on",
    );
    expect(silent.get('[data-test="starter-pack-progress-alerts-note"]').text()).toBe(
      "off until you turn them on",
    );
  });

  it("closes and lands once setup completes", async () => {
    const flow = ready();
    const wrapper = render(flow);
    await submit(wrapper).trigger("click");
    await flushPromises();
    expect(flow.land).toHaveBeenCalledWith();
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("stays open with Retry after a partial failure, then lands when the retry finishes", async () => {
    const failedItem = { kind: "alert", itemId: "a2", status: "failed" };
    const flow = fakeFlow({
      interrupted: ref(true),
      failed: ref([failedItem]),
      toCreate: ref([{ kind: "alert", itemId: "a1", status: "created" }, failedItem]),
      made: ref([{ kind: "alert", itemId: "a1", status: "created" }]),
    });
    const wrapper = render(flow);
    expect(has(wrapper, "starter-pack-drawer-items")).toBe(false);
    expect(wrapper.get('[data-test="stub-dialog-title"]').text()).toBe(
      "Setting up Kubernetes monitoring",
    );
    expect(wrapper.get('[data-test="stub-dialog-sub"]').text()).toBe("1 of 2 created · 1 to retry");
    expect(wrapper.get('[data-test="starter-pack-progress-failed-row"]').text()).toContain(
      "Failed · name-a2",
    );
    expect(wrapper.get('[data-test="starter-pack-progress-kind-created-row"]').text()).toContain(
      "Created · Alerts 1 of 2",
    );
    expect(wrapper.get('[data-test="starter-pack-progress-undo-btn"]').text()).toBe("Undo setup");
    expect(wrapper.get('[data-test="starter-pack-progress-retry-btn"]').text()).toBe(
      "Retry 1 item",
    );
    await wrapper.get('[data-test="starter-pack-progress-retry-btn"]').trigger("click");
    await flushPromises();
    expect(flow.land).toHaveBeenCalled();
  });

  it("offers Finish or Undo on an interrupted install", () => {
    const wrapper = render(
      fakeFlow({
        interrupted: ref(true),
        toCreate: ref([
          { kind: "alert", itemId: "a0", status: "created" },
          { kind: "alert", itemId: "a1", status: "pending" },
        ]),
        made: ref([{ kind: "alert", itemId: "a0", status: "created" }]),
      }),
    );
    expect(has(wrapper, "starter-pack-progress-finish-btn")).toBe(true);
    expect(has(wrapper, "starter-pack-progress-undo-btn")).toBe(true);
  });

  it("hides Finish, Retry and Undo while running", () => {
    const wrapper = render(
      fakeFlow({
        running: ref(true),
        toCreate: ref([{ kind: "alert", itemId: "a1", status: "pending" }]),
      }),
    );
    expect(wrapper.get('[data-test="stub-dialog-sub"]').text()).toBe(
      "0 of 1 created · you can leave this page",
    );
    expect(wrapper.get('[data-test="starter-pack-progress-kind-creating-row"]').text()).toBe(
      "Creating · Alerts 0 of 1",
    );
    expect(has(wrapper, "starter-pack-progress-running-btn")).toBe(true);
    expect(has(wrapper, "starter-pack-progress-finish-btn")).toBe(false);
    expect(has(wrapper, "starter-pack-progress-open-btn")).toBe(false);
    expect(has(wrapper, "starter-pack-progress-undo-btn")).toBe(false);
  });

  it("says so when setup fails before anything is recorded", () => {
    const wrapper = render(ready({ installFailed: ref(true) }));
    expect(has(wrapper, "starter-pack-drawer-install-error")).toBe(true);
    expect(has(wrapper, "starter-pack-drawer-submit-btn")).toBe(true);
  });

  it("opens the first dashboard or the pack from the install dialog", async () => {
    const created = [{ kind: "dashboard", itemId: "overview", status: "created" }];
    const flow = fakeFlow({
      interrupted: ref(true),
      toCreate: ref(created),
      made: ref(created),
    });
    const wrapper = render(flow);
    expect(wrapper.get('[data-test="starter-pack-progress-open-btn"]').text()).toBe(
      "Open name-overview",
    );
    expect(has(wrapper, "starter-pack-progress-manage-btn")).toBe(true);
    await wrapper.get('[data-test="starter-pack-progress-open-btn"]').trigger("click");
    await flushPromises();
    expect(flow.land).toHaveBeenCalled();
  });

  it("offers Open dashboard when every item already exists", () => {
    const preview = {
      ...PREVIEW,
      items: [{ kind: "dashboard", itemId: "overview", status: "existing" }],
      notIncluded: [],
    };
    const wrapper = render(fakeFlow({ preview: shallowRef(preview) }));
    expect(has(wrapper, "starter-pack-drawer-open-btn")).toBe(true);
    expect(has(wrapper, "starter-pack-drawer-submit-btn")).toBe(false);
  });

  it("names the built-in pack calmly when the Library is out of reach", () => {
    const wrapper = render(fakeFlow({ preview: shallowRef({ ...PREVIEW, offline: true }) }));
    expect(wrapper.get('[data-test="starter-pack-drawer-source"]').text()).toContain(
      "can't be reached. Using the pack built into this version",
    );
  });
  it("leaves out the adapted card when nothing was adapted", () => {
    const wrapper = render(ready());
    expect(has(wrapper, "starter-pack-drawer-group-adapted")).toBe(false);
  });

  it("sums up what was matched, collapsed, with the version", async () => {
    const wrapper = render(
      adaptedFlow({ questions: [QUESTION], bindings: BINDINGS, flavours: { kube: "otel" } }),
    );
    expect(adaptedMeta(wrapper).text()).toBe(
      "1 stream and 2 fields matched to your data · OpenTelemetry",
    );
    expect(group(wrapper, "adapted").find('[role="checkbox"]').exists()).toBe(false);
    expect(adaptedShown(wrapper)).toBe(false);
    await group(wrapper, "adapted").find("div").trigger("click");
    expect(adaptedShown(wrapper)).toBe(true);
  });

  it("names only the matched kind there is", () => {
    const wrapper = render(adaptedFlow({ bindings: BINDINGS.slice(0, 1) }));
    expect(adaptedMeta(wrapper).text()).toBe("1 field matched to your data");
  });

  it("opens on its own and warns when a choice is open", () => {
    const wrapper = render(
      adaptedFlow({
        questions: [
          QUESTION,
          { want: "kube_node_status_allocatable", kind: "confirm", candidates: [] },
          { want: "k8s_events", kind: "none", candidates: [] },
        ],
        bindings: BINDINGS,
      }),
    );
    expect(adaptedMeta(wrapper).text()).toBe("1 needs your choice · 1 not found · 3 matched");
    expect(adaptedMeta(wrapper).classes()).toContain("text-status-warning-text");
    expect(adaptedShown(wrapper)).toBe(true);
  });

  it("keeps the version in the summary while a choice is open", () => {
    const wrapper = render(
      adaptedFlow({
        questions: [{ want: "kube_node_status_allocatable", kind: "confirm", candidates: [] }],
        bindings: BINDINGS,
        flavours: { kube: "otel" },
      }),
    );
    expect(adaptedMeta(wrapper).text()).toBe("1 needs your choice · 2 matched · OpenTelemetry");
  });

  it("stays open once the last open question is answered", async () => {
    const ask = { want: "kube_pod_info", kind: "confirm", candidates: [] };
    const flow = adaptedFlow({ questions: [ask] });
    const wrapper = render(flow);
    expect(adaptedShown(wrapper)).toBe(true);
    flow.preview.value = { ...PREVIEW, questions: [QUESTION] } as never;
    await nextTick();
    expect(adaptedMeta(wrapper).text()).toBe("1 stream matched to your data");
    expect(adaptedShown(wrapper)).toBe(true);
  });

  it("opens but stays neutral when a stream is only missing", () => {
    const wrapper = render(
      adaptedFlow({ questions: [{ want: "k8s_events", kind: "none", candidates: [] }] }),
    );
    expect(adaptedMeta(wrapper).text()).toBe("1 not found");
    expect(adaptedMeta(wrapper).classes()).not.toContain("text-status-warning-text");
    expect(adaptedShown(wrapper)).toBe(true);
  });
});
