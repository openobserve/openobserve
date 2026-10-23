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

const { suppress } = vi.hoisted(() => ({ suppress: { value: false } }));
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>();
  return {
    ...actual,
    toast: vi.fn((options: Parameters<typeof actual.toast>[0]) =>
      suppress.value ? () => {} : actual.toast(options),
    ),
  };
});

import {
  addLicenseDeniedError,
  addUnauthorizedError,
  resetUnauthorizedErrors,
  useLicenseDeniedDialog,
} from "./useUnauthorizedErrorGrouper";
import { dismissAll, toast, toastRecords } from "@/lib/feedback/Toast/useToast";
import { raw } from "@/types/i18n";

describe("grouped access toast", () => {
  afterEach(() => {
    vi.useRealTimers();
    suppress.value = false;
    resetUnauthorizedErrors();
    dismissAll();
  });

  it("never adopts a toast it did not create, nor keeps errors from a toast never shown", () => {
    vi.useFakeTimers();
    toast({ variant: "error", message: raw("Header lookup failed") });

    suppress.value = true;
    addUnauthorizedError("http://localhost:5080/api/acme/alerts");
    vi.advanceTimersByTime(300);

    suppress.value = false;
    addUnauthorizedError("http://localhost:5080/api/acme/streams");
    vi.advanceTimersByTime(300);

    const [header, grouped] = toastRecords;
    expect(header.message).toBe("Header lookup failed");
    expect(header.details).toBeUndefined();
    expect(grouped.details?.map((d) => d.url)).toEqual(["/api/acme/streams"]);
  });
});

describe("license denied dialog", () => {
  it("collects distinct features while open and forgets them on close", () => {
    const { features, close } = useLicenseDeniedDialog();
    expect(features.value).toBeNull();

    addLicenseDeniedError(["dashboards"]);
    addLicenseDeniedError(["functions", "dashboards"]);
    expect(features.value).toEqual(["dashboards", "functions"]);

    close();
    expect(features.value).toBeNull();

    addLicenseDeniedError([]);
    expect(features.value).toEqual([]);
  });
});
