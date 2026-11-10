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
import { effectScope, nextTick, ref } from "vue";
import "@/locales";
import { gt, raw } from "@/types/i18n";
import {
  coverageSentence,
  coverageWord,
  agoText,
  checkedView,
  durationText,
  emptyCoverageNotice,
  formatDay,
  formatWhen,
  liveCellLook,
  liveCellWord,
  liveFailureOf,
  liveGapLines,
  liveLookWord,
  liveLoadText,
  liveNotice,
  liveSurfaceEmpty,
  moreCount,
  moreText,
  refreshFailedText,
  seeAllText,
  todayText,
  userTimeZone,
  whereText,
  type LiveFailure,
} from "./liveCopy";
import {
  SKELETON_DELAY_MS,
  SKELETON_HOLD_MS,
  keepSameOrg,
  stateOf,
  useHeldSkeleton,
  useKeptFailure,
  useLoadPhase,
} from "./liveModel";
import type { SourceState, SourceStatus } from "./liveAdapter";

const httpError = (status: number) => ({
  response: { status, data: { message: `status ${status}` } },
});

// 2026-10-30T02:30:00Z: still Oct 29 west of UTC, already Oct 30 east of it.
const LOST_AT_US = Date.UTC(2026, 9, 30, 2, 30) * 1000;

describe("liveFailureOf / liveNotice", () => {
  it("maps 403 to a red denial that names the alerts permission and offers no retry", () => {
    expect(liveFailureOf(httpError(403))).toBe("denied");
    const notice = liveNotice(gt, "coverage", "denied");
    expect(notice).toMatchObject({ severity: "error", retry: false, details: false, icon: "lock" });
    expect(notice.title).toBe("You don't have permission to see coverage");
  });

  it("the denial names the missing org-wide permission", () => {
    const notice = liveNotice(gt, "coverage", "denied");
    expect(notice).toMatchObject({ severity: "error", retry: false, details: false });
    expect(notice.description).toContain("all alerts in this organization");
    expect(notice.description).toContain("not only some folders");
    expect(notice.description).toContain("Ask an organization admin for it.");
  });

  it("maps 404 to a neutral 'not turned on' state with no retry", () => {
    expect(liveFailureOf(httpError(404))).toBe("off");
    const notice = liveNotice(gt, "coverage", "off");
    expect(notice).toMatchObject({ severity: "neutral", retry: false, details: false });
    expect(notice.title).toBe("AutoObserve isn't turned on");
  });

  it("maps 503 to a red, retryable 'temporarily unavailable' state", () => {
    expect(liveFailureOf(httpError(503))).toBe("unavailable");
    const notice = liveNotice(gt, "coverage", "unavailable");
    expect(notice).toMatchObject({ severity: "error", retry: true, details: false });
    expect(notice.title).toBe("Coverage is temporarily unavailable");
  });

  it("maps any other failure, a network error included, to red with Retry and Details", () => {
    expect(liveFailureOf(httpError(500))).toBe("failed");
    expect(liveFailureOf(new Error("Network Error"))).toBe("failed");
    expect(liveFailureOf(undefined)).toBe("failed");
    const notice = liveNotice(gt, "suggestions", "failed");
    expect(notice).toMatchObject({ severity: "error", retry: true, details: true });
    expect(notice.title).toBe("Couldn't load suggestions");
  });
});

describe("stateOf", () => {
  const query = (data: unknown, error: unknown) => ({
    data: ref(data),
    isError: ref(!!error),
    error: ref(error),
    errorUpdatedAt: ref(2_000),
    dataUpdatedAt: ref(1_000),
    isFetching: ref(fetching),
  });
  let fetching = false;
  const retry = () => undefined;

  it("marks a retry in flight as busy, so Retry can show it is running", () => {
    fetching = true;
    expect(stateOf(query(undefined, httpError(500)), retry)).toMatchObject({
      status: "error",
      busy: true,
    });
    fetching = false;
    expect(stateOf(query(undefined, httpError(500)), retry).busy).toBe(false);
  });

  it("treats a failed first load as an error with its cause", () => {
    expect(stateOf(query(undefined, httpError(503)), retry)).toMatchObject({
      status: "error",
      failure: "unavailable",
      stale: null,
    });
  });

  it("keeps the old content on a failed refresh and marks it stale with both times", () => {
    expect(stateOf(query({ rows: [] }, httpError(500)), retry)).toMatchObject({
      status: "ready",
      failure: "failed",
      stale: { failedAt: 2_000, dataAt: 1_000 },
    });
  });
});

