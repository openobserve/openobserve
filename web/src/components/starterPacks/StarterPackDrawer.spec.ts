import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref, shallowRef } from "vue";

import i18n from "@/locales";
import {
  resetBrowserMatches,
  useBrowserMatches,
} from "@/composables/starterPacks/useBrowserMatches";

const mocks = vi.hoisted(() => ({
  destinations: [] as any[],
  read: null as null | (() => Promise<any[]>),
  state: { userInfo: { email: "user@example.com" }, zoConfig: {} as Record<string, unknown> },
  ensure: vi.fn(),
  push: vi.fn(async () => undefined),
}));

vi.mock("vuex", () => ({ useStore: () => ({ state: mocks.state }) }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/composables/query/readQuery", () => ({
  readQuery: async () => (mocks.read ? mocks.read() : mocks.destinations),
}));
vi.mock("@/composables/starterPacks/useEmailMeDestination", () => ({
  useEmailMeDestination: () => ({ ensure: mocks.ensure }),
}));

import StarterPackDrawer from "./StarterPackDrawer.vue";
import { fakeFlow, PACK } from "./starterPackTestFlow";

const SLACK = { name: "oncall", type: "http", destination_type_name: "slack" };

beforeEach(() => {
  mocks.destinations = [SLACK, { name: "hook", type: "http" }];
  mocks.read = null;
  mocks.state.zoConfig = {};
  mocks.ensure.mockReset();
  mocks.push.mockClear();
});

const render = (flow = fakeFlow(), props: Record<string, unknown> = {}) =>
  mount(StarterPackDrawer, {
    props: { flow, clusters: ["staging-eu-1"], open: true, ...props },
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
        OSelect: {
          props: ["modelValue", "options", "disabled"],
          emits: ["update:modelValue"],
          template:
            '<select :value="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option></select>',
        },
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
const box = (wrapper: Wrapper, id: string) =>
  wrapper.get(`[data-test="starter-pack-alert-setup-${id}"] [role="checkbox"]`);
const shown = async (flow = ready(), props: Record<string, unknown> = {}) => {
  const wrapper = render(flow, props);
  await flushPromises();
  return wrapper;
};

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
    pack: {
      ...PACK,
      flavours: [{ id: "otel", titleKey: "starterPacks.packs.kubernetes.flavours.opentelemetry" }],
    },
    preview: shallowRef({ ...PREVIEW, ...over }),
  });
const adaptedMeta = (wrapper: Wrapper) =>
  group(wrapper, "adapted").get('[data-test="starter-pack-drawer-group-meta"]');
const adaptedShown = (wrapper: Wrapper) =>
  group(wrapper, "adapted").find("starter-pack-adapted-rows-stub").exists();

