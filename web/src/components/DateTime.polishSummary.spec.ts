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

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DateTime from "@/components/DateTime.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock("@/utils/timeInputFailure", () => ({ reportParseFailure: vi.fn() }));
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: toastSpy,
}));

const NOW = new Date("2026-11-16T10:00:00Z");
const IST = "Asia/Calcutta";
const tr = (key: string, params: Record<string, unknown> = {}) =>
  String((i18n.global.t as unknown as (k: string, p: object) => string)(key, params));

describe("DateTime summary row and overlays (V2)", () => {
  let wrapper: VueWrapper<InstanceType<typeof DateTime>> | null = null;

  const createWrapper = (props: Record<string, unknown> = {}) => {
    wrapper = mount(DateTime, {
      props,
      attachTo: document.body,
      global: { plugins: [i18n, store] },
    });
    return wrapper;
  };
  const openMenu = async () => {
    wrapper!.vm.onMenuOpenChange(true);
    wrapper!.vm.menuOpen = true;
    await flushPromises();
  };
  const el = (dataTest: string) => document.querySelector<HTMLElement>(`[data-test="${dataTest}"]`);
  const text = (dataTest: string) => (el(dataTest)?.textContent ?? "").replace(/\s+/g, " ").trim();
  const typeInBar = async (value: string) => {
    const field = el("date-time-input-field") as HTMLInputElement;
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await flushPromises();
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    store.state.timezone = IST;
    store.state.savedViewFlag = false;
    localStorage.clear();
    toastSpy.mockClear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("hides the footer steppers while a draft is shown", async () => {
    createWrapper();
    await openMenu();
    expect(el("date-time-prev-btn-footer")).not.toBeNull();
    await typeInBar("2h");
    expect(el("date-time-draft-tag")).not.toBeNull();
    expect(el("date-time-prev-btn-footer")).toBeNull();
    expect(el("date-time-next-btn-footer")).toBeNull();
    expect(el("date-time-zoom-out-btn-footer")).toBeNull();
  });

  it("moves a UTC reading note to the list head line and keeps the summary to the range", async () => {
    createWrapper();
    await openMenu();
    await typeInBar("2026-11-15T14:32:10.250Z");
    expect(text("date-time-list-head-note")).toBe(tr("dateTime.typedInZoneHead", { zone: "UTC" }));
    expect(el("date-time-preview-note")).toBeNull();
    expect(el("date-time-as-utc-toggle")).toBeNull();
  });

  it("names an anchor draft by its window and shows its dates to the second", async () => {
    createWrapper();
    await openMenu();
    await typeInBar("2026-11-15T14:32:10.250Z");
    expect(text("date-time-resolved-name")).toBe("± 5 min");
    expect(text("date-time-resolved-range")).toBe("Nov 15, 19:57:10 – 20:07:10");
  });

  it("confirms a copy by swapping its icon, with no toast", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    createWrapper();
    await openMenu();
    el("date-time-copy-btn")!.click();
    await flushPromises();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(el("date-time-copy-btn-done")).not.toBeNull();
    expect(text("date-time-live-region")).toBe(tr("common.dateRangeCopied"));
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("opens the trigger tooltip below, aligned to the trigger start, on explorers", () => {
    createWrapper();
    expect(wrapper!.vm.triggerTooltipAlign).toBe("start");
  });
});
