import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, reactive, ref, shallowRef } from "vue";

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

import type { PackReviewChoices } from "@/composables/starterPacks/useStarterPackPopup";
import StarterPackDrawer from "./StarterPackDrawer.vue";
import { fakeFlow, PACK } from "./starterPackTestFlow";
import { loadCatalogFixture } from "@/test/unit/helpers/starterPacksCatalog";

loadCatalogFixture();

const SLACK = { name: "oncall", type: "http", destination_type_name: "slack" };

beforeEach(() => {
  mocks.destinations = [SLACK, { name: "hook", type: "http" }];
  mocks.read = null;
  mocks.state.zoConfig = {};
  mocks.ensure.mockReset();
  mocks.push.mockClear();
});

// The popup's D14 defaults, as useStarterPackPopup makes them.
const freshChoices = (): PackReviewChoices =>
  reactive({
    unticked: new Set<string>(),
    expanded: {},
    turnOn: true,
    sendTo: false,
    destination: "",
  });

const render = (flow = fakeFlow(), props: Record<string, unknown> = {}) =>
  mount(StarterPackDrawer, {
    props: { flow, clusters: ["staging-eu-1"], choices: freshChoices(), showBack: true, ...props },
    global: {
      plugins: [i18n],
      stubs: {
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
  severities: { a1: "critical", a2: "warning" },
  descriptions: { a1: "CPU above 90%", overview: "The cluster overview" },
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
  it("shows one card per group with Dashboards and Alerts open and a Set up button", async () => {
    const wrapper = await shown();
    expect(group(wrapper, "view").text()).toContain("Kubernetes view");
    expect(group(wrapper, "dashboard").text()).toContain("12 panels fit your data");
    expect(group(wrapper, "alert").text()).toContain("2 · 1 critical · 1 warning");
    expect(
      group(wrapper, "alert").findAll('[data-test="starter-pack-drawer-alert-row"]'),
    ).toHaveLength(2);
    expect(has(wrapper, "starter-pack-drawer-dashboard-row")).toBe(true);
    expect(has(wrapper, "starter-pack-drawer-savedView-row")).toBe(false);
    expect(group(wrapper, "savedView").text()).toContain("Saved views in Logs");
    expect(group(wrapper, "not").text()).toContain("1 item left out");
    expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
      "Kubernetes starter pack · built for staging-eu-1",
    );
    expect(submit(wrapper).text()).toBe("Set up 4 items");
    expect(wrapper.get('[data-test="starter-pack-drawer-summary"]').text()).toBe(
      "You can undo this for 24 hours",
    );
    expect(wrapper.get('[data-test="starter-pack-drawer-back-btn"]').text()).toBe("Back");
    expect(wrapper.text().match(/24 hours/g)).toHaveLength(1);
    expect(wrapper.text()).toContain("Kubernetes pack");
    expect(has(wrapper, "starter-pack-drawer-stepper")).toBe(true);
    expect(wrapper.get('[data-test="starter-pack-drawer-reach-line"]').text()).toContain(
      "All clusters · 1 seen so far: staging-eu-1",
    );
  });

  it("leaves each kind's header unfilled and gives its chip the kind's colour from tokens", async () => {
    const wrapper = await shown();
    const header = (id: string) =>
      wrapper.get(`[data-test="starter-pack-drawer-group-header-${id}"]`).classes();
    const chip = (id: string) =>
      wrapper.get(`[data-test="starter-pack-drawer-group-chip-${id}"]`).classes();
    for (const id of ["dashboard", "alert", "savedView"]) {
      expect(header(id).some((name) => name.startsWith("bg-"))).toBe(false);
    }
    expect(chip("dashboard")).toEqual(expect.arrayContaining(["bg-icon-chip-info-bg"]));
    expect(chip("alert")).toEqual(expect.arrayContaining(["bg-icon-chip-orange-bg"]));
    expect(chip("savedView")).toEqual(expect.arrayContaining(["bg-icon-chip-purple-bg"]));
    for (const id of ["dashboard", "alert", "savedView"]) {
      expect(chip(id).some((name) => name.startsWith("dark:") || name === "text-white")).toBe(
        false,
      );
    }
  });

  it("goes back to the list from Back and closes from the close button", async () => {
    const wrapper = await shown();
    await wrapper.get('[data-test="starter-pack-drawer-back-btn"]').trigger("click");
    await wrapper.get('[data-test="starter-pack-popup-close-btn"]').trigger("click");
    expect(wrapper.emitted("back")).toHaveLength(1);
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(wrapper.text()).not.toMatch(/not now/i);
  });

  it("shows no Back when the pack was not opened from the popup's list", async () => {
    const wrapper = await shown(ready(), { showBack: false });
    expect(wrapper.find('[data-test="starter-pack-drawer-back-btn"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="starter-pack-drawer-submit-btn"]').exists()).toBe(true);
  });

  it("remembers ticks and expansion in the popup's choices, so a reopen keeps them", async () => {
    const choices = freshChoices();
    const first = await shown(ready(), { choices });
    await rowChecks(first, "alert")[0].trigger("click");
    await group(first, "savedView").find("div").trigger("click");
    first.unmount();
    const again = await shown(ready(), { choices });
    expect(submit(again).text()).toBe("Set up 3 items");
    expect(has(again, "starter-pack-drawer-savedView-row")).toBe(true);
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
    expect(submit(wrapper).text()).toBe("Set up 4 items");
    await rowChecks(wrapper, "alert")[0].trigger("click");
    expect(submit(wrapper).text()).toBe("Set up 3 items");
    await submit(wrapper).trigger("click");
    await flushPromises();
    expect(flow.install).toHaveBeenCalledWith(undefined, {
      exclude: ["a1"],
      enableAlerts: true,
      destination: undefined,
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
    expect(submit(wrapper).text()).toBe("Set up 2 items");
  });

  it("disables setup when nothing is ticked", async () => {
    const wrapper = render(ready());
    for (const id of ["dashboard", "alert", "savedView"]) {
      await groupCheck(wrapper, id).trigger("click");
    }
    expect(submit(wrapper).text()).toBe("Set up 0 items");
    expect(submit(wrapper).attributes("disabled")).toBeDefined();
  });

  describe("alerts block", () => {
    const pick = async (wrapper: Wrapper, name: string) => {
      await box(wrapper, "send-to").trigger("click");
      await wrapper.get('[data-test="starter-pack-alert-setup-dest-select"]').setValue(name);
    };
    const quiet = (wrapper: Wrapper) => {
      expect(wrapper.text()).not.toMatch(/no one is notified|notify no one|silent/i);
      expect(has(wrapper, "starter-pack-alert-setup-history-only")).toBe(false);
    };

    it("starts with Turn on ticked, Send to unticked and no destination picked (D14)", async () => {
      const wrapper = await shown();
      expect(box(wrapper, "turn-on-check").attributes("aria-checked")).toBe("true");
      expect(box(wrapper, "send-to").attributes("aria-checked")).toBe("false");
      expect(wrapper.get('[data-test="starter-pack-alert-setup-turn-on-label"]').text()).toBe(
        "Turn on the 2 pack alerts",
      );
      const select = wrapper.get('[data-test="starter-pack-alert-setup-dest-select"]');
      expect((select.element as HTMLSelectElement).value).toBe("");
      expect(select.attributes("disabled")).toBeDefined();
      expect(select.text()).toContain("oncall · Slack webhook");
      expect(select.text()).toContain("hook · Custom (Webhook)");
      expect(wrapper.get('[data-test="starter-pack-alert-setup-destinations"]').text()).toBe(
        "2 destinations in this org",
      );
      quiet(wrapper);
    });

    it("runs the alerts with no destination when Send to stays unticked", async () => {
      const flow = ready();
      const wrapper = await shown(flow);
      await submit(wrapper).trigger("click");
      await flushPromises();
      expect(flow.install).toHaveBeenCalledWith(undefined, {
        exclude: [],
        enableAlerts: true,
        destination: undefined,
      });
    });

    it("sends to the destination the user picks", async () => {
      const flow = ready();
      const wrapper = await shown(flow);
      await pick(wrapper, "hook");
      await submit(wrapper).trigger("click");
      await flushPromises();
      expect(flow.install).toHaveBeenCalledWith(undefined, {
        exclude: [],
        enableAlerts: true,
        destination: "hook",
      });
    });

    it("holds Set up while Send to is ticked with no destination picked, and says why", async () => {
      const flow = ready();
      const wrapper = await shown(flow);
      await box(wrapper, "send-to").trigger("click");
      expect(submit(wrapper).attributes("disabled")).toBeDefined();
      expect(wrapper.get('[data-test="starter-pack-drawer-summary"]').text()).toBe(
        "Choose a destination for Send to, or untick it",
      );
      await wrapper.get('[data-test="starter-pack-alert-setup-dest-select"]').setValue("hook");
      expect(submit(wrapper).attributes("disabled")).toBeUndefined();
    });

    it("creates alerts off with the destination set when only Send to is ticked", async () => {
      const flow = ready();
      const wrapper = await shown(flow);
      await box(wrapper, "turn-on-check").trigger("click");
      await pick(wrapper, "oncall");
      quiet(wrapper);
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

    it("offers Email me, unpicked, when the org has no destination and creates it once picked", async () => {
      mocks.destinations = [];
      mocks.ensure.mockResolvedValue({ name: "email-user@example.com" });
      const flow = ready();
      const wrapper = await shown(flow);
      const label = wrapper.get('[data-test="starter-pack-alert-setup-email-me"]');
      expect(label.text().replace(/\s+/g, " ")).toBe("Send to: Email me — user@example.com");
      expect(box(wrapper, "send-to").attributes("aria-checked")).toBe("false");
      await box(wrapper, "send-to").trigger("click");
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
      expect(has(wrapper, "starter-pack-alert-setup-email-note")).toBe(false);
      quiet(wrapper);
      await submit(wrapper).trigger("click");
      await flushPromises();
      expect(mocks.ensure).not.toHaveBeenCalled();
    });

    it("runs the install with alerts off when Email me cannot be saved", async () => {
      mocks.destinations = [];
      mocks.ensure.mockResolvedValue({ failure: "email" });
      const flow = ready();
      const wrapper = await shown(flow);
      await box(wrapper, "send-to").trigger("click");
      await submit(wrapper).trigger("click");
      await flushPromises();
      expect(flow.install).toHaveBeenCalledWith(undefined, {
        exclude: [],
        enableAlerts: false,
        destination: undefined,
      });
    });

    it("disables Send to with a note and keeps Turn on ticked when there is nothing to send to", async () => {
      mocks.destinations = [];
      mocks.state.zoConfig = { smtp_enabled: false };
      const wrapper = await shown();
      expect(box(wrapper, "send-to").attributes("aria-checked")).toBe("false");
      expect(box(wrapper, "send-to").attributes("disabled")).toBeDefined();
      expect(box(wrapper, "turn-on-check").attributes("aria-checked")).toBe("true");
      expect(has(wrapper, "starter-pack-alert-setup-no-destination")).toBe(true);
      quiet(wrapper);
    });

    it("keeps Send to unavailable with a note when the destinations read fails", async () => {
      mocks.read = () => Promise.reject(new Error("down"));
      const flow = ready();
      const wrapper = await shown(flow);
      expect(box(wrapper, "send-to").attributes("disabled")).toBeDefined();
      expect(has(wrapper, "starter-pack-alert-setup-email-me")).toBe(false);
      expect(has(wrapper, "starter-pack-alert-setup-destinations-failed")).toBe(true);
      await submit(wrapper).trigger("click");
      await flushPromises();
      expect(mocks.ensure).not.toHaveBeenCalled();
      expect(flow.install).toHaveBeenCalledWith(undefined, {
        exclude: [],
        enableAlerts: true,
        destination: undefined,
      });
    });

    it("never creates Email me while Turn on is unticked", async () => {
      mocks.destinations = [];
      mocks.ensure.mockResolvedValue({ name: "email-user@example.com" });
      const flow = ready();
      const wrapper = await shown(flow);
      await box(wrapper, "send-to").trigger("click");
      await box(wrapper, "turn-on-check").trigger("click");
      await submit(wrapper).trigger("click");
      await flushPromises();
      expect(mocks.ensure).not.toHaveBeenCalled();
      expect(flow.install).toHaveBeenCalledWith(undefined, {
        exclude: [],
        enableAlerts: false,
        destination: undefined,
      });
    });

    it("waits for the destinations before Set up, drawn with the D14 defaults", () => {
      const wrapper = render(ready());
      expect(has(wrapper, "starter-pack-alert-setup-dest-loading")).toBe(true);
      expect(box(wrapper, "turn-on-check").attributes("aria-checked")).toBe("true");
      expect(box(wrapper, "send-to").attributes("aria-checked")).toBe("false");
      expect(submit(wrapper).attributes("disabled")).toBeDefined();
    });

    it("keeps a box the user changed while the destinations loaded", async () => {
      let arrive!: (rows: any[]) => void;
      mocks.read = () => new Promise((done) => (arrive = done));
      const wrapper = render(ready());
      await box(wrapper, "turn-on-check").trigger("click");
      await box(wrapper, "send-to").trigger("click");
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
      arrive([]);
      await flushPromises();
      expect(box(wrapper, "send-to").attributes("aria-checked")).toBe("false");
      expect(box(wrapper, "turn-on-check").attributes("aria-checked")).toBe("true");
    });

    it("says the alerts are created on, naming only the destination, on the creating row", async () => {
      const flow = ready();
      const wrapper = await shown(flow);
      await pick(wrapper, "oncall");
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

    it("says Creating · on with no destination, and nothing about who is notified", async () => {
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
        "Creating · on",
      );
      quiet(wrapper);
    });

    it("names Email me the way Ready does on the creating alerts row", async () => {
      mocks.destinations = [];
      mocks.ensure.mockResolvedValue({ name: "email-user@example.com" });
      const flow = ready();
      const wrapper = await shown(flow);
      await box(wrapper, "send-to").trigger("click");
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

  it("takes every alert's severity and description from its Library entry, with the item summary", async () => {
    const pack = { ...PACK, alertSummaries: { a1: "CPU busy for 15 min" } };
    const wrapper = render(ready({ pack }));
    const [first, second] = group(wrapper, "alert").findAll(
      '[data-test="starter-pack-drawer-alert-row"]',
    );
    expect(first.get('[data-test="starter-pack-drawer-alert-severity"]').text()).toBe("Critical");
    expect(second.get('[data-test="starter-pack-drawer-alert-severity"]').text()).toBe("Warning");
    expect(first.get('[data-test="starter-pack-drawer-row-summary"]').text()).toBe(
      "CPU busy for 15 min",
    );
    expect(second.get('[data-test="starter-pack-drawer-row-summary"]').text()).toBe("");
    expect(first.element.parentElement?.textContent).toContain("CPU above 90%");
  });

  it("puts the dashboard's own description in its tooltip and its summary on the row", async () => {
    const pack = {
      ...PACK,
      dashboards: [{ id: "overview", title: "Overview", summary: "Pods and nodes at a glance" }],
    };
    const wrapper = render(ready({ pack }));
    const row = group(wrapper, "dashboard").get('[data-test="starter-pack-drawer-dashboard-row"]');
    expect(row.get('[data-test="starter-pack-drawer-row-summary"]').text()).toBe(
      "Pods and nodes at a glance",
    );
    expect(row.element.parentElement?.textContent).toContain("The cluster overview");
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
    expect(submit(wrapper).text()).toBe("Set up");
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

  it("offers no setup and no tick-boxes when setup was refused", () => {
    const wrapper = render(ready({ forbidden: ref(true) }));
    expect(wrapper.find('[role="checkbox"]').exists()).toBe(false);
    expect(has(wrapper, "starter-pack-alert-setup")).toBe(false);
    expect(has(wrapper, "starter-pack-drawer-submit-btn")).toBe(false);
    expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
      "Kubernetes · you can see this pack but not set it up",
    );
    expect(wrapper.get('[data-test="starter-pack-drawer-summary"]').text()).toBe(
      "You can't create alerts in this org",
    );
  });

  describe("View Pack", () => {
    const ITEMS = [
      { kind: "dashboard", itemId: "overview", status: "created", id: "d1", folderId: "fd" },
      { kind: "alert", itemId: "a1", status: "created", id: "al1" },
      { kind: "alert", itemId: "a2", status: "created", id: "al2" },
      { kind: "savedView", itemId: "v1", status: "created", id: "s1" },
    ];
    const setUp = (over: Record<string, unknown> = {}) =>
      fakeFlow({
        installed: ref(true),
        canUndo: ref(false),
        items: ref(ITEMS),
        made: ref(ITEMS),
        toCreate: ref(ITEMS),
        enabledAlertIds: shallowRef(new Set(["al1"])),
        record: shallowRef({
          installedBy: "aisha@x",
          installedAt: (Date.now() - 2 * 3_600_000) * 1000,
          items: ITEMS,
        }),
        dashboardItem: shallowRef(ITEMS[0]),
        itemRoute: (item: { kind: string; id: string }) => ({
          name: item.kind,
          query: { id: item.id },
        }),
        dashboardsRoute: ref({ name: "dashboards" }),
        ...over,
      });
    const viewGroup = (wrapper: Wrapper, id: string) =>
      wrapper.get(`[data-test="starter-pack-view-group-${id}"]`);

    it("shows what the pack made with no stepper or tick-boxes, and who set it up how long ago", () => {
      const wrapper = render(setUp());
      expect(has(wrapper, "starter-pack-drawer-stepper")).toBe(false);
      expect(wrapper.find('[role="checkbox"]').exists()).toBe(false);
      expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
        "Set up by aisha@x 2 h ago",
      );
      const mine = render(
        setUp({
          record: shallowRef({ installedBy: "user@example.com", installedAt: Date.now() * 1000 }),
        }),
      );
      expect(mine.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
        "Set up by you just now",
      );
    });

    it("gives every group one Open button, and lets only a group of several expand (D4)", () => {
      const wrapper = render(setUp());
      const ids = ["view", "dashboard", "alert", "savedView"];
      for (const id of ids) {
        expect(
          viewGroup(wrapper, id).findAll('[data-test="starter-pack-view-group-open"]'),
        ).toHaveLength(1);
      }
      expect(viewGroup(wrapper, "dashboard").text()).toContain("name-overview");
      expect(viewGroup(wrapper, "dashboard").text()).toContain("Dashboard");
      expect(viewGroup(wrapper, "savedView").text()).toContain(
        "Saved view · shared with everyone in this org",
      );
      expect(
        viewGroup(wrapper, "dashboard")
          .find('[data-test="starter-pack-view-group-expand"]')
          .exists(),
      ).toBe(false);
      expect(
        viewGroup(wrapper, "alert").find('[data-test="starter-pack-view-group-expand"]').exists(),
      ).toBe(true);
      expect(viewGroup(wrapper, "alert").text()).toContain("2 · 1 on · 1 silent");
      const rows = viewGroup(wrapper, "alert").findAll('[data-test="starter-pack-view-alert-row"]');
      expect(rows.map((row) => row.text())).toEqual(["name-a1On", "name-a2Silent"]);
    });

    it("opens the item or its list from a group, and the item from a row, closing the popup", async () => {
      const wrapper = render(setUp());
      await viewGroup(wrapper, "dashboard")
        .get('[data-test="starter-pack-view-group-open"]')
        .trigger("click");
      expect(mocks.push).toHaveBeenLastCalledWith({ name: "dashboard", query: { id: "d1" } });
      await viewGroup(wrapper, "alert")
        .get('[data-test="starter-pack-view-group-open"]')
        .trigger("click");
      expect(mocks.push).toHaveBeenLastCalledWith({
        name: "alertList",
        query: { org_identifier: "org" },
      });
      await viewGroup(wrapper, "alert")
        .findAll('[data-test="starter-pack-view-alert-row"]')[1]
        .trigger("click");
      expect(mocks.push).toHaveBeenLastCalledWith({ name: "alert", query: { id: "al2" } });
      await viewGroup(wrapper, "view")
        .get('[data-test="starter-pack-view-group-open"]')
        .trigger("click");
      expect(mocks.push).toHaveBeenLastCalledWith({
        name: "infraKubernetes",
        query: { org_identifier: "org" },
      });
      expect(wrapper.emitted("close")).toHaveLength(4);
    });

    it("says once that pack items are ordinary items, with the alert scope line (D15)", () => {
      const wrapper = render(setUp());
      expect(wrapper.get('[data-test="starter-pack-view-ordinary"]').text()).toBe(
        "These are ordinary alerts, dashboards and views. Edit or delete them on their own pages.",
      );
      expect(wrapper.text().match(/ordinary alerts/g)).toHaveLength(1);
      expect(wrapper.get('[data-test="starter-pack-progress-scope"]').text()).toBe(
        "Alert scope: All clusters · 1 seen so far: staging-eu-1",
      );
    });

    it("hides the scope line on a pack without a cluster scope", () => {
      const wrapper = render(setUp({ pack: { ...PACK, clusterScoped: false } }));
      expect(has(wrapper, "starter-pack-progress-scope")).toBe(false);
    });

    it("folds a long alert list behind Show N more", async () => {
      const many = Array.from({ length: 7 }, (_, index) => ({
        kind: "alert",
        itemId: `a${index}`,
        status: "created",
        id: `al${index}`,
      }));
      const wrapper = render(setUp({ items: ref(many) }));
      const rows = () =>
        viewGroup(wrapper, "alert").findAll('[data-test="starter-pack-view-alert-row"]');
      expect(rows()).toHaveLength(5);
      await wrapper.get('[data-test="starter-pack-view-show-more"]').trigger("click");
      expect(rows()).toHaveLength(7);
    });

    it("offers Back, Open dashboard and Remove after the undo window", async () => {
      const flow = setUp();
      const wrapper = render(flow);
      expect(wrapper.get('[data-test="starter-pack-drawer-back-btn"]').text()).toBe("Back");
      expect(has(wrapper, "starter-pack-page-remove-btn")).toBe(true);
      expect(has(wrapper, "starter-pack-progress-undo-btn")).toBe(false);
      await wrapper.get('[data-test="starter-pack-drawer-open-btn"]').trigger("click");
      await flushPromises();
      expect(flow.land).toHaveBeenCalled();
      expect(wrapper.emitted("close")).toHaveLength(1);
    });

    it("offers Open dashboard only when the pack made one", () => {
      const plain = render(fakeFlow({ installed: ref(true) }));
      expect(plain.find('[data-test="starter-pack-drawer-open-btn"]').exists()).toBe(false);
      expect(render(setUp()).get('[data-test="starter-pack-drawer-open-btn"]').text()).toBe(
        "Open dashboard",
      );
    });
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
    expect(wrapper.emitted("close")).toBeUndefined();
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
    };
    useBrowserMatches("org").saveFull({ checkedAt: 1, sources: [source], dismissed: 0 }, []);
    const wrapper = await shown();
    await submit(wrapper).trigger("click");
    await flushPromises();
    expect(useBrowserMatches("org").visible.value).toEqual([]);
    expect(useBrowserMatches("org").copy.value?.installedPackIds).toEqual(["kubernetes"]);
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

  it("shows an interrupted setup as step 2 with Retry and Back, and no Undo", async () => {
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
    expect(wrapper.get('[data-test="starter-pack-drawer-summary"]').text()).toBe(
      "Setup interrupted · 1 of 2 done",
    );
    expect(wrapper.get('[data-test="starter-pack-progress-failed-row"]').text()).toContain(
      "Failed · name-a2",
    );
    expect(has(wrapper, "starter-pack-progress-undo-btn")).toBe(false);
    expect(has(wrapper, "starter-pack-drawer-back-btn")).toBe(true);
    expect(wrapper.get('[data-test="starter-pack-progress-retry-btn"]').text()).toBe(
      "Retry 1 item",
    );
    await wrapper.get('[data-test="starter-pack-progress-retry-btn"]').trigger("click");
    await flushPromises();
    expect(flow.retry).toHaveBeenCalled();
    expect(flow.install).not.toHaveBeenCalled();
    expect(flow.land).not.toHaveBeenCalled();
  });

  it("says the stored alert choice on Ready after a resumed install", async () => {
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
    expect(has(wrapper, "starter-pack-ready")).toBe(true);
    expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
      "1 of 1 created · 1 alert on",
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

  it("shows progress while running, closable, pointing back at the header chip", async () => {
    const wrapper = render(
      fakeFlow({
        running: ref(true),
        toCreate: ref([{ kind: "alert", itemId: "a1", status: "pending" }]),
      }),
    );
    expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
      "Setting up · 0 of 1 created",
    );
    expect(wrapper.get('[data-test="starter-pack-progress-come-back"]').text()).toBe(
      "0 of 1 created · you can close this and keep working. Find it again from Starter packs in the header.",
    );
    expect(wrapper.get('[data-test="starter-pack-drawer-summary"]').text()).toBe(
      "You can close this. Setup keeps going.",
    );
    const row = wrapper.get('[data-test="starter-pack-progress-kind-creating-row"]');
    expect(row.text()).toContain("Alerts 0 of 1");
    expect(row.text()).toContain("Creating");
    const running = wrapper.get('[data-test="starter-pack-progress-running-btn"]');
    expect(running.text()).toBe("Setting up…");
    expect(running.attributes("disabled")).toBeDefined();
    expect(running.find('[data-test="starter-pack-step-spinner"]').exists()).toBe(true);
    expect(has(wrapper, "starter-pack-drawer-back-btn")).toBe(false);
    await wrapper.get('[data-test="starter-pack-popup-close-btn"]').trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("says everything exists and continues to Ready when there is nothing to create", async () => {
    const preview = {
      ...PREVIEW,
      items: [{ kind: "dashboard", itemId: "overview", status: "existing" }],
      notIncluded: [],
    };
    const wrapper = render(fakeFlow({ preview: shallowRef(preview) }));
    expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toContain(
      "You already have all 1 items in this pack",
    );
    expect(wrapper.find(".o-banner, [data-test$='-banner']").exists()).toBe(false);
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
    const finish = async (over: Record<string, unknown> = {}) => {
      const items = (over.items as typeof ITEMS) ?? ITEMS;
      const flow = ready({
        dashboardItem: shallowRef(ITEMS[0]),
        itemRoute: (item: { kind: string; id: string }) => ({
          name: item.kind,
          query: { id: item.id },
        }),
        dashboardsRoute: ref({ name: "dashboards" }),
        ...over,
        items: ref(items),
      });
      const wrapper = await shown(flow);
      flow.install = vi.fn(async () => {
        flow.running.value = true;
        await nextTick();
        flow.made.value = items.filter(({ status }) => status === "created") as never;
        flow.toCreate.value = items.filter(({ status }) => status !== "existing") as never;
        flow.failed.value = items.filter(({ status }) => status === "failed") as never;
        flow.installed.value = !flow.failed.value.length;
        flow.running.value = false;
        return flow.installed.value;
      }) as never;
      await submit(wrapper).trigger("click");
      await flushPromises();
      return { wrapper, flow };
    };

    it("shows the View Pack groups with no caveat line and no Where to next cards", async () => {
      const { wrapper } = await finish();
      expect(wrapper.get('[data-test="starter-pack-ready-title"]').text()).toBe(
        "Kubernetes monitoring is ready",
      );
      expect(has(wrapper, "starter-pack-view-group-alert")).toBe(true);
      expect(has(wrapper, "starter-pack-view-group-dashboard")).toBe(true);
      expect(wrapper.text()).not.toContain("Where to next");
      expect(wrapper.text()).not.toMatch(/no one is notified|alert history/i);
      expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
        "4 of 4 created · 2 alerts on",
      );
      expect(wrapper.get('[data-test="starter-pack-view-ordinary"]').exists()).toBe(true);
    });

    it("offers Undo with the time left and Back to Packs, and no primary", async () => {
      const { wrapper } = await finish();
      expect(wrapper.get('[data-test="starter-pack-ready-undo-left"]').text()).toBe(
        "available for 5 h",
      );
      expect(wrapper.get('[data-test="starter-pack-drawer-back-btn"]').text()).toBe(
        "Back to Packs",
      );
      expect(has(wrapper, "starter-pack-progress-retry-btn")).toBe(false);
      expect(has(wrapper, "starter-pack-drawer-open-btn")).toBe(false);
      await wrapper.get('[data-test="starter-pack-drawer-back-btn"]').trigger("click");
      expect(wrapper.emitted("back")).toHaveLength(1);
    });

    it("says where off alerts stand in the subtitle when Turn on was unticked", async () => {
      const flow = ready({ items: ref(ITEMS) });
      const wrapper = await shown(flow);
      await box(wrapper, "turn-on-check").trigger("click");
      flow.install = vi.fn(async () => {
        flow.running.value = true;
        await nextTick();
        flow.made.value = ITEMS as never;
        flow.toCreate.value = ITEMS as never;
        flow.installed.value = true;
        flow.running.value = false;
        return true;
      }) as never;
      await submit(wrapper).trigger("click");
      await flushPromises();
      expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
        "4 of 4 created · alerts off",
      );
    });

    const failEmailMe = async (failure: string) => {
      mocks.destinations = [];
      mocks.ensure.mockResolvedValue({ failure });
      const flow = ready({ items: ref(ITEMS) });
      const wrapper = await shown(flow);
      await box(wrapper, "send-to").trigger("click");
      flow.install = vi.fn(async () => {
        flow.running.value = true;
        await nextTick();
        flow.made.value = ITEMS as never;
        flow.toCreate.value = ITEMS as never;
        flow.installed.value = true;
        flow.running.value = false;
        return true;
      }) as never;
      await submit(wrapper).trigger("click");
      await flushPromises();
      return wrapper;
    };

    it("says why the alerts were added off when Email me could not be created", async () => {
      const wrapper = await failEmailMe("email");
      expect(wrapper.get('[data-test="starter-pack-ready-email-failed"]').text()).toBe(
        "Your email destination could not be created, so the alerts were added turned off.",
      );
    });

    it("names a refused Email me as the reason the alerts were added off", async () => {
      const wrapper = await failEmailMe("forbidden");
      expect(wrapper.get('[data-test="starter-pack-ready-email-failed"]').text()).toBe(
        "You can't add alert destinations in this org, so your email destination was not created and the alerts were added turned off.",
      );
    });

    it("shows no Email me warning when the alerts were set up as asked", async () => {
      const { wrapper } = await finish();
      expect(has(wrapper, "starter-pack-ready-email-failed")).toBe(false);
    });

    it("counts the pack alerts that were already here in the subtitle", async () => {
      const items = [
        ...ITEMS.slice(0, 3),
        { kind: "alert", itemId: "a2", status: "existing", id: "old" },
      ];
      const { wrapper } = await finish({ items });
      expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
        "3 of 3 created · 1 already here",
      );
    });

    it("puts a failure on its own row with Retry, and offers Retry N items (M5b)", async () => {
      const items = [...ITEMS.slice(0, 3), { kind: "alert", itemId: "a2", status: "failed" }];
      const { wrapper, flow } = await finish({ items });
      expect(wrapper.get('[data-test="starter-pack-ready-title"]').text()).toBe(
        "Kubernetes monitoring is set up, 1 item was not created",
      );
      expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
        "3 of 4 created · 1 not created",
      );
      const failed = wrapper.get('[data-test="starter-pack-view-row-failed"]');
      expect(failed.text()).toContain("Not created");
      expect(wrapper.get('[data-test="starter-pack-progress-retry-btn"]').text()).toBe(
        "Retry 1 item",
      );
      await wrapper.get('[data-test="starter-pack-view-row-retry"]').trigger("click");
      await flushPromises();
      expect(flow.retry).toHaveBeenCalledTimes(1);
      await wrapper.get('[data-test="starter-pack-progress-retry-btn"]').trigger("click");
      await flushPromises();
      expect(flow.retry).toHaveBeenCalledTimes(2);
    });

    it("puts Retry, or Ask an admin, on a one-item group whose item failed", async () => {
      const items = [
        { kind: "dashboard", itemId: "overview", status: "failed" },
        ...ITEMS.slice(1),
      ];
      const { wrapper, flow } = await finish({ items });
      const dashboard = wrapper.get('[data-test="starter-pack-view-group-dashboard"]');
      expect(dashboard.text()).toContain("Not created");
      expect(dashboard.find(".bg-icon-chip-success-bg").exists()).toBe(false);
      expect(dashboard.find(".bg-icon-chip-error-bg").exists()).toBe(true);
      expect(dashboard.find('[data-test="starter-pack-view-group-open"]').exists()).toBe(false);
      await dashboard.get('[data-test="starter-pack-view-row-retry"]').trigger("click");
      await flushPromises();
      expect(flow.retry).toHaveBeenCalledTimes(1);
      flow.forbidden.value = true;
      await nextTick();
      expect(wrapper.get('[data-test="starter-pack-view-group-dashboard"]').text()).toContain(
        "Ask an admin",
      );
    });

    it("marks a several-item group by what was created: warning and Open, or error and no Open", async () => {
      const dashboard = (itemId: string, status: string) => ({
        kind: "dashboard",
        itemId,
        status,
        id: itemId,
      });
      const group = async (items: Array<Record<string, unknown>>) =>
        (await finish({ items: [...items, ...ITEMS.slice(1)] })).wrapper.get(
          '[data-test="starter-pack-view-group-dashboard"]',
        );
      const partial = await group([dashboard("overview", "created"), dashboard("nodes", "failed")]);
      expect(partial.find(".bg-icon-chip-warning-bg").exists()).toBe(true);
      expect(partial.get('[data-test="starter-pack-view-group-meta"]').text()).toBe(
        "1 of 2 created · 1 not created",
      );
      expect(partial.find('[data-test="starter-pack-view-group-open"]').exists()).toBe(true);
      const none = await group([dashboard("overview", "failed"), dashboard("nodes", "failed")]);
      expect(none.find(".bg-icon-chip-error-bg").exists()).toBe(true);
      expect(none.find(".bg-icon-chip-success-bg").exists()).toBe(false);
      expect(none.get('[data-test="starter-pack-view-group-meta"]').text()).toBe(
        "0 of 2 created · 2 not created",
      );
      expect(none.find('[data-test="starter-pack-view-group-open"]').exists()).toBe(false);
    });

    it("says Ask an admin, with no Retry and no link, on a failed row the user may not fix", async () => {
      const items = [...ITEMS.slice(0, 3), { kind: "alert", itemId: "a2", status: "failed" }];
      const { wrapper, flow } = await finish({ items });
      flow.forbidden.value = true;
      await nextTick();
      const failed = wrapper.get('[data-test="starter-pack-view-row-failed"]');
      expect(failed.text()).toContain("Ask an admin");
      expect(failed.find("a").exists()).toBe(false);
      expect(has(wrapper, "starter-pack-view-row-retry")).toBe(false);
      expect(has(wrapper, "starter-pack-progress-retry-btn")).toBe(false);
    });

    it("undoes in place from the footer and goes back to the list", async () => {
      const { wrapper, flow } = await finish();
      await wrapper.get('[data-test="starter-pack-ready-undo-btn"]').trigger("click");
      await wrapper.get('[data-test="starter-pack-undo-confirm-btn"]').trigger("click");
      await flushPromises();
      expect(flow.undo).toHaveBeenCalled();
      expect(wrapper.emitted("back")).toHaveLength(1);
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
      itemRoute: () => ({ name: "alert" }),
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
    expect(wrapper.emitted("back")).toHaveLength(1);
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
    expect(wrapper.emitted("back")).toBeUndefined();
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

  it("says a setup that failed before anything was recorded in the footer, never a banner", () => {
    const wrapper = render(ready({ installFailed: ref(true) }));
    expect(wrapper.get('[data-test="starter-pack-drawer-summary"]').text()).toBe(
      "Setup didn't finish. Try again.",
    );
    expect(has(wrapper, "starter-pack-drawer-install-error")).toBe(false);
    expect(has(wrapper, "starter-pack-drawer-submit-btn")).toBe(true);
  });

  it("counts a Use all copy under its source alert's Library severity", () => {
    const preview = {
      ...PREVIEW,
      items: [
        ...PREVIEW.items,
        { kind: "alert", itemId: "a1@logs_b", status: "pending", copyOf: "a1" },
      ],
    };
    const wrapper = render(fakeFlow({ preview: shallowRef(preview) }));
    expect(group(wrapper, "alert").get('[data-test="starter-pack-drawer-group-meta"]').text()).toBe(
      "3 · 2 critical · 1 warning",
    );
  });

  it("counts only the ticked alerts, by Library severity, in the Alerts card", async () => {
    const wrapper = render(ready());
    const meta = () =>
      group(wrapper, "alert").get('[data-test="starter-pack-drawer-group-meta"]').text();
    expect(meta()).toBe("2 · 1 critical · 1 warning");
    await rowChecks(wrapper, "alert")[0].trigger("click");
    expect(meta()).toBe("1 · 1 warning");
    expect(has(wrapper, "starter-pack-alert-setup")).toBe(true);
  });

  it("goes back after an inline Remove or Undo succeeds, and not when it fails", async () => {
    const removed = render(fakeFlow({ installed: ref(true), canUndo: ref(false) }));
    await removed.get('[data-test="starter-pack-page-remove-btn"]').trigger("click");
    await removed.get('[data-test="starter-pack-remove-confirm-btn"]').trigger("click");
    await flushPromises();
    expect(removed.emitted("back")).toHaveLength(1);
    const failed = render(
      fakeFlow({ installed: ref(true), canUndo: ref(true), undo: vi.fn(async () => false) }),
    );
    await failed.get('[data-test="starter-pack-progress-undo-btn"]').trigger("click");
    await failed.get('[data-test="starter-pack-undo-confirm-btn"]').trigger("click");
    await flushPromises();
    expect(failed.emitted("back")).toBeUndefined();
  });

  it("stays and says how many items it kept after an Undo or Remove", async () => {
    const removal = shallowRef<unknown>(null);
    const kept = {
      removed: [],
      kept: [
        { kind: "alert", itemId: "a1", reason: "changed" },
        { kind: "folder", itemId: "alerts", reason: "not_empty" },
      ],
    };
    const flow = fakeFlow({
      installed: ref(true),
      canUndo: ref(true),
      removal,
      undo: vi.fn(async () => {
        removal.value = kept;
        flow.installed.value = false;
        return true;
      }),
    });
    const wrapper = render(flow);
    await wrapper.get('[data-test="starter-pack-progress-undo-btn"]').trigger("click");
    await wrapper.get('[data-test="starter-pack-undo-confirm-btn"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("back")).toBeUndefined();
    expect(wrapper.get('[data-test="starter-pack-drawer-summary"]').text()).toBe(
      "Kept 2 items that were changed or are still in use. Delete them on their own pages.",
    );
  });

  it("loads the destinations after Undo, so the pack can be set up again at once", async () => {
    const reads = vi.fn(async () => [SLACK]);
    mocks.read = reads;
    const flow = ready({
      installed: ref(true),
      canUndo: ref(true),
      removal: shallowRef({
        removed: [],
        kept: [{ kind: "alert", itemId: "a1", reason: "changed" }],
      }),
      undo: vi.fn(async () => {
        flow.installed.value = false;
        return true;
      }),
    });
    const wrapper = await shown(flow);
    expect(reads).not.toHaveBeenCalled();
    await wrapper.get('[data-test="starter-pack-progress-undo-btn"]').trigger("click");
    await wrapper.get('[data-test="starter-pack-undo-confirm-btn"]').trigger("click");
    await flushPromises();
    expect(reads).toHaveBeenCalledTimes(1);
    expect(has(wrapper, "starter-pack-alert-setup-dest-loading")).toBe(false);
    expect(submit(wrapper).attributes("disabled")).toBeUndefined();
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
