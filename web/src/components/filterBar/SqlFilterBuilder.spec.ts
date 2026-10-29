// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import SqlFilterBuilder from "./SqlFilterBuilder.vue";
import type { FilterField } from "@/utils/query/filterBar";

const fields: FilterField[] = [
  { name: "level", type: "string" },
  { name: "status", type: "number" },
];

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

const mountBuilder = (query: string) => {
  wrapper = mount(SqlFilterBuilder, {
    attachTo: document.body,
    props: { query, fields, dataTest: "b" },
  });
  return wrapper;
};

const chips = () => wrapper!.findAll('[data-test^="b-bar-chip-"][data-test$="-field"]');

describe("SqlFilterBuilder", () => {
  it("draws a filter-mode query as chips, with no preview line to cut off", () => {
    mountBuilder("level = 'error' AND status >= 500");
    expect(chips()).toHaveLength(2);
    expect(wrapper!.find('[data-test="b-preview"]').exists()).toBe(false);
  });

  it("blends the bar into the editor surface instead of drawing an input frame", () => {
    mountBuilder("");
    expect(wrapper!.find('[data-test="b-bar-field"]').classes()).not.toContain("border");
  });

  it("re-reads the query when it changes outside the bar", async () => {
    mountBuilder("level = 'error'");
    await wrapper!.setProps({ query: "level = 'error' AND status = 1" });
    expect(chips()).toHaveLength(2);
  });

  it("writes the compiled query back when a chip is removed", async () => {
    mountBuilder("level = 'error' AND status = 1");
    await wrapper!.find('[data-test="b-bar-chip-status-remove"]').trigger("click");
    expect(wrapper!.emitted("update:query")).toEqual([["level = 'error'"]]);
  });

  it("offers to keep a query it cannot draw as text, or clear it and build", async () => {
    mountBuilder("upper(level) = 'ERROR'");
    expect(wrapper!.find('[data-test="b-unparsable"]').exists()).toBe(true);
    await wrapper!.find('[data-test="b-keep-query"]').trigger("click");
    expect(wrapper!.emitted("exit")).toHaveLength(1);
    await wrapper!.find('[data-test="b-clear-and-build"]').trigger("click");
    await flushPromises();
    expect(wrapper!.emitted("update:query")).toEqual([[""]]);
    expect(wrapper!.find('[data-test="b-bar-input"]').exists()).toBe(true);
  });

  it("draws an OR query with its connector", () => {
    mountBuilder("level = 'a' OR level = 'b'");
    expect(wrapper!.find('[data-test="b-bar-connector-1"]').exists()).toBe(true);
  });
});