describe("StarterPackDrawer", () => {
  it("shows one card per group with the alerts open and a Set up button", async () => {
    const wrapper = await shown();
    expect(group(wrapper, "view").text()).toContain("Kubernetes view");
    expect(group(wrapper, "dashboard").text()).toContain("12 panels fit your data");
    expect(group(wrapper, "alert").text()).toContain("2 · 0 critical · 0 warning");
    expect(
      group(wrapper, "alert").findAll('[data-test="starter-pack-drawer-alert-row"]'),
    ).toHaveLength(2);
    expect(has(wrapper, "starter-pack-drawer-dashboard-row")).toBe(false);
    expect(group(wrapper, "savedView").text()).toContain("Saved views in Logs");
    expect(group(wrapper, "not").text()).toContain("1 item left out");
    expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
      "Kubernetes starter pack · built for staging-eu-1",
    );
    expect(submit(wrapper).text()).toBe("Set up");
    expect(wrapper.get('[data-test="starter-pack-drawer-summary"]').text()).toBe(
      "4 items. You can undo the setup for 24 hours.",
    );
    expect(wrapper.text()).toContain("Kubernetes pack");
    expect(has(wrapper, "starter-pack-drawer-stepper")).toBe(true);
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

  it("lists a saved view whose stream was not found under Not included", async () => {
    const flow = ready({
      preview: shallowRef({
        ...PREVIEW,
        items: PREVIEW.items.filter(({ kind }) => kind !== "savedView"),
        notIncluded: [{ kind: "savedView", itemId: "v1", name: "Events", reason: "no_data" }],
      }),
    });
    const wrapper = render(flow);
    await group(wrapper, "not").find("div").trigger("click");
    const row = group(wrapper, "not").get('[data-test="starter-pack-drawer-not-row"]');
    expect(row.text()).toContain("Events");
    expect(row.text()).toContain("Not seen yet");
    expect(wrapper.find('[data-test="starter-pack-drawer-group-savedView"]').exists()).toBe(false);
  });

  it("leaves an unticked row out of the install and drops the count", async () => {
    const flow = ready();
    const wrapper = await shown(flow);
    await rowChecks(wrapper, "alert")[0].trigger("click");
    expect(wrapper.get('[data-test="starter-pack-drawer-summary"]').text()).toContain("3 items");
    await submit(wrapper).trigger("click");
    await flushPromises();
    expect(flow.install).toHaveBeenCalledWith(undefined, {
      exclude: ["a1"],
      enableAlerts: true,
      destination: "oncall",
    });
  });

  it("sets up into the folder its host chose", async () => {
    const flow = ready();
    const wrapper = await shown(flow, { folderName: "Team K8s" });
    await submit(wrapper).trigger("click");
    await flushPromises();
    expect(flow.install).toHaveBeenCalledWith("Team K8s", {
      exclude: [],
      enableAlerts: true,
      destination: "oncall",
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
    expect(wrapper.get('[data-test="starter-pack-drawer-summary"]').text()).toContain("2 items");
  });

  it("disables setup when nothing is ticked", async () => {
    const wrapper = render(ready());
    for (const id of ["dashboard", "alert", "savedView"]) {
      await groupCheck(wrapper, id).trigger("click");
    }
    expect(submit(wrapper).attributes("disabled")).toBeDefined();
  });

  describe("alerts block", () => {
    it("preselects the first destination and ticks both boxes", async () => {
      const wrapper = await shown();
      expect(box(wrapper, "turn-on-check").attributes("aria-checked")).toBe("true");
      expect(box(wrapper, "send-to").attributes("aria-checked")).toBe("true");
      expect(wrapper.get('[data-test="starter-pack-alert-setup-turn-on-label"]').text()).toBe(
        "Turn on the 2 pack alerts",
      );
      const select = wrapper.get('[data-test="starter-pack-alert-setup-dest-select"]');
      expect((select.element as HTMLSelectElement).value).toBe("oncall");
      expect(select.text()).toContain("oncall · Slack webhook");
      expect(select.text()).toContain("hook · Custom (Webhook)");
      expect(wrapper.get('[data-test="starter-pack-alert-setup-first-of"]').text()).toBe(
        "First of 2 destinations in this org",
      );
      expect(has(wrapper, "starter-pack-alert-setup-history-only")).toBe(false);
    });

    it("keeps the boxes independent and hints at history-only alerts", async () => {
      const flow = ready();
      const wrapper = await shown(flow);
      await box(wrapper, "send-to").trigger("click");
      expect(box(wrapper, "turn-on-check").attributes("aria-checked")).toBe("true");
      expect(has(wrapper, "starter-pack-alert-setup-history-only")).toBe(true);
      const select = wrapper.get('[data-test="starter-pack-alert-setup-dest-select"]');
      expect(select.attributes("disabled")).toBeDefined();
      expect((select.element as HTMLSelectElement).value).toBe("oncall");
      await submit(wrapper).trigger("click");
      await flushPromises();
      expect(flow.install).toHaveBeenCalledWith(undefined, {
        exclude: [],
        enableAlerts: true,
        destination: undefined,
      });
    });

    it("creates alerts off with the destination set when only Send to is ticked", async () => {
      const flow = ready();
      const wrapper = await shown(flow);
      await box(wrapper, "turn-on-check").trigger("click");
      expect(box(wrapper, "send-to").attributes("aria-checked")).toBe("true");
      expect(has(wrapper, "starter-pack-alert-setup-history-only")).toBe(false);
      await submit(wrapper).trigger("click");
      await flushPromises();
      expect(flow.install).toHaveBeenCalledWith(undefined, {
        exclude: [],
        enableAlerts: false,
        destination: "oncall",
      });
    });

    it("hides the block while the Alerts group is unticked", async () => {
      const wrapper = await shown();
      await groupCheck(wrapper, "alert").trigger("click");
      expect(has(wrapper, "starter-pack-alert-setup")).toBe(false);
    });

    it("leaves out email destinations when SMTP is known to be off", async () => {
      mocks.state.zoConfig = { smtp_enabled: false };
      mocks.destinations = [{ name: "mail", type: "email", emails: ["a@example.com"] }, SLACK];
      const wrapper = await shown();
      expect(
        wrapper.get('[data-test="starter-pack-alert-setup-dest-select"]').text(),
      ).not.toContain("mail");
    });

    it("offers Email me when the org has no destination and creates it before setup", async () => {
      mocks.destinations = [];
      mocks.ensure.mockResolvedValue({ name: "email-user@example.com" });
      const flow = ready();
      const wrapper = await shown(flow);
      const label = wrapper.get('[data-test="starter-pack-alert-setup-email-me"]');
      expect(label.text().replace(/\s+/g, " ")).toBe("Send to: Email me — user@example.com");
      expect(label.html().indexOf("Send to:")).toBeLessThan(
        label.html().indexOf('data-test="starter-pack-alert-setup-email-icon"'),
      );
      expect(has(wrapper, "starter-pack-alert-setup-email-note")).toBe(true);
      await submit(wrapper).trigger("click");
      await flushPromises();
      expect(mocks.ensure).toHaveBeenCalledWith("user@example.com");
      expect(flow.install).toHaveBeenCalledWith(undefined, {
        exclude: [],
        enableAlerts: true,
        destination: "email-user@example.com",
      });
    });

    it("never creates Email me while Send to is unticked", async () => {
      mocks.destinations = [];
      const wrapper = await shown();
      await box(wrapper, "send-to").trigger("click");
      expect(has(wrapper, "starter-pack-alert-setup-email-note")).toBe(false);
      expect(has(wrapper, "starter-pack-alert-setup-history-only")).toBe(true);
      await submit(wrapper).trigger("click");
      await flushPromises();
      expect(mocks.ensure).not.toHaveBeenCalled();
    });

    it("runs the install with alerts off when Email me cannot be saved", async () => {
      mocks.destinations = [];
      mocks.ensure.mockResolvedValue({ failure: "email" });
      const flow = ready();
      const wrapper = await shown(flow);
      await submit(wrapper).trigger("click");
      await flushPromises();
      expect(flow.install).toHaveBeenCalledWith(undefined, {
        exclude: [],
        enableAlerts: false,
        destination: undefined,
      });
    });

    it("disables Send to with a note when there is nothing to send to", async () => {
      mocks.destinations = [];
      mocks.state.zoConfig = { smtp_enabled: false };
      const wrapper = await shown();
      expect(box(wrapper, "send-to").attributes("aria-checked")).toBe("false");
      expect(box(wrapper, "send-to").attributes("disabled")).toBeDefined();
      expect(box(wrapper, "turn-on-check").attributes("aria-checked")).toBe("false");
      expect(has(wrapper, "starter-pack-alert-setup-no-destination")).toBe(true);
      await box(wrapper, "turn-on-check").trigger("click");
      expect(has(wrapper, "starter-pack-alert-setup-history-only")).toBe(true);
    });

    it("waits for the destinations before Set up, drawn with both boxes ticked", () => {
      const wrapper = render(ready());
      expect(has(wrapper, "starter-pack-alert-setup-dest-loading")).toBe(true);
      expect(box(wrapper, "turn-on-check").attributes("aria-checked")).toBe("true");
      expect(box(wrapper, "send-to").attributes("aria-checked")).toBe("true");
      expect(box(wrapper, "send-to").attributes("disabled")).toBeUndefined();
      expect(submit(wrapper).attributes("disabled")).toBeDefined();
    });

    it("decides the defaults once the destinations arrive", async () => {
      mocks.destinations = [];
      mocks.state.zoConfig = { smtp_enabled: false };
      const wrapper = render(ready());
      expect(box(wrapper, "turn-on-check").attributes("aria-checked")).toBe("true");
      await flushPromises();
      expect(has(wrapper, "starter-pack-alert-setup-dest-loading")).toBe(false);
      expect(box(wrapper, "turn-on-check").attributes("aria-checked")).toBe("false");
      expect(box(wrapper, "send-to").attributes("aria-checked")).toBe("false");
    });

    it("ignores a destination list that arrives after a newer one", async () => {
      let finishOld!: (rows: any[]) => void;
      mocks.read = () => new Promise((done) => (finishOld = done));
      const wrapper = render(ready());
      await wrapper.setProps({ open: false });
      mocks.read = async () => [SLACK];
      await wrapper.setProps({ open: true });
      await flushPromises();
      finishOld([]);
      await flushPromises();
      const select = wrapper.get('[data-test="starter-pack-alert-setup-dest-select"]');
      expect((select.element as HTMLSelectElement).value).toBe("oncall");
      expect(box(wrapper, "send-to").attributes("aria-checked")).toBe("true");
    });

    it("keeps a box the user changed while the destinations loaded", async () => {
      let arrive!: (rows: any[]) => void;
      mocks.read = () => new Promise((done) => (arrive = done));
      const wrapper = render(ready());
      await box(wrapper, "turn-on-check").trigger("click");
      arrive([SLACK]);
      await flushPromises();
      expect(box(wrapper, "turn-on-check").attributes("aria-checked")).toBe("false");
      expect(box(wrapper, "send-to").attributes("aria-checked")).toBe("true");
    });

    it("forces Send to off when there turns out to be nothing to send to", async () => {
      mocks.state.zoConfig = { smtp_enabled: false };
      let arrive!: (rows: any[]) => void;
      mocks.read = () => new Promise((done) => (arrive = done));
      const wrapper = render(ready());
      await box(wrapper, "send-to").trigger("click");
      await box(wrapper, "send-to").trigger("click");
      await box(wrapper, "turn-on-check").trigger("click");
      await box(wrapper, "turn-on-check").trigger("click");
      arrive([]);
      await flushPromises();
      expect(box(wrapper, "send-to").attributes("aria-checked")).toBe("false");
      expect(box(wrapper, "turn-on-check").attributes("aria-checked")).toBe("true");
    });

    it("names only the destination on the creating alerts row", async () => {
      const flow = ready();
      const wrapper = await shown(flow);
      flow.install = vi.fn(async () => {
        flow.toCreate.value = [{ kind: "alert", itemId: "a1", status: "pending" }] as never;
        flow.running.value = true;
        return new Promise<boolean>(() => {});
      }) as never;
      await submit(wrapper).trigger("click");
      await flushPromises();
      const row = wrapper.get('[data-test="starter-pack-progress-kind-creating-row"]');
      expect(row.text()).toContain("Creating · on, sending to oncall");
      expect(row.text()).not.toContain("Slack");
    });

    it("names Email me the way Ready does on the creating alerts row", async () => {
      mocks.destinations = [];
      mocks.ensure.mockResolvedValue({ name: "email-user@example.com" });
      const flow = ready();
      const wrapper = await shown(flow);
      flow.install = vi.fn(async () => {
        flow.toCreate.value = [{ kind: "alert", itemId: "a1", status: "pending" }] as never;
        flow.running.value = true;
        return new Promise<boolean>(() => {});
      }) as never;
      await submit(wrapper).trigger("click");
      await flushPromises();
      expect(wrapper.get('[data-test="starter-pack-progress-kind-creating-row"]').text()).toContain(
        "Creating · on, sending to Email me (user@example.com)",
      );
    });

    it("keeps the reach line true once alerts are turned on", async () => {
      const wrapper = await shown();
      expect(wrapper.get('[data-test="starter-pack-drawer-reach-line"]').text()).toBe(
        "Alert scope: All clusters · 1 seen so far: staging-eu-1 · Background queries: each started alert runs on its own schedule",
      );
      await box(wrapper, "turn-on-check").trigger("click");
      expect(wrapper.get('[data-test="starter-pack-drawer-reach-line"]').text()).toBe(
        "Alert scope: All clusters · 1 seen so far: staging-eu-1 · Background queries: None for now",
      );
    });
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
    expect(has(wrapper, "starter-pack-alert-setup")).toBe(false);
    expect(has(wrapper, "starter-pack-drawer-submit-btn")).toBe(false);
    expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
      "Kubernetes · you can see this pack but not set it up",
    );
    expect(wrapper.get('[data-test="starter-pack-drawer-forbidden"]').text()).toBe(
      "You can't create alerts in this org",
    );
    const copy = wrapper.get('[data-test="starter-pack-drawer-copy-link-btn"]');
    expect(copy.text()).toBe("Copy link for an admin");
    await copy.trigger("click");
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

  it("moves to Ready when setup completes and never navigates by itself", async () => {
    const flow = ready();
    const wrapper = await shown(flow);
    flow.install = vi.fn(async () => {
      flow.running.value = true;
      await nextTick();
      flow.installed.value = true;
      flow.running.value = false;
      return true;
    }) as never;
    await submit(wrapper).trigger("click");
    await flushPromises();
    expect(has(wrapper, "starter-pack-ready")).toBe(true);
    expect(flow.land).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(wrapper.emitted("update:open")).toBeUndefined();
    expect(wrapper.emitted("installed")).toHaveLength(1);
  });

  it("drops the installed pack from this browser's header matches", async () => {
    window.localStorage.clear();
    resetBrowserMatches();
    const source = {
      id: "kubernetes",
      packId: "kubernetes",
      label: "kubernetes",
      streams: [],
      items: [],
      queriesPerDay: 0,
    };
    useBrowserMatches("org").saveFull({ checkedAt: 1, sources: [source], dismissed: 0 }, []);
    const wrapper = await shown();
    await submit(wrapper).trigger("click");
    await flushPromises();
    expect(useBrowserMatches("org").copy.value).toMatchObject({
      sources: [],
      installedPackIds: ["kubernetes"],
    });
  });

  it("keeps the header match and stays put when the install failed", async () => {
    window.localStorage.clear();
    resetBrowserMatches();
    const source = {
      id: "kubernetes",
      packId: "kubernetes",
      label: "kubernetes",
      streams: [],
      items: [],
      queriesPerDay: 0,
    };
    useBrowserMatches("org").saveFull({ checkedAt: 1, sources: [source], dismissed: 0 }, []);
    const flow = ready({ install: vi.fn(async () => false) });
    const wrapper = await shown(flow);
    await submit(wrapper).trigger("click");
    await flushPromises();
    expect(useBrowserMatches("org").copy.value).toMatchObject({
      sources: [source],
      installedPackIds: [],
    });
    expect(flow.land).not.toHaveBeenCalled();
  });

  it("shows an interrupted setup as step 2 with Retry and Manage pack, and no Undo", async () => {
    const failedItem = { kind: "alert", itemId: "a2", status: "failed" };
    const flow = fakeFlow({
      interrupted: ref(true),
      failed: ref([failedItem]),
      toCreate: ref([{ kind: "alert", itemId: "a1", status: "created" }, failedItem]),
      made: ref([{ kind: "alert", itemId: "a1", status: "created" }]),
    });
    const wrapper = render(flow);
    await flushPromises();
    expect(has(wrapper, "starter-pack-drawer-items")).toBe(false);
    expect(wrapper.get('[data-test="starter-pack-progress"]').text()).toContain(
      "1 of 2 items created",
    );
    expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
      "1 of 2 created · 1 needs your attention",
    );
    expect(wrapper.text()).toContain("Interrupted");
    expect(wrapper.get('[data-test="starter-pack-progress-failed-row"]').text()).toContain(
      "Failed · name-a2",
    );
    expect(has(wrapper, "starter-pack-progress-undo-btn")).toBe(false);
    expect(has(wrapper, "starter-pack-progress-manage-btn")).toBe(true);
    expect(wrapper.get('[data-test="starter-pack-progress-retry-btn"]').text()).toBe(
      "Retry 1 item",
    );
    await wrapper.get('[data-test="starter-pack-progress-retry-btn"]').trigger("click");
    await flushPromises();
    expect(flow.retry).toHaveBeenCalled();
    expect(flow.install).not.toHaveBeenCalled();
    expect(flow.land).not.toHaveBeenCalled();
  });

  it("shows the stored alert choice on Ready after a resumed install", async () => {
    const items = [{ kind: "alert", itemId: "a1", status: "created", id: "al1" }];
    const flow = fakeFlow({
      interrupted: ref(true),
      items: ref(items),
      toCreate: ref([{ kind: "alert", itemId: "a1", status: "pending" }]),
      record: shallowRef({ status: "incomplete", enableAlerts: true, destination: "oncall" }),
    });
    flow.retry = vi.fn(async () => {
      flow.interrupted.value = false;
      flow.running.value = true;
      await nextTick();
      flow.made.value = items as never;
      flow.installed.value = true;
      flow.running.value = false;
      return true;
    }) as never;
    const wrapper = render(flow);
    await flushPromises();
    await wrapper.get('[data-test="starter-pack-progress-finish-btn"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-test="starter-pack-ready-summary-alerts"]').text()).toBe(
      "1 alert on → oncall · Slack webhook",
    );
  });

  it("offers Finish on an interrupted install without failures", () => {
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
    expect(has(wrapper, "starter-pack-progress-undo-btn")).toBe(false);
  });

  it("shows progress inside the popup while running, with the come-back line", () => {
    const wrapper = render(
      fakeFlow({
        running: ref(true),
        toCreate: ref([{ kind: "alert", itemId: "a1", status: "pending" }]),
      }),
    );
    expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
      "Setting up · 0 of 1 created",
    );
    expect(wrapper.text()).toContain("Setting up…");
    expect(wrapper.get('[data-test="starter-pack-progress-come-back"]').text()).toBe(
      "0 of 1 created · you can close this and keep working. Find it again under Data → Starter Packs.",
    );
    const row = wrapper.get('[data-test="starter-pack-progress-kind-creating-row"]');
    expect(row.text()).toContain("Alerts 0 of 1");
    expect(row.text()).toContain("Creating");
    const running = wrapper.get('[data-test="starter-pack-progress-running-btn"]');
    expect(running.text()).toBe("Setting up…");
    expect(running.attributes("disabled")).toBeDefined();
    expect(running.find('[data-test="starter-pack-step-spinner"]').exists()).toBe(true);
    expect(has(wrapper, "starter-pack-progress-finish-btn")).toBe(false);
    expect(has(wrapper, "starter-pack-progress-undo-btn")).toBe(false);
  });

  it("says everything exists and continues to Ready when there is nothing to create", async () => {
    const preview = {
      ...PREVIEW,
      items: [{ kind: "dashboard", itemId: "overview", status: "existing" }],
      notIncluded: [],
    };
    const wrapper = render(fakeFlow({ preview: shallowRef(preview) }));
    expect(wrapper.get('[data-test="starter-pack-drawer-all-exist"]').text()).toContain(
      "You already have all 1 items in this pack",
    );
    expect(has(wrapper, "starter-pack-drawer-submit-btn")).toBe(false);
    await wrapper.get('[data-test="starter-pack-drawer-continue-btn"]').trigger("click");
    expect(has(wrapper, "starter-pack-ready")).toBe(true);
    expect(has(wrapper, "starter-pack-ready-undo-btn")).toBe(false);
  });

  describe("Ready", () => {
    const ITEMS = [
      { kind: "dashboard", itemId: "overview", status: "created", id: "d1" },
      { kind: "savedView", itemId: "v1", status: "created", id: "s1" },
      { kind: "alert", itemId: "a1", status: "created", id: "al1" },
      { kind: "alert", itemId: "a2", status: "created", id: "al2" },
    ];
    const finish = async (
      boxes: { turnOn?: boolean; sendTo?: boolean } = {},
      over: Record<string, unknown> = {},
      props: Record<string, unknown> = {},
    ) => {
      const items = (over.items as typeof ITEMS) ?? ITEMS;
      const flow = ready({
        dashboardItem: shallowRef(ITEMS[0]),
        ...over,
        items: ref(items),
      });
      const wrapper = await shown(flow, props);
      if (boxes.turnOn === false) await box(wrapper, "turn-on-check").trigger("click");
      if (boxes.sendTo === false) await box(wrapper, "send-to").trigger("click");
      flow.install = vi.fn(async () => {
        flow.running.value = true;
        await nextTick();
        flow.made.value = items.filter(({ status }) => status === "created") as never;
        flow.toCreate.value = items.filter(({ status }) => status !== "existing") as never;
        flow.installed.value = true;
        flow.running.value = false;
        return true;
      }) as never;
      await submit(wrapper).trigger("click");
      await flushPromises();
      return { wrapper, flow };
    };
    const line = (wrapper: Wrapper, id: string) =>
      wrapper.get(`[data-test="starter-pack-ready-summary-${id}"]`).text();

    it("sums up what was made with the alerts on and routed", async () => {
      const { wrapper } = await finish({}, {}, { matchState: "matched" });
      expect(wrapper.get('[data-test="starter-pack-ready-title"]').text()).toBe(
        "Kubernetes monitoring is ready",
      );
      expect(line(wrapper, "dashboards")).toBe("1 dashboard");
      expect(line(wrapper, "views")).toBe("1 saved view in Logs");
      expect(line(wrapper, "alerts")).toBe("2 alerts on → oncall · Slack webhook");
      expect(line(wrapper, "data")).toBe("Receiving data from staging-eu-1");
      expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
        "4 of 4 created · 2 alerts on",
      );
      expect(has(wrapper, "starter-pack-ready-next-native-view")).toBe(true);
      expect(wrapper.get('[data-test="starter-pack-ready-next-native-view"]').text()).toContain(
        "Recommended",
      );
      expect(wrapper.get('[data-test="starter-pack-ready-next-dashboard"]').text()).not.toContain(
        "Recommended",
      );
      expect(wrapper.get('[data-test="starter-pack-ready-undo-left"]').text()).toBe(
        "available for 5 h",
      );
    });

    it("links to adding a destination when only Turn on was ticked", async () => {
      const { wrapper } = await finish({ sendTo: false });
      expect(line(wrapper, "alerts")).toContain(
        "2 alerts on — recorded in alert history; no one is notified",
      );
      await wrapper.get('[data-test="starter-pack-ready-add-destination-btn"]').trigger("click");
      expect(mocks.push).toHaveBeenCalledWith({
        name: "starterPack",
        params: { pack: "kubernetes" },
        query: { turnOn: "1" },
      });
    });

    it("says where off alerts will send when only Send to was ticked", async () => {
      const { wrapper } = await finish({ turnOn: false });
      expect(line(wrapper, "alerts")).toContain(
        "Alerts are off — they will send to oncall · Slack webhook when you turn them on",
      );
      expect(line(wrapper, "alerts")).toContain("Turn them on from the pack page");
      expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
        "4 of 4 created · alerts off",
      );
    });

    it("says alerts are off, waits for data and recommends the dashboard without a view", async () => {
      const { wrapper } = await finish(
        { turnOn: false, sendTo: false },
        { licensed: ref(false) },
        { matchState: "waiting" },
      );
      expect(line(wrapper, "alerts")).toContain("Alerts are off");
      expect(line(wrapper, "data")).toBe(
        "Waiting for first data — dashboards fill in when it arrives",
      );
      expect(has(wrapper, "starter-pack-ready-next-native-view")).toBe(false);
      expect(wrapper.get('[data-test="starter-pack-ready-next-dashboard"]').text()).toContain(
        "Recommended",
      );
    });

    it("names Email me and gives the reason when it could not be saved", async () => {
      mocks.destinations = [];
      mocks.ensure.mockResolvedValue({ name: "email-user@example.com" });
      const on = await finish();
      expect(line(on.wrapper, "alerts")).toBe("2 alerts on → Email me (user@example.com)");
      mocks.ensure.mockResolvedValue({ failure: "forbidden" });
      const refused = await finish();
      expect(line(refused.wrapper, "alerts")).toContain(
        "Alerts are off — you can't create destinations; ask an admin",
      );
      mocks.ensure.mockResolvedValue({ failure: "email" });
      const noSmtp = await finish();
      expect(line(noSmtp.wrapper, "alerts")).toContain(
        "the email destination couldn't be saved; email is not set up on this server",
      );
    });

    it("points at the pack alerts that were already here and are off", async () => {
      const items = [
        ...ITEMS.slice(0, 3),
        { kind: "alert", itemId: "a2", status: "existing", id: "old" },
      ];
      const { wrapper } = await finish({}, { items });
      expect(line(wrapper, "alerts")).toContain("1 alert on → oncall · Slack webhook");
      expect(line(wrapper, "alerts-rest")).toContain("1 pack alert was already here and is off.");
      expect(line(wrapper, "alerts-rest")).toContain("Turn on the rest from the pack page");
      expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
        "3 of 3 created · 1 already here",
      );
    });

    it("opens the view or the dashboard only when a card is clicked", async () => {
      const { wrapper, flow } = await finish();
      await wrapper.get('[data-test="starter-pack-ready-next-native-view"]').trigger("click");
      expect(mocks.push).toHaveBeenCalledWith({
        name: "infraKubernetes",
        query: { org_identifier: "org" },
      });
      expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
      await wrapper.setProps({ open: true });
      const again = await finish();
      await again.wrapper.get('[data-test="starter-pack-ready-next-dashboard"]').trigger("click");
      await flushPromises();
      expect(again.flow.land).toHaveBeenCalled();
      expect(flow.land).not.toHaveBeenCalled();
    });

    it("undoes in place from the footer and closes without navigating", async () => {
      const { wrapper, flow } = await finish();
      await wrapper.get('[data-test="starter-pack-ready-undo-btn"]').trigger("click");
      await wrapper.get('[data-test="starter-pack-undo-confirm-btn"]').trigger("click");
      await flushPromises();
      expect(flow.undo).toHaveBeenCalled();
      expect(wrapper.emitted("done")).toHaveLength(1);
      expect(has(wrapper, "starter-pack-ready-tour-btn")).toBe(false);
    });

    it("closes from the footer and stays on the page", async () => {
      const { wrapper, flow } = await finish();
      await wrapper.get('[data-test="starter-pack-ready-close-btn"]').trigger("click");
      expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
      expect(flow.land).not.toHaveBeenCalled();
      expect(mocks.push).not.toHaveBeenCalled();
    });
  });

  it("confirms Remove in place in the footer, never in a second dialog", async () => {
    const items = [{ kind: "alert", itemId: "a1", status: "created", id: "al1" }];
    const flow = fakeFlow({
      installed: ref(true),
      canUndo: ref(false),
      items: ref(items),
      made: ref(items),
      toCreate: ref(items),
      alertsOn: ref(1),
    });
    const wrapper = render(flow);
    await wrapper.get('[data-test="starter-pack-page-remove-btn"]').trigger("click");
    expect(has(wrapper, "starter-pack-undo-dialog")).toBe(false);
    const confirm = wrapper.get('[data-test="starter-pack-drawer-confirm"]');
    expect(confirm.text()).toContain("Remove pack?");
    expect(confirm.text()).toContain("Removes 1 item · 1 live alert loses cover");
    expect(has(wrapper, "starter-pack-drawer-open-btn")).toBe(false);
    await wrapper.get('[data-test="starter-pack-drawer-confirm-cancel-btn"]').trigger("click");
    expect(has(wrapper, "starter-pack-drawer-confirm")).toBe(false);
    await wrapper.get('[data-test="starter-pack-page-remove-btn"]').trigger("click");
    await wrapper.get('[data-test="starter-pack-remove-confirm-btn"]').trigger("click");
    await flushPromises();
    expect(flow.remove).toHaveBeenCalled();
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("confirms Undo setup in place with the time left", async () => {
    const flow = fakeFlow({ installed: ref(true), canUndo: ref(true) });
    const wrapper = render(flow);
    await wrapper.get('[data-test="starter-pack-progress-undo-btn"]').trigger("click");
    const confirm = wrapper.get('[data-test="starter-pack-drawer-confirm"]');
    expect(confirm.text()).toContain("Undo setup?");
    expect(confirm.text()).toContain("5 h left to undo");
    await wrapper.get('[data-test="starter-pack-undo-confirm-btn"]').trigger("click");
    await flushPromises();
    expect(flow.undo).toHaveBeenCalled();
  });

  it("keeps the confirm open with the failure when Undo setup fails", async () => {
    const flow = fakeFlow({
      installed: ref(true),
      canUndo: ref(true),
      undo: vi.fn(async () => false),
    });
    const wrapper = render(flow);
    await wrapper.get('[data-test="starter-pack-progress-undo-btn"]').trigger("click");
    await wrapper.get('[data-test="starter-pack-undo-confirm-btn"]').trigger("click");
    await flushPromises();
    expect(flow.undo).toHaveBeenCalledTimes(1);
    expect(has(wrapper, "starter-pack-confirm-failed")).toBe(true);
    expect(has(wrapper, "starter-pack-drawer-confirm")).toBe(true);
    expect(wrapper.emitted("update:open")).toBeUndefined();
  });

  it("runs Remove once and locks the confirm while it works", async () => {
    const flow = fakeFlow({ installed: ref(true), canUndo: ref(false), busy: ref(false) });
    const wrapper = render(flow);
    await wrapper.get('[data-test="starter-pack-page-remove-btn"]').trigger("click");
    flow.busy.value = true;
    await nextTick();
    expect(
      wrapper.get('[data-test="starter-pack-drawer-confirm-cancel-btn"]').attributes("disabled"),
    ).toBeDefined();
    await wrapper.get('[data-test="starter-pack-remove-confirm-btn"]').trigger("click");
    expect(flow.remove).not.toHaveBeenCalled();
  });

  it("says so when setup fails before anything is recorded", () => {
    const wrapper = render(ready({ installFailed: ref(true) }));
    expect(has(wrapper, "starter-pack-drawer-install-error")).toBe(true);
    expect(has(wrapper, "starter-pack-drawer-submit-btn")).toBe(true);
  });

  it("offers Open pack on a set-up pack without a dashboard and Open dashboard with one", () => {
    const plain = render(fakeFlow({ installed: ref(true) }));
    expect(plain.get('[data-test="starter-pack-drawer-open-btn"]').text()).toBe("Open pack");
    const withDashboard = render(
      fakeFlow({
        installed: ref(true),
        dashboardItem: shallowRef({ kind: "dashboard", itemId: "overview", id: "d1" }),
      }),
    );
    expect(withDashboard.get('[data-test="starter-pack-drawer-open-btn"]').text()).toBe(
      "Open dashboard",
    );
  });

  it("counts only the ticked alerts, by severity, in the Alerts card", async () => {
    const pack = {
      ...PACK,
      bundledAlerts: [
        { entry: { id: "a1", severity: "critical" } },
        { entry: { id: "a2", severity: "warning" } },
      ],
    };
    const wrapper = render(ready({ pack }));
    const meta = () =>
      group(wrapper, "alert").get('[data-test="starter-pack-drawer-group-meta"]').text();
    expect(meta()).toBe("2 · 1 critical · 1 warning");
    await rowChecks(wrapper, "alert")[0].trigger("click");
    expect(meta()).toBe("1 · 0 critical · 1 warning");
    expect(has(wrapper, "starter-pack-alert-setup")).toBe(true);
  });

  it("reports done after an inline Remove or Undo succeeds, and not when it fails", async () => {
    const removed = render(fakeFlow({ installed: ref(true), canUndo: ref(false) }));
    await removed.get('[data-test="starter-pack-page-remove-btn"]').trigger("click");
    await removed.get('[data-test="starter-pack-remove-confirm-btn"]').trigger("click");
    await flushPromises();
    expect(removed.emitted("done")).toHaveLength(1);
    const failed = render(
      fakeFlow({ installed: ref(true), canUndo: ref(true), undo: vi.fn(async () => false) }),
    );
    await failed.get('[data-test="starter-pack-progress-undo-btn"]').trigger("click");
    await failed.get('[data-test="starter-pack-undo-confirm-btn"]').trigger("click");
    await flushPromises();
    expect(failed.emitted("done")).toBeUndefined();
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
