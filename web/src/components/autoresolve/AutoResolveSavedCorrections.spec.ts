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

vi.mock("@/services/autoresolve", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { listCorrections: vi.fn(), removeCorrection: vi.fn() },
  });
});

import autoresolve, { type AutoResolveCorrection } from "@/services/autoresolve";
import AutoResolveSavedCorrections from "./AutoResolveSavedCorrections.vue";

const service = vi.mocked(autoresolve);

router.addRoute({
  name: "autoresolveRun",
  path: "/autoresolve/runs/:id",
  component: { render: () => null },
});

const correction = (i: number): AutoResolveCorrection => ({
  id: `cr-${i}`,
  kind: "wrong_fix",
  note: `Only the consumer is wrong (${i})`,
  option_title: null,
  run_id: `run-${i}`,
  revision: 1,
  created_by: "lead@example.com",
  created_at_us: 1_700_000_000_000_000 + i,
  run_started_at_us: 1_700_000_000_000_000,
});

let wrapper: VueWrapper | undefined;

const mountList = async (count: number, canRemove: boolean) => {
  const corrections = Array.from({ length: count }, (_, i) => correction(i));
  service.listCorrections.mockResolvedValue(
    axiosReply({ corrections, total: count, can_remove: canRemove }),
  );
  service.removeCorrection.mockResolvedValue(axiosReply(undefined));
  wrapper = mount(AutoResolveSavedCorrections, {
    props: { org: "default", autoresolveId: "af-1" },
    global: { plugins: [i18n, store, router], provide: { store } },
  });
  await flushPromises();
  return wrapper;
};

const rows = () => wrapper!.findAll('[data-test="autoresolve-saved-correction"]');
const removes = () => wrapper!.findAll('[data-test="autoresolve-saved-correction-remove"]');

afterEach(() => {
  wrapper?.unmount();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("AutoResolveSavedCorrections", () => {
  it.each<[number, boolean, number, string | null]>([
    [0, true, 0, null],
    [1, false, 1, null],
    [7, true, 5, "2"],
  ])("%i corrections (may remove: %s) fold past five", async (count, canRemove, shown, more) => {
    await mountList(count, canRemove);

    expect(wrapper!.find('[data-test="autoresolve-saved-corrections"]').exists()).toBe(count > 0);
    expect(rows()).toHaveLength(shown);
    expect(removes()).toHaveLength(canRemove ? shown : 0);
    const moreButton = wrapper!.find('[data-test="autoresolve-saved-corrections-more"]');
    expect(moreButton.exists()).toBe(more !== null);
    if (!more) return;
    expect(moreButton.text()).toContain(more);
    await moreButton.trigger("click");
    expect(rows()).toHaveLength(count);
  });

  it("Remove drops the correction for later runs", async () => {
    await mountList(1, true);

    await removes()[0].trigger("click");
    await flushPromises();
    expect(service.removeCorrection).toHaveBeenCalledWith("default", "af-1", "cr-0");
  });
});
