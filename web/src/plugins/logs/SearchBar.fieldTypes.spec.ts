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

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import SearchBar from "@/plugins/logs/SearchBar.vue";
import { locateNotACondition } from "@/utils/query/sqlDiagnostics";

const ERROR = "Cannot infer common argument type for logical boolean operation Boolean AND Utf8";
const QUERY = "SELECT * FROM logs WHERE a = 1 AND flag AND body";

describe("SearchBar — column types for server type errors", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => wrapper?.unmount());

  const mountWith = (fields: object[]) => {
    wrapper = mount(SearchBar, {
      global: { provide: { store }, plugins: [i18n, router], stubs: { QueryEditor: true } },
    });
    wrapper.vm.searchObj.data.stream.selectedStreamFields = fields;
  };

  it("reads dataType, the shape the stream-field loader produces", () => {
    mountWith([
      { name: "flag", dataType: "Boolean" },
      { name: "body", dataType: "Utf8" },
    ]);
    expect(locateNotACondition(ERROR, QUERY)?.field).toBe("body");
  });

  it("reads type, the shape of a raw stream schema", () => {
    mountWith([
      { name: "flag", type: "Boolean" },
      { name: "body", type: "Utf8" },
    ]);
    expect(locateNotACondition(ERROR, QUERY)?.field).toBe("body");
  });
});

describe("SearchBar — filter builder field types across streams", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => wrapper?.unmount());

  const builderTypes = (selected: string[]) => {
    wrapper = mount(SearchBar, {
      global: { provide: { store }, plugins: [i18n, router], stubs: { QueryEditor: true } },
    });
    const data = wrapper.vm.searchObj.data;
    data.streamResults = {
      list: [
        { name: "aa_logs", schema: [{ name: "code", type: "Utf8" }] },
        { name: "app_logs", schema: [{ name: "code", type: "Int64" }] },
      ],
    };
    data.stream.selectedStream = selected;
    data.stream.selectedStreamFields = [{ name: "code", dataType: "Int64" }];
    return wrapper.vm.filterBuilderFields.map((f: { name: string; type: string }) => f.type);
  };

  it("treats a field the selected streams type differently as text", () => {
    expect(builderTypes(["aa_logs", "app_logs"])).toEqual(["string"]);
  });

  it("keeps the field's own type with one stream selected", () => {
    expect(builderTypes(["app_logs"])).toEqual(["number"]);
  });
});
