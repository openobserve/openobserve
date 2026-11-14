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
import { effectScope } from "vue";

vi.mock("./useFindMore", () => ({ useFindMore: () => ({}) }));
vi.mock("./useInstallRecords", () => ({ useInstallRecords: () => ({}) }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/types/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/types/i18n")>()),
  useI18nTyped: () => ({ t: (key: string) => key }),
}));

import { resetBrowserMatches } from "./useBrowserMatches";
import { useRefreshMatches } from "./useRefreshMatches";

describe("useRefreshMatches", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    resetBrowserMatches();
  });
  afterEach(() => vi.useRealTimers());

  it("stops its clock when its owner goes away, so a remount per org leaks no timer", () => {
    const before = vi.getTimerCount();
    const scope = effectScope();
    scope.run(() => useRefreshMatches("org"));
    expect(vi.getTimerCount()).toBe(before + 1);
    scope.stop();
    expect(vi.getTimerCount()).toBe(before);
  });
});
