import { describe, it, expect, afterEach, vi } from "vitest";
import { nextTick, reactive } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/aws-exports", () => ({
  default: { isCloud: "false", isEnterprise: "true" },
}));

import PermissionsTable from "@/components/iam/roles/PermissionsTable.vue";

const makePermission = () => ({
  AllowAll: { show: true, value: false },
  AllowList: { show: true, value: false },
  AllowGet: { show: true, value: false },
  AllowDelete: { show: true, value: false },
  AllowPost: { show: true, value: false },
  AllowPut: { show: true, value: false },
});

const makeRow = (name: string, show = true, hasEntities = false, expand = false) => ({
  name,
  display_name: name,
  resourceName: name,
  type: "Type",
  show,
  has_entities: hasEntities,
  expand,
  entities: [],
  permission: makePermission(),
  is_loading: false,
});

async function mountTable(props: Record<string, any> = {}) {
  const wrapper = mount(PermissionsTable, {
    global: {
      plugins: [i18n, store],
      stubs: {
        // Stub the recursive PermissionsTable to avoid infinite render
        PermissionsTable: {
          name: "PermissionsTable",
          props: ["rows", "level", "parent", "customFilteredPermissions", "filter"],
          template: '<div data-test="nested-permissions-table-stub" />',
        },
      },
    },
    props: {
      rows: [],
      level: 0,
      visibleResourceCount: 0,
      parent: {
        name: "main",
        resourceName: "main",
        expand: false,
        is_loading: false,
        has_entities: false,
      },
      selectedPermissionsHash: new Set(),
      filter: {},
      customFilteredPermissions: {},
      ...props,
    },
  });
  await flushPromises();
  return wrapper;
}

// No PermissionsTable stub: a regression in programmatic expansion is invisible unless the nested level renders for real.
async function mountRealNestedTable(props: Record<string, any> = {}) {
  const wrapper = mount(PermissionsTable, {
    global: { plugins: [i18n, store] },
    props: {
      rows: [],
      level: 0,
      visibleResourceCount: 0,
      parent: {
        name: "main",
        resourceName: "main",
        expand: false,
        is_loading: false,
        has_entities: false,
      },
      selectedPermissionsHash: new Set(),
      filter: {},
      customFilteredPermissions: {},
      ...props,
    },
    attachTo: document.body,
  });
  await flushPromises();
  await nextTick();
  return wrapper;
}

const makeParentRow = (name: string, children: string[], expand: boolean) => ({
  ...makeRow(name, true, true, expand),
  entities: children.map((child) => makeRow(child, true, false, false)),
});

afterEach(() => {
  vi.clearAllMocks();
});

// 1. Rendering at level 0
describe("PermissionsTable - level 0 rendering", () => {
  it('renders the table section and hides "No Permissions Selected" when rows are present at level 0', async () => {
    const rows = [makeRow("stream", true)];

    const wrapper = await mountTable({ level: 0, visibleResourceCount: 1, rows });

    expect(wrapper.find('[data-test="iam-main-permissions-table-section"]').exists()).toBe(true);
    expect(
      wrapper.find('[data-test="edit-role-permissions-table-no-permissions-title"]').exists(),
    ).toBe(false);
  });

  it('does NOT render the "No Resources Present" message at level 0 when rows are empty', async () => {
    const wrapper = await mountTable({ level: 0, rows: [] });

    expect(
      wrapper.find('[data-test="edit-role-permissions-table-no-resources-title"]').exists(),
    ).toBe(false);
  });

  it('renders "No Permissions Selected" when rows are empty at level 0', async () => {
    const wrapper = await mountTable({ level: 0, rows: [] });
    expect(
      wrapper.find('[data-test="edit-role-permissions-table-no-permissions-title"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-test="edit-role-permissions-table-no-permissions-title"]').text(),
    ).toContain("No Permissions Selected");
  });

  it('does NOT render "No Permissions Selected" when rows are present at level 0', async () => {
    const rows = [makeRow("stream", true)];
    const wrapper = await mountTable({ level: 0, rows, visibleResourceCount: 1 });
    expect(
      wrapper.find('[data-test="edit-role-permissions-table-no-permissions-title"]').exists(),
    ).toBe(false);
  });
});

