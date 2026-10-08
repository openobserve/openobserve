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

import { describe, expect, it, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import DetailTable from "@/plugins/logs/DetailTable.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { lineLinkBusy, lineLinkPopover } from "@/composables/useLogs/useLogLineLink";

const link = vi.hoisted(() => ({
  state: { kind: "enabled" } as any,
  copy: vi.fn(),
}));

vi.mock("@/composables/useLogs/useLogLineLink", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/useLogs/useLogLineLink")>()),
  useLogLineLink: () => ({
    lineLinkState: () => link.state,
    copyLineLink: (...args: unknown[]) => link.copy(...args),
  }),
}));
vi.mock("@/composables/useStreams", () => ({ default: () => ({ getStreams: vi.fn() }) }));

const row = { _timestamp: 1_700_000_000_000_000, message: "payment declined" };

const mountTable = (extra: Record<string, unknown> = {}) =>
  mount(DetailTable, {
    attachTo: document.body,
    props: { modelValue: row, currentIndex: 0, totalLength: 1, streamType: "logs", ...extra },
    global: { provide: { store }, plugins: [i18n, router] },
  });

const button = () =>
  document.querySelector<HTMLButtonElement>('[data-test="log-detail-copy-line-link-btn"]');

describe("DetailTable Copy link (4c C6)", () => {
  let wrapper: any;

  afterEach(() => {
    wrapper?.unmount();
    link.state = { kind: "enabled" };
    link.copy.mockReset();
    lineLinkBusy.value = false;
    lineLinkPopover.value = null;
    document.body.innerHTML = "";
  });

  it("sits in the header action row, after the severity tag and before Wrap, and copies this row (AC-C1.2)", async () => {
    wrapper = mountTable();
    await flushPromises();
    const follows = (a: Element, b: Element) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const badge = document.querySelector('[data-test="log-detail-severity-badge"]')!;
    const wrap = document.querySelector('[data-test="log-detail-wrap-values-toggle-btn"]')!;
    expect(follows(badge, button()!)).toBe(true);
    expect(follows(button()!, wrap)).toBe(true);
    expect(button()?.textContent).toContain("Copy link");
    button()!.click();
    expect(link.copy).toHaveBeenCalledWith(row, "drawer");
  });

  it("is disabled with the reason when G1 or eligibility fails (J-C7)", async () => {
    link.state = { kind: "disabled", reason: "Turn off the function to link a single line" };
    wrapper = mountTable();
    await flushPromises();
    expect(button()?.getAttribute("aria-disabled")).toBe("true");
    expect(button()?.hasAttribute("disabled")).toBe(true);
    expect(wrapper.vm.lineLinkTooltip).toBe("Turn off the function to link a single line");
  });

  it("is not shown when embedded, nor where the action is hidden (Visualize, Patterns)", async () => {
    wrapper = mountTable({ embedded: true });
    await flushPromises();
    expect(button()).toBeNull();
    wrapper.unmount();
    link.state = { kind: "hidden" };
    wrapper = mountTable();
    await flushPromises();
    expect(button()).toBeNull();
  });

  it("shows busy while the link is built, and the fallback popover with a readable URL (AC-C1.3, L-05)", async () => {
    wrapper = mountTable();
    lineLinkBusy.value = true;
    await flushPromises();
    expect(button()?.getAttribute("aria-busy")).toBe("true");
    lineLinkBusy.value = false;
    lineLinkPopover.value = { url: "https://o2.example/web/short/abc", source: "drawer" };
    await flushPromises();
    await vi.waitFor(() =>
      expect(document.querySelector('[data-test="log-line-link-popover"]')).not.toBeNull(),
    );
    const input = document.querySelector<HTMLInputElement>(
      '[data-test="log-line-link-popover-url-field"]',
    );
    expect(input?.value).toBe("https://o2.example/web/short/abc");
    expect(input?.readOnly).toBe(true);
  });
});
