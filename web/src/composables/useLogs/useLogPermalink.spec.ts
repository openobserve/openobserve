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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { ref } from "vue";
import searchService from "@/services/search";
import {
  activePermalink,
  clearPermalink,
  currentInitOrigin,
  initOriginForRun,
  isInitOrigin,
  noteGridQuery,
  noteUserScopeChange,
  permalinkBanner,
  permalinkCloseExemption,
  permalinkHighlightTs,
  resetPermalinkForTests,
  sharedLineRecord,
} from "@/composables/useLogs/useLogPermalink";
import {
  beginPermalinkFromUrl,
  resolveActivePermalink,
  retryPermalinkResolve,
} from "@/composables/useLogs/permalinkResolve";
import {
  bindLogsUrlRouter,
  resetLogsUrlForTests,
  sharedPage,
  sharedPageNotice,
} from "@/composables/useLogs/useLogsUrl";
import { closeDrawerForQuery, drawerCloseExemptions } from "@/composables/useLogs/logsRowNav";
import { fingerprintRecord } from "@/utils/logs/logPermalink";

vi.mock("@/services/search", () => ({ default: { search: vi.fn() } }));

const search = vi.mocked(searchService.search);

const TS = 1_700_000_000_000_123;
const recordA = { _timestamp: TS, level: "error", message: "payment declined" };
const recordB = { _timestamp: TS, level: "error", message: "card expired" };

const ok = (hits: unknown[], extra: Record<string, unknown> = {}) =>
  Promise.resolve({ status: 200, data: { hits, is_partial: false, function_error: [], ...extra } });
const fail = (status: number, data: unknown = {}) =>
  Promise.reject(Object.assign(new Error(`HTTP ${status}`), { response: { status, data } }));

const routerWith = (query: Record<string, unknown>) => {
  const currentRoute = ref<any>({ name: "logs", query });
  return {
    currentRoute,
    push: vi.fn(),
    replace: vi.fn(async (to: any) => {
      currentRoute.value = { name: "logs", query: to.query };
    }),
  };
};

const linkQuery = (extra: Record<string, unknown> = {}) => ({
  stream: "app",
  log_stream: "app",
  log_ts: String(TS),
  ...extra,
});

