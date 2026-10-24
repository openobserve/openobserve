import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";
import AddAlertView from "./AddAlertView.vue";
import destinationService from "@/services/alert_destination";
import alertsService from "@/services/alerts";
import templateService from "@/services/alert_templates";
import { queryClient } from "@/composables/query/queryClient";

vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list: vi.fn(),
    },
  });
});

vi.mock("@/services/alert_templates", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list: vi.fn(() => Promise.resolve({ data: [] })),
    },
  });
});

vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      get_by_alert_id: vi.fn(),
    },
  });
});

describe("AddAlertView.vue", () => {
  let store: any;
  let router: any;

  beforeEach(() => {
    vi.clearAllMocks();

    store = createStore({
      state: {
        selectedOrganization: {
          identifier: "test-org",
        },
        organizationData: {
          allAlertsListByFolderId: {},
        },
      },
      actions: {
        setAllAlertsListByFolderId: vi.fn(),
      },
    });

    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", component: { template: "<div>Home</div>" } },
        { path: "/alerts", name: "alertList", component: { template: "<div>Alerts</div>" } },
        {
          path: "/alerts/edit/:alert_id",
          name: "editAlert",
          component: { template: "<div>Edit</div>" },
        },
        {
          path: "/alerts/detail/:alert_id",
          name: "alertDetail",
          component: { template: "<div>Detail</div>" },
        },
      ],
    });
  });

  describe("after save and templates", () => {
    const AddAlertStub = {
      name: "AddAlert",
      props: ["modelValue", "isUpdated", "destinations", "templates"],
      template: '<div class="add-alert-stub"></div>',
    };
    const mountView = async () => {
      vi.mocked(destinationService.list).mockResolvedValue({ data: [] } as any);
      const wrapper = mount(AddAlertView, {
        global: { plugins: [store, router], stubs: { AddAlert: AddAlertStub } },
      });
      await flushPromises();
      return wrapper;
    };

    beforeEach(() => queryClient.clear());
    // The router uses the real jsdom history, so a navigation here would leak its URL into later tests.
    afterEach(() => window.history.replaceState({}, "", "/"));

    it("passes the org's templates to the form", async () => {
      const templates = [{ name: "default_template" }];
      vi.mocked(templateService.list).mockResolvedValue({ data: templates } as any);
      const wrapper = await mountView();
      expect(templateService.list).toHaveBeenCalledWith(
        expect.objectContaining({ org_identifier: "test-org" }),
      );
      expect(wrapper.findComponent({ name: "AddAlert" }).props("templates")).toEqual(templates);
    });

    it("refetches templates when the form asks for a refresh", async () => {
      vi.mocked(templateService.list).mockResolvedValue({ data: [{ name: "a" }] } as any);
      const wrapper = await mountView();
      vi.mocked(templateService.list).mockResolvedValue({ data: [{ name: "b" }] } as any);

      wrapper.findComponent({ name: "AddAlert" }).vm.$emit("refresh:templates");
      await flushPromises();

      expect(wrapper.findComponent({ name: "AddAlert" }).props("templates")).toEqual([
        { name: "b" },
      ]);
    });

    it("opens the new alert's detail page after a create", async () => {
      const wrapper = await mountView();
      const pushSpy = vi.spyOn(router, "push");

      wrapper.findComponent({ name: "AddAlert" }).vm.$emit("update:list", "team-a", "new-id");
      await flushPromises();

      expect(pushSpy).toHaveBeenCalledWith({
        name: "alertDetail",
        params: { alert_id: "new-id" },
        query: { org_identifier: "test-org", folder: "team-a" },
      });
    });

    it("returns to the list after an edit", async () => {
      const wrapper = await mountView();
      const pushSpy = vi.spyOn(router, "push");

      wrapper.findComponent({ name: "AddAlert" }).vm.$emit("update:list", "team-a");
      await flushPromises();

      expect(pushSpy).toHaveBeenCalledWith(expect.objectContaining({ name: "alertList" }));
      expect(pushSpy).not.toHaveBeenCalledWith(expect.objectContaining({ name: "alertDetail" }));
    });
  });

  it("should render AddAlert component when destinations are loaded", async () => {
    vi.mocked(destinationService.list).mockResolvedValue({
      data: [{ id: 1, name: "Destination 1" }],
    } as any);

    const wrapper = mount(AddAlertView, {
      global: {
        plugins: [store, router],
        stubs: {
          AddAlert: {
            name: "AddAlert",
            template: '<div class="add-alert-stub"></div>',
          },
        },
      },
    });

    await flushPromises();

    expect(wrapper.find(".add-alert-stub").exists()).toBe(true);
  });

  it("should fetch destinations on mount", async () => {
    vi.mocked(destinationService.list).mockResolvedValue({
      data: [{ id: 1, name: "Destination 1" }],
    } as any);

    mount(AddAlertView, {
      global: {
        plugins: [store, router],
        stubs: {
          AddAlert: true,
        },
      },
    });

    await flushPromises();

    expect(destinationService.list).toHaveBeenCalledWith(
      expect.objectContaining({ org_identifier: "test-org", module: "alert" }),
    );
  });

  it("renders AddAlert even when the org has no destinations", async () => {
    vi.mocked(destinationService.list).mockResolvedValue({
      data: [],
    } as any);

    const wrapper = mount(AddAlertView, {
      global: {
        plugins: [store, router],
        stubs: {
          AddAlert: {
            name: "AddAlert",
            template: '<div class="add-alert-stub"></div>',
          },
        },
      },
    });

    await flushPromises();

    expect(wrapper.find(".add-alert-stub").exists()).toBe(true);
  });

  it("should handle getDestinations error", async () => {
    vi.mocked(destinationService.list).mockRejectedValue(new Error("Network error"));

    const wrapper = mount(AddAlertView, {
      global: {
        plugins: [store, router],
        stubs: {
          AddAlert: true,
        },
      },
    });

    await flushPromises();

    // The component should handle the error gracefully
    // We can verify that destinations list is empty
    expect(wrapper.vm.destinations).toEqual([]);
  });

  it("should navigate to alert list on handleUpdateList", async () => {
    vi.mocked(destinationService.list).mockResolvedValue({
      data: [{ id: 1, name: "Destination 1" }],
    } as any);

    const pushSpy = vi.spyOn(router, "push");

    const wrapper = mount(AddAlertView, {
      global: {
        plugins: [store, router],
        stubs: {
          AddAlert: {
            name: "AddAlert",
            template: '<div class="add-alert-stub" @update:list="$emit(\'update:list\')"></div>',
          },
        },
      },
    });

    await flushPromises();

    wrapper.findComponent({ name: "AddAlert" }).vm.$emit("update:list");
    await flushPromises();

    expect(pushSpy).toHaveBeenCalledWith({
      name: "alertList",
      query: {
        org_identifier: "test-org",
        folder: "default",
        tab: "all",
      },
    });
  });

  it("should navigate back on handleCancel", async () => {
    vi.mocked(destinationService.list).mockResolvedValue({
      data: [{ id: 1, name: "Destination 1" }],
    } as any);

    const backSpy = vi.spyOn(router, "back");

    const wrapper = mount(AddAlertView, {
      global: {
        plugins: [store, router],
        stubs: {
          AddAlert: {
            name: "AddAlert",
            template:
              '<div class="add-alert-stub" @cancel:hideform="$emit(\'cancel:hideform\')"></div>',
          },
        },
      },
    });

    await flushPromises();

    wrapper.findComponent({ name: "AddAlert" }).vm.$emit("cancel:hideform");
    await flushPromises();

    expect(backSpy).toHaveBeenCalled();
  });

  it("should refresh destinations when event is emitted", async () => {
    vi.mocked(destinationService.list).mockResolvedValue({
      data: [{ id: 1, name: "Destination 1" }],
    } as any);

    const wrapper = mount(AddAlertView, {
      global: {
        plugins: [store, router],
        stubs: {
          AddAlert: {
            name: "AddAlert",
            template:
              '<div class="add-alert-stub" @refresh:destinations="$emit(\'refresh:destinations\')"></div>',
          },
        },
      },
    });

    await flushPromises();

    // Clear previous calls
    vi.mocked(destinationService.list).mockClear();

    wrapper.findComponent({ name: "AddAlert" }).vm.$emit("refresh:destinations");
    await flushPromises();

    expect(destinationService.list).toHaveBeenCalledTimes(1);
  });

  it("should pass correct props to AddAlert", async () => {
    const mockDestinations = [
      { id: 1, name: "Destination 1" },
      { id: 2, name: "Destination 2" },
    ];

    vi.mocked(destinationService.list).mockResolvedValue({
      data: mockDestinations,
    } as any);

    const wrapper = mount(AddAlertView, {
      global: {
        plugins: [store, router],
        stubs: {
          AddAlert: {
            name: "AddAlert",
            template: '<div class="add-alert-stub"></div>',
            props: ["destinations", "isUpdated"],
          },
        },
      },
    });

    await flushPromises();

    const addAlert = wrapper.findComponent({ name: "AddAlert" });
    expect(addAlert.props("destinations")).toEqual(mockDestinations);
    expect(addAlert.props("isUpdated")).toBe(false);
  });

  describe("edit mode", () => {
    const AddAlertStub = {
      name: "AddAlert",
      props: ["modelValue", "isUpdated", "destinations"],
      template: '<div class="add-alert-stub"></div>',
    };

    const mountEditing = async (alertId = "alert-1") => {
      await router.push({ name: "editAlert", params: { alert_id: alertId } });
      await router.isReady();

      const wrapper = mount(AddAlertView, {
        global: { plugins: [store, router], stubs: { AddAlert: AddAlertStub } },
      });
      await flushPromises();
      return wrapper;
    };

    it("loads the alert itself instead of routing through the list", async () => {
      // The whole point: pressing Edit on the detail page used to mount the
      // list and refetch everything before the form appeared.
      vi.mocked(destinationService.list).mockResolvedValue({ data: [{ id: 1 }] } as any);
      vi.mocked(alertsService.get_by_alert_id).mockResolvedValue({
        data: { name: "my-alert", stream_name: "k8s_logs", stream_type: "logs" },
      } as any);

      const wrapper = await mountEditing();

      expect(alertsService.get_by_alert_id).toHaveBeenCalledWith("test-org", "alert-1");

      const form = wrapper.findComponent(AddAlertStub);
      expect(form.props("isUpdated")).toBe(true);

      // The whole fetched alert reaches the form, not just its name — the form
      // takes its entire edit prefill from this one object.
      const seeded = form.props("modelValue") as any;
      expect(seeded.name).toBe("my-alert");
      expect(seeded.stream_name).toBe("k8s_logs");
      expect(seeded.stream_type).toBe("logs");
    });

    it("does not fetch an alert when creating one", async () => {
      vi.mocked(destinationService.list).mockResolvedValue({ data: [{ id: 1 }] } as any);
      await router.push({ name: "alertList" });

      mount(AddAlertView, {
        global: { plugins: [store, router], stubs: { AddAlert: AddAlertStub } },
      });
      await flushPromises();

      expect(alertsService.get_by_alert_id).not.toHaveBeenCalled();
    });

    it("holds the form back until the alert has arrived", async () => {
      vi.mocked(destinationService.list).mockResolvedValue({ data: [{ id: 1 }] } as any);
      let resolveAlert: (value: any) => void = () => {};
      vi.mocked(alertsService.get_by_alert_id).mockReturnValue(
        new Promise((resolve) => {
          resolveAlert = resolve;
        }) as any,
      );

      await router.push({ name: "editAlert", params: { alert_id: "alert-1" } });
      const wrapper = mount(AddAlertView, {
        global: { plugins: [store, router], stubs: { AddAlert: AddAlertStub } },
      });
      await flushPromises();

      // Rendering the form early would flash an empty create-form first.
      expect(wrapper.find(".add-alert-stub").exists()).toBe(false);

      resolveAlert({ data: { name: "my-alert" } });
      await flushPromises();
      expect(wrapper.find(".add-alert-stub").exists()).toBe(true);
    });

    it("sends the user back to the list when the alert cannot be loaded", async () => {
      vi.mocked(destinationService.list).mockResolvedValue({ data: [{ id: 1 }] } as any);
      vi.mocked(alertsService.get_by_alert_id).mockRejectedValue(new Error("404"));
      const replaceSpy = vi.spyOn(router, "replace");

      await mountEditing("missing");

      // An empty form here would save as a NEW alert.
      expect(replaceSpy).toHaveBeenCalledWith(expect.objectContaining({ name: "alertList" }));
    });

    it("still opens the editor when the org has no destinations left", async () => {
      // The alert already exists; refusing to open it would be absurd.
      vi.mocked(destinationService.list).mockResolvedValue({ data: [] } as any);
      vi.mocked(alertsService.get_by_alert_id).mockResolvedValue({
        data: { name: "my-alert" },
      } as any);
      const pushSpy = vi.spyOn(router, "push");

      const wrapper = await mountEditing();

      expect(wrapper.findComponent(AddAlertStub).exists()).toBe(true);
      expect(pushSpy).not.toHaveBeenCalledWith(expect.objectContaining({ name: "alertList" }));
    });
  });
});