// 2. Rendering at level > 0
describe("PermissionsTable - level > 0 rendering", () => {
  it('renders "No Resources Present" when filtered rows are empty at level > 0', async () => {
    const parent = {
      name: "stream",
      resourceName: "stream",
      expand: true,
      is_loading: false,
      has_entities: true,
    };
    // rows are all show=false so getFilteredRows is empty
    const rows = [makeRow("logs", false)];
    const wrapper = await mountTable({ level: 1, rows, parent });
    expect(
      wrapper.find('[data-test="edit-role-permissions-table-no-resources-title"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-test="edit-role-permissions-table-no-resources-title"]').text(),
    ).toContain("No Resources Present");
  });

  it('does NOT render "No Resources Present" when there are visible rows', async () => {
    const parent = {
      name: "stream",
      resourceName: "stream",
      expand: true,
      is_loading: false,
      has_entities: true,
    };
    const rows = [makeRow("logs", true)];
    const wrapper = await mountTable({ level: 1, rows, parent });
    expect(
      wrapper.find('[data-test="edit-role-permissions-table-no-resources-title"]').exists(),
    ).toBe(false);
  });

  it("renders loading indicator when parent.is_loading is true", async () => {
    const parent = {
      name: "stream",
      resourceName: "stream",
      expand: true,
      is_loading: true,
      has_entities: true,
    };
    const wrapper = await mountTable({ level: 1, parent });
    expect(
      wrapper.find('[data-test="edit-role-permissions-table-loading-resources-loader"]').exists(),
    ).toBe(true);
  });

  it("does NOT render loading indicator when parent.is_loading is false", async () => {
    const parent = {
      name: "stream",
      resourceName: "stream",
      expand: false,
      is_loading: false,
      has_entities: true,
    };
    const wrapper = await mountTable({ level: 1, parent });
    // Loading div exists but is v-show'd off - it still exists in DOM
    // Check that it's not visible
    const loader = wrapper.find(
      '[data-test="edit-role-permissions-table-loading-resources-loader"]',
    );
    if (loader.exists()) {
      expect(loader.isVisible()).toBe(false);
    }
  });
});

// 3. getFilteredRows computed
describe("PermissionsTable - getFilteredRows computed", () => {
  it("returns only rows where show is true", async () => {
    const rows = [makeRow("stream", true), makeRow("logs", false), makeRow("metrics", true)];
    const wrapper = await mountTable({ rows });
    expect((wrapper.vm as any).getFilteredRows.length).toBe(2);
    expect((wrapper.vm as any).getFilteredRows.map((r: any) => r.name)).toEqual([
      "stream",
      "metrics",
    ]);
  });

  it("returns empty array when all rows are hidden", async () => {
    const rows = [makeRow("stream", false), makeRow("logs", false)];
    const wrapper = await mountTable({ rows });
    expect((wrapper.vm as any).getFilteredRows.length).toBe(0);
  });

  it("returns all rows when all are shown", async () => {
    const rows = [makeRow("a", true), makeRow("b", true), makeRow("c", true)];
    const wrapper = await mountTable({ rows });
    expect((wrapper.vm as any).getFilteredRows.length).toBe(3);
  });

  it("handles rows with undefined show gracefully", async () => {
    const rows = [
      { name: "x", show: undefined },
      { name: "y", show: true },
    ];
    const wrapper = await mountTable({ rows });
    // rows with show=undefined are falsy, filtered out
    expect((wrapper.vm as any).getFilteredRows.length).toBe(1);
  });
});

// 4. "Top 50" warning
describe("PermissionsTable - Top 50 warning", () => {
  it("shows the Top 50 banner when filtered rows count is exactly 50", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => makeRow(`resource-${i}`, true));
    const parent = {
      name: "stream",
      resourceName: "stream",
      expand: false,
      is_loading: false,
      has_entities: false,
    };
    const wrapper = await mountTable({ level: 1, rows, parent });
    expect(wrapper.text()).toContain("Top 50");
  });

  it("does NOT show Top 50 banner when fewer than 50 filtered rows", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRow(`resource-${i}`, true));
    const wrapper = await mountTable({ level: 1, rows });
    expect(wrapper.text()).not.toContain("Top 50");
  });
});

// 5. expandPermission emits
describe("PermissionsTable - expandPermission", () => {
  it('emits "expand:row" with the resource when called', async () => {
    const wrapper = await mountTable({ rows: [makeRow("stream", true, true)] });
    const resource = makeRow("stream", true, true);
    await (wrapper.vm as any).expandPermission(resource);
    const emitted = wrapper.emitted("expand:row");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toEqual(resource);
  });
});

// 6. handlePermissionChange emits
describe("PermissionsTable - handlePermissionChange", () => {
  it('emits "updated:permission" with row and permission name', async () => {
    const wrapper = await mountTable({ rows: [makeRow("stream", true)] });
    const row = makeRow("stream", true);
    (wrapper.vm as any).handlePermissionChange(row, "AllowGet");
    const emitted = wrapper.emitted("updated:permission");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toEqual(row);
    expect(emitted![0][1]).toBe("AllowGet");
  });

  it("emits multiple times for multiple permission changes", async () => {
    const wrapper = await mountTable();
    const row = makeRow("logs", true);
    (wrapper.vm as any).handlePermissionChange(row, "AllowAll");
    (wrapper.vm as any).handlePermissionChange(row, "AllowList");
    (wrapper.vm as any).handlePermissionChange(row, "AllowDelete");
    expect(wrapper.emitted("updated:permission")).toHaveLength(3);
  });
});

