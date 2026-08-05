import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";
import AddAlertView from "./AddAlertView.vue";
import destinationService from "@/services/alert_destination";
import alertsService from "@/services/alerts";

vi.mock("@/services/alert_destination", () => ({
  default: {
    list: vi.fn(),
  },
}));

vi.mock("@/services/alerts", () => ({
  default: {
    get_by_alert_id: vi.fn(),
  },
}));

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
      ],
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

    expect(destinationService.list).toHaveBeenCalledWith({
      org_identifier: "test-org",
      module: "alert",
    });
  });

  it("should not render AddAlert when destinations are empty", async () => {
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

    expect(wrapper.find(".add-alert-stub").exists()).toBe(false);
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
        data: { name: "my-alert", stream_name: "logs" },
      } as any);

      const wrapper = await mountEditing();

      expect(alertsService.get_by_alert_id).toHaveBeenCalledWith("test-org", "alert-1");

      const form = wrapper.findComponent(AddAlertStub);
      expect(form.props("isUpdated")).toBe(true);
      expect((form.props("modelValue") as any).name).toBe("my-alert");
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
      expect(replaceSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: "alertList" }),
      );
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
      expect(pushSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: "alertList" }),
      );
    });
  });
});
