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

import { describe, expect, it } from "vitest";
import { computed, defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import { useConfigPanel } from "./useConfigPanel";

const panelData = (type: string) => ({
  data: {
    type,
    queries: [{ customQuery: false, fields: { x: [], y: [], z: [], breakdown: [] } }],
    config: { unit: "default", trellis: { layout: null } },
  },
  layout: { currentQueryIndex: 0 },
});

// Mounted with the real English catalogue, so the search runs on the words the panel shows.
const searchFor = async (type: string, query: string) => {
  let panel: ReturnType<typeof useConfigPanel> | undefined;
  mount(
    defineComponent({
      setup() {
        panel = useConfigPanel(
          panelData(type),
          ref(false),
          "dashboard",
          computed(() => false),
          computed(() => false),
          computed(() => false),
        );
        return () => h("div");
      },
    }),
    { global: { plugins: [i18n] } },
  );
  panel!.searchQuery.value = query;
  await nextTick();
  return panel!;
};

describe("config search", () => {
  it.each(["mapping", "value mapping", "Value Mappings"])(
    "finds Value Transformations by %s",
    async (query) => {
      const panel = await searchFor("table", query);
      expect(panel.isSectionVisible("valueTransformations")).toBe(true);
      expect(panel.isConfigOptionVisible("valueTransformations", "value-transformations")).toBe(
        true,
      );
    },
  );
});
