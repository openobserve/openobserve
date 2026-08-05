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
import {
  alertCreationDialog,
  closeAlertCreationDialog,
} from "@/composables/alerts/useAlertCreation";

const mockOpenAlertCreation = vi.fn(() => true);
vi.mock("@/composables/alerts/useAlertCreation", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return { ...actual, useAlertCreation: () => ({ openAlertCreation: mockOpenAlertCreation }) };
});

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
  closeAlertCreationDialog();
});

/** A prefill with something to decide, so the confirm dialog is warranted. */
const needsDialog = () => ({
  ...prefill(),
  streamCandidates: [
    { name: "a", type: "logs" },
    { name: "b", type: "logs" },
  ],
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

  it("goes straight to the form when there is nothing to decide", async () => {
    // The confirm dialog is an extra click on every alert; it must not appear
    // for the ordinary single-stream, pattern-less case.
    wrapper = mountAction();
    await wrapper.find(".menu-item-stub").trigger("click");

    expect(alertCreationDialog.value).toBeNull();
    expect(mockOpenAlertCreation).toHaveBeenCalledTimes(1);
  });

  it("still goes straight through when only non-blocking warnings are present", async () => {
    const build = vi.fn(() => ({
      ...prefill(),
      warnings: [{ key: "limitStripped", level: "warning" as const }],
    }));
    wrapper = mountAction({}, build);
    await wrapper.find(".menu-item-stub").trigger("click");

    expect(alertCreationDialog.value).toBeNull();
    expect(mockOpenAlertCreation).toHaveBeenCalledTimes(1);
  });

  it("requests the confirm dialog when there IS something to decide", async () => {
    wrapper = mountAction({}, vi.fn(needsDialog));
    await wrapper.find(".menu-item-stub").trigger("click");

    expect(alertCreationDialog.value?.open).toBe(true);
    // The candidates ride along so the dialog can render its stream picker; the
    // pre-selected stream is left alone (the fallback is only for an empty one).
    expect(alertCreationDialog.value?.prefill.streamCandidates).toHaveLength(2);
    expect(mockOpenAlertCreation).not.toHaveBeenCalled();
  });

  it("requests the dialog for a blocked prefill so the reason gets stated", async () => {
    const build = vi.fn(() => ({ ...prefill(), streamName: "" }));
    wrapper = mountAction({}, build);
    await wrapper.find(".menu-item-stub").trigger("click");

    expect(alertCreationDialog.value?.open).toBe(true);
    expect(mockOpenAlertCreation).not.toHaveBeenCalled();
  });

  it("does not render a dialog of its own", async () => {
    // The dialog must NOT live here: reka-ui unmounts a dropdown's content when
    // an item is selected, which would kill a locally-owned dialog in the same
    // tick it opened — the "opens and closes immediately" bug.
    wrapper = mountAction({}, vi.fn(needsDialog));
    await wrapper.find(".menu-item-stub").trigger("click");

    expect(wrapper.findComponent({ name: "CreateAlertFromSourceDialog" }).exists()).toBe(false);
  });

  it("keeps the dialog request alive after the trigger unmounts", async () => {
    wrapper = mountAction({}, vi.fn(needsDialog));
    await wrapper.find(".menu-item-stub").trigger("click");

    wrapper.unmount();
    wrapper = null;

    expect(alertCreationDialog.value?.open).toBe(true);
  });

  it("normalizes the prefill before showing it", async () => {
    const build = vi.fn(() => ({ ...needsDialog(), periodMinutes: 99_999 }));
    wrapper = mountAction({}, build);
    await wrapper.find(".menu-item-stub").trigger("click");

    expect(alertCreationDialog.value?.prefill.periodMinutes).toBe(1440);
  });

  it("does nothing when a disabled reason is set", async () => {
    const build = vi.fn(prefill);
    wrapper = mountAction({ disabledReason: "Select a stream first" }, build);
    await wrapper.find(".menu-item-stub").trigger("click");

    expect(build).not.toHaveBeenCalled();
    expect(alertCreationDialog.value).toBeNull();
  });

  it("marks the control disabled when a reason is set", () => {
    wrapper = mountAction({ disabledReason: "Select a stream first" });
    expect(wrapper.findComponent(DropdownItemStub).props("disabled")).toBe(true);
  });

  it("passes the folder along on the dialog path", async () => {
    wrapper = mountAction({ folder: "team-a" }, vi.fn(needsDialog));
    await wrapper.find(".menu-item-stub").trigger("click");

    expect(alertCreationDialog.value?.options).toEqual({ folder: "team-a" });
  });

  it("passes the folder along on the direct path", async () => {
    wrapper = mountAction({ folder: "team-a" });
    await wrapper.find(".menu-item-stub").trigger("click");

    expect(mockOpenAlertCreation).toHaveBeenCalledWith(expect.anything(), { folder: "team-a" });
  });

  describe("icon presentation", () => {
    // Host menus differ: the logs More menu badges its icons, the dashboards
    // panel menu does not. The host supplies the presentation; the registry
    // still owns which icon it is.
    const DropdownItemWithSlots = {
      name: "ODropdownItem",
      props: ["disabled"],
      emits: ["select"],
      template: `<div class="menu-item-stub"><slot name="icon-left" /><slot /></div>`,
    };

    it("renders a default icon when the host supplies none", () => {
      wrapper = mount(CreateAlertAction, {
        props: { source: "logs", build: vi.fn(prefill) },
        global: {
          plugins: [i18n],
          stubs: { ...stubs, ODropdownItem: DropdownItemWithSlots },
        },
      });
      expect(wrapper.findComponent({ name: "OIcon" }).exists()).toBe(true);
    });

    it("lets the host override the icon presentation, passing the registry icon in", () => {
      wrapper = mount(CreateAlertAction, {
        props: { source: "logs", build: vi.fn(prefill) },
        global: {
          plugins: [i18n],
          stubs: { ...stubs, ODropdownItem: DropdownItemWithSlots },
        },
        slots: {
          "icon-left": `<template #icon-left="{ icon }">
            <span class="host-badge">{{ icon }}</span>
          </template>`,
        },
      });

      const badge = wrapper.find(".host-badge");
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("shield-alert-outline");
    });
  });

  it("uses the registry label for the source", () => {
    wrapper = mountAction({ source: "logs" });
    expect(wrapper.text()).toContain("Create Alert");
  });
});
