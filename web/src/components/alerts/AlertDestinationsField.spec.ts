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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createStore } from "vuex";
import i18n from "@/locales";
import AlertDestinationsField from "./AlertDestinationsField.vue";
import { queryClient } from "@/composables/query/queryClient";
import { toast } from "@/lib/feedback/Toast/useToast";

const destinationMocks = vi.hoisted(() => ({
  testSend: vi.fn(),
  list: vi.fn(),
  listTemplates: vi.fn(),
}));

const listWorkflowsMock = vi.hoisted(() =>
  vi.fn(async () => ({
    data: [
      { id: "wf-1", name: "Escalate", is_draft: false },
      { id: "wf-2", name: "Unfinished", is_draft: true },
    ],
  })),
);

vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "true", isCloud: "false" },
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ resolve: () => ({ href: "" }) }),
}));

vi.mock("@/services/workflows", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      listWorkflows: (...args: any[]) => listWorkflowsMock(...args),
    },
  });
});

vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      testSend: (...args: any[]) => destinationMocks.testSend(...args),
      list: (...args: any[]) => destinationMocks.list(...args),
    },
  });
});

vi.mock("@/services/alert_templates", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { list: (...args: any[]) => destinationMocks.listTemplates(...args) },
  });
});

vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, toast: vi.fn() };
});

const TargetsStub = defineComponent({
  name: "AlertTargetsSelect",
  props: ["workflowOptions", "workflowsEnabled", "placeholder"],
  emits: ["refresh", "create-destination", "create-workflow"],
  template: "<div />",
});

const DrawerStub = defineComponent({
  name: "ODrawer",
  props: ["open", "title", "size"],
  emits: ["update:open"],
  template: '<div v-if="open" data-test="drawer-stub"><slot /></div>',
});

const AddDestinationStub = defineComponent({
  name: "AddDestination",
  props: { drawer: Boolean, templates: Array },
  emits: ["created", "get:destinations", "cancel:hideform"],
  template: '<div data-test="add-destination-stub" />',
});

function mountField(props: Record<string, unknown> = {}) {
  const store = createStore({
    state: {
      selectedOrganization: { identifier: "test-org" },
      zoConfig: { workflows_enabled: true },
    },
  });
  return mount(AlertDestinationsField, {
    props: { destinations: [], workflows: [], destinationOptions: [], ...props },
    global: {
      plugins: [i18n, store],
      stubs: {
        AlertTargetsSelect: TargetsStub,
        ODrawer: DrawerStub,
        AddDestination: AddDestinationStub,
        OIcon: true,
        OTooltip: true,
      },
    },
  });
}

describe("AlertDestinationsField workflows", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    listWorkflowsMock.mockClear();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("offers only published workflows", async () => {
    wrapper = mountField();
    await flushPromises();

    const options = wrapper.findComponent(TargetsStub).props("workflowOptions") as any[];
    expect(options.map((o) => o.value)).toEqual(["wf-1"]);
  });

  it("serves a reopened form from the cache", async () => {
    wrapper = mountField();
    await flushPromises();
    wrapper.unmount();

    wrapper = mountField();
    await flushPromises();

    expect(listWorkflowsMock).toHaveBeenCalledTimes(1);
  });

  // A workflow made in the new tab never expires this tab's cache, so only a forced read shows it.
  it("re-reads workflows from the server on refresh and asks the parent for destinations", async () => {
    wrapper = mountField();
    await flushPromises();
    expect(listWorkflowsMock).toHaveBeenCalledTimes(1);

    wrapper.findComponent(TargetsStub).vm.$emit("refresh");
    await flushPromises();

    expect(listWorkflowsMock).toHaveBeenCalledTimes(2);
    expect(wrapper.emitted("refresh")).toHaveLength(1);
  });
});

