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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { axiosReply } from "@/test/unit/helpers/mockService";
import { queryClient } from "@/composables/query/queryClient";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";

vi.mock("@/services/autoresolve", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { listRuns: vi.fn(), getSummary: vi.fn() },
  });
});

import autoresolve, {
  type AutoResolveRunQuery,
  type AutoResolveRunRow,
} from "@/services/autoresolve";
import AutoResolveRunsTable from "./AutoResolveRunsTable.vue";

const service = vi.mocked(autoresolve);

// The goal cell links to the run page, which the shared test router does not declare.
router.addRoute({
  name: "autoresolveRun",
  path: "/autoresolve/runs/:id",
  component: { render: () => null },
});

const run = (id: string): AutoResolveRunRow => ({
  id,
  goal: `Goal ${id}`,
  state: "worked",
  trigger: {
    kind: "person",
    label: "Started by ana@example.com",
    by: "ana@example.com",
    alert_id: null,
  },
  requester: "ana@example.com",
  connections: [{ id: "c1", name: "Code host" }],
  created_at_us: 1_700_000_000_000_000,
  ended_at_us: 1_700_000_600_000_000,
});

let wrapper: VueWrapper | undefined;

const rows = () =>
  wrapper!
    .findAll("[data-test]")
    .filter((el) => /^o2-table-row-\d+$/.test(el.attributes("data-test") ?? ""));

afterEach(() => {
  wrapper?.unmount();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("AutoResolveRunsTable", () => {
  it("requests page 2 with the filters and shows the pager's count for one run", async () => {
    service.getSummary.mockResolvedValue(
      axiosReply({
        connections: [{ id: "c1", name: "Code host", can_approve: true }],
        region: "",
        triggers_fire_here: true,
      }),
    );
    service.listRuns.mockImplementation(async (_org: string, q: AutoResolveRunQuery) =>
      axiosReply(
        q.page === 2
          ? { runs: [run("r-26")], total: 26 }
          : { runs: Array.from({ length: 25 }, (_, i) => run(`r-${i}`)), total: 26 },
      ),
    );
    wrapper = mount(AutoResolveRunsTable, {
      props: { org: "default" },
      attachTo: document.body,
      global: { plugins: [i18n, store, router], provide: { store } },
    });
    await flushPromises();

    const [startedBy, connection] = wrapper.findAllComponents(OSelect);
    wrapper.findComponent(OSearchInput).vm.$emit("update:modelValue", "checkout");
    wrapper.findComponent(OToggleGroup).vm.$emit("update:modelValue", "waiting");
    startedBy.vm.$emit("update:modelValue", "me");
    connection.vm.$emit("update:modelValue", "c1");
    const next = () => wrapper!.find('[data-test="o2-table-next-page-btn"]');
    await vi.waitFor(() => {
      expect(service.listRuns).toHaveBeenLastCalledWith(
        "default",
        expect.objectContaining({ connection: "c1" }),
      );
      expect(next().attributes("disabled")).toBeUndefined();
    });
    await next().trigger("click");
    await vi.waitFor(() => expect(rows()).toHaveLength(1));

    expect(service.listRuns).toHaveBeenLastCalledWith(
      "default",
      expect.objectContaining({
        page: 2,
        page_size: 25,
        q: "checkout",
        state: ["waiting_approval"],
        requester: store.state.userInfo.email,
        connection: "c1",
        from_us: expect.any(Number),
      }),
    );
    const { t } = i18n.global;
    await vi.waitFor(() =>
      expect(
        wrapper!.find('[data-test="o2-table-pagination-info"]').text().replace(/\s+/g, " "),
      ).toBe(`${t("search.showing")} 26 - 26 ${t("search.of")} 26`),
    );
  });
});