describe("coverageSentence", () => {
  const say = (total: number, gaps: number) => coverageSentence(gt, "en-US", { total, gaps });

  it("is silent with no rows", () => {
    expect(say(0, 0)).toBeNull();
  });

  it("reads right for one service", () => {
    expect(say(1, 0)).toBe("I'm watching your 1 service.");
    expect(say(1, 1)).toBe("Your 1 service has a coverage gap.");
  });

  it("reads right for a few services", () => {
    expect(say(4, 1)).toBe("I'm watching 3 of your 4 services. 1 has a coverage gap.");
    expect(say(3, 0)).toBe("I'm watching all 3 of your services.");
    expect(say(3, 3)).toBe("All 3 of your services have a coverage gap.");
  });

  it("reads right for many services, with grouped digits", () => {
    expect(say(240, 54)).toBe("I'm watching 186 of your 240 services. 54 have a coverage gap.");
    expect(say(1240, 2)).toBe("I'm watching 1,238 of your 1,240 services. 2 have a coverage gap.");
  });

  it("never uses the fixture vocabulary", () => {
    for (const [total, gaps] of [
      [1, 0],
      [4, 1],
      [240, 240],
    ])
      expect(say(total, gaps)).not.toMatch(/can't see|learning|fully watched/i);
  });
});

describe("the 'and N more' line", () => {
  it("counts what the rail leaves out", () => {
    expect(moreCount(12, 5)).toBe(7);
    expect(moreText(gt, "en-US", 12, 5)).toBe("and 7 more");
    expect(moreText(gt, "en-US", 6, 5)).toBe("and 1 more");
    expect(seeAllText(gt, "en-US", 3000)).toBe("See all");
  });

  it("shows no line when everything fits", () => {
    expect(moreText(gt, "en-US", 5, 5)).toBeNull();
    expect(moreText(gt, "en-US", 3, 3)).toBeNull();
    expect(moreText(gt, "en-US", 0, 0)).toBeNull();
  });
});

describe("dates and times in the viewer's timezone", () => {
  it("formats the loss day in the given zone, east and west of UTC", () => {
    expect(formatDay(LOST_AT_US, "en-US", "Asia/Kolkata")).toBe("Oct 30, 2026");
    expect(formatDay(LOST_AT_US, "en-US", "America/Los_Angeles")).toBe("Oct 29, 2026");
  });

  it("falls back to the browser zone for a setting Intl rejects", () => {
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(userTimeZone("Not/AZone")).toBe(browser);
    expect(userTimeZone("")).toBe(browser);
    expect(userTimeZone("America/New_York")).toBe("America/New_York");
  });

  it("names both times of a failed refresh in the viewer's zone", () => {
    const stale = { failedAt: Date.UTC(2026, 10, 1, 9, 2), dataAt: Date.UTC(2026, 10, 1, 8, 57) };
    const now = Date.UTC(2026, 10, 1, 9, 5);
    expect(refreshFailedText(gt, "en-GB", "Asia/Kolkata", "suggestions", stale, now)).toBe(
      "Refresh failed at 14:32 · showing suggestions from 14:27",
    );
  });

  it("adds the date to a time that isn't today in the viewer's zone", () => {
    const now = Date.UTC(2026, 10, 2, 9, 0);
    expect(formatWhen(Date.UTC(2026, 10, 2, 8, 0), "en-GB", "UTC", now)).toBe("08:00");
    expect(formatWhen(Date.UTC(2026, 10, 1, 8, 0), "en-GB", "UTC", now)).toBe("1 Nov 2026, 08:00");
    const stale = { failedAt: Date.UTC(2026, 10, 2, 8, 59), dataAt: Date.UTC(2026, 10, 1, 8, 0) };
    expect(refreshFailedText(gt, "en-GB", "UTC", "coverage", stale, now)).toBe(
      "Refresh failed at 08:59 · showing coverage from 1 Nov 2026, 08:00",
    );
  });

  it("decides 'today' in the viewer's zone, not the browser's", () => {
    const now = Date.UTC(2026, 10, 2, 0, 30);
    const at = Date.UTC(2026, 10, 1, 23, 50);
    expect(formatWhen(at, "en-GB", "UTC", now)).toBe("1 Nov 2026, 23:50");
    expect(formatWhen(at, "en-GB", "Asia/Kolkata", now)).toBe("05:20");
  });
});

describe("durations and the empty coverage notice", () => {
  it("reads a minute count as the largest whole unit", () => {
    expect(durationText("en-US", 1)).toBe("1 minute");
    expect(durationText("en-US", 45)).toBe("45 minutes");
    expect(durationText("en-US", 1439)).toBe("23 hours");
    expect(durationText("en-US", 2 * 1440 + 5)).toBe("2 days");
  });

  it("says just now below a minute, and the largest whole unit ago above it", () => {
    expect(agoText(gt, "en-US", 0)).toBe("just now");
    expect(agoText(gt, "en-US", 1)).toBe("1 minute ago");
    expect(agoText(gt, "en-US", 120)).toBe("2 hours ago");
    expect(emptyCoverageNotice(gt, "en-US", 0).description).toContain(
      "My last check, just now, found no services.",
    );
  });

  it("tells 'no check yet' from 'a check found nothing', with a readable age", () => {
    expect(emptyCoverageNotice(gt, "en-US", null).title).toBe(
      "No check has finished in the last day",
    );
    const found = emptyCoverageNotice(gt, "en-US", 1439);
    expect(found.title).toBe("No services found yet");
    expect(found.description).toContain("My last check, 23 hours ago, found no services.");
    expect(found).toMatchObject({ severity: "neutral", retry: false });
  });

  it("names the two live states with the approved words", () => {
    expect(coverageWord(gt, "watched")).toBe("Watched");
    expect(coverageWord(gt, "gap")).toBe("Coverage gap");
  });
});

describe("loading announcements", () => {
  it("says loading, then loaded, per surface", () => {
    expect(liveLoadText(gt, "coverage", "loading")).toBe("Loading coverage");
    expect(liveLoadText(gt, "coverage", "loaded")).toBe("Coverage loaded");
    expect(liveLoadText(gt, "suggestions", "loaded")).toBe("Suggestions loaded");
    expect(liveLoadText(gt, "suggestions", "idle")).toBe("");
  });

  it("announces loaded only after a load that ends in content", async () => {
    const scope = effectScope();
    const status = ref<SourceStatus>("loading");
    const skeleton = ref(false);
    const phase = scope.run(() => useLoadPhase(() => status.value, skeleton))!;
    expect(phase.value).toBe("idle");
    skeleton.value = true;
    expect(phase.value).toBe("loading");
    status.value = "error";
    skeleton.value = false;
    await nextTick();
    expect(phase.value).toBe("idle");
    status.value = "ready";
    await nextTick();
    expect(phase.value).toBe("loaded");
    scope.stop();
  });
});

describe("useHeldSkeleton", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const held = () => {
    vi.useFakeTimers();
    const busy = ref(true);
    const scope = effectScope();
    const shown = scope.run(() => useHeldSkeleton(busy))!;
    return { busy, shown, scope };
  };

  it("never shows for a wait shorter than the delay", async () => {
    const { busy, shown, scope } = held();
    vi.advanceTimersByTime(SKELETON_DELAY_MS - 10);
    busy.value = false;
    await nextTick();
    vi.advanceTimersByTime(SKELETON_DELAY_MS);
    expect(shown.value).toBe(false);
    scope.stop();
  });

  it("shows after the delay and holds for the minimum once shown", async () => {
    const { busy, shown, scope } = held();
    vi.advanceTimersByTime(SKELETON_DELAY_MS);
    expect(shown.value).toBe(true);
    vi.advanceTimersByTime(50);
    busy.value = false;
    await nextTick();
    expect(shown.value).toBe(true);
    vi.advanceTimersByTime(SKELETON_HOLD_MS - 60);
    expect(shown.value).toBe(true);
    vi.advanceTimersByTime(20);
    expect(shown.value).toBe(false);
    scope.stop();
  });

  it("stays up without a flash when the source turns busy again during the hold", async () => {
    const { busy, shown, scope } = held();
    vi.advanceTimersByTime(SKELETON_DELAY_MS);
    busy.value = false;
    await nextTick();
    busy.value = true;
    await nextTick();
    vi.advanceTimersByTime(SKELETON_HOLD_MS * 3);
    expect(shown.value).toBe(true);
    scope.stop();
  });
});

