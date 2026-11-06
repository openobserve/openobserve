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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import usersService from "@/services/users";
import AddDestination from "./AddDestination.vue";

const route = vi.hoisted(() => ({ query: {} as Record<string, string> }));
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn(), currentRoute: { value: route } }),
  useRoute: () => ({ params: {}, query: {} }),
  onBeforeRouteLeave: vi.fn(),
  onBeforeRouteUpdate: vi.fn(),
}));
vi.mock("@/services/alert_destination", () => ({
  default: { list: vi.fn(), create: vi.fn(), update: vi.fn(), test: vi.fn() },
}));
vi.mock("@/services/users", () => ({ default: { orgUsers: vi.fn(), getRoles: vi.fn() } }));
vi.mock("@/services/reodotdev_analytics", () => ({ useReo: () => ({ track: vi.fn() }) }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const UNIFIED = "prebuilt_default";
const UNIFIED_LABEL = "Unified default (prebuilt_default)";

// The generic filter drops isPrebuilt rows, so the component adds the system entries itself.
const TEMPLATES = [
  { name: "prebuilt_slack", type: "http", kind: "content", isPrebuilt: true, body: "" },
  { name: UNIFIED, type: "http", kind: "content", isPrebuilt: true, body: "" },
  { name: "email_tpl", type: "email", kind: "custom", body: "" },
  { name: "raw_http_tpl", type: "http", kind: "custom", body: "" },
  { name: "content_tpl", type: "http", kind: "content", body: "" },
];

let wrapper: VueWrapper<any> | null = null;

const mountComp = (props: Record<string, any> = {}) =>
  mount(AddDestination, {
    props: { templates: TEMPLATES, destination: null, isAlerts: true, ...props },
    global: {
      plugins: [i18n, store],
      stubs: {
        PrebuiltDestinationSelector: { template: "<div />" },
        DestinationTestResult: {
          template: "<div />",
          props: ["result", "showSuccessResponseBody"],
        },
        AddUser: {
          template: "<div />",
          props: ["open", "container", "roles", "userRole", "isCloud"],
        },
        DestinationPreview: {
          template: "<div />",
          props: ["modelValue", "type", "templateContent"],
        },
        AppTabs: { template: "<div />", props: ["tabs", "activeTab"] },
      },
    },
  });

const getForm = (w: VueWrapper<any>) => w.findComponent({ name: "OForm" }).vm.form;

const selectType = async (w: VueWrapper<any>, type: string) => {
  const form = getForm(w);
  form.setFieldValue("destination_type", type);
  form.setFieldValue("type", type === "email" ? "email" : "http");
  form.setFieldValue("credentials", type === "email" ? { recipients: ["a@acme.io"] } : {});
  await flushPromises();
  return form;
};

const values = (w: VueWrapper<any>) => w.vm.prebuiltTemplateOptions.map((o: any) => o.value);
// Labels are resolved strings (`raw(t(...))`), so compare them as text.
const labelOf = (w: VueWrapper<any>, value: string) =>
  w.vm.prebuiltTemplateOptions.find((o: any) => o.value === value)?.label ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usersService.orgUsers).mockResolvedValue({ data: { data: [] } } as any);
  vi.mocked(usersService.getRoles).mockResolvedValue({ data: [] } as any);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("AddDestination - prebuilt template options", () => {
  it("slack: channel default first, unified default second, then http user templates", async () => {
    wrapper = mountComp();
    await selectType(wrapper, "slack");

    expect(values(wrapper)).toEqual(["prebuilt_slack", UNIFIED, "raw_http_tpl", "content_tpl"]);
    // The API row for prebuilt_default is not added a second time.
    expect(values(wrapper).filter((v: string) => v === UNIFIED)).toHaveLength(1);
    expect(labelOf(wrapper, UNIFIED)).toBe(UNIFIED_LABEL);
    expect(labelOf(wrapper, "prebuilt_slack")).toBe("Default (prebuilt_slack)");
  });

  it("email: offers the unified default too, since a Content template fits every transport", async () => {
    wrapper = mountComp();
    await selectType(wrapper, "email");

    expect(values(wrapper)).toEqual(["prebuilt_email", UNIFIED, "email_tpl", "content_tpl"]);
    expect(labelOf(wrapper, UNIFIED)).toBe(UNIFIED_LABEL);
  });

  it("edit mode: a saved prebuilt_default stays selected and is one of the options", async () => {
    const saved: any = {
      name: "ops-slack",
      url: "https://hooks.slack.com/services/T000/B000/xxxxxxxx",
      type: "http",
      method: "post",
      destination_type_name: "slack",
      template: UNIFIED,
      skip_tls_verify: false,
      headers: {},
      metadata: { prebuilt_type: "slack", credential_channel: "#ops" },
    };
    wrapper = mountComp({ destination: saved });
    await flushPromises();

    const form = getForm(wrapper);
    expect(form.state.values.destination_type).toBe("slack");
    expect(form.state.values.template).toBe(UNIFIED);
    expect(values(wrapper)).toContain(UNIFIED);
    expect(wrapper.find('[data-test="add-destination-prebuilt-template-select"]').exists()).toBe(
      true,
    );
  });
});
