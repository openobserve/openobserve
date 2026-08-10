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

//! The SLO delete confirmation (Feature 5, work item B2).
//!
//! Deleting an SLO CASCADES to every alert attached to it. The dialog warned
//! about storage and said nothing about that, so the one irreversible
//! consequence a human would want to know about — "this also deletes the three
//! alerts that page you" — was invisible.
//!
//! The count is fetched LAZILY, on dialog open. Fetching it per row while
//! building the list would put an N+1 on a page that renders fine without it.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

vi.mock("@/services/slos", () => ({
  default: {
    list: vi.fn(),
    delete: vi.fn(),
    move: vi.fn(),
    setEnabled: vi.fn(),
  },
}));

vi.mock("@/services/alerts", () => ({
  default: { list_by_slo: vi.fn() },
}));

import SloList from "@/views/slos/SloList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import sloService from "@/services/slos";
import alertsService from "@/services/alerts";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

const sloRow = (overrides: Record<string, any> = {}) => ({
  id: "slo-123",
  name: "checkout-availability",
  enabled: true,
  target: 99.9,
  window_secs: 30 * 86400,
  slice_interval_secs: 300,
  tags: [],
  folder_id: "default",
  status: {
    sli: 99.95,
    error_budget_remaining: 0.6,
    burn_rate: 0.4,
    coverage: 1,
    no_data: false,
  },
  ...overrides,
});

// ODialog portals its body to document.body, which puts it outside the mounted
// wrapper's tree and therefore outside `wrapper.find`. The stub keeps the
// content in place — and honours `open`, so "the dialog is closed" stays a
// distinguishable state rather than every assertion passing vacuously.
const ODialogStub = {
  name: "ODialog",
  props: { open: { type: Boolean, default: false }, title: { type: String, default: "" } },
  template:
    '<div v-if="open" class="o-dialog-stub" :data-test-id="$attrs[\'data-test\']">' +
    '<slot /><slot name="footer" /></div>',
};

async function mountList(rows: any[]) {
  vi.mocked(sloService.list).mockResolvedValue({ data: { list: rows } } as any);

  const wrapper = mount(SloList, {
    attachTo: node,
    global: {
      plugins: [i18n, store, router],
      stubs: {
        FolderList: { template: '<div data-test="stub-folder-list"></div>' },
        SelectFolderDropDown: true,
        ODialog: ODialogStub,
      },
    },
  });
  await flushPromises();
  await new Promise((r) => setTimeout(r, 75));
  await flushPromises();
  return wrapper;
}

const openDeleteFor = async (wrapper: any, name: string) => {
  await wrapper.find(`[data-test="slos-slolist-delete-${name}"]`).trigger("click");
  await flushPromises();
};

/** Everything is looked up INSIDE the dialog: a cascade warning rendered
 *  elsewhere on the page is not a warning the person confirming will read.
 *
 *  NOTE for the implementer — this file requires ONE new hook in SloList.vue:
 *  `data-test="slos-slolist-delete-confirm"` on the delete dialog's destructive
 *  button (its sibling move dialog already has `slos-slolist-move-confirm`). */
const dialog = (wrapper: any) => wrapper.find('[data-test-id="slos-slolist-delete-dialog"]');

/** `find` on an empty DOMWrapper THROWS rather than returning empty, so a
 *  closed dialog would surface as an opaque error instead of a failed
 *  assertion. Every banner lookup goes through this. */
const openDialog = (wrapper: any) => {
  expect(dialog(wrapper).exists(), "delete dialog is not open").toBe(true);
  return dialog(wrapper);
};
const countBanner = (wrapper: any) =>
  openDialog(wrapper).find('[data-test="slos-slolist-delete-alert-count"]');
const unknownBanner = (wrapper: any) =>
  openDialog(wrapper).find('[data-test="slos-slolist-delete-alert-count-unknown"]');
const pendingNote = (wrapper: any) =>
  openDialog(wrapper).find('[data-test="slos-slolist-delete-alert-count-loading"]');

const ORG = "default";

