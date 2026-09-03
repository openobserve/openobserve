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

import CreateAlertDialogProvider from "@/components/alerts/CreateAlertDialogProvider.vue";
import { ALERT_PREFILL_VERSION, type AlertPrefill } from "@/ts/interfaces/alertPrefill";

const mockOpenAlertCreation = vi.fn(() => true);
vi.mock("@/composables/alerts/useAlertCreation", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return { ...actual, useAlertCreation: () => ({ openAlertCreation: mockOpenAlertCreation }) };
});

// Imported after the mock so the singleton state is the real one.
const { alertCreationDialog, requestAlertCreation, closeAlertCreationDialog } =
  await import("@/composables/alerts/useAlertCreation");

const DialogStub = {
  name: "CreateAlertFromSourceDialog",
  props: ["open", "prefill"],
  emits: ["update:open", "confirm", "cancel"],
  template: `<div class="dialog-stub" />`,
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

const mountProvider = () =>
  mount(CreateAlertDialogProvider, {
    global: { plugins: [i18n], stubs: { CreateAlertFromSourceDialog: DialogStub } },
  });

let wrapper: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  mockOpenAlertCreation.mockClear();
  closeAlertCreationDialog();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  closeAlertCreationDialog();
});

describe("CreateAlertDialogProvider", () => {
  it("renders nothing until a dialog is requested", () => {
    wrapper = mountProvider();
    expect(wrapper.findComponent(DialogStub).exists()).toBe(false);
  });

  it("renders the dialog once a surface requests one", async () => {
    wrapper = mountProvider();
    requestAlertCreation(prefill());
    await wrapper.vm.$nextTick();

    const dialog = wrapper.findComponent(DialogStub);
    expect(dialog.exists()).toBe(true);
    expect(dialog.props("open")).toBe(true);
    expect((dialog.props("prefill") as AlertPrefill).streamName).toBe("k8s_logs");
  });

  it("hands the confirmed prefill to the launcher with the requested folder", async () => {
    wrapper = mountProvider();
    requestAlertCreation(prefill(), { folder: "team-a" });
    await wrapper.vm.$nextTick();

    const confirmed = { ...prefill(), streamName: "other" };
    await wrapper.findComponent(DialogStub).vm.$emit("confirm", confirmed);

    expect(mockOpenAlertCreation).toHaveBeenCalledWith(confirmed, { folder: "team-a" });
  });

  it("clears the request after confirming", async () => {
    wrapper = mountProvider();
    requestAlertCreation(prefill());
    await wrapper.vm.$nextTick();

    await wrapper.findComponent(DialogStub).vm.$emit("confirm", prefill());
    expect(alertCreationDialog.value).toBeNull();
  });

  it("clears the request on cancel without launching", async () => {
    wrapper = mountProvider();
    requestAlertCreation(prefill());
    await wrapper.vm.$nextTick();

    await wrapper.findComponent(DialogStub).vm.$emit("cancel");

    expect(alertCreationDialog.value).toBeNull();
    expect(mockOpenAlertCreation).not.toHaveBeenCalled();
  });

  it("clears the request when the dialog closes itself (Escape / overlay)", async () => {
    wrapper = mountProvider();
    requestAlertCreation(prefill());
    await wrapper.vm.$nextTick();

    await wrapper.findComponent(DialogStub).vm.$emit("update:open", false);

    expect(alertCreationDialog.value).toBeNull();
    expect(mockOpenAlertCreation).not.toHaveBeenCalled();
  });

  it("normalizes on request, so the dialog can state a blocking reason", async () => {
    wrapper = mountProvider();
    requestAlertCreation({ ...prefill(), streamName: "" });
    await wrapper.vm.$nextTick();

    expect(alertCreationDialog.value?.prefill.warnings.map((w) => w.key)).toContain("noStream");
  });

  it("replaces an outstanding request rather than stacking dialogs", async () => {
    wrapper = mountProvider();
    requestAlertCreation(prefill());
    requestAlertCreation({ ...prefill(), streamName: "second" });
    await wrapper.vm.$nextTick();

    expect(wrapper.findAllComponents(DialogStub)).toHaveLength(1);
    expect(alertCreationDialog.value?.prefill.streamName).toBe("second");
  });
});
