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

vi.mock("@/services/alerts", () => ({
  default: { listByFolderId: vi.fn(), delete_by_alert_id: vi.fn() },
}));
vi.mock("@/services/alert_destination", () => ({
  default: { list: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/services/alert_templates", () => ({
  default: { list: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn(() => vi.fn()) }));

import DependencyUsagePanel from "./DependencyUsagePanel.vue";
import { invalidateDependencyGraphCache } from "@/composables/alerts/useDependencyGraph";
import alertsService from "@/services/alerts";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

const TEMPLATES = [{ name: "tpl-http", type: "http" }];
const DESTINATIONS = [{ name: "slack", type: "http", template: "tpl-http" }];
const seedAlerts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    alert_id: `a${i}`,
    name: `alert-${String(i).padStart(3, "0")}`,
    destinations: ["slack"],
    enabled: true,
    folder_id: "default",
  }));

function mountPanel(focus: Record<string, unknown>): VueWrapper {
  return mount(DependencyUsagePanel, {
    props: { focus },
    global: {
      plugins: [i18n, store, router],
      stubs: {
        // Real DependencyUsageRow renders (with its O2 children stubbed) so the
        // clickable rows and their open/delete emits are exercised.
        OButton: { template: `<button v-bind="$attrs"><slot /></button>` },
        OIcon: { template: "<i />" },
        OTag: { template: "<span><slot /></span>" },
        OTooltip: { template: "<span />" },
        OSpinner: { template: "<div class='spinner' />" },
        OBanner: { template: "<div class='banner' />" },
        OSearchInput: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template: `<input :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
        },
      },
    },
  });
}

const rows = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-test^="dependency-usage-row-"]').map((n) => n.attributes("data-test"));

describe("DependencyUsagePanel", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    // The graph is cached per-org at module scope; clear it so each test's mocked
    // list responses are actually fetched instead of a prior test's graph.
    invalidateDependencyGraphCache();
    vi.mocked(destinationService.list).mockResolvedValue({ data: DESTINATIONS } as any);
    vi.mocked(templateService.list).mockResolvedValue({ data: TEMPLATES } as any);
    vi.mocked(destinationService.delete).mockResolvedValue({} as any);
  });
  afterEach(() => wrapper?.unmount());

  it("shows every related kind as a section: template AND alerts for a destination", async () => {
    vi.mocked(alertsService.listByFolderId).mockResolvedValue({
      data: { list: seedAlerts(3) },
    } as any);
    wrapper = mountPanel({ kind: "destination", name: "slack" });
    await flushPromises();
    expect(wrapper.find('[data-test="dependency-usage-templates"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="dependency-usage-alerts"]').exists()).toBe(true);
    // The template is a clickable row (not a static chip) with its own actions.
    expect(rows(wrapper)).toContain("dependency-usage-row-tpl-http");
    expect(rows(wrapper)).toContain("dependency-usage-row-alert-000");
    expect(wrapper.find('[data-test="dependency-usage-open-tpl-http"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="dependency-usage-delete-tpl-http"]').exists()).toBe(true);
    // Small list -> no pager.
    expect(wrapper.find('[data-test="dependency-usage-pager"]').exists()).toBe(false);
  });

  it("collapses a section from its header", async () => {
    vi.mocked(alertsService.listByFolderId).mockResolvedValue({
      data: { list: seedAlerts(3) },
    } as any);
    wrapper = mountPanel({ kind: "destination", name: "slack" });
    await flushPromises();
    const alertRows = () => wrapper.findAll('[data-test^="dependency-usage-row-alert-"]');
    expect(alertRows().length).toBe(3);
    await wrapper.find('[data-test="dependency-usage-alerts-toggle"]').trigger("click");
    await nextTick();
    expect(alertRows().length).toBe(0);
  });

  it("requests a delete (for the wrapper's ConfirmDialog) incl. a template", async () => {
    vi.mocked(alertsService.listByFolderId).mockResolvedValue({
      data: { list: seedAlerts(1) },
    } as any);
    wrapper = mountPanel({ kind: "destination", name: "slack" });
    await flushPromises();
    // Clicking a template row's delete emits requestDelete — the modal confirm is
    // the wrapper's job (a dialog can't live inside the popover).
    await wrapper.find('[data-test="dependency-usage-delete-tpl-http"]').trigger("click");
    expect(wrapper.emitted("requestDelete")?.[0]?.[0] as any).toMatchObject({
      kind: "template",
      name: "tpl-http",
    });
  });

  it("pages a large alert list (50/page) and searches it", async () => {
    vi.mocked(alertsService.listByFolderId).mockResolvedValue({
      data: { list: seedAlerts(120) },
    } as any);
    wrapper = mountPanel({ kind: "destination", name: "slack" });
    await flushPromises();
    const alertRows = () =>
      wrapper
        .findAll('[data-test^="dependency-usage-row-alert-"]')
        .map((n) => n.attributes("data-test"));

    // First page renders 50 alerts, pager is present.
    expect(alertRows()).toHaveLength(50);
    expect(wrapper.find('[data-test="dependency-usage-pager"]').exists()).toBe(true);

    // Search narrows to a single alert (no pager) and resets paging.
    await wrapper.find('[data-test="dependency-usage-search"]').setValue("alert-117");
    await nextTick();
    expect(alertRows()).toEqual(["dependency-usage-row-alert-117"]);
    expect(wrapper.find('[data-test="dependency-usage-pager"]').exists()).toBe(false);
  });
});
