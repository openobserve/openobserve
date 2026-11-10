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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { defineComponent, h, ref } from "vue";
import incidentsService from "@/services/incidents";
import securityCases from "@/services/securityCases";
import { useAlertTriage } from "./useAlertTriage";

vi.mock("@/services/incidents", () => ({
  default: { updateStatus: vi.fn(), postComment: vi.fn() },
}));
vi.mock("@/services/securityCases", () => ({
  default: { lookup: vi.fn(), promote: vi.fn() },
}));

function setup(ids: string[], enabled = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let api!: ReturnType<typeof useAlertTriage>;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useAlertTriage(ref("acme"), ref(ids), ref(enabled));
        return () => h("div");
      },
    }),
    { global: { plugins: [[VueQueryPlugin, { queryClient }]] } },
  );
  return { api, wrapper };
}

describe("useAlertTriage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(securityCases.lookup).mockResolvedValue({
      data: {
        cases: {
          a1: { id: "c1", status: "open", severity: "P1" },
          a2: { id: "c1", status: "open", severity: "P1" },
        },
      },
    } as any);
  });

  it("maps each detection to its open case and lists each case once", async () => {
    const { api, wrapper } = setup(["a1", "a2"]);
    await flushPromises();
    expect(api.caseByAlert.value.a1.id).toBe("c1");
    expect(api.openCases.value.map((c) => c.id)).toEqual(["c1"]);
    wrapper.unmount();
  });

  it("asks nothing without triage access or ids", async () => {
    setup(["a1"], false).wrapper.unmount();
    setup([]).wrapper.unmount();
    await flushPromises();
    expect(securityCases.lookup).not.toHaveBeenCalled();
  });

  it("acknowledges and annotates the case, naming the detection in the note", async () => {
    const { api, wrapper } = setup(["a1"]);
    await api.acknowledge("c1");
    expect(incidentsService.updateStatus).toHaveBeenCalledWith("acme", "c1", "acknowledged");
    await api.addNote("c1", "Mimikatz", "seen on host");
    expect(incidentsService.postComment).toHaveBeenCalledWith(
      "acme",
      "c1",
      "Mimikatz: seen on host",
    );
    wrapper.unmount();
  });

  it("promotes firings to a new case or an existing one", async () => {
    vi.mocked(securityCases.promote).mockResolvedValue({ data: { id: "c9" } } as any);
    const { api, wrapper } = setup(["a1"]);
    const firings = [{ alert_id: "a1", fired_at: 5 }];
    expect(await api.promote(firings)).toEqual({ id: "c9" });
    await api.promote(firings, "c1");
    expect(securityCases.promote).toHaveBeenLastCalledWith("acme", firings, "c1");
    wrapper.unmount();
  });
});