describe("AlertDestinationsField status line", () => {
  const NOTE = '[data-test="alert-settings-destinations-note"]';
  const STATUS = '[data-test="alert-settings-destinations-status"]';
  const ERROR = '[data-test="alert-settings-destinations-error"]';
  const t = i18n.global.t as any;

  it("is not marked required", () => {
    expect(mountField().text()).not.toContain("*");
  });

  it("says no destination is notified when the alert has nowhere to send", () => {
    const wrapper = mountField({ notifiesNobody: true, showStatus: true });
    expect(wrapper.find(NOTE).text()).toBe(t("alerts.alertSettings.noDestinationNote"));
    expect(wrapper.find(STATUS).exists()).toBe(false);
  });

  it("names a single destination", () => {
    const wrapper = mountField({ destinations: ["ops-slack"], showStatus: true });
    expect(wrapper.find(STATUS).text()).toBe(
      t("alerts.alertSettings.sendsToStatus", { targets: "ops-slack" }),
    );
    expect(wrapper.find(NOTE).exists()).toBe(false);
  });

  it("counts several destinations and names a single workflow", async () => {
    const wrapper = mountField({
      destinations: ["a", "b"],
      workflows: ["wf-1"],
      showStatus: true,
    });
    await flushPromises();
    expect(wrapper.find(STATUS).text()).toBe(
      t("alerts.alertSettings.sendsToStatus", { targets: "2 destinations and Escalate" }),
    );
  });

  // The team lives on the Advanced tab, so the picker cannot show it.
  it("falls back to the on-call team when the parent says there is a target but none is picked", () => {
    expect(mountField({ showStatus: true }).find(STATUS).text()).toBe(
      t("alerts.alertSettings.sendsToStatus", {
        targets: t("alerts.alertSettings.oncallTeamTarget"),
      }),
    );
  });

  it("stays quiet unless asked, as on the recovery field", () => {
    const wrapper = mountField({ notifiesNobody: true });
    expect(wrapper.find(NOTE).exists()).toBe(false);
    expect(wrapper.find(STATUS).exists()).toBe(false);
  });

  it("passes the placeholder to the picker", () => {
    const wrapper = mountField({ placeholder: "No destination" });
    expect(wrapper.findComponent(TargetsStub).props("placeholder")).toBe("No destination");
  });

  // focusOnFirstError finds the tab that owns an invalid field by its [role="alert"] message.
  it("renders an error instead of the status, as [role=alert]", () => {
    const wrapper = mountField({ notifiesNobody: true, showStatus: true, error: "bad" });
    expect(wrapper.find(ERROR).attributes("role")).toBe("alert");
    expect(wrapper.find(NOTE).exists()).toBe(false);
  });
});