// 7. Table section data-test
describe("PermissionsTable - table section", () => {
  it("renders the main table section div", async () => {
    const parent = {
      name: "main",
      resourceName: "main",
      expand: false,
      is_loading: false,
      has_entities: false,
    };
    const wrapper = await mountTable({ parent });
    expect(wrapper.find('[data-test="iam-main-permissions-table-section"]').exists()).toBe(true);
  });

  it("uses the parent name in the data-test attribute", async () => {
    const parent = {
      name: "stream",
      resourceName: "stream",
      expand: false,
      is_loading: false,
      has_entities: false,
    };
    const wrapper = await mountTable({ parent });
    expect(wrapper.find('[data-test="iam-stream-permissions-table-section"]').exists()).toBe(true);
  });
});

// Programmatic expansion (row.expand) must reach the rendered table
describe("PermissionsTable - programmatic expansion", () => {
  const nestedSection = (wrapper: any, name: string) =>
    wrapper.find(`[data-test="iam-${name}-permissions-table-section"]`);

  // OTableBodyRow keys the expand button by the row's INDEX, not by row-key.
  const clickExpandToggle = async (wrapper: any, index = 0) => {
    await wrapper.find(`[data-test="o2-table-expand-${index}"]`).trigger("click");
    await nextTick();
    await flushPromises();
  };

  it("renders the nested rows of a row that arrives already expanded", async () => {
    const rows = [makeParentRow("stream", ["metrics", "logs"], true)];

    const wrapper = await mountRealNestedTable({ rows, visibleResourceCount: 1 });

    expect(nestedSection(wrapper, "stream").exists()).toBe(true);
    expect(wrapper.text()).toContain("metrics");
    expect(wrapper.text()).toContain("logs");
  });

  it("does NOT render the nested rows of a collapsed row", async () => {
    const rows = [makeParentRow("stream", ["metrics"], false)];

    const wrapper = await mountRealNestedTable({ rows, visibleResourceCount: 1 });

    expect(nestedSection(wrapper, "stream").exists()).toBe(false);
  });

  it("renders the nested rows when a row becomes expanded after mount", async () => {
    const rows = reactive([makeParentRow("stream", ["metrics"], false)]);
    const wrapper = await mountRealNestedTable({ rows, visibleResourceCount: 1 });
    expect(nestedSection(wrapper, "stream").exists()).toBe(false);

    rows[0].expand = true;
    await nextTick();
    await flushPromises();

    expect(nestedSection(wrapper, "stream").exists()).toBe(true);
  });

  it("lets the user collapse a programmatically expanded row and keeps it collapsed", async () => {
    const rows = [makeParentRow("stream", ["metrics"], true)];
    const wrapper = await mountRealNestedTable({ rows, visibleResourceCount: 1 });
    expect(nestedSection(wrapper, "stream").exists()).toBe(true);

    await clickExpandToggle(wrapper);

    expect(nestedSection(wrapper, "stream").exists()).toBe(false);

    // A re-render must not resurrect the expansion the user just dismissed.
    await wrapper.setProps({ visibleResourceCount: 2 });
    await nextTick();
    await flushPromises();

    expect(nestedSection(wrapper, "stream").exists()).toBe(false);
  });

  it("lets the user re-expand a row they collapsed", async () => {
    const rows = [makeParentRow("stream", ["metrics"], true)];
    const wrapper = await mountRealNestedTable({ rows, visibleResourceCount: 1 });

    await clickExpandToggle(wrapper);
    expect(nestedSection(wrapper, "stream").exists()).toBe(false);

    await clickExpandToggle(wrapper);

    expect(nestedSection(wrapper, "stream").exists()).toBe(true);
  });

  it("still emits expand:row when the user expands a collapsed row manually", async () => {
    const rows = [makeParentRow("stream", ["metrics"], false)];
    const wrapper = await mountRealNestedTable({ rows, visibleResourceCount: 1 });

    await clickExpandToggle(wrapper);

    const emitted = wrapper.emitted("expand:row");
    expect(emitted).toBeTruthy();
    expect((emitted![0][0] as any).name).toBe("stream");
  });

  it("does not emit expand:row for a row that was already expanded programmatically", async () => {
    const rows = [makeParentRow("stream", ["metrics"], true)];

    const wrapper = await mountRealNestedTable({ rows, visibleResourceCount: 1 });

    expect(wrapper.emitted("expand:row")).toBeFalsy();
  });
});
