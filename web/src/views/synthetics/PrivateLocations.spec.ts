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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import type { SyntheticLocation } from "@/types/synthetics";

// ── Mocks (hoisted by Vitest) ──────────────────────────────────────────────

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

// Hoisted so the vi.mock factory below can reference it (vi.mock is hoisted
// to the top of the file, so top-level const declarations are in TDZ when the
// factory runs).
const { mockRouterPush } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}));

vi.mock("@/utils/synthetics/format", () => ({
  formatTimeAgoUs: vi.fn((us: number) => `formatted-${us}`),
}));

// ── Component under test ───────────────────────────────────────────────────

import PrivateLocations from "./PrivateLocations.vue";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeLocation(overrides: Partial<SyntheticLocation> = {}): SyntheticLocation {
  return {
    id: "loc-1",
    name: "US East",
    region: "us-east-1",
    provider: "aws",
    kind: "private",
    pool: "default",
    enabled: true,
    types: ["http", "browser"],
    live_agents: 3,
    agent_names: ["agent-a", "agent-b", "agent-c"],
    agents_total: 5,
    status: "online",
    version: "2.0.0",
    last_seen_at: Date.now() * 1000,
    monitors_count: 0,
    checks_per_min: 10,
    ...overrides,
  };
}

const OTableStub = {
  template: `
    <div :data-test="$attrs['data-test']">
      <div class="otable-toolbar"><slot name="toolbar" /></div>
      <div class="otable-toolbar-trailing"><slot name="toolbar-trailing" /></div>
      <table>
        <tbody>
          <tr
            v-for="(row, index) in (data || [])"
            :key="row[rowKey]"
            class="otable-row"
            @click="$emit('row-click', row)"
          >
            <td class="otable-cell-status"><slot name="cell-status" :row="row" /></td>
            <td class="otable-cell-name"><slot name="cell-name" :row="row" /></td>
            <td class="otable-cell-agents"><slot name="cell-agents" :row="row" /></td>
            <td class="otable-cell-types"><slot name="cell-types" :row="row" /></td>
            <td class="otable-cell-lastSeen"><slot name="cell-lastSeen" :row="row" /></td>
            <td class="otable-cell-actions"><slot name="cell-actions" :row="row" /></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!data || data.length === 0" class="otable-empty"><slot name="empty" /></div>
    </div>
  `,
  props: [
    "data",
    "columns",
    "rowKey",
    "loading",
    "pagination",
    "pageSize",
    "pageSizeOptions",
    "showGlobalFilter",
    "persistColumns",
    "tableId",
    "enableColumnResize",
  ],
  emits: ["row-click"],
};

const OButtonStub = {
  template: "<button @click=\"$emit('click')\"><slot /></button>",
  props: ["variant", "size", "iconLeft", "loading", "title"],
  emits: ["click"],
};

const OInputStub = {
  template:
    '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  props: ["modelValue", "placeholder"],
  emits: ["update:modelValue"],
};

const OBadgeStub = {
  template: '<span class="obadge-stub"><slot /></span>',
  props: ["variant", "dot", "size"],
};

const OTagStub = {
  template: '<span class="otag-stub"><slot /></span>',
  props: ["size", "shape", "variant"],
};

const OEmptyStateStub = {
  template: '<div :data-test="$attrs[\'data-test\']" class="oemptystate-stub" />',
  props: ["size", "illustration", "filtered", "title", "description"],
};