describe("AlertDestinationsField destination drawer", () => {
  let wrapper: VueWrapper;
  let open: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    queryClient.clear();
    destinationMocks.listTemplates.mockResolvedValue({ data: [{ name: "t1", type: "http" }] });
    open = vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    wrapper?.unmount();
    open.mockRestore();
  });

  async function openDrawer(props: Record<string, unknown> = {}) {
    wrapper = mountField(props);
    await flushPromises();
    wrapper.findComponent(TargetsStub).vm.$emit("create-destination");
    await flushPromises();
  }

  const form = () => wrapper.findComponent(AddDestinationStub);

  it("opens the destination form in a drawer instead of a new tab", async () => {
    await openDrawer();

    expect(wrapper.findComponent(DrawerStub).props("open")).toBe(true);
    expect(form().props("drawer")).toBe(true);
    expect(form().props("templates")).toEqual([{ name: "t1", type: "http" }]);
    expect(open).not.toHaveBeenCalled();
  });

  it("refreshes the list, then selects the new destination beside the picked ones", async () => {
    const order: string[] = [];
    await openDrawer({
      destinations: ["ops"],
      onRefresh: () => order.push("refresh"),
      "onUpdate:destinations": () => order.push("update"),
    });

    form().vm.$emit("created", "new-hook");
    form().vm.$emit("cancel:hideform");
    await flushPromises();

    expect(order).toEqual(["refresh", "update"]);
    expect(wrapper.emitted("update:destinations")).toEqual([[["ops", "new-hook"]]]);
    expect(wrapper.findComponent(DrawerStub).props("open")).toBe(false);
  });

  it("selects nothing when the form is cancelled", async () => {
    await openDrawer({ destinations: ["ops"] });

    form().vm.$emit("cancel:hideform");
    await flushPromises();

    expect(wrapper.emitted("update:destinations")).toBeUndefined();
    expect(wrapper.emitted("refresh")).toBeUndefined();
    expect(wrapper.findComponent(DrawerStub).props("open")).toBe(false);
  });

  it("works for the recovery field, which has no workflows", async () => {
    await openDrawer({ destinations: [], supportsWorkflows: false });

    form().vm.$emit("created", "pager");
    await flushPromises();

    expect(wrapper.emitted("update:destinations")).toEqual([[["pager"]]]);
  });

  it("keeps New workflow in a new tab", async () => {
    wrapper = mountField();
    await flushPromises();

    wrapper.findComponent(TargetsStub).vm.$emit("create-workflow");

    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("AlertDestinationsField send test", () => {
  const BTN = '[data-test="alert-destinations-send-test-btn"]';
  const t = i18n.global.t as any;
  let wrapper: VueWrapper;

  beforeEach(() => {
    queryClient.clear();
    vi.mocked(toast).mockClear();
    destinationMocks.testSend.mockReset().mockResolvedValue({ data: { success: true } });
    destinationMocks.list.mockResolvedValue({
      data: [
        { name: "ops", template: "ops-template" },
        { name: "bare", template: "" },
      ],
    });
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  async function clickSend(props: Record<string, unknown>) {
    wrapper = mountField({ showSendTest: true, ...props });
    await flushPromises();
    await wrapper.find(BTN).trigger("click");
    await flushPromises();
  }

  const sentTemplates = () =>
    destinationMocks.testSend.mock.calls.map((call: any[]) => [
      call[0].destination_name,
      call[0].data,
    ]);

  it("is not offered unless the parent asks", () => {
    wrapper = mountField({ destinations: ["ops"] });
    expect(wrapper.find(BTN).exists()).toBe(false);
  });

  it("is disabled, with the reason, while nothing is selected", () => {
    wrapper = mountField({ showSendTest: true });
    expect(wrapper.find(BTN).attributes("disabled")).toBeDefined();
    expect(
      wrapper.find('[data-test="alert-destinations-send-test-reason"]').attributes("content"),
    ).toBe(t("alert_templates.testSendNoDestination"));
  });

  it("sends the alert's template to every selected destination", async () => {
    await clickSend({ destinations: ["ops", "bare"], alertTemplate: "alert-template" });

    expect(sentTemplates()).toEqual([
      ["ops", { template_name: "alert-template" }],
      ["bare", { template_name: "alert-template" }],
    ]);
    expect(destinationMocks.testSend.mock.calls[0][0]).toMatchObject({
      org_identifier: "test-org",
      options: { skipAccessToast: true },
    });
  });

  it("falls back to each destination's template, then to the org default content", async () => {
    await clickSend({ destinations: ["ops", "bare", "unknown"] });

    expect(sentTemplates()).toEqual([
      ["ops", { template_name: "ops-template" }],
      ["bare", { template_name: "o2_default_content" }],
      ["unknown", { template_name: "o2_default_content" }],
    ]);
  });

  it("confirms the send", async () => {
    await clickSend({ destinations: ["ops"] });

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "success",
        message: t("alert_templates.testSendSuccess"),
      }),
    );
  });

  it("names the destination the author may not send to", async () => {
    destinationMocks.testSend.mockRejectedValue({ response: { status: 403 } });
    await clickSend({ destinations: ["ops"] });

    expect(toast).toHaveBeenCalledWith({
      variant: "error",
      message: t("alerts.alertSettings.sendTestForbidden", { name: "ops" }),
    });
  });

  it("says once when the send cap is hit", async () => {
    destinationMocks.testSend.mockRejectedValue({ response: { status: 429 } });
    await clickSend({ destinations: ["ops", "bare"] });

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({
      variant: "error",
      message: t("alert_templates.testSendRateLimited"),
    });
  });

  it("shows the server's reason for any other failure", async () => {
    destinationMocks.testSend.mockRejectedValue({
      response: { status: 400, data: { message: "Template x not found" } },
    });
    await clickSend({ destinations: ["ops"] });

    expect(toast).toHaveBeenCalledWith({ variant: "error", message: "Template x not found" });
  });

  // A failed lookup is not proof the destination has no template, so the default must not stand in.
  it("sends nothing and says so when the destination templates cannot be read", async () => {
    destinationMocks.list.mockRejectedValue(new Error("network"));
    await clickSend({ destinations: ["ops"] });

    expect(destinationMocks.testSend).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      variant: "error",
      message: t("alerts.alertSettings.sendTestLookupFailed"),
    });
  });

  it("still sends the alert's template when the destination templates cannot be read", async () => {
    destinationMocks.list.mockRejectedValue(new Error("network"));
    await clickSend({ destinations: ["ops"], alertTemplate: "alert-template" });

    expect(sentTemplates()).toEqual([["ops", { template_name: "alert-template" }]]);
  });
});
