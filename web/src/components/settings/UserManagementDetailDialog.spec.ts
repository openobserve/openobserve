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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import i18n from "@/locales";
import UserManagementDetailDialog from "./UserManagementDetailDialog.vue";

const DialogStub = defineComponent({
  name: "ODialog",
  props: ["open", "title"],
  template: "<div><slot /></div>",
});

// Renders each row's cells; the real table lays out nothing in jsdom.
const TableStub = defineComponent({
  name: "OTable",
  props: ["data", "columns"],
  template: `<div>
    <div v-for="row in data" :key="row.org_id" :data-test="'org-' + row.org_id">
      <template v-for="col in columns" :key="col.id">
        <slot :name="'cell-' + col.id" :row="row">{{ row[col.accessorKey] }}|</slot>
      </template>
    </div>
    <slot v-if="!data.length" name="empty" />
  </div>`,
});

const user = {
  id: "3MRK77U05VjFAzYBDqq6SxsNXg1",
  email: "jane@acme.com",
  first_name: "Jane",
  last_name: "Doe",
  is_external: true,
  created_at: 1,
  orgs: [
    { org_id: "acme", org_name: "Acme Corp", role: "admin" },
    { org_id: "beta", org_name: "Beta Inc", role: "viewer" },
  ],
};

const mountDialog = (props: Record<string, unknown>) =>
  mount(UserManagementDetailDialog, {
    props: { open: true, user, blockState: "email", ...props },
    global: { plugins: [i18n], stubs: { ODialog: DialogStub, OTable: TableStub } },
  });

const text = (wrapper: ReturnType<typeof mountDialog>, dataTest: string) =>
  wrapper.find(`[data-test="${dataTest}"]`).text();

describe("UserManagementDetailDialog", () => {
  it("shows the user's id, email, name, type and block state", () => {
    const wrapper = mountDialog({});

    expect(text(wrapper, "user-management-detail-id")).toBe("3MRK77U05VjFAzYBDqq6SxsNXg1");
    expect(text(wrapper, "user-management-detail-email")).toBe("jane@acme.com");
    expect(text(wrapper, "user-management-detail-name")).toBe("Jane Doe");
    expect(text(wrapper, "user-management-detail-type")).toBe("SSO");
    expect(text(wrapper, "user-management-detail-block-state")).toBe("Blocked by email");
  });

  it("lists every organization with its id, name and role", () => {
    const wrapper = mountDialog({});

    expect(text(wrapper, "org-acme")).toContain("acme|");
    expect(text(wrapper, "org-acme")).toContain("Acme Corp|");
    expect(text(wrapper, "org-acme")).toContain("Admin");
    expect(text(wrapper, "org-beta")).toContain("Viewer");
  });

  it("says so when the user belongs to no organization", () => {
    const wrapper = mountDialog({ user: { ...user, orgs: [], first_name: "", last_name: "" } });

    expect(text(wrapper, "user-management-detail-orgs")).toContain(
      "Not a member of any organization",
    );
    expect(text(wrapper, "user-management-detail-name")).toBe("—");
  });
});
