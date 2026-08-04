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

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";

import CreateAlertAction from "@/components/alerts/CreateAlertAction.vue";
import { ALERT_PREFILL_VERSION, type AlertPrefill } from "@/ts/interfaces/alertPrefill";

const mockOpenAlertCreation = vi.fn(() => true);
vi.mock("@/composables/alerts/useAlertCreation", () => ({
  useAlertCreation: () => ({ openAlertCreation: mockOpenAlertCreation }),
}));

const DialogStub = {
  name: "CreateAlertFromSourceDialog",
  props: ["open", "prefill"],
  emits: ["update:open", "confirm", "cancel"],
  template: `<div data-test="dialog-stub" />`,
};

const DropdownItemStub = {
  name: "ODropdownItem",
  props: ["disabled", "iconLeft"],
  emits: ["select"],
  template: `<div class="menu-item-stub" @click="$emit('select')"><slot /></div>`,
};

const ButtonStub = {
  name: "OButton",
  props: ["disabled", "variant", "iconLeft"],
  emits: ["click"],
  template: `<button :disabled="disabled" @click="$emit('click')"><slot /></button>`,
};

const stubs = {
  CreateAlertFromSourceDialog: DialogStub,
  ODropdownItem: DropdownItemStub,
  OButton: ButtonStub,
  OTooltip: { name: "OTooltip", props: ["content"], template: `<span>{{ content }}</span>` },
};

const prefill = (): AlertPrefill => ({
  version: ALERT_PREFILL_VERSION,
  source: "logs",
  sourceLabel: "k8s_logs",
  streamType: "logs",
  streamName: "k8s_logs",
  queryType: "sql",
  sql: 'SELECT * FROM "k8s_logs"',
  warnings: [],
});

const mountAction = (props: Record<string, unknown> = {}, build = vi.fn(prefill)) =>
  mount(CreateAlertAction, {
    props: { source: "logs", build, ...props },
    global: { plugins: [i18n], stubs },
  });

let wrapper: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  mockOpenAlertCreation.mockClear();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("CreateAlertAction", () => {
  it("renders a dropdown item by default", () => {
    wrapper = mountAction();
    expect(wrapper.findComponent(DropdownItemStub).exists()).toBe(true);
  });

  it("renders a button in button variant", () => {
    wrapper = mountAction({ variant: "button" });
    expect(wrapper.find("button").exists()).toBe(true);
    expect(wrapper.findComponent(DropdownItemStub).exists()).toBe(false);
  });

  it("does NOT call build on render — only on activation", async () => {
    const build = vi.fn(prefill);
    wrapper = mountAction({}, build);
    expect(build).not.toHaveBeenCalled();

    await wrapper.find(".menu-item-stub").trigger("click");
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("opens the confirm dialog with the built prefill", async () => {
    wrapper = mountAction();
    await wrapper.find(".menu-item-stub").trigger("click");

    const dialog = wrapper.findComponent(DialogStub);
    expect(dialog.props("open")).toBe(true);
    expect((dialog.props("prefill") as AlertPrefill).streamName).toBe("k8s_logs");
  });

  it("normalizes the prefill before showing it", async () => {
    const build = vi.fn(() => ({ ...prefill(), periodMinutes: 99_999 }));
    wrapper = mountAction({}, build);
    await wrapper.find(".menu-item-stub").trigger("click");

    expect((wrapper.findComponent(DialogStub).props("prefill") as AlertPrefill).periodMinutes).toBe(
      1440,
    );
  });

  it("does nothing when a disabled reason is set", async () => {
    const build = vi.fn(prefill);
    wrapper = mountAction({ disabledReason: "Select a stream first" }, build);
    await wrapper.find(".menu-item-stub").trigger("click");

    expect(build).not.toHaveBeenCalled();
    expect(wrapper.findComponent(DialogStub).props("open")).toBe(false);
  });

  it("marks the control disabled when a reason is set", () => {
    wrapper = mountAction({ disabledReason: "Select a stream first" });
    expect(wrapper.findComponent(DropdownItemStub).props("disabled")).toBe(true);
  });

  it("hands the confirmed prefill to the launcher", async () => {
    wrapper = mountAction({ folder: "team-a" });
    await wrapper.find(".menu-item-stub").trigger("click");

    const confirmed = { ...prefill(), streamName: "other" };
    await wrapper.findComponent(DialogStub).vm.$emit("confirm", confirmed);

    expect(mockOpenAlertCreation).toHaveBeenCalledWith(confirmed, { folder: "team-a" });
  });

  it("drops the pending prefill on cancel", async () => {
    wrapper = mountAction();
    await wrapper.find(".menu-item-stub").trigger("click");
    await wrapper.findComponent(DialogStub).vm.$emit("cancel");

    expect(wrapper.findComponent(DialogStub).props("prefill")).toBeNull();
    expect(mockOpenAlertCreation).not.toHaveBeenCalled();
  });

  it("uses the registry label for the source", () => {
    wrapper = mountAction({ source: "logs" });
    expect(wrapper.text()).toContain("Create Alert");
  });
});