describe("useKeptFailure", () => {
  const at = (status: SourceStatus, failure: LiveFailure | null = null): Required<SourceState> => ({
    status,
    retry: () => undefined,
    busy: status === "loading",
    failure,
    detail: raw(""),
    stale: null,
  });

  it("keeps a failure up over another page's placeholder rows, and drops it for real ones", async () => {
    const scope = effectScope();
    const state = ref(at("error", "failed"));
    const placeholder = ref(false);
    const kept = scope.run(() =>
      useKeptFailure(
        () => state.value,
        () => "acme",
        () => placeholder.value,
      ),
    )!;
    placeholder.value = true;
    state.value = at("ready");
    await nextTick();
    expect(kept.value).toMatchObject({ status: "error", failure: "failed", busy: true });
    placeholder.value = false;
    state.value = { ...at("ready") };
    await nextTick();
    expect(kept.value.status).toBe("ready");
    scope.stop();
  });

  it("keeps a failure up, busy, while its retry runs, and drops it for content or another org", async () => {
    const scope = effectScope();
    const state = ref(at("error", "unavailable"));
    const org = ref("acme");
    const kept = scope.run(() =>
      useKeptFailure(
        () => state.value,
        () => org.value,
      ),
    )!;
    state.value = at("loading");
    expect(kept.value).toMatchObject({ status: "error", failure: "unavailable", busy: true });
    state.value = at("ready");
    await nextTick();
    expect(kept.value.status).toBe("ready");
    state.value = at("loading");
    expect(kept.value.status).toBe("loading");
    state.value = at("error", "failed");
    await nextTick();
    state.value = at("loading");
    org.value = "beta";
    await nextTick();
    expect(kept.value.status).toBe("loading");
    scope.stop();
  });
});

