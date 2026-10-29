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
import { addLicenseDeniedError, clearLicenseDenials, useLicenseDenials } from "./useLicenseDenials";

describe("license denials", () => {
  afterEach(() => useLicenseDenials().dismiss());

  it("collects distinct features until dismissed", () => {
    const { features, dismiss } = useLicenseDenials();
    expect(features.value).toBeNull();

    addLicenseDeniedError(["dashboards"]);
    addLicenseDeniedError(["functions", "dashboards"]);
    expect(features.value).toEqual(["dashboards", "functions"]);

    dismiss();
    expect(features.value).toBeNull();

    addLicenseDeniedError([]);
    expect(features.value).toEqual([]);
  });

  it("forgets them on navigation and ignores requests the old page started", () => {
    vi.useFakeTimers();
    addLicenseDeniedError(["workflows"]);
    expect(useLicenseDenials().features.value).toEqual(["workflows"]);
    clearLicenseDenials();
    expect(useLicenseDenials().features.value).toBeNull();
    addLicenseDeniedError(["oncall"], Date.now() - 1);
    expect(useLicenseDenials().features.value).toBeNull();
    addLicenseDeniedError(["oncall"]);
    expect(useLicenseDenials().features.value).toEqual(["oncall"]);
    vi.useRealTimers();
  });
});
