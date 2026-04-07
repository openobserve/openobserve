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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({ plugins: [Dialog, Notify] });

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ params: {}, query: {} }),
}));

vi.mock("@/services/alert_destination", () => ({
  default: {
    create: vi.fn().mockResolvedValue({ data: { code: 200 } }),
    update: vi.fn().mockResolvedValue({ data: { code: 200 } }),
    test: vi.fn().mockResolvedValue({ data: { code: 200 } }),
    getPrebuiltTypes: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({ track: vi.fn() }),
}));

import AddDestination from "@/components/alerts/AddDestination.vue";
import destinationService from "@/services/alert_destination";

async function mountComp(props: Record<string, any> = {}) {
  return mount(AddDestination, {
    props: {
      templates: [],
      destination: null,
      isAlerts: true,
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        PrebuiltDestinationSelector: {
          template: '<div data-test="prebuilt-destination-selector-stub"></div>',
          props: ["modelValue", "searchQuery"],
          emits: ["update:modelValue", "select", "update:searchQuery"],
        },
        PrebuiltDestinationForm: {
          template: '<div data-test="prebuilt-form-stub"></div>',
          props: ["modelValue", "destinationType", "hideActions"],
          emits: ["update:modelValue"],
        },
        DestinationTestResult: {
          template: '<div data-test="destination-test-result-stub"></div>',
          props: ["result"],
        },
        DestinationPreview: {
          template: '<div data-test="destination-preview-stub"></div>',
          props: ["destination"],
        },
      },
    },
  });
}

describe("AddDestination - rendering (create mode)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders without errors", async () => {
    const w = await mountComp();
    expect(w.exists()).toBe(true);
  });

  it("renders the title element", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="add-destination-title"]').exists()).toBe(true);
  });

  it("shows add title when no destination prop", async () => {
    const w = await mountComp({ destination: null });
    const titleEl = w.find('[data-test="add-destination-title"]');
    expect(titleEl.text()).toContain("New Destination");
  });

  it("renders the cancel button", async () => {
    const w = await mountComp();
    // Set to custom mode to show url/method/cancel/submit
    (w.vm as any).formData.destination_type = "custom";
    await w.vm.$nextTick();
    expect(w.find('[data-test="add-destination-cancel-btn"]').exists()).toBe(true);
  });

  it("renders the url input in custom mode", async () => {
    const w = await mountComp();
    (w.vm as any).formData.destination_type = "custom";
    await w.vm.$nextTick();
    expect(w.find('[data-test="add-destination-url-input"]').exists()).toBe(true);
  });

  it("renders the method select in custom mode", async () => {
    const w = await mountComp();
    (w.vm as any).formData.destination_type = "custom";
    await w.vm.$nextTick();
    expect(w.find('[data-test="add-destination-method-select"]').exists()).toBe(true);
  });
});

describe("AddDestination - rendering (update mode)", () => {
  const existingDest = {
    name: "my-dest",
    url: "https://hooks.slack.com/test",
    method: "post",
    headers: {},
    template: "tmpl1",
    destination_type: "custom",
  };

  it("shows update title when destination prop provided", async () => {
    const w = await mountComp({ destination: existingDest });
    await flushPromises();
    const titleEl = w.find('[data-test="add-destination-title"]');
    expect(titleEl.text()).toContain("Update");
  });
});

describe("AddDestination - initial state", () => {
  it("formData.name is empty by default", async () => {
    const w = await mountComp();
    expect((w.vm as any).formData.name).toBe("");
  });

  it("formData.method defaults to post", async () => {
    const w = await mountComp();
    expect((w.vm as any).formData.method).toBe("post");
  });

  it("isPrebuiltDestination is false by default", async () => {
    const w = await mountComp();
    expect((w.vm as any).isPrebuiltDestination).toBeFalsy();
  });
});

describe("AddDestination - isPrebuiltDestination computed", () => {
  it("returns false for empty destination_type", async () => {
    const w = await mountComp();
    (w.vm as any).formData.destination_type = "";
    expect((w.vm as any).isPrebuiltDestination).toBeFalsy();
  });

  it("returns false for custom destination_type", async () => {
    const w = await mountComp();
    (w.vm as any).formData.destination_type = "custom";
    expect((w.vm as any).isPrebuiltDestination).toBe(false);
  });

  it("returns true for prebuilt destination_type (e.g. slack)", async () => {
    const w = await mountComp();
    (w.vm as any).formData.destination_type = "slack";
    expect((w.vm as any).isPrebuiltDestination).toBe(true);
  });
});

describe("AddDestination - getDestinationTypeIcon", () => {
  it("returns a string for known type", async () => {
    const w = await mountComp();
    const icon = (w.vm as any).getDestinationTypeIcon("slack");
    expect(typeof icon).toBe("string");
  });

  it("returns a fallback string for unknown type", async () => {
    const w = await mountComp();
    const icon = (w.vm as any).getDestinationTypeIcon("unknown-type");
    expect(typeof icon).toBe("string");
  });
});

describe("AddDestination - getDestinationTypeName", () => {
  it("returns typeId when no matching type found", async () => {
    const w = await mountComp();
    (w.vm as any).availableTypes = [];
    const name = (w.vm as any).getDestinationTypeName("my-type");
    expect(name).toBe("my-type");
  });

  it("returns type name when matching type found", async () => {
    const w = await mountComp();
    (w.vm as any).availableTypes = [{ id: "slack", name: "Slack" }];
    const name = (w.vm as any).getDestinationTypeName("slack");
    expect(name).toBe("Slack");
  });
});

describe("AddDestination - cancel button", () => {
  it("clicking cancel emits cancel:hideform", async () => {
    const w = await mountComp();
    (w.vm as any).formData.destination_type = "custom";
    await w.vm.$nextTick();
    await w.find('[data-test="add-destination-cancel-btn"]').trigger("click");
    expect(w.emitted("cancel:hideform")).toBeTruthy();
  });
});

describe("AddDestination - saveDestination", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls destinationService.create in create mode when form is filled", async () => {
    const w = await mountComp({ destination: null, isAlerts: false });
    await flushPromises();
    (w.vm as any).formData.name = "dest1";
    (w.vm as any).formData.url = "https://example.com/webhook";
    (w.vm as any).formData.method = "post";
    (w.vm as any).formData.template = "tmpl1";
    (w.vm as any).formData.destination_type = "custom";
    await (w.vm as any).saveDestination();
    await flushPromises();
    expect(destinationService.create).toHaveBeenCalled();
  });
});
