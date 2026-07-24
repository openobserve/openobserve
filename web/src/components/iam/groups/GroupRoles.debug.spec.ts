import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, vi } from "vitest";
import GroupRoles from "@/components/iam/groups/GroupRoles.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import fs from "fs";

vi.mock("@/services/iam", () => ({
  getRoles: vi.fn(() => Promise.resolve({ data: ["admin", "user", "developer"] })),
}));

vi.mock("@/composables/iam/usePermissions", () => ({
  default: vi.fn(() => ({
    rolesState: {},
    groupsState: {},
  })),
}));

describe("debug", () => {
  it("prints table HTML", async () => {
    const wrapper = mount(GroupRoles, {
      global: {
        provide: { store },
        plugins: [i18n],
      },
      props: {
        groupRoles: ["admin", "user"],
        activeTab: "roles",
        addedRoles: new Set(),
        removedRoles: new Set(),
      },
    });

    await flushPromises();

    const table = wrapper.find('[data-test="iam-roles-selection-table"]');
    const html = table.html();

    const lines: string[] = [];
    lines.push("TABLE HTML length: " + html.length);
    lines.push("=== FIRST 3000 CHARS ===");
    lines.push(html.substring(0, 3000));
    lines.push("=== CHECKBOX SEARCH ===");
    const adminCb = wrapper.find('[data-test="iam-roles-selection-table-body-row-admin-checkbox"]');
    lines.push("Admin checkbox exists: " + adminCb.exists());

    const allCheckboxes = wrapper.findAll('[data-test*="checkbox"]');
    lines.push("All checkboxes found: " + allCheckboxes.length);
    allCheckboxes.forEach((el, i) => {
      lines.push(`  ${i}: data-test="${el.attributes("data-test")}"`);
    });

    lines.push("=== ALL DATA-TEST IN TABLE ===");
    const allDataTests = table.findAll("[data-test]");
    allDataTests.forEach((el, i) => {
      lines.push(`  ${i}: ${el.attributes("data-test")}`);
    });

    const o2Root = wrapper.find('[data-test="o2-table-root"]');
    lines.push("OTable root exists: " + o2Root.exists());

    fs.writeFileSync("/tmp/debug_output.txt", lines.join("\n"));
    wrapper.unmount();

    // Read back to verify
    const written = fs.readFileSync("/tmp/debug_output.txt", "utf8");
    console.error("DEBUG_OUTPUT_LENGTH:", written.length);
  });
});
