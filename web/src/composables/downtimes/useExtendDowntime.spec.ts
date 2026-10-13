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
import { toast } from "@/lib/feedback/Toast/useToast";
import { useExtendDowntime } from "./useExtendDowntime";

vi.mock("@/services/downtimes", () => ({ default: { extend: vi.fn() } }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const store = createStore({ state: { selectedOrganization: { identifier: "acme" } } });

const mountExtend = () => {
  let api: ReturnType<typeof useExtendDowntime> | undefined;
  mount(
    defineComponent({
      setup() {
        api = useExtendDowntime();
        return {};
      },
      template: "<div />",
    }),
    { global: { plugins: [store] } },
  );
  return api!;
};

const conflict = {
  response: {
    status: 409,
    data: { message: "Someone changed this downtime since you loaded it. Reload and try again." },
  },
};

describe("useExtendDowntime", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(downtimes.extend).mockReset();
    vi.mocked(toast).mockReset();
  });

  it("sends the version of the row it was given", async () => {
    vi.mocked(downtimes.extend).mockResolvedValue({
      data: { id: "d1", name: "d1", folder_id: "ops", schedule: { ends_at: 0 } },
    } as any);
    const { extendBy } = mountExtend();
    await extendBy({ id: "d1", folder_id: "ops", version: 4 }, 3600);
    expect(downtimes.extend).toHaveBeenCalledWith(
      "acme",
      "d1",
      { by_secs: 3600, version: 4 },
      "ops",
    );

    await extendBy({ id: "d1", folder_id: "ops" }, 60);
    expect(downtimes.extend).toHaveBeenLastCalledWith("acme", "d1", { by_secs: 60 }, "ops");
  });

  it("shows the conflict and offers a reload on a 409", async () => {
    vi.mocked(downtimes.extend).mockRejectedValue(conflict);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { extendBy } = mountExtend();
    await expect(extendBy({ id: "d1", folder_id: "ops", version: 3 }, 3600)).resolves.toBeNull();
    await flushPromises();

    const shown = vi.mocked(toast).mock.calls[0][0] as any;
    expect(shown.variant).toBe("error");
    expect(String(shown.message)).toBe(conflict.response.data.message);
    expect(shown.action).toBeDefined();
    shown.action.handler();
    expect(invalidate).toHaveBeenCalled();
    invalidate.mockRestore();
  });

  it("offers no reload for any other failure", async () => {
    vi.mocked(downtimes.extend).mockRejectedValue({
      response: { status: 400, data: { message: "The extension is too long." } },
    });
    const { extendBy } = mountExtend();
    await extendBy({ id: "d1", folder_id: "ops", version: 3 }, 3600);
    const shown = vi.mocked(toast).mock.calls[0][0] as any;
    expect(shown.action).toBeUndefined();
  });
});
