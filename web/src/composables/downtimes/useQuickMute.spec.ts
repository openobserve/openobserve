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

import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createStore } from "vuex";
import i18n from "@/locales";
import downtimes from "@/services/downtimes";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useQuickMute } from "./useQuickMute";

vi.mock("@/services/downtimes", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

describe("useQuickMute", () => {
  it("links the View downtime toast to the folder and org the mute was filed in", async () => {
    const store = createStore({
      state: { selectedOrganization: { identifier: "acme" }, timezone: "UTC", zoConfig: {} },
    });
    let api: ReturnType<typeof useQuickMute> | undefined;
    mount(
      defineComponent({
        setup() {
          api = useQuickMute();
          return {};
        },
        template: "<div />",
      }),
      { global: { plugins: [store, i18n] } },
    );
    vi.mocked(downtimes.create).mockResolvedValue({ data: { id: "d9" } } as any);
    const id = await api!.mute(
      [{ module: "anomaly_detections", ids: ["x1"] }],
      Date.now() * 1000 + 3_600_000_000,
      undefined,
      "ops",
    );
    expect(id).toBe("d9");
    // The org changes before the click: the link still names the org the mute is in.
    store.state.selectedOrganization.identifier = "other";
    vi.mocked(toast).mock.calls.at(-1)?.[0].action?.handler();
    expect(push).toHaveBeenCalledWith({
      name: "downtimeDetail",
      params: { id: "d9" },
      query: { org_identifier: "acme", folder: "ops" },
    });
  });
});
