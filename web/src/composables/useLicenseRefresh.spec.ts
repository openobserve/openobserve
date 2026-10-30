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

  it("toasts success and reloads license and config after the settle delay", async () => {
    vi.mocked(licenseServer.refresh_license_limits).mockResolvedValue({} as never);
    const ok = await useLicenseRefresh().refreshLicenseLimits();
    expect(ok).toBe(true);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "success", message: "about.license_refresh_success" }),
    );
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

  it("a 403 toasts the permission message and schedules nothing", async () => {
    vi.mocked(licenseServer.refresh_license_limits).mockRejectedValue({
      response: { status: 403, data: { message: "no" } },
    });
    const ok = await useLicenseRefresh().refreshLicenseLimits();
    expect(ok).toBe(false);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "about.refresh_needs_permission" }),
    );
    await vi.advanceTimersByTimeAsync(LICENSE_REFRESH_SETTLE_MS * 2);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("other errors toast the server message", async () => {
    vi.mocked(licenseServer.refresh_license_limits).mockRejectedValue({
      response: { status: 500, data: { message: "boom" } },
    });
    const ok = await useLicenseRefresh().refreshLicenseLimits();
    expect(ok).toBe(false);
    const arg = toastMock.mock.calls[0][0];
    expect(arg.variant).toBe("error");
    expect(arg.message).toContain("about.failed_to_refresh_license");
    expect(arg.message).toContain("boom");
    await vi.advanceTimersByTimeAsync(LICENSE_REFRESH_SETTLE_MS * 2);
    expect(dispatch).not.toHaveBeenCalled();
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
