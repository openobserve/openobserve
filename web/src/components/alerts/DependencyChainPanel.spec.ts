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

import DependencyChainPanel from "./DependencyChainPanel.vue";
import alertsService from "@/services/alerts";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

const TEMPLATES = [{ name: "tpl-http", type: "http" }];
const DESTINATIONS = [{ name: "slack", type: "http", template: "tpl-http" }];

function mountPanel(
  focus: Record<string, unknown>,
  props: Record<string, unknown> = {},
): VueWrapper {
  return mount(DependencyChainPanel, {
    props: { focus, ...props },
    global: {
      plugins: [i18n, store, router],
      stubs: {
        OButton: { template: `<button v-bind="$attrs"><slot /></button>` },
        OIcon: { template: "<i />" },
        OTag: { template: "<span><slot /></span>" },
        OTooltip: { template: "<span />" },
        OSpinner: { template: "<div class='spinner' />" },
        OBanner: { template: "<div class='banner' />" },
        ConfirmDialog: {
          name: "ConfirmDialog",
          props: ["modelValue", "title", "message"],
          emits: ["update:ok", "update:cancel"],
          template: "<div class='confirm-dialog' />",
        },
      },
    },
  });
}

const rowTests = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-test^="dependency-row-"]').map((n) => n.attributes("data-test"));

describe("DependencyChainPanel", () => {
  let wrapper: VueWrapper;

  const seedAlerts = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      alert_id: `a${i}`,
      name: `alert-${i}`,
      destinations: ["slack"],
      enabled: true,
      folder_id: "default",
    }));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(destinationService.list).mockResolvedValue({ data: DESTINATIONS } as any);
    vi.mocked(templateService.list).mockResolvedValue({ data: TEMPLATES } as any);
    vi.mocked(destinationService.delete).mockResolvedValue({} as any);
  });
  afterEach(() => wrapper?.unmount());

  it("renders the destination's template + alerts (a small chain)", async () => {
    vi.mocked(alertsService.listByFolderId).mockResolvedValue({
      data: { list: seedAlerts(3) },
    } as any);
    wrapper = mountPanel({ kind: "destination", name: "slack" });
    await flushPromises();
    const tests = rowTests(wrapper);
    expect(tests).toContain("dependency-row-template-tpl-http");
    expect(tests).toContain("dependency-row-destination-slack");
    expect(tests).toContain("dependency-row-alert-alert-0");
    // No pager for a 3-alert chain.
    expect(wrapper.find('[data-test="dependency-chain-next"]').exists()).toBe(false);
  });

  it("pages the alerts 10 at a time with working prev/next", async () => {
    vi.mocked(alertsService.listByFolderId).mockResolvedValue({
      data: { list: seedAlerts(25) },
    } as any);
    wrapper = mountPanel({ kind: "destination", name: "slack" });
    await flushPromises();

    const alertRows = () =>
      wrapper.findAll('[data-test^="dependency-row-alert-"]').map((n) => n.attributes("data-test"));

    expect(alertRows()).toHaveLength(10);
    expect(alertRows()).toContain("dependency-row-alert-alert-0");
    expect(alertRows()).not.toContain("dependency-row-alert-alert-10");

    await wrapper.find('[data-test="dependency-chain-next"]').trigger("click");
    await nextTick();
    expect(alertRows()).toHaveLength(10);
    expect(alertRows()).toContain("dependency-row-alert-alert-10");
    expect(alertRows()).not.toContain("dependency-row-alert-alert-0");
  });

  it("deleting a node calls the API and emits 'deleted'", async () => {
    vi.mocked(alertsService.listByFolderId).mockResolvedValue({
      data: { list: seedAlerts(1) },
    } as any);
    wrapper = mountPanel({ kind: "destination", name: "slack" });
    await flushPromises();
    // Delete → inline confirm → confirm-yes actually deletes.
    await wrapper.find('[data-test="dependency-row-delete-slack"]').trigger("click");
    await nextTick();
    await wrapper.find('[data-test="dependency-row-confirm-yes-slack"]').trigger("click");
    await flushPromises();
    expect(destinationService.delete).toHaveBeenCalledWith(
      expect.objectContaining({ destination_name: "slack" }),
    );
    expect(wrapper.emitted("deleted")).toBeTruthy();
  });

  it("shows an empty state when the entity has no dependencies", async () => {
    vi.mocked(alertsService.listByFolderId).mockResolvedValue({ data: { list: [] } } as any);
    vi.mocked(destinationService.list).mockResolvedValue({ data: [] } as any);
    vi.mocked(templateService.list).mockResolvedValue({ data: [] } as any);
    wrapper = mountPanel({ kind: "destination", name: "ghost" });
    await flushPromises();
    expect(wrapper.find('[data-test="dependency-chain-empty"]').exists()).toBe(true);
  });
});