describe("SloList — delete dialog dependent-alert count", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    // mockReset, not just clearAllMocks: the latter clears call history but
    // leaves any queued `mockResolvedValueOnce` in place, so an unconsumed
    // one-shot would leak into the next test as an unrelated-looking failure.
    vi.mocked(alertsService.list_by_slo).mockReset();
    vi.mocked(alertsService.list_by_slo).mockResolvedValue({ data: { list: [] } } as any);
    vi.mocked(sloService.delete).mockResolvedValue({ data: { code: 200 } } as any);
  });

  afterEach(() => wrapper?.unmount());

  it("does not look up alerts while merely listing SLOs", async () => {
    wrapper = await mountList([sloRow(), sloRow({ id: "slo-456", name: "search-latency" })]);
    expect(alertsService.list_by_slo).not.toHaveBeenCalled();
  });

  it("looks the alerts up when the dialog opens, exactly once", async () => {
    wrapper = await mountList([sloRow()]);
    await openDeleteFor(wrapper, "checkout-availability");

    expect(alertsService.list_by_slo).toHaveBeenCalledTimes(1);
    expect(alertsService.list_by_slo).toHaveBeenCalledWith(ORG, "slo-123");
  });

  // The wording matters as much as the number: "3" on its own does not tell
  // anyone that confirming destroys three alerts. Asserted against LITERAL
  // English rather than t(...) — comparing a render of t(k) to t(k) passes even
  // when the message is an unrendered plural template like "a | b".
  it("warns that the delete cascades, with the count", async () => {
    vi.mocked(alertsService.list_by_slo).mockResolvedValue({
      data: { list: [{ alert_id: "a" }, { alert_id: "b" }, { alert_id: "c" }] },
    } as any);
    wrapper = await mountList([sloRow()]);
    await openDeleteFor(wrapper, "checkout-availability");

    expect(countBanner(wrapper).exists()).toBe(true);
    expect(countBanner(wrapper).text()).toBe(
      "Deleting this SLO also deletes the 3 alerts attached to it.",
    );
  });

  it("says it in the singular for a single alert", async () => {
    vi.mocked(alertsService.list_by_slo).mockResolvedValue({
      data: { list: [{ alert_id: "a" }] },
    } as any);
    wrapper = await mountList([sloRow()]);
    await openDeleteFor(wrapper, "checkout-availability");

    expect(countBanner(wrapper).text()).toBe(
      "Deleting this SLO also deletes the alert attached to it.",
    );
  });

  it("says nothing about alerts when the SLO has none", async () => {
    wrapper = await mountList([sloRow()]);
    await openDeleteFor(wrapper, "checkout-availability");

    // Anchors: the dialog really is open and the lookup really did run and
    // resolve, so "silent" means "zero attached" and not "never built".
    expect(dialog(wrapper).exists()).toBe(true);
    expect(alertsService.list_by_slo).toHaveBeenCalledWith(ORG, "slo-123");

    expect(countBanner(wrapper).exists()).toBe(false);
    expect(unknownBanner(wrapper).exists()).toBe(false);
    expect(pendingNote(wrapper).exists()).toBe(false);
  });

  // Silence would read as "no alerts attached", which is the one wrong answer:
  // the cascade still happens.
  it("says the count is unknown rather than implying zero when the fetch fails", async () => {
    vi.mocked(alertsService.list_by_slo).mockRejectedValue(new Error("boom"));
    wrapper = await mountList([sloRow()]);
    await openDeleteFor(wrapper, "checkout-availability");

    expect(unknownBanner(wrapper).exists()).toBe(true);
    expect(unknownBanner(wrapper).text()).toBe(
      "Could not check which alerts are attached. Deleting this SLO deletes all of them.",
    );
    expect(countBanner(wrapper).exists()).toBe(false);
  });

  // "Pending" and "zero" must not look identical: a fast confirm on a slow
  // network would otherwise get no cascade warning at all, silently.
  it("distinguishes a still-loading count from zero", async () => {
    vi.mocked(alertsService.list_by_slo).mockImplementation(() => new Promise(() => {}) as any);
    wrapper = await mountList([sloRow()]);
    await openDeleteFor(wrapper, "checkout-availability");

    expect(pendingNote(wrapper).exists()).toBe(true);
    expect(countBanner(wrapper).exists()).toBe(false);
    expect(unknownBanner(wrapper).exists()).toBe(false);
  });

  // A stale count from the previously inspected SLO would understate — or
  // overstate — what this delete destroys. The dialog is genuinely closed in
  // between, so an implementation that refetches on open is not forbidden.
  it("does not carry a count over to the next SLO's dialog", async () => {
    vi.mocked(alertsService.list_by_slo).mockResolvedValueOnce({
      data: { list: [{ alert_id: "a" }, { alert_id: "b" }] },
    } as any);
    wrapper = await mountList([sloRow(), sloRow({ id: "slo-456", name: "search-latency" })]);

    await openDeleteFor(wrapper, "checkout-availability");
    expect(countBanner(wrapper).text()).toContain("2");

    (wrapper.vm as any).deleteDialog = false;
    await flushPromises();

    // Second SLO has no alerts.
    vi.mocked(alertsService.list_by_slo).mockResolvedValue({ data: { list: [] } } as any);
    await openDeleteFor(wrapper, "search-latency");

    expect(alertsService.list_by_slo).toHaveBeenLastCalledWith(ORG, "slo-456");
    expect(countBanner(wrapper).exists()).toBe(false);
  });

  // The failure this guards is a swap, not a delay: SLO A's slower response
  // landing after the user moved on to SLO B would label B's delete with A's
  // count — and the number is the whole point of the banner.
  it("ignores a slow response for an SLO the user has moved on from", async () => {
    let resolveFirst: (v: any) => void = () => {};
    vi.mocked(alertsService.list_by_slo)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)) as any)
      .mockResolvedValue({ data: { list: [] } } as any);

    wrapper = await mountList([sloRow(), sloRow({ id: "slo-456", name: "search-latency" })]);

    await openDeleteFor(wrapper, "checkout-availability");
    (wrapper.vm as any).deleteDialog = false;
    await flushPromises();
    await openDeleteFor(wrapper, "search-latency");

    // Now the first SLO's answer finally arrives — for the wrong dialog.
    resolveFirst({ data: { list: [{ alert_id: "a" }, { alert_id: "b" }, { alert_id: "c" }] } });
    await flushPromises();

    expect(countBanner(wrapper).exists()).toBe(false);
  });

  it("still deletes the SLO", async () => {
    wrapper = await mountList([sloRow()]);
    await openDeleteFor(wrapper, "checkout-availability");

    await wrapper.find('[data-test="slos-slolist-delete-confirm"]').trigger("click");
    await flushPromises();

    expect(sloService.delete).toHaveBeenCalledWith(ORG, "slo-123");
  });

  // The storage caveat is a different, still-true fact; the cascade note is an
  // addition, not a replacement. Scoped to the dialog so an orphaned note
  // elsewhere on the page does not satisfy it.
  it("keeps the storage note", async () => {
    wrapper = await mountList([sloRow()]);
    await openDeleteFor(wrapper, "checkout-availability");

    expect(dialog(wrapper).text()).toContain(i18n.global.t("slos.deleteBudgetNote"));
  });
});
