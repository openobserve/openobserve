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

const finder = vi.hoisted(() => ({ ok: false }));
vi.mock("./useFindMore", async () => {
  const { ref } = await import("vue");
  return {
    useFindMore: () => {
      const state = ref("idle");
      const result = ref<unknown>(null);
      const check = async () => {
        state.value = finder.ok ? "ready" : "error";
        result.value = finder.ok ? { checkedAt: 1, sources: [], dismissed: 0 } : null;
      };
      return { state, result, check };
    },
  };
});
vi.mock("./useInstallRecords", () => ({ useInstallRecords: () => ({ list: async () => [] }) }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/types/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/types/i18n")>()),
  useI18nTyped: () => ({ t: (key: string) => key }),
}));

import { toast } from "@/lib/feedback/Toast/useToast";

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

  it("says a failed check in its own state instead of a toast, and clears it on the next good one", async () => {
    vi.useRealTimers();
    const scope = effectScope();
    const checker = scope.run(() => useRefreshMatches("org"))!;
    finder.ok = false;
    expect(await checker.refresh()).toBe(false);
    expect(checker.failed.value).toBe(true);
    expect(toast).not.toHaveBeenCalled();
    finder.ok = true;
    expect(await checker.refresh()).toBe(true);
    expect(checker.failed.value).toBe(false);
    scope.stop();
  });
});
