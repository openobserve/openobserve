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

import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { computed, ref } from "vue";
import PanelDraftsTray from "./PanelDraftsTray.vue";
import { PANEL_DRAFTS_KEY } from "@/composables/dashboard/usePanelDraft";

const entry = (id: string, status: string, tabId: string, title: string, isNew = false) => ({
  record: {
    key: id,
    panelId: isNew ? null : id,
    draftId: isNew ? id : null,
    isNew,
    data: { title },
    updatedAt: Date.now() - 60_000,
  },
  status,
  tabId,
});

const tabs = [
  { tabId: "t1", name: "Overview" },
  { tabId: "t2", name: "Errors" },
];

const mountTray = (items: any[]) => {
  const entries = ref(items);
  const ctx = {
    entries,
    byPanelId: computed(() => new Map()),
    open: vi.fn(),
    remove: vi.fn(async (e: any) => {
      entries.value = entries.value.filter((x) => x !== e);
    }),
  };
  const wrapper = mount(PanelDraftsTray, {
    attachTo: document.body,
    props: { tabs },
    global: { provide: { [PANEL_DRAFTS_KEY as symbol]: ctx } },
  });
  return { wrapper, ctx };
};

describe("PanelDraftsTray", () => {
  let wrapper: any;

  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = "";
  });

  it("renders no chip when there are no drafts", () => {
    ({ wrapper } = mountTray([]));
    expect(wrapper.find('[data-test="dashboard-drafts-chip"]').exists()).toBe(false);
  });

  it("lists drafts across tabs in the drawer and continues or deletes them", async () => {
    const edited = entry("p1", "edited", "t1", "Request rate");
    const fresh = entry("d1", "new", "t2", "", true);
    let ctx: any;
    ({ wrapper, ctx } = mountTray([edited, fresh]));

    const chip = wrapper.find('[data-test="dashboard-drafts-chip"]');
    expect(chip.text()).toContain("2 unsaved drafts");
    await chip.trigger("click");
    await flushPromises();

    const drawer = document.querySelector('[data-test="dashboard-drafts-drawer"]')!;
    expect(drawer.textContent).toContain("Unsaved drafts on this dashboard");
    const items = drawer.querySelectorAll('[data-test^="dashboard-drafts-item-"][data-test$="1"]');
    expect(items).toHaveLength(2);
    expect(drawer.textContent).toContain("Request rate");
    expect(drawer.textContent).toContain("Untitled panel");
    expect(drawer.textContent).toContain("Errors");
    expect(drawer.textContent).toContain("New panel");

    (
      drawer.querySelector(
        '[data-test="dashboard-drafts-item-d1"] [data-test="dashboard-drafts-item-delete"]',
      ) as HTMLButtonElement
    ).click();
    await flushPromises();
    expect(ctx.remove).not.toHaveBeenCalled();
    const confirm = document.querySelector('[data-test="dashboard-drafts-delete-confirm"]')!;
    expect(confirm.textContent).toContain("Delete draft?");
    expect(confirm.textContent).toContain('"Untitled panel" will be lost');
    (confirm.querySelector('[data-test="o-dialog-primary-btn"]') as HTMLButtonElement).click();
    await flushPromises();
    expect(ctx.remove).toHaveBeenCalledWith(fresh);
    expect(wrapper.find('[data-test="dashboard-drafts-chip"]').text()).toContain("1 unsaved draft");

    (
      document.querySelector(
        '[data-test="dashboard-drafts-item-p1"] [data-test="dashboard-drafts-item-continue"]',
      ) as HTMLButtonElement
    ).click();
    expect(ctx.open).toHaveBeenCalledWith(edited);
  });

  it("renders nothing outside a dashboard that provides drafts", () => {
    wrapper = mount(PanelDraftsTray, { props: { tabs } });
    expect(wrapper.html()).not.toContain("dashboard-drafts-chip");
  });
});