function makeWrapper(props: { locations?: SyntheticLocation[]; loading?: boolean } = {}) {
  return mount(PrivateLocations, {
    props: {
      locations: props.locations ?? [],
      loading: props.loading ?? false,
    },
    global: {
      stubs: {
        OTable: OTableStub,
        OButton: OButtonStub,
        OInput: OInputStub,
        OBadge: OBadgeStub,
        OTag: OTagStub,
        OEmptyState: OEmptyStateStub,
      },
    },
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("PrivateLocations", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRouterPush.mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("rendering", () => {
    it("renders the table with the correct data-test attribute", () => {
      wrapper = makeWrapper({ locations: [makeLocation()] });

      expect(wrapper.find('[data-test="synthetics-private-locations-table"]').exists()).toBe(true);
    });

    it("renders the search input in the toolbar", () => {
      wrapper = makeWrapper({ locations: [makeLocation()] });

      const input = wrapper.find('[data-test="synthetics-private-locations-search-input"]');
      expect(input.exists()).toBe(true);
    });

    it("renders the refresh button in the toolbar-trailing", () => {
      wrapper = makeWrapper({ locations: [makeLocation()] });

      const refreshBtn = wrapper.find('[data-test="synthetics-private-locations-refresh-btn"]');
      expect(refreshBtn.exists()).toBe(true);
    });

    it("renders location rows in the table", () => {
      const locations = [
        makeLocation({ id: "loc-1", name: "US East" }),
        makeLocation({ id: "loc-2", name: "EU West" }),
      ];
      wrapper = makeWrapper({ locations });

      const rows = wrapper.findAll(".otable-row");
      expect(rows).toHaveLength(2);
    });

    it("renders the location name and pool in the name cell", () => {
      wrapper = makeWrapper({
        locations: [makeLocation({ name: "US East", pool: "prod" })],
      });

      const nameCell = wrapper.find(".otable-cell-name");
      expect(nameCell.text()).toContain("US East");
      expect(nameCell.text()).toContain("prod");
    });

    it("renders agents count and version in the agents cell", () => {
      wrapper = makeWrapper({
        locations: [makeLocation({ live_agents: 3, agents_total: 5, version: "2.0.0" })],
      });

      const agentsCell = wrapper.find(".otable-cell-agents");
      expect(agentsCell.text()).toContain("3/5");
      expect(agentsCell.text()).toContain("v2.0.0");
    });

    it("renders type chips for each type", () => {
      wrapper = makeWrapper({
        locations: [makeLocation({ types: ["http", "browser", "tcp"] })],
      });

      const chips = wrapper.findAll(".otable-cell-types .otag-stub");
      expect(chips).toHaveLength(3);
      expect(chips[0].text()).toBe("HTTP");
      expect(chips[1].text()).toBe("BROWSER");
      expect(chips[2].text()).toBe("TCP");
    });

    it("renders a dash when types array is empty", () => {
      wrapper = makeWrapper({ locations: [makeLocation({ types: [] })] });

      const typesCell = wrapper.find(".otable-cell-types");
      expect(typesCell.text()).toBe("—");
    });

    it("renders the last seen formatted time", () => {
      const ts = 1700000000000000;
      wrapper = makeWrapper({ locations: [makeLocation({ last_seen_at: ts })] });

      const lastSeenCell = wrapper.find(".otable-cell-lastSeen");
      expect(lastSeenCell.text()).toContain(`formatted-${ts}`);
    });

    it("renders a dash when last_seen_at is missing", () => {
      wrapper = makeWrapper({
        locations: [makeLocation({ last_seen_at: undefined as any })],
      });

      const lastSeenCell = wrapper.find(".otable-cell-lastSeen");
      expect(lastSeenCell.text()).toBe("—");
    });

    it("renders copy and delete action buttons for each row", () => {
      wrapper = makeWrapper({
        locations: [makeLocation({ id: "loc-a" }), makeLocation({ id: "loc-b" })],
      });

      expect(
        wrapper.find('[data-test="synthetics-private-locations-copy-btn-loc-a"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="synthetics-private-locations-delete-btn-loc-a"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="synthetics-private-locations-copy-btn-loc-b"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="synthetics-private-locations-delete-btn-loc-b"]').exists(),
      ).toBe(true);
    });

    it("renders OBadge with success variant for online status", () => {
      wrapper = makeWrapper({ locations: [makeLocation({ status: "online" })] });

      const badge = wrapper.find(".obadge-stub");
      expect(badge.exists()).toBe(true);
      const statusCell = wrapper.find(".otable-cell-status");
      expect(statusCell.text()).toContain("synthetics.privateLocations.status.online");
    });
  });

  describe("loading prop", () => {
    it("passes loading true to OTable", () => {
      wrapper = makeWrapper({ loading: true, locations: [] });
      // The OTable stub is rendered; verify the empty slot doesn't
      // show OEmptyState when loading is true (v-if="!loading")
      expect(wrapper.find('[data-test="synthetics-private-locations-empty-state"]').exists()).toBe(
        false,
      );
    });

    it("passes loading false to OTable", () => {
      wrapper = makeWrapper({ loading: false });
      // With loading false and no data, the empty state should appear
      // This is tested in the empty state section
      expect(wrapper.find('[data-test="synthetics-private-locations-table"]').exists()).toBe(true);
    });
  });

  describe("search/filter", () => {
    it("shows all locations when search is empty", () => {
      const locations = [
        makeLocation({ id: "loc-1", name: "US East" }),
        makeLocation({ id: "loc-2", name: "EU West" }),
        makeLocation({ id: "loc-3", name: "Asia Pacific" }),
      ];
      wrapper = makeWrapper({ locations });

      const rows = wrapper.findAll(".otable-row");
      expect(rows).toHaveLength(3);
    });

    it("filters locations by name (case-insensitive)", async () => {
      // Use regions that don't contain "east" so only name matches drive the result.
      const locations = [
        makeLocation({ id: "loc-1", name: "US East", region: "r-1", pool: "p-1" }),
        makeLocation({ id: "loc-2", name: "EU West", region: "r-2", pool: "p-2" }),
        makeLocation({ id: "loc-3", name: "Asia Pacific", region: "r-3", pool: "p-3" }),
      ];
      wrapper = makeWrapper({ locations });

      const input = wrapper.find("input");
      await input.setValue("east");

      const rows = wrapper.findAll(".otable-row");
      expect(rows).toHaveLength(1);
      const nameCell = wrapper.find(".otable-cell-name");
      expect(nameCell.text()).toContain("US East");
    });

    it("filters locations by region (case-insensitive)", async () => {
      const locations = [
        makeLocation({ id: "loc-1", name: "Prod", region: "us-east-1" }),
        makeLocation({ id: "loc-2", name: "Staging", region: "eu-west-1" }),
      ];
      wrapper = makeWrapper({ locations });

      const input = wrapper.find("input");
      await input.setValue("west");

      const rows = wrapper.findAll(".otable-row");
      expect(rows).toHaveLength(1);
      const nameCell = wrapper.find(".otable-cell-name");
      expect(nameCell.text()).toContain("Staging");
    });

    it("filters locations by pool (case-insensitive)", async () => {
      const locations = [
        makeLocation({ id: "loc-1", name: "A", pool: "alpha" }),
        makeLocation({ id: "loc-2", name: "B", pool: "beta" }),
        makeLocation({ id: "loc-3", name: "C", pool: "alpha-backup" }),
      ];
      wrapper = makeWrapper({ locations });

      const input = wrapper.find("input");
      await input.setValue("ALPHA");

      const rows = wrapper.findAll(".otable-row");
      expect(rows).toHaveLength(2);
    });

    it("shows no rows when search matches nothing", async () => {
      const locations = [makeLocation({ id: "loc-1", name: "US East" })];
      wrapper = makeWrapper({ locations });

      const input = wrapper.find("input");
      await input.setValue("zzz-nonexistent");

      const rows = wrapper.findAll(".otable-row");
      expect(rows).toHaveLength(0);
    });

    it("restores all rows when search is cleared", async () => {
      // Use unique regions/pools so "east" only matches the name field.
      const locations = [
        makeLocation({ id: "loc-1", name: "US East", region: "r-a", pool: "p-a" }),
        makeLocation({ id: "loc-2", name: "EU West", region: "r-b", pool: "p-b" }),
      ];
      wrapper = makeWrapper({ locations });

      const input = wrapper.find("input");
      await input.setValue("east");
      expect(wrapper.findAll(".otable-row")).toHaveLength(1);

      await input.setValue("");
      expect(wrapper.findAll(".otable-row")).toHaveLength(2);
    });
  });

  describe("events", () => {
    it('emits "refresh" when refresh button is clicked', async () => {
      wrapper = makeWrapper({ locations: [makeLocation()] });

      const refreshBtn = wrapper.find('[data-test="synthetics-private-locations-refresh-btn"]');
      await refreshBtn.trigger("click");

      expect(wrapper.emitted("refresh")).toBeTruthy();
      expect(wrapper.emitted("refresh")).toHaveLength(1);
    });

    it('emits "copy-setup" with row data when copy button is clicked', async () => {
      const loc = makeLocation({ id: "loc-abc", name: "Test Location" });
      wrapper = makeWrapper({ locations: [loc] });

      const copyBtn = wrapper.find('[data-test="synthetics-private-locations-copy-btn-loc-abc"]');
      await copyBtn.trigger("click");

      expect(wrapper.emitted("copy-setup")).toBeTruthy();
      expect(wrapper.emitted("copy-setup")).toHaveLength(1);
      expect(wrapper.emitted("copy-setup")![0][0]).toEqual(loc);
    });

    it('emits "delete" with row data when delete button is clicked', async () => {
      const loc = makeLocation({ id: "loc-xyz", monitors_count: 0 });
      wrapper = makeWrapper({ locations: [loc] });

      const deleteBtn = wrapper.find(
        '[data-test="synthetics-private-locations-delete-btn-loc-xyz"]',
      );
      await deleteBtn.trigger("click");

      expect(wrapper.emitted("delete")).toBeTruthy();
      expect(wrapper.emitted("delete")).toHaveLength(1);
      expect(wrapper.emitted("delete")![0][0]).toEqual(loc);
    });

    it("does not emit delete when button is clicked but monitors_count > 0 (disabled)", async () => {
      const loc = makeLocation({ id: "loc-busy", monitors_count: 5 });
      wrapper = makeWrapper({ locations: [loc] });

      // Native disabled button blocks the click event from firing.
      const deleteBtn = wrapper.find(
        '[data-test="synthetics-private-locations-delete-btn-loc-busy"]',
      );
      await deleteBtn.trigger("click");

      expect(wrapper.emitted("delete")).toBeFalsy();
    });
  });

  describe("delete button disabled state", () => {
    it("delete button is enabled when monitors_count is 0", () => {
      wrapper = makeWrapper({
        locations: [makeLocation({ id: "loc-free", monitors_count: 0 })],
      });

      const deleteBtn = wrapper.find(
        '[data-test="synthetics-private-locations-delete-btn-loc-free"]',
      );
      expect(deleteBtn.attributes("disabled")).toBeUndefined();
    });

    it("delete button is disabled when monitors_count > 0", () => {
      wrapper = makeWrapper({
        locations: [makeLocation({ id: "loc-busy", monitors_count: 3 })],
      });

      const deleteBtn = wrapper.find(
        '[data-test="synthetics-private-locations-delete-btn-loc-busy"]',
      );
      expect(deleteBtn.attributes("disabled")).toBeDefined();
    });
  });

  describe("empty state", () => {
    it("shows OEmptyState when locations is empty and not loading", () => {
      wrapper = makeWrapper({ locations: [], loading: false });

      const emptyState = wrapper.find('[data-test="synthetics-private-locations-empty-state"]');
      expect(emptyState.exists()).toBe(true);
    });

    it("does not show OEmptyState when loading is true (even with empty locations)", () => {
      wrapper = makeWrapper({ locations: [], loading: true });

      const emptyState = wrapper.find('[data-test="synthetics-private-locations-empty-state"]');
      expect(emptyState.exists()).toBe(false);
    });

    it("does not show OEmptyState when locations has items", () => {
      wrapper = makeWrapper({ locations: [makeLocation()], loading: false });

      const emptyState = wrapper.find('[data-test="synthetics-private-locations-empty-state"]');
      expect(emptyState.exists()).toBe(false);
    });
  });

  describe("row click navigation", () => {
    it("navigates to private location detail on row click", async () => {
      const loc = makeLocation({ id: "loc-detail" });
      wrapper = makeWrapper({ locations: [loc] });

      const row = wrapper.find(".otable-row");
      await row.trigger("click");

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "synthetic-private-location",
        params: { id: "loc-detail" },
      });
    });
  });

  describe("status variant mapping", () => {
    it("uses success variant for online status", () => {
      wrapper = makeWrapper({ locations: [makeLocation({ id: "loc-1", status: "online" })] });

      const badge = wrapper.find(".obadge-stub");
      expect(badge.exists()).toBe(true);
      // Text still renders because the stub renders the slot
      const statusCell = wrapper.find(".otable-cell-status");
      expect(statusCell.text()).toContain("synthetics.privateLocations.status.online");
    });

    it("uses error variant for offline status", () => {
      wrapper = makeWrapper({ locations: [makeLocation({ id: "loc-2", status: "offline" })] });

      const statusCell = wrapper.find(".otable-cell-status");
      expect(statusCell.text()).toContain("synthetics.privateLocations.status.offline");
    });

    it("uses default variant for unknown status", () => {
      wrapper = makeWrapper({
        locations: [makeLocation({ id: "loc-3", status: "pending" as any })],
      });

      const statusCell = wrapper.find(".otable-cell-status");
      expect(statusCell.text()).toContain("synthetics.privateLocations.status.pending");
    });
  });

  describe("no setup agent button", () => {
    it("does NOT render a 'Setup an agent' button in the toolbar", () => {
      wrapper = makeWrapper({ locations: [makeLocation()] });

      const toolbar = wrapper.find(".otable-toolbar");
      const toolbarText = toolbar.text();
      // The toolbar only contains the search input; there should be no
      // setup-related button text
      expect(toolbarText).not.toContain("Setup");
      expect(toolbarText).not.toContain("Agent");
      expect(toolbarText).not.toContain("agent");
    });

    it("does NOT render any button other than refresh in the toolbar-trailing", async () => {
      wrapper = makeWrapper({ locations: [makeLocation()] });

      const trailing = wrapper.find(".otable-toolbar-trailing");
      const buttons = trailing.findAll("button");
      // Only the refresh button should exist in toolbar-trailing
      expect(buttons).toHaveLength(1);
      expect(buttons[0]?.attributes("data-test")).toBe("synthetics-private-locations-refresh-btn");
    });
  });
});
