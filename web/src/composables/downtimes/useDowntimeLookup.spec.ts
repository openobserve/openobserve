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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createStore } from "vuex";
import downtimes from "@/services/downtimes";
import { queryClient } from "@/composables/query/queryClient";
import { useDowntimeLookup } from "./useDowntimeLookup";

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));
vi.mock("@/services/downtimes", () => ({ default: { list: vi.fn() } }));

const store = createStore({
  state: {
    selectedOrganization: { identifier: "acme" },
    zoConfig: { downtimes_enabled: true },
  },
});

const rows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `dt-${i}`, name: `Window ${i}` }));

const lookup = async (total: number, count: number) => {
  vi.mocked(downtimes.list).mockResolvedValue({ data: { items: rows(count), total } } as never);
  let result!: ReturnType<typeof useDowntimeLookup>;
  mount(
    defineComponent({
      setup() {
        result = useDowntimeLookup(true);
        return {};
      },
      template: "<div />",
    }),
    { global: { plugins: [store] } },
  );
  await flushPromises();
  return result;
};

describe("useDowntimeLookup", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(downtimes.list).mockReset();
  });

  it("marks an unknown id as not loaded when the org holds more rows than one page", async () => {
    const { truncated, notLoaded, nameOf } = await lookup(600, 500);
    expect(truncated.value).toBe(true);
    expect(notLoaded("dt-future")).toBe(true);
    expect(notLoaded("dt-3")).toBe(false);
    expect(nameOf("dt-3")).toBe("Window 3");
  });

  it("keeps an unknown id as is when the list is complete", async () => {
    const { truncated, notLoaded, nameOf } = await lookup(2, 2);
    expect(truncated.value).toBe(false);
    expect(notLoaded("dt-gone")).toBe(false);
    expect(nameOf("dt-gone")).toBe("dt-gone");
  });
});
