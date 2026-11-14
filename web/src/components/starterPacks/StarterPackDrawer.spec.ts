import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { ref, shallowRef } from "vue";

import i18n from "@/locales";

import StarterPackDrawer from "./StarterPackDrawer.vue";
import { fakeFlow } from "./starterPackTestFlow";

const SHELL = { template: '<div><slot /><slot name="footer" /></div>' };
const render = (flow = fakeFlow()) =>
  mount(StarterPackDrawer, {
    props: { flow, clusters: ["staging-eu-1"], open: true },
    global: {
      plugins: [i18n],
      stubs: {
        ODrawer: SHELL,
        ODialog: {
          props: ["title", "subTitle"],
          template:
            '<div data-test="stub-dialog"><span data-test="stub-dialog-title">{{ title }}</span><span data-test="stub-dialog-sub">{{ subTitle }}</span><slot /><slot name="footer" /></div>',
        },
        OCollapsible: {
          props: ["label", "caption"],
          template: "<div>{{ label }} {{ caption }}<slot /></div>",
        },
        OIcon: true,
        StarterPackAdaptedRows: true,
      },
    },
  });
const has = (wrapper: ReturnType<typeof render>, id: string) =>
  wrapper.find(`[data-test="${id}"]`).exists();

const PREVIEW = {
  panels: { kept: 12, dropped: 3 },
  items: [
    { kind: "dashboard", itemId: "overview", status: "pending" },
    { kind: "alert", itemId: "a1", status: "pending" },
    { kind: "savedView", itemId: "v1", status: "pending" },
  ],
  names: {},
  notIncluded: [{ kind: "alert", itemId: "a2", name: "Disk full", reason: "already_have" }],
};

describe("StarterPackDrawer", () => {
  it("lists each section with counts, scope and a tagged reason for each item left out", () => {
    const wrapper = render(fakeFlow({ preview: shallowRef(PREVIEW) }));
    expect(wrapper.get('[data-test="starter-pack-drawer-dashboards"]').text()).toContain(
      "name-overview",
    );
    expect(wrapper.get('[data-test="starter-pack-drawer-alerts"]').text()).toContain(
      "1 alert Silent until you turn them on",
    );
    expect(wrapper.get('[data-test="starter-pack-drawer-alert-row"]').text()).toContain("name-a1");
    expect(wrapper.get('[data-test="starter-pack-drawer-saved-searches"]').text()).toContain(
      "1 saved view in Logs",
    );
    expect(wrapper.get('[data-test="starter-pack-drawer-submit-btn"]').text()).toBe(
      "Install 4 items",
    );
    expect(wrapper.get('[data-test="starter-pack-drawer-note"]').text()).toBe(
      "Removable in one click for 24 hours. No existing dashboard or alert is changed.",
    );
    expect(wrapper.get('[data-test="starter-pack-drawer-reach-line"]').text()).toContain(
      "All clusters · 1 seen so far: staging-eu-1",
    );
    expect(wrapper.get('[data-test="starter-pack-drawer-not-included"]').text()).toContain(
      "You have itDisk full: you already have it",
    );
  });

  it("tags an item left out for a different data flavour as Needs data", () => {
    const preview = {
      ...PREVIEW,
      notIncluded: [
        { kind: "dashboard", itemId: "d2", name: "Node metrics", reason: "no_flavour" },
      ],
    };
    const wrapper = render(fakeFlow({ preview: shallowRef(preview) }));
    const row = wrapper.get('[data-test="starter-pack-drawer-not-included"]').text();
    expect(row).toContain("Needs data");
    expect(row).toContain("Node metrics: not available for your metric names yet");
  });

  it("shows one Adapted to your data section holding the adapted rows", () => {
    const wrapper = render(fakeFlow({ preview: shallowRef(PREVIEW) }));
    expect(wrapper.text().split("Adapted to your data")).toHaveLength(2);
    const reach = wrapper.get('[data-test="starter-pack-drawer-reach"]');
    expect(reach.findComponent({ name: "StarterPackAdaptedRows" }).exists()).toBe(true);
  });

  it("lists the view under items left out on a lower plan", () => {
    const wrapper = render(fakeFlow({ preview: shallowRef(PREVIEW), licensed: ref(false) }));
    expect(wrapper.get('[data-test="starter-pack-drawer-panels"]').text()).toContain(
      "12 panels fit your data",
    );
    expect(wrapper.get('[data-test="starter-pack-drawer-not-included"]').text()).toContain(
      "EnterpriseKubernetes view: needs the Enterprise plan",
    );
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

  it("closes and lands once setup completes", async () => {
    const flow = fakeFlow({ preview: shallowRef(PREVIEW) });
    const wrapper = render(flow);
    await wrapper.get('[data-test="starter-pack-drawer-submit-btn"]').trigger("click");
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

  it("swaps Undo for Remove pack once the window closes", () => {
    const created = [{ kind: "alert", itemId: "a1", status: "created" }];
    const wrapper = render(
      fakeFlow({
        installed: ref(true),
        canUndo: ref(false),
        toCreate: ref(created),
        made: ref(created),
      }),
    );
    expect(has(wrapper, "starter-pack-page-remove-btn")).toBe(true);
    expect(has(wrapper, "starter-pack-progress-undo-btn")).toBe(false);
    expect(wrapper.get('[data-test="starter-pack-progress-summary"]').text()).toBe(
      "1 of 1 created",
    );
  });

  it("never reports the pack's own items as already there", () => {
    const made = [{ kind: "alert", itemId: "a2", status: "created" }];
    const wrapper = render(
      fakeFlow({
        installed: ref(true),
        made: ref(made),
        toCreate: ref(made),
        preview: shallowRef(PREVIEW),
      }),
    );
    expect(wrapper.text()).not.toContain("you already have it");
  });

  it("says so when setup fails before anything is recorded", () => {
    const wrapper = render(fakeFlow({ preview: shallowRef(PREVIEW), installFailed: ref(true) }));
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

  it("keeps Set up while only the dashboard is left to create", () => {
    const wrapper = render(
      fakeFlow({ preview: shallowRef(PREVIEW), alertCount: ref(0), viewCount: ref(0) }),
    );
    expect(has(wrapper, "starter-pack-drawer-submit-btn")).toBe(true);
  });

  it("names the built-in pack calmly when the Library is out of reach", () => {
    const wrapper = render(fakeFlow({ preview: shallowRef({ ...PREVIEW, offline: true }) }));
    expect(wrapper.get('[data-test="starter-pack-drawer-source"]').text()).toContain(
      "can't be reached. Using the pack built into this version",
    );
  });

  it("offers the admin link when setup was refused", () => {
    const wrapper = render(fakeFlow({ forbidden: ref(true) }));
    expect(has(wrapper, "starter-pack-drawer-copy-link-btn")).toBe(true);
    expect(has(wrapper, "starter-pack-drawer-submit-btn")).toBe(false);
  });
});
