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
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createStore } from "vuex";
import i18n from "@/locales";
import downtimes from "@/services/downtimes";
import { queryClient } from "@/composables/query/queryClient";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useDowntimeRowActions } from "./useDowntimeRowActions";

vi.mock("@/services/downtimes", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const store = createStore({
  state: { selectedOrganization: { identifier: "acme" }, timezone: "UTC" },
});

const mountActions = () => {
  let api: ReturnType<typeof useDowntimeRowActions> | undefined;
  mount(
    defineComponent({
      setup() {
        api = useDowntimeRowActions();
        return {};
      },
      template: "<div />",
    }),
    { global: { plugins: [store, i18n] } },
  );
  return api!;
};

const mute = {
  id: "d1",
  name: "Quick mute · ut-demo-anomaly",
  ends_at: 4_102_444_800_000_000,
  version: 3,
  folder_id: "ops",
  end_here: true,
};
const httpError = (status: number, data: unknown = {}) => ({ response: { status, data } });
const lastToast = () => vi.mocked(toast).mock.calls.at(-1)?.[0];

describe("useDowntimeRowActions", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(toast).mockReset();
    push.mockReset();
    for (const fn of Object.values(downtimes)) if (vi.isMockFunction(fn)) fn.mockReset();
  });

  it("ends a mute at the version and in the folder the row showed", async () => {
    vi.mocked(downtimes.cancel).mockResolvedValue({ data: {} } as any);
    expect(await mountActions().end(mute)).toBe("ok");
    expect(downtimes.cancel).toHaveBeenCalledWith("acme", "d1", "ops", 3);
    expect(lastToast()?.message).toBe("Mute ended. Notifications resume.");
  });

  it("says the mute changed on a 409, refetches, and links to the downtime", async () => {
    const refetch = vi.spyOn(queryClient, "invalidateQueries");
    vi.mocked(downtimes.cancel).mockRejectedValue(httpError(409));
    expect(await mountActions().end(mute)).toBe("conflict");
    expect(lastToast()?.message).toBe("This mute changed. Open the downtime.");
    expect(refetch).toHaveBeenCalled();
    lastToast()?.action?.handler();
    expect(push).toHaveBeenCalledWith({
      name: "downtimeDetail",
      params: { id: "d1" },
      query: { org_identifier: "acme", folder: "ops" },
    });
    refetch.mockRestore();
  });

  it("says a 403 is a missing permission, and still refetches", async () => {
    const refetch = vi.spyOn(queryClient, "invalidateQueries");
    vi.mocked(downtimes.cancel).mockRejectedValue(httpError(403));
    expect(await mountActions().end(mute)).toBe("conflict");
    expect(lastToast()?.message).toBe("You do not have permission to end this mute.");
    expect(refetch).toHaveBeenCalled();
    refetch.mockRestore();
  });

  it("refetches nothing when no answer came", async () => {
    const refetch = vi.spyOn(queryClient, "invalidateQueries");
    vi.mocked(downtimes.cancel).mockRejectedValue(new Error("Network Error"));
    expect(await mountActions().end(mute)).toBe("failed");
    expect(refetch).not.toHaveBeenCalled();
    refetch.mockRestore();
  });

  it("extends by a preset at the version the row showed", async () => {
    vi.mocked(downtimes.extend).mockResolvedValue({
      data: { id: "d1", schedule: { ends_at: 4_102_448_400_000_000 } },
    } as any);
    expect(await mountActions().extendBy(mute, 3600)).toBe("ok");
    expect(downtimes.extend).toHaveBeenCalledWith(
      "acme",
      "d1",
      { by_secs: 3600, version: 3 },
      "ops",
    );
    vi.mocked(downtimes.extend).mockRejectedValue(httpError(409));
    expect(await mountActions().extendBy(mute, 3600)).toBe("conflict");
    expect(lastToast()?.message).toBe("This mute changed. Open the downtime.");
  });

  it("extends until a time at the row's version, with the row messages on a refusal", async () => {
    vi.mocked(downtimes.get).mockResolvedValue({
      data: { id: "d1", folder_id: "ops", version: 3, current_window: { start: 1, end: 2 } },
    } as any);
    const api = mountActions();
    expect(await api.extendUntil(9)).toBe("failed");
    await api.openExtendUntil(mute);
    vi.mocked(downtimes.extend).mockResolvedValue({
      data: { id: "d1", schedule: { ends_at: 4_102_448_400_000_000 } },
    } as any);
    expect(await api.extendUntil(4_102_448_400_000_000)).toBe("ok");
    expect(downtimes.extend).toHaveBeenCalledWith(
      "acme",
      "d1",
      { until: 4_102_448_400_000_000, version: 3 },
      "ops",
    );
    const refetch = vi.spyOn(queryClient, "invalidateQueries");
    vi.mocked(downtimes.extend).mockRejectedValue(httpError(409));
    expect(await api.extendUntil(4_102_448_400_000_000)).toBe("conflict");
    expect(lastToast()?.message).toBe("This mute changed. Open the downtime.");
    expect(refetch).toHaveBeenCalled();
    vi.mocked(downtimes.extend).mockRejectedValue(httpError(403));
    expect(await api.extendUntil(4_102_448_400_000_000)).toBe("conflict");
    expect(lastToast()?.message).toBe("Could not extend the downtime");
    refetch.mockRestore();
  });

  it("opens Extend until on the stored row the row's version names", async () => {
    vi.mocked(downtimes.get).mockResolvedValue({
      data: { id: "d1", folder_id: "ops", version: 3, current_window: { start: 1, end: 2 } },
    } as any);
    const api = mountActions();
    expect(await api.openExtendUntil(mute)).toBe("ok");
    expect(downtimes.get).toHaveBeenCalledWith("acme", "d1", "ops");
    expect(api.extendUntilOpen.value).toBe(true);
    expect(api.extendUntilRow.value).toMatchObject({ id: "d1", version: 3 });
  });

  it("refuses to open on a stored row newer than the row, and refreshes the list", async () => {
    const refetch = vi.spyOn(queryClient, "invalidateQueries");
    vi.mocked(downtimes.get).mockResolvedValue({
      data: { id: "d1", folder_id: "ops", version: 5, current_window: { start: 1, end: 2 } },
    } as any);
    const api = mountActions();
    expect(await api.openExtendUntil(mute)).toBe("conflict");
    expect(api.extendUntilOpen.value).toBe(false);
    expect(lastToast()?.message).toBe("This mute changed. Open the downtime.");
    expect(refetch).toHaveBeenCalled();
    refetch.mockRestore();
  });

  it("keeps the last Extend until opened when an earlier read answers later", async () => {
    const answers: Record<string, (v: unknown) => void> = {};
    vi.mocked(downtimes.get).mockImplementation(
      (_org, id) => new Promise((resolve) => (answers[id] = resolve)) as any,
    );
    const api = mountActions();
    const first = api.openExtendUntil(mute);
    const second = api.openExtendUntil({ ...mute, id: "d2" });
    answers.d2({
      data: { id: "d2", folder_id: "ops", version: 3, current_window: { start: 1, end: 9 } },
    });
    expect(await second).toBe("ok");
    answers.d1({
      data: { id: "d1", folder_id: "ops", version: 3, current_window: { start: 1, end: 2 } },
    });
    expect(await first).toBe("failed");
    expect(api.extendUntilRow.value).toMatchObject({ id: "d2", current_window: { end: 9 } });
  });

  it("reads again when it joined a read that started before the row moved on", async () => {
    let answerOld: (v: unknown) => void = () => {};
    vi.mocked(downtimes.get)
      .mockImplementationOnce(() => new Promise((resolve) => (answerOld = resolve)) as any)
      .mockResolvedValueOnce({
        data: { id: "d1", folder_id: "ops", version: 4, current_window: { start: 1, end: 5 } },
      } as any);
    const api = mountActions();
    const stale = api.openExtendUntil(mute);
    const fresh = api.openExtendUntil({ ...mute, version: 4 });
    answerOld({
      data: { id: "d1", folder_id: "ops", version: 3, current_window: { start: 1, end: 2 } },
    });
    expect(await stale).toBe("failed");
    expect(await fresh).toBe("ok");
    expect(downtimes.get).toHaveBeenCalledTimes(2);
    expect(api.extendUntilRow.value).toMatchObject({ version: 4, current_window: { end: 5 } });
  });
  it("reads the stored window fresh each time Extend until opens", async () => {
    vi.mocked(downtimes.get).mockResolvedValue({
      data: { id: "d1", folder_id: "ops", version: 3, current_window: { start: 1, end: 2 } },
    } as any);
    const api = mountActions();
    expect(await api.openExtendUntil(mute)).toBe("ok");
    vi.mocked(downtimes.get).mockResolvedValue({
      data: { id: "d1", folder_id: "ops", version: 4, current_window: { start: 1, end: 5 } },
    } as any);
    expect(await api.openExtendUntil({ ...mute, version: 4 })).toBe("ok");
    expect(downtimes.get).toHaveBeenCalledTimes(2);
    expect(api.extendUntilRow.value).toMatchObject({ version: 4, current_window: { end: 5 } });
  });

  it("tells a refused Extend until open from no answer, so its screen can refresh", async () => {
    const api = mountActions();
    vi.mocked(downtimes.get).mockRejectedValueOnce(httpError(404));
    expect(await api.openExtendUntil(mute)).toBe("conflict");
    vi.mocked(downtimes.get).mockRejectedValueOnce(new Error("Network Error"));
    expect(await api.openExtendUntil(mute)).toBe("failed");
    expect(api.extendUntilOpen.value).toBe(false);
  });

  it("drops a refusal that answers after an org switch, and refreshes the old org's lists", async () => {
    const refetch = vi.spyOn(queryClient, "invalidateQueries");
    let refuse: (e: unknown) => void = () => {};
    vi.mocked(downtimes.cancel).mockImplementation(
      () => new Promise((_resolve, reject) => (refuse = reject)) as any,
    );
    const api = mountActions();
    const ending = api.end(mute);
    await Promise.resolve();
    store.state.selectedOrganization = { identifier: "other" };
    try {
      refuse(httpError(409));
      expect(await ending).toBe("conflict");
      expect(toast).not.toHaveBeenCalled();
      const orgs = refetch.mock.calls.map(([f]) => (f as { queryKey: unknown[] }).queryKey[1]);
      expect(orgs.length).toBeGreaterThan(0);
      expect(orgs.every((o) => o === "acme")).toBe(true);
    } finally {
      store.state.selectedOrganization = { identifier: "acme" };
      refetch.mockRestore();
    }
  });

  it("replaces the changed-mute toast, so View downtime opens the latest row", async () => {
    const dismiss = vi.fn();
    vi.mocked(toast).mockReturnValue(dismiss as any);
    vi.mocked(downtimes.cancel).mockRejectedValue(httpError(409));
    const api = mountActions();
    await api.end(mute);
    expect(dismiss).not.toHaveBeenCalled();
    await api.end({ ...mute, id: "d2" });
    expect(dismiss).toHaveBeenCalledTimes(1);
    lastToast()?.action?.handler();
    expect(push).toHaveBeenLastCalledWith(expect.objectContaining({ params: { id: "d2" } }));
  });
});