describe("keepSameOrg", () => {
  it("keeps the previous page for the same org and drops it for another", () => {
    const previous = { total: 12 };
    const query = (org: string) => ({ queryKey: ["org", org, "autoobserve"] as const });
    expect(keepSameOrg("acme")(previous, query("acme"))).toBe(previous);
    expect(keepSameOrg("beta")(previous, query("acme"))).toBeUndefined();
    expect(keepSameOrg("acme")(previous, undefined)).toBeUndefined();
  });
});

describe("liveGapLines (the drawer's line for a gap)", () => {
  const check = (stateKey: string, reason?: string) => ({
    state: "gap" as const,
    reason: reason ? raw(reason) : undefined,
    engine: { state: raw(stateKey), stateKey: stateKey as never, monitors: [] },
  });

  it("keeps each falling-short check's own reason and groups the ones with no monitor", () => {
    const lines = liveGapLines(gt, "en-US", {
      errors: check("silent", "Errors: e matches, but it notifies no one"),
      latency: check("none"),
      absence: check("none"),
    });
    expect(lines).toEqual([
      "Errors: e matches, but it notifies no one",
      "No alert watches its latency or whether it stops sending",
    ]);
  });

  it("says which checks were just added instead of calling them unwatched (T2-N1)", () => {
    const lines = liveGapLines(
      gt,
      "en-US",
      { errors: check("none"), latency: check("none"), absence: check("none") },
      new Set(["errors", "absence"] as const),
    );
    expect(lines).toEqual([
      "No alert watches its latency",
      "Added alerts for its errors and whether it stops sending. AutoObserve counts them at its next check.",
    ]);
    expect(
      liveGapLines(
        gt,
        "en-US",
        { errors: check("none"), latency: check("covered"), absence: check("covered") },
        new Set(["errors"] as const),
      ),
    ).toEqual(["Added an alert for its errors. AutoObserve counts it at its next check."]);
  });

  it("names the key's dots with the page's two state words", () => {
    expect(liveLookWord(gt, "covered")).toBe("Watched");
    expect(liveLookWord(gt, "gap")).toBe("Coverage gap");
  });

  it("uses only Watched and Coverage gap for a service or check state, never older words", () => {
    const words = [
      gt("autoobserveLive.states.covered"),
      gt("autoobserveLive.suggestions.kinds.coverage_gap"),
      gt("insight.kind.chip.notWatched"),
      gt("autoobserve.coverage.badgeNotWatched"),
    ];
    expect(words).toEqual(["Watched", "Coverage gap", "Coverage gap", "Coverage gap"]);
  });
});

