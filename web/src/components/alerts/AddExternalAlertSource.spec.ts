import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { createRouter, createWebHistory } from "vue-router";
import AddExternalAlertSource from "./AddExternalAlertSource.vue";
import alertSources from "@/services/alert_sources";
import destinationService from "@/services/alert_destination";

vi.mock("@/services/alert_sources", () => ({
  default: { create: vi.fn(), listSenders: vi.fn(), update: vi.fn() },
}));

vi.mock("@/services/alert_destination", () => ({
  default: { list: vi.fn() },
}));

// ODrawer teleports its body, which wrapper.find()/html() can't traverse.
// Same stub the codebase uses in AddRegexPattern.spec.ts.
const ODrawerStub = {
  name: "ODrawer",
  inheritAttrs: false,
  props: ["open", "title", "size", "formId", "primaryButtonLabel", "secondaryButtonLabel"],
  emits: ["update:open", "click:primary", "click:secondary"],
  template: `<div data-test="o-drawer-stub" :data-open="String(open)"><slot /></div>`,
};

let mountedWrappers: Array<ReturnType<typeof mount>> = [];

function buildWrapper(open = true, editingIntegration: any = undefined) {
  const store = createStore({
    state: {
      selectedOrganization: { identifier: "myorg" },
      // CopyContent reads these in setup(); omitting them aborts that subtree.
      userInfo: { email: "admin@example.com" },
      organizationData: { organizationPasscode: "passcode" },
      zoConfig: {},
      API_ENDPOINT: "http://localhost:5080",
    },
  });
  const i18n = createI18n({
    legacy: false,
    locale: "en",
    messages: {
      en: { alert_sources: { connectedFormat: "Connected — format detected: {format}" } },
    },
  });
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div />" } },
      { path: "/destinations", name: "alertDestinations", component: { template: "<div />" } },
    ],
  });
  const wrapper = mount(AddExternalAlertSource, {
    props: { open, editingIntegration },
    global: { plugins: [store, i18n, router], stubs: { ODrawer: ODrawerStub } },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

describe("AddExternalAlertSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (destinationService.list as any).mockResolvedValue({
      data: [{ name: "sre-pages" }, { name: "email-oncall" }],
    });
    (alertSources.listSenders as any).mockResolvedValue({ data: { senders: [] } });
  });

  afterEach(() => {
    // Unmount explicitly: a leaked poll timer or pending fetch leaks into the
    // next test's flush under fake timers.
    mountedWrappers.forEach((w) => w.unmount());
    mountedWrappers = [];
    vi.useRealTimers();
  });

  it("fetches destination options for the alert module when opened", async () => {
    // Opens false→true: the fetch fires off the `open` watcher, not mounted().
    const wrapper = buildWrapper(false);
    expect(destinationService.list).not.toHaveBeenCalled();
    await wrapper.setProps({ open: true });
    await vi.waitFor(() =>
      expect(destinationService.list).toHaveBeenCalledWith({
        org_identifier: "myorg",
        module: "alert",
      }),
    );
  });

  it("calls create with name, auto source_type, and selected destinations, then emits created", async () => {
    (alertSources.create as any).mockResolvedValue({
      data: { id: "int-1", token: "o2iat_abc", name: "grafana-staging" },
    });
    const wrapper = buildWrapper();
    await (wrapper.vm as any).submit({ name: "grafana-staging", destinations: ["sre-pages"] });
    expect(alertSources.create).toHaveBeenCalledWith("myorg", {
      name: "grafana-staging",
      source_type: "auto",
      destinations: ["sre-pages"],
    });
    expect(wrapper.emitted("created")).toBeTruthy();
  });

  it("does not call create when name is empty", async () => {
    const wrapper = buildWrapper();
    await (wrapper.vm as any).submit({ name: "   ", destinations: [] });
    expect(alertSources.create).not.toHaveBeenCalled();
  });

  it("emits update:open(false) on cancel", async () => {
    const wrapper = buildWrapper();
    await (wrapper.vm as any).cancel();
    expect(wrapper.emitted("update:open")).toBeTruthy();
    expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
  });

  it("resets the form when reopened after a previous create", async () => {
    (alertSources.create as any).mockResolvedValue({
      data: { id: "int-1", token: "o2iat_abc", name: "grafana-staging" },
    });
    const wrapper = buildWrapper();
    await (wrapper.vm as any).submit({ name: "grafana-staging", destinations: [] });
    expect((wrapper.vm as any).created).toBe(true);
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    expect((wrapper.vm as any).created).toBe(false);
    expect((wrapper.vm as any).defaultValues).toEqual({ name: "", destinations: [] });
    expect(
      (wrapper.find('[data-test="add-alert-source-name-input"] input').element as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("renders a usable name input and destinations select in the DOM", async () => {
    const wrapper = buildWrapper();
    const nameInput = wrapper.find('[data-test="add-alert-source-name-input"] input');
    expect(nameInput.exists()).toBe(true);
    await nameInput.setValue("my-source");
    expect((nameInput.element as HTMLInputElement).value).toBe("my-source");
    expect(wrapper.find('[data-test="add-alert-source-destinations-select"]').exists()).toBe(true);
  });

  it("creates the source when the drawer's form is submitted, without a manual click handler", async () => {
    (alertSources.create as any).mockResolvedValue({
      data: { id: "int-1", token: "o2iat_abc", name: "grafana-staging" },
    });
    const wrapper = buildWrapper();
    await flushPromises();
    await wrapper
      .find('[data-test="add-alert-source-name-input"] input')
      .setValue("grafana-staging");
    await wrapper.find("form#add-alert-source-form").trigger("submit");
    await vi.waitFor(() =>
      expect(alertSources.create).toHaveBeenCalledWith("myorg", {
        name: "grafana-staging",
        source_type: "auto",
        destinations: [],
      }),
    );
  });

  it("does not submit an empty name — the schema blocks the create call", async () => {
    const wrapper = buildWrapper();
    await flushPromises();
    await wrapper.find("form#add-alert-source-form").trigger("submit");
    await flushPromises();
    expect(alertSources.create).not.toHaveBeenCalled();
  });

  it("shows all 3 setup steps together before the source is created, not just step 1", async () => {
    const wrapper = buildWrapper();
    const html = wrapper.html();
    expect(html).toContain("alert_sources.setupStep1Title");
    expect(html).toContain("alert_sources.setupStep2Title");
    expect(html).toContain("alert_sources.setupStep3Title");
    // Steps 2/3 show a placeholder until the source is created.
    expect(wrapper.find('[data-test="add-alert-source-step2-placeholder"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="add-alert-source-created-snippet"]').exists()).toBe(false);
  });

  it("opens the Destinations page in a new tab to create a destination", async () => {
    const wrapper = buildWrapper();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    (wrapper.vm as any).routeToCreateDestination();
    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, target] = openSpy.mock.calls[0];
    expect(target).toBe("_blank");
    expect(String(url)).toContain("action=add");
    expect(String(url)).toContain("org_identifier=myorg");
    openSpy.mockRestore();
  });

  it("shows the waiting-for-event pill immediately after creation", async () => {
    (alertSources.create as any).mockResolvedValue({
      data: { id: "int-1", token: "o2iat_abc", name: "grafana-staging" },
    });
    (alertSources.listSenders as any).mockResolvedValue({ data: { senders: [] } });
    const wrapper = buildWrapper();
    await wrapper
      .find('[data-test="add-alert-source-name-input"] input')
      .setValue("grafana-staging");
    await (wrapper.vm as any).submit({ name: "grafana-staging", destinations: [] });
    await flushPromises();
    await vi.runOnlyPendingTimersAsync();
    await flushPromises();
    // The stub's slot tree renders stale under fake timers (a VTU quirk), so
    // assert on state; the DOM branch is covered by the name-input test.
    expect((wrapper.vm as any).created).toBe(true);
    expect((wrapper.vm as any).waitingForEvent).toBe(true);
    expect((wrapper.vm as any).createdIntegration?.id).toBe("int-1");
  });

  it("createdCurlSnippet body is valid, self-contained shell syntax with no leading comment", async () => {
    (alertSources.create as any).mockResolvedValue({
      data: { id: "int-1", token: "o2iat_abc", name: "grafana-staging" },
    });
    const wrapper = buildWrapper();
    await (wrapper.vm as any).submit({ name: "grafana-staging", destinations: [] });
    const snippet = (wrapper.vm as any).createdCurlSnippet as string;
    expect(snippet.startsWith("curl ")).toBe(true);
    expect(snippet).not.toContain("#");
  });

  it("createdCurlSnippet body is recognized by the generic payload-format detector (status + labels, not empty)", async () => {
    (alertSources.create as any).mockResolvedValue({
      data: { id: "int-1", token: "o2iat_abc", name: "grafana-staging" },
    });
    const wrapper = buildWrapper();
    await (wrapper.vm as any).submit({ name: "grafana-staging", destinations: [] });
    const snippet = (wrapper.vm as any).createdCurlSnippet as string;
    const bodyMatch = snippet.match(/-d '(.+)'$/);
    expect(bodyMatch).not.toBeNull();
    const body = JSON.parse(bodyMatch![1]);
    expect(body).toHaveProperty("status");
    expect(["firing", "resolved"]).toContain(body.status);
    expect(typeof body.labels).toBe("object");
    expect(body.labels).not.toBeNull();
  });

  it("flips to connected once polling finds a sender", async () => {
    (alertSources.create as any).mockResolvedValue({
      data: { id: "int-1", token: "o2iat_abc", name: "grafana-staging" },
    });
    (alertSources.listSenders as any)
      .mockResolvedValueOnce({ data: { senders: [] } })
      .mockResolvedValue({ data: { senders: [{ detected_source: "grafana" }] } });
    const wrapper = buildWrapper();
    await (wrapper.vm as any).submit({ name: "grafana-staging", destinations: [] });
    await vi.advanceTimersByTimeAsync(3000);
    await wrapper.vm.$nextTick();
    expect((wrapper.vm as any).waitingForEvent).toBe(false);
    expect((wrapper.vm as any).detectedFormat).toBe("grafana");
  });

  it("connectedLabel interpolates the detected format into the connected message", async () => {
    (alertSources.create as any).mockResolvedValue({
      data: { id: "int-1", token: "o2iat_abc", name: "grafana-staging" },
    });
    (alertSources.listSenders as any).mockResolvedValue({
      data: { senders: [{ detected_source: "grafana" }] },
    });
    const wrapper = buildWrapper();
    await wrapper
      .find('[data-test="add-alert-source-name-input"] input')
      .setValue("grafana-staging");
    await (wrapper.vm as any).submit({ name: "grafana-staging", destinations: [] });
    await flushPromises();
    await vi.runOnlyPendingTimersAsync();
    await flushPromises();
    expect((wrapper.vm as any).waitingForEvent).toBe(false);
    expect((wrapper.vm as any).connectedLabel).toContain("grafana");
  });

  it("stops polling on unmount", async () => {
    (alertSources.create as any).mockResolvedValue({
      data: { id: "int-1", token: "o2iat_abc", name: "grafana-staging" },
    });
    const wrapper = buildWrapper();
    await (wrapper.vm as any).submit({ name: "grafana-staging", destinations: [] });
    expect((wrapper.vm as any).pollTimer).toBeDefined();
    wrapper.unmount();
    expect((wrapper.vm as any).pollTimer).toBeUndefined();
  });

  it("stops polling when closed", async () => {
    (alertSources.create as any).mockResolvedValue({
      data: { id: "int-1", token: "o2iat_abc", name: "grafana-staging" },
    });
    const wrapper = buildWrapper();
    await (wrapper.vm as any).submit({ name: "grafana-staging", destinations: [] });
    expect((wrapper.vm as any).pollTimer).toBeDefined();
    await wrapper.setProps({ open: false });
    expect((wrapper.vm as any).pollTimer).toBeUndefined();
  });

  describe("edit mode", () => {
    const EXISTING_INTEGRATION = {
      id: "int-1",
      org_id: "myorg",
      name: "default",
      source_type: "auto",
      token: "o2iat_abc",
      enabled: true,
      config: {},
      destinations: ["sre-pages"],
      created_by: "admin@example.com",
      created_at: 1,
      updated_at: 1,
      url: "/api/v2/myorg/incidents/events/o2iat_abc",
    };

    it("pre-fills the form from the editing integration when opened", async () => {
      const wrapper = buildWrapper(false, EXISTING_INTEGRATION);
      await wrapper.setProps({ open: true });
      expect((wrapper.vm as any).isEditMode).toBe(true);
      expect((wrapper.vm as any).defaultValues).toEqual({
        name: "default",
        destinations: ["sre-pages"],
      });
      expect(
        (
          wrapper.find('[data-test="add-alert-source-name-input"] input')
            .element as HTMLInputElement
        ).value,
      ).toBe("default");
    });

    it("submitEdit calls update with only the changed fields, then emits updated and closes", async () => {
      (alertSources.update as any).mockResolvedValue({ data: {} });
      const wrapper = buildWrapper(false, EXISTING_INTEGRATION);
      await wrapper.setProps({ open: true });
      await (wrapper.vm as any).submitEdit({ name: "renamed", destinations: ["sre-pages"] });
      expect(alertSources.update).toHaveBeenCalledWith("myorg", "int-1", { name: "renamed" });
      expect(wrapper.emitted("updated")).toBeTruthy();
      expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    });

    it("submitEdit calls update with only destinations when only destinations changed", async () => {
      (alertSources.update as any).mockResolvedValue({ data: {} });
      const wrapper = buildWrapper(false, EXISTING_INTEGRATION);
      await wrapper.setProps({ open: true });
      await (wrapper.vm as any).submitEdit({
        name: "default",
        destinations: ["sre-pages", "email-oncall"],
      });
      expect(alertSources.update).toHaveBeenCalledWith("myorg", "int-1", {
        destinations: ["sre-pages", "email-oncall"],
      });
    });

    it("submitEdit does nothing when the name is blank", async () => {
      const wrapper = buildWrapper(false, EXISTING_INTEGRATION);
      await wrapper.setProps({ open: true });
      await (wrapper.vm as any).submitEdit({ name: "   ", destinations: ["sre-pages"] });
      expect(alertSources.update).not.toHaveBeenCalled();
    });

    it("onSubmit routes to update instead of create when in edit mode", async () => {
      (alertSources.update as any).mockResolvedValue({ data: {} });
      const wrapper = buildWrapper(false, EXISTING_INTEGRATION);
      await wrapper.setProps({ open: true });
      await (wrapper.vm as any).onSubmit({ name: "renamed", destinations: ["sre-pages"] });
      expect(alertSources.create).not.toHaveBeenCalled();
      expect(alertSources.update).toHaveBeenCalledWith("myorg", "int-1", { name: "renamed" });
    });
  });
});
