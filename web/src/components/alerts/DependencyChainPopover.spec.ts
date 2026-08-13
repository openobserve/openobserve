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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";

vi.mock("@/services/alert_destination", () => ({ default: { delete: vi.fn() } }));
vi.mock("@/services/alert_templates", () => ({ default: { delete: vi.fn() } }));
vi.mock("@/services/alerts", () => ({ default: { delete_by_alert_id: vi.fn() } }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn(() => vi.fn()) }));

import DependencyChainPopover from "./DependencyChainPopover.vue";
import destinationService from "@/services/alert_destination";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const OPopoverStub = {
  name: "OPopover",
  props: ["open"],
  emits: ["update:open"],
  template: `<div class="opopover-stub"><slot name="trigger" /><slot /></div>`,
};
const PanelStub = {
  name: "DependencyUsagePanel",
  props: { focus: { type: Object, default: null } },
  emits: ["requestDelete", "open"],
  template: `<div class="panel-stub" />`,
};
const ConfirmDialogStub = {
  name: "ConfirmDialog",
  props: ["modelValue", "title", "message"],
  emits: ["update:ok", "update:cancel", "update:modelValue"],
  template: `<div class="confirm-stub" :data-visible="modelValue" :data-title="title" />`,
};

function mountPopover(focus: Record<string, unknown>): VueWrapper {
  return mount(DependencyChainPopover, {
    props: { focus },
    global: {
      plugins: [i18n, store],
      stubs: {
        OPopover: OPopoverStub,
        DependencyUsagePanel: PanelStub,
        ConfirmDialog: ConfirmDialogStub,
        OButton: { template: `<button v-bind="$attrs"><slot /></button>` },
        OIcon: { template: "<i />" },
        OTooltip: { template: "<span />" },
      },
    },
  });
}

describe("DependencyChainPopover", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(destinationService.delete).mockResolvedValue({} as any);
  });
  afterEach(() => wrapper?.unmount());

  it("renders a trigger and mounts the panel only when open", async () => {
    wrapper = mountPopover({ kind: "destination", name: "slack" });
    expect(wrapper.find('[data-test="view-dependencies-slack"]').exists()).toBe(true);
    expect(wrapper.findComponent(PanelStub).exists()).toBe(false);

    (wrapper.vm as any).open = true;
    await nextTick();
    expect(wrapper.findComponent(PanelStub).exists()).toBe(true);
  });

  it("a requestDelete closes the popover and opens the ConfirmDialog", async () => {
    wrapper = mountPopover({ kind: "destination", name: "slack" });
    (wrapper.vm as any).open = true;
    await nextTick();

    wrapper.findComponent(PanelStub).vm.$emit("requestDelete", {
      kind: "destination",
      name: "slack",
      id: "destination:slack",
    });
    await nextTick();
    expect((wrapper.vm as any).open).toBe(false);
    const confirm = wrapper.find(".confirm-stub");
    expect(confirm.attributes("data-visible")).toBe("true");
    expect(confirm.attributes("data-title")).toContain("slack");
  });

  it("bubbles an in-place `open` to the host page and closes the popover", async () => {
    wrapper = mountPopover({ kind: "template", name: "tpl-http" });
    (wrapper.vm as any).open = true;
    await nextTick();

    wrapper.findComponent(PanelStub).vm.$emit("open", {
      kind: "template",
      name: "tpl-http",
      id: "template:tpl-http",
    });
    await nextTick();
    expect((wrapper.vm as any).open).toBe(false);
    expect(wrapper.emitted("open")?.[0]?.[0] as any).toMatchObject({
      kind: "template",
      name: "tpl-http",
    });
  });

  it("confirming the dialog deletes via the API and emits 'deleted'", async () => {
    wrapper = mountPopover({ kind: "destination", name: "slack" });
    (wrapper.vm as any).open = true;
    await nextTick();
    wrapper.findComponent(PanelStub).vm.$emit("requestDelete", {
      kind: "destination",
      name: "slack",
      id: "destination:slack",
    });
    await nextTick();

    wrapper.findComponent(ConfirmDialogStub).vm.$emit("update:ok");
    await flushPromises();
    expect(destinationService.delete).toHaveBeenCalledWith(
      expect.objectContaining({ destination_name: "slack" }),
    );
    expect(wrapper.emitted("deleted")).toBeTruthy();
  });
});