describe("liveCellWord / liveCellLook (the coverage table's cells)", () => {
  it("says Watched, or Coverage gap whether no alert matches or an alert falls short", () => {
    expect(liveCellWord(gt, "covered")).toBe("Watched");
    expect(liveCellWord(gt, "none")).toBe("Coverage gap");
    expect(liveCellWord(gt, "silent")).toBe("Coverage gap");
    expect(liveCellWord(gt, "blind")).toBe("Coverage gap");
    expect(liveCellWord(gt, "none", true)).toBe("Added");
  });

  it("draws covered green and every gap with the one amber", () => {
    expect(liveCellLook("covered")).toBe("covered");
    expect(
      ["none", "weak", "silent", "blind", "unmapped"].map((s) => liveCellLook(s as never)),
    ).toEqual(["gap", "gap", "gap", "gap", "gap"]);
  });
});

describe("the live top bar", () => {
  // 2026-11-05T23:30Z: still Thursday in UTC, already Friday in India.
  const NOW_MS = Date.UTC(2026, 10, 5, 23, 30);
  const ready = (passMinutes: number | null) => ({ status: "ready" as const, passMinutes });

  it("today is the viewer's date in the viewer's zone", () => {
    expect(todayText("en-US", "UTC", NOW_MS)).toBe("Thursday, November 5");
    expect(todayText("en-US", "Asia/Kolkata", NOW_MS)).toBe("Friday, November 6");
  });

  it("the check slot follows the coverage pass", () => {
    expect(checkedView(gt, "en-US", { status: "loading", passMinutes: null })).toEqual({
      kind: "loading",
    });
    expect(checkedView(gt, "en-US", ready(0))).toEqual({ kind: "text", text: "Checked just now" });
    expect(checkedView(gt, "en-US", ready(12))).toEqual({
      kind: "text",
      text: "Checked 12 minutes ago",
    });
    expect(checkedView(gt, "en-US", ready(null))).toEqual({
      kind: "text",
      text: "First check in progress",
    });
    expect(checkedView(gt, "en-US", { status: "error", passMinutes: 12 })).toEqual({
      kind: "none",
    });
  });
});

describe("whereText (a service's Kubernetes location)", () => {
  it("whereText reads every location shape", () => {
    expect(whereText(gt, "prod", "payments")).toBe("prod / payments");
    expect(whereText(gt, "prod", "")).toBe("prod");
    expect(whereText(gt, "", "payments")).toBe("payments");
    expect(whereText(gt, "", "")).toBeNull();
    expect(whereText(gt, undefined, null)).toBeNull();
  });

  it("each live empty surface is neutral, says what will appear and offers one next step", () => {
    const seen = new Set<string>();
    for (const surface of ["changes", "history", "settings"] as const) {
      const { notice, action } = liveSurfaceEmpty(gt, surface);
      expect(notice.severity, surface).toBe("neutral");
      expect(notice.retry, surface).toBe(false);
      expect(notice.details, surface).toBe(false);
      for (const text of [notice.title, notice.description, action])
        expect(String(text), surface).not.toMatch(/autoobserveLive\./);
      expect(String(notice.description), surface).toMatch(/will (appear|be|show)|shows here/);
      seen.add(String(notice.title));
    }
    expect(seen.size).toBe(3);
    expect(String(liveSurfaceEmpty(gt, "changes").action)).toBe("Review suggestions");
    expect(String(liveSurfaceEmpty(gt, "history").action)).toBe("Open issues");
    expect(String(liveSurfaceEmpty(gt, "settings").action)).toBe("How it works");
  });
});
