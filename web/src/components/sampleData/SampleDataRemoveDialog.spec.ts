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

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SetupContext } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import enLocale from "@/locales/languages/en-US.json";
import SampleDataRemoveDialog from "./SampleDataRemoveDialog.vue";
import {
  SampleLoadRunningError,
  useSampleDataSession,
} from "@/composables/sampleData/useSampleDataSession";
import { removeSampleData } from "@/utils/sampleData/loader";

// Render the dialog inline instead of portalling it into <body>.
vi.mock("reka-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("reka-ui")>()),
  DialogPortal: {
    setup:
      (_: unknown, { slots }: SetupContext) =>
      () =>
        slots.default?.(),
  },
}));

const toastMock = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

vi.mock("@/utils/sampleData/loader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/sampleData/loader")>()),
  removeSampleData: vi.fn(),
}));

const i18n = createI18n({ legacy: false, locale: "en", messages: { en: enLocale } });
const session = useSampleDataSession();

describe("SampleDataRemoveDialog", () => {
  let wrapper: VueWrapper;
  const byTest = (id: string) => wrapper.find(`[data-test="${id}"]`);
  const flush = async () => {
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
  };
  const setStatus = (statuses: string[]) =>
    session.removeSteps.value.forEach((s, i) => (s.status = statuses[i] as never));

  beforeEach(() => {
    toastMock.mockClear();
    vi.mocked(removeSampleData).mockReset().mockResolvedValue([]);
    session.removeDialogOpen.value = false;
    session.removePhase.value = "idle";
    session.removeKept.value = [];
    session.removeError.value = null;
    setStatus(Array(6).fill("pending"));
    wrapper?.unmount();
    wrapper = mount(SampleDataRemoveDialog, { global: { plugins: [i18n] } });
  });

  const show = async (phase: "removing" | "done" | "failed") => {
    session.removePhase.value = phase;
    session.removeDialogOpen.value = true;
    await flush();
  };

  it("shows the removing view with a background button", async () => {
    setStatus(["done", "running", "pending", "pending", "pending", "pending"]);
    await show("removing");
    expect(byTest("sample-remove-title").text()).toBe("Removing sample data");
    expect(byTest("sample-remove-label").text()).toBe("Removing sample data…");
    expect(byTest("sample-remove-percent").text()).toBe("17%");
    expect(byTest("sample-remove-step-alerts").attributes("data-status")).toBe("done");
    expect(byTest("sample-remove-step-alertDelivery").attributes("data-status")).toBe("running");
    expect(byTest("sample-remove-step-alertDelivery").text()).toBe("Alert template and webhook");
    expect(byTest("sample-remove-announcer").text()).toBe("Removing sample data");
    expect(byTest("sample-remove-done").exists()).toBe(false);
    await byTest("sample-remove-background").trigger("click");
    await flush();
    expect(session.removeDialogOpen.value).toBe(false);
    expect(session.removePhase.value).toBe("removing");
  });

  it("shows the done view, and Done closes and resets", async () => {
    setStatus(Array(6).fill("done"));
    await show("done");
    expect(byTest("sample-remove-title").text()).toBe("Sample data removed");
    expect(byTest("sample-remove-label").text()).toBe("Removal complete");
    expect(byTest("sample-remove-percent").text()).toBe("100%");
    expect(byTest("sample-remove-kept").exists()).toBe(false);
    await byTest("sample-remove-done").trigger("click");
    await flush();
    expect(session.removeDialogOpen.value).toBe(false);
    expect(session.removePhase.value).toBe("idle");
  });

  it("lists the kept names only when there are some", async () => {
    session.removeKept.value = ["fn_a", "tpl_b"];
    await show("done");
    expect(byTest("sample-remove-kept").text()).toBe(
      "Kept, because something else uses them: fn_a, tpl_b",
    );
  });

  it("shows the failed view with the server message", async () => {
    setStatus(["done", "failed", "pending", "pending", "pending", "pending"]);
    session.removeError.value = { response: { data: { message: "stream locked" } } };
    await show("failed");
    expect(byTest("sample-remove-title").text()).toBe("Could not remove all sample data");
    expect(byTest("sample-remove-label").text()).toBe("Removal stopped");
    expect(byTest("sample-remove-step-alertDelivery").attributes("data-status")).toBe("failed");
    expect(byTest("sample-remove-error").text()).toBe("stream locked");
    expect(byTest("sample-remove-close").exists()).toBe(true);
  });

  it("asks to wait when the load still runs, and falls back to a generic message", async () => {
    session.removeError.value = new SampleLoadRunningError();
    await show("failed");
    expect(byTest("sample-remove-error").text()).toBe("Wait for sample data to finish loading.");
    session.removeError.value = new Error("x");
    await flush();
    expect(byTest("sample-remove-error").text()).toBe("Could not remove all sample data");
  });

  it("Close resets and Try Again removes again for the stored org", async () => {
    session.removeOrg.value = "org-a";
    await show("failed");
    await byTest("sample-remove-retry").trigger("click");
    await flush();
    expect(removeSampleData).toHaveBeenCalledWith("org-a", expect.any(Function));
    expect(session.removePhase.value).toBe("done");

    await show("failed");
    await byTest("sample-remove-close").trigger("click");
    await flush();
    expect(session.removePhase.value).toBe("idle");
  });

  it("toasts when the removal ends with the dialog closed, then resets", async () => {
    session.removeDialogOpen.value = false;
    session.removePhase.value = "removing";
    await flush();
    session.removeKept.value = ["a", "b"];
    session.removePhase.value = "done";
    await flush();
    expect(toastMock).toHaveBeenCalledWith({
      variant: "success",
      message: "Sample data removed. 2 sample items stay because something else uses them.",
    });
    expect(session.removePhase.value).toBe("idle");
  });

  it("toasts the error when a closed removal fails", async () => {
    session.removePhase.value = "removing";
    await flush();
    session.removeError.value = new SampleLoadRunningError();
    session.removePhase.value = "failed";
    await flush();
    expect(toastMock).toHaveBeenCalledWith({
      variant: "error",
      message: "Wait for sample data to finish loading.",
    });
    expect(session.removePhase.value).toBe("idle");
  });

  it("does not toast when the dialog is open at the end", async () => {
    await show("removing");
    session.removePhase.value = "done";
    await flush();
    expect(toastMock).not.toHaveBeenCalled();
    expect(session.removePhase.value).toBe("done");
  });
});
