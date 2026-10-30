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

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";

vi.mock("@/types/i18n", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

vi.mock("@/lib/vue-shortcut-manager", () => ({ useShortcuts: vi.fn() }));

import EvalJobList from "./EvalJobList.vue";

const OTableStub = defineComponent({
  name: "OTable",
  props: { columns: { type: Array, default: () => [] } },
  template: "<div data-test='eval-job-list-table' />",
});

function mountList() {
  return mount(EvalJobList, {
    props: { rows: [], search: "" },
    global: {
      stubs: {
        OTable: OTableStub,
        EvalListShell: { template: "<div><slot name='table' /></div>" },
      },
    },
  });
}

describe("EvalJobList columns", () => {
  it("gives the flex Name column a 160px floor so the fixed columns cannot squeeze it", () => {
    const columns = mountList().findComponent(OTableStub).props("columns") as any[];
    const name = columns.find((c) => c.id === "name");
    expect(name).toBeDefined();
    expect(name.meta.flex).toBe(true);
    expect(name.minSize).toBe(160);
  });
});