describe("useLogPermalink + permalinkResolve (4c C3–C5)", () => {
  beforeEach(() => {
    resetPermalinkForTests();
    resetLogsUrlForTests();
    search.mockReset();
  });

  describe("beginPermalinkFromUrl", () => {
    it("returns no origin and sets nothing for a plain query link", () => {
      expect(beginPermalinkFromUrl({ stream: "app" }, "default")).toBeNull();
      expect(activePermalink.value).toBeNull();
      expect(permalinkBanner.value).toBeNull();
    });

    it("mints an init origin for a page-only link so the page notice can wait for the first run", () => {
      sharedPage.value = 3;
      const token = beginPermalinkFromUrl({ stream: "app", page: "3" }, "default");
      expect(token).toMatch(/^permalink-init:\d+$/);
      expect(activePermalink.value).toBeNull();
    });

    it("shows the invalid banner and keeps no permalink for malformed params (J-C8)", () => {
      const token = beginPermalinkFromUrl(linkQuery({ log_ts: "abc" }), "default");
      expect(token).not.toBeNull();
      expect(activePermalink.value).toBeNull();
      expect(permalinkBanner.value?.state).toBe("invalid");
    });

    it("parses a valid line link into the active permalink", () => {
      beginPermalinkFromUrl(linkQuery({ log_id: "42" }), "default");
      expect(activePermalink.value?.link).toEqual({ stream: "app", ts: TS, id: "42" });
      expect(activePermalink.value?.org).toBe("default");
    });
  });

  describe("init origin", () => {
    it("a query with the current token keeps the permalink; any other query ends it with a replace", async () => {
      const router = routerWith(linkQuery({ log_fp: "abc" }));
      bindLogsUrlRouter(router as any);
      const token = beginPermalinkFromUrl(linkQuery({ log_fp: "abc" }), "default");
      sharedPage.value = 2;
      noteGridQuery(token, 7);
      expect(activePermalink.value).not.toBeNull();
      expect(isInitOrigin(token)).toBe(true);

      noteGridQuery(undefined);
      expect(activePermalink.value).toBeNull();
      expect(currentInitOrigin()).toBeNull();
      expect(sharedPage.value).toBeNull();
      expect(sharedPageNotice.value).toBeNull();
      await vi.waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
      expect(router.currentRoute.value.query).toEqual({ stream: "app" });
      expect(router.push).not.toHaveBeenCalled();
    });

    it("a user refinement revokes the token, so a run merged with init reasons cannot inherit it (J-C11)", () => {
      const token = beginPermalinkFromUrl(linkQuery(), "default");
      expect(initOriginForRun(token)).toBe(token);
      noteUserScopeChange();
      expect(initOriginForRun(token)).toBeUndefined();
      expect(activePermalink.value).toBeNull();
    });

    it("exempts only the init search from the drawer-close rule, and only while the shared line is open", () => {
      expect(drawerCloseExemptions).toContain(permalinkCloseExemption);
      const token = beginPermalinkFromUrl(linkQuery(), "default") as string;
      const searchObj: any = { meta: { showDetailTab: true }, data: {} };
      closeDrawerForQuery(searchObj, false, token);
      expect(searchObj.meta.showDetailTab).toBe(false);
      sharedLineRecord.value = { ...recordA };
      searchObj.meta.showDetailTab = true;
      closeDrawerForQuery(searchObj, false, token);
      expect(searchObj.meta.showDetailTab).toBe(true);
      closeDrawerForQuery(searchObj, false, undefined);
      expect(searchObj.meta.showDetailTab).toBe(false);
    });
  });

  describe("resolveActivePermalink", () => {
    it("sends the 1 µs one-shot search with search_type other, no cache and the link's regions (C4)", async () => {
      search.mockReturnValue(ok([recordA]) as any);
      beginPermalinkFromUrl(linkQuery({ log_id: "42" }), "default");
      await resolveActivePermalink({ regions: ["us"], clusters: ["c1"] });
      expect(search).toHaveBeenCalledTimes(1);
      const [options, searchType, multi, useCache] = search.mock.calls[0] as any[];
      expect(searchType).toBe("other");
      expect(multi).toBe(false);
      expect(useCache).toBe(false);
      expect(options.org_identifier).toBe("default");
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(options.query).toEqual({
        query: {
          sql: "SELECT * FROM app WHERE _o2_id = '42'",
          start_time: TS,
          end_time: TS + 1,
          from: 0,
          size: 5000,
          quick_mode: false,
        },
        regions: ["us"],
        clusters: ["c1"],
      });
    });

    it("found: the drawer record is the resolved row; multi-stream adds _stream_name (J-C2, J-C5)", async () => {
      search.mockReturnValue(ok([recordA, recordB]) as any);
      beginPermalinkFromUrl(linkQuery({ log_fp: fingerprintRecord(recordB) }), "default");
      await resolveActivePermalink({ multiStream: true });
      expect(permalinkBanner.value?.state).toBe("found");
      expect(sharedLineRecord.value).toEqual({ ...recordB, _stream_name: "app" });
    });

    it("ambiguous timestamp link highlights the rows at that µs, no drawer (J-C9)", async () => {
      search.mockReturnValue(ok([recordA, recordB]) as any);
      beginPermalinkFromUrl(linkQuery(), "default");
      await resolveActivePermalink();
      expect(permalinkBanner.value?.state).toBe("ambiguous");
      expect(permalinkBanner.value?.messageParams).toEqual({ count: 2 });
      expect(sharedLineRecord.value).toBeNull();
      expect(permalinkHighlightTs.value).toBe(TS);
    });

    it("tie-heavy timestamp link (size cap hit, nothing else wrong) is ambiguous, not incomplete (S-C3)", async () => {
      const hits = Array.from({ length: 5000 }, (_, i) => ({ _timestamp: TS, n: i }));
      search.mockReturnValue(ok(hits) as any);
      beginPermalinkFromUrl(linkQuery(), "default");
      await resolveActivePermalink();
      expect(permalinkBanner.value?.state).toBe("ambiguous");
      expect(permalinkBanner.value?.messageKey).toBe(
        "search.linePermalink.bannerAmbiguousTieHeavy",
      );
      expect(permalinkBanner.value?.messageParams.count).toMatch(/^5.000\+$/);
      expect(permalinkBanner.value?.actionKey).toBe("search.linePermalink.actionShowLines");
      expect(permalinkHighlightTs.value).toBe(TS);
    });

    it("a capped stream that does carry _o2_id keeps the generic ambiguous copy", async () => {
      const hits = Array.from({ length: 5000 }, (_, i) => ({ _timestamp: TS, _o2_id: i }));
      search.mockReturnValue(ok(hits) as any);
      beginPermalinkFromUrl(linkQuery(), "default");
      await resolveActivePermalink();
      expect(permalinkBanner.value?.messageKey).toBe("search.linePermalink.bannerAmbiguous");
    });

    it("a partial response stays incomplete even with a matching row (J-C12)", async () => {
      search.mockReturnValue(ok([{ ...recordA, _o2_id: "42" }], { is_partial: true }) as any);
      beginPermalinkFromUrl(linkQuery({ log_id: "42" }), "default");
      await resolveActivePermalink();
      expect(permalinkBanner.value?.state).toBe("incomplete");
      expect(sharedLineRecord.value).toBeNull();
      expect(permalinkHighlightTs.value).toBeNull();
    });

    it.each([
      [403, {}, "denied"],
      [400, { code: 20002 }, "stream_missing"],
      [500, {}, "error"],
    ])("HTTP %s maps to %s with no record", async (status, data, state) => {
      search.mockReturnValue(fail(status, data) as any);
      beginPermalinkFromUrl(linkQuery({ log_id: "42" }), "default");
      await resolveActivePermalink();
      expect(permalinkBanner.value?.state).toBe(state);
      expect(sharedLineRecord.value).toBeNull();
    });

    it("gone appends the stream's retention when it is readable (J-C3)", async () => {
      search.mockReturnValue(ok([]) as any);
      beginPermalinkFromUrl(linkQuery({ log_id: "42" }), "default");
      await resolveActivePermalink({ retentionDays: () => 14 });
      expect(permalinkBanner.value?.state).toBe("gone");
      expect(permalinkBanner.value?.messageParams).toEqual({ days: 14 });
    });

    it("Retry re-runs the resolve once and can turn error into found (J-C14)", async () => {
      search.mockReturnValueOnce(fail(500) as any).mockReturnValueOnce(ok([recordA]) as any);
      beginPermalinkFromUrl(linkQuery(), "default");
      await resolveActivePermalink();
      expect(permalinkBanner.value?.state).toBe("error");
      await retryPermalinkResolve();
      expect(search).toHaveBeenCalledTimes(2);
      expect(permalinkBanner.value?.state).toBe("found");
      expect(sharedLineRecord.value).toEqual(recordA);
    });

    it("a clear while the resolve is pending aborts it and the late answer changes nothing (J-C19)", async () => {
      let answer: (value: unknown) => void = () => undefined;
      search.mockReturnValue(new Promise((resolve) => (answer = resolve)) as any);
      beginPermalinkFromUrl(linkQuery(), "default");
      const pending = resolveActivePermalink();
      const signal = (search.mock.calls[0][0] as any).signal as AbortSignal;
      clearPermalink();
      expect(signal.aborted).toBe(true);
      answer({ status: 200, data: { hits: [recordA], is_partial: false } });
      await pending;
      expect(sharedLineRecord.value).toBeNull();
      expect(permalinkBanner.value).toBeNull();
    });
  });
});
