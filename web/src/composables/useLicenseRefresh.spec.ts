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

import { effectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LICENSE_REFRESH_SETTLE_MS } from "@/utils/licenseWaivers";

const dispatch = vi.fn();
const toastMock = vi.fn();
const fetchQuery = vi.fn();
const invalidateQueries = vi.fn();

vi.mock("@tanstack/vue-query", () => ({
  useMutation: <T>(options: { mutationFn: () => Promise<T> }) => ({
    mutateAsync: options.mutationFn,
  }),
}));
vi.mock("vuex", () => ({
  useStore: () => ({ dispatch, state: { selectedOrganization: { identifier: "acme" } } }),
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...a: unknown[]) => toastMock(...a) }));
vi.mock("@/composables/query/queryClient", () => ({
  queryClient: {
    invalidateQueries: (...a: unknown[]) => invalidateQueries(...a),
    fetchQuery: (...a: unknown[]) => fetchQuery(...a),
  },
}));
vi.mock("@/services/license_server", () => ({
  default: { refresh_license_limits: vi.fn() },
}));
vi.mock("@/services/license_server.queries", () => ({
  licenseQuery: () => ({ queryKey: ["license"] }),
  refreshLicenseMutation: () => ({ mutationFn: () => licenseServer.refresh_license_limits() }),
}));
vi.mock("@/services/config.queries", () => ({
  configFullQuery: (org: string) => ({ queryKey: ["config", org] }),
}));
vi.mock("@/types/i18n", () => ({
  useI18nTyped: () => ({ t: (k: string) => k }),
  raw: (s: string) => s,
}));

import licenseServer from "@/services/license_server";
import { useLicenseRefresh } from "./useLicenseRefresh";

describe("useLicenseRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    invalidateQueries.mockResolvedValue(undefined);
    fetchQuery.mockResolvedValue({ license_search_allowed: true });
  });
  afterEach(() => vi.useRealTimers());

  it("returns the body without toasting and reloads after the settle delay", async () => {
    vi.mocked(licenseServer.refresh_license_limits).mockResolvedValue({} as never);
    const ok = await useLicenseRefresh().refreshLicenseLimits();
    expect(ok).toEqual({ ok: true, body: undefined, status: undefined });
    expect(toastMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(LICENSE_REFRESH_SETTLE_MS - 1);
    expect(dispatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith("setConfig", { license_search_allowed: true });
    expect(invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["license"], exact: true, refetchType: "none" }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["config", "acme"], exact: true, refetchType: "none" }),
    );
    expect(fetchQuery).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["license"] }));
  });

  it("passes the server's attempt time through and derives no time of its own", async () => {
    vi.mocked(licenseServer.refresh_license_limits).mockResolvedValue({
      status: 200,
      data: { outcome: "unchanged", attempt_at: 1792748530100000 },
      headers: { date: "Fri, 23 Oct 2026 03:02:00 GMT" },
    } as never);
    expect(await useLicenseRefresh().refreshLicenseLimits()).toStrictEqual({
      ok: true,
      body: { outcome: "unchanged", attempt_at: 1792748530100000 },
      status: 200,
    });
  });

  it("a 403 returns its status and schedules nothing", async () => {
    vi.mocked(licenseServer.refresh_license_limits).mockRejectedValue({
      response: { status: 403, data: { message: "no" } },
    });
    const ok = await useLicenseRefresh().refreshLicenseLimits();
    expect(ok).toEqual({ ok: false, status: 403, body: { message: "no" } });
    expect(toastMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(LICENSE_REFRESH_SETTLE_MS * 2);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("returns HTTP failures for the caller to render inline", async () => {
    vi.mocked(licenseServer.refresh_license_limits).mockRejectedValue({
      response: { status: 500, data: { message: "boom" } },
    });
    expect(await useLicenseRefresh().refreshLicenseLimits()).toEqual({
      ok: false,
      status: 500,
      body: { message: "boom" },
    });
    expect(toastMock).not.toHaveBeenCalled();
  });
  it("busy replies still schedule a local state reload", async () => {
    vi.mocked(licenseServer.refresh_license_limits).mockRejectedValue({
      response: {
        status: 409,
        data: { code: 409, reason: "refresh_in_progress", limits_refreshed: true },
      },
    });
    expect((await useLicenseRefresh().refreshLicenseLimits()).status).toBe(409);
    await vi.advanceTimersByTimeAsync(LICENSE_REFRESH_SETTLE_MS);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("a double click schedules exactly one reload", async () => {
    vi.mocked(licenseServer.refresh_license_limits).mockResolvedValue({} as never);
    const { refreshLicenseLimits } = useLicenseRefresh();
    await refreshLicenseLimits();
    await vi.advanceTimersByTimeAsync(5_000);
    await refreshLicenseLimits();
    await vi.advanceTimersByTimeAsync(LICENSE_REFRESH_SETTLE_MS);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("no reload fires after the owning scope is disposed", async () => {
    vi.mocked(licenseServer.refresh_license_limits).mockResolvedValue({} as never);
    const scope = effectScope();
    const { refreshLicenseLimits } = scope.run(() => useLicenseRefresh())!;
    await refreshLicenseLimits();
    await vi.advanceTimersByTimeAsync(5_000);
    scope.stop();
    await vi.advanceTimersByTimeAsync(LICENSE_REFRESH_SETTLE_MS * 2);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("runs the page callback once the reload settles", async () => {
    vi.mocked(licenseServer.refresh_license_limits).mockResolvedValue({} as never);
    const onSettled = vi.fn();
    await useLicenseRefresh().refreshLicenseLimits(onSettled);
    await vi.advanceTimersByTimeAsync(LICENSE_REFRESH_SETTLE_MS - 1);
    expect(onSettled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
});
