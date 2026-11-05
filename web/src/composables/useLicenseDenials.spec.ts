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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addLicenseDeniedError, clearLicenseDenials } from "./useLicenseDenials";
import { toast } from "@/lib/feedback/Toast/useToast";
import { isPageLocked } from "@/composables/useFeatureLock";

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/composables/useFeatureLock", () => ({ isPageLocked: vi.fn(() => false) }));

describe("license denials", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(isPageLocked).mockReturnValue(false);
  });
  afterEach(() => {
    // Clear on the fake clock so pageChangedAt does not jump to real time.
    clearLicenseDenials();
    vi.useRealTimers();
    vi.mocked(toast).mockClear();
  });

  it("warns once per feature set, regardless of order, and again for a different set", () => {
    addLicenseDeniedError(["dashboards", "functions"]);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast).mock.calls[0][0]).toMatchObject({ variant: "warning" });

    addLicenseDeniedError(["functions", "dashboards"]);
    expect(toast).toHaveBeenCalledTimes(1);

    addLicenseDeniedError(["dashboards"]);
    expect(toast).toHaveBeenCalledTimes(2);
  });

  it("warns for an empty feature set too", () => {
    addLicenseDeniedError([]);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("warns again after navigation and ignores requests the old page started", () => {
    addLicenseDeniedError(["workflows"]);
    vi.setSystemTime(Date.now() + 1);
    clearLicenseDenials();
    addLicenseDeniedError(["oncall"], Date.now() - 1);
    expect(toast).toHaveBeenCalledTimes(1);
    addLicenseDeniedError(["workflows"]);
    expect(toast).toHaveBeenCalledTimes(2);
  });

  it("stays silent on a locked page", () => {
    vi.mocked(isPageLocked).mockReturnValue(true);
    addLicenseDeniedError(["workflows"]);
    expect(toast).not.toHaveBeenCalled();
  });
});
