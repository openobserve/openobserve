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

const TargetsStub = defineComponent({
  name: "AlertTargetsSelect",
  props: ["workflowOptions", "workflowsEnabled"],
  emits: ["refresh"],
  template: "<div />",
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
      stubs: { AlertTargetsSelect: TargetsStub, OIcon: true, OTooltip: true },
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

describe("AlertDestinationsField with nowhere to send", () => {
  const NOTE = '[data-test="alert-settings-destinations-note"]';
  const ERROR = '[data-test="alert-settings-destinations-error"]';

  it("is not marked required", () => {
    expect(mountField().text()).not.toContain("*");
  });

  it("says the alert notifies nobody when told so", () => {
    expect(mountField({ notifiesNobody: true }).find(NOTE).text()).toContain(
      (i18n.global.t as any)("alerts.alertSettings.noDestinationNote"),
    );
  });

  it("stays quiet by default, as on the recovery field", () => {
    expect(mountField().find(NOTE).exists()).toBe(false);
  });

  // focusOnFirstError finds the tab that owns an invalid field by its [role="alert"] message.
  it("renders an error instead of the note, as [role=alert]", () => {
    const wrapper = mountField({ notifiesNobody: true, error: "bad" });
    expect(wrapper.find(ERROR).attributes("role")).toBe("alert");
    expect(wrapper.find(NOTE).exists()).toBe(false);
  });
});
