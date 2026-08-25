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

/**
 * "How old is this?" — the staleness reading behind the DBM refresh control.
 *
 * The app already answers this in `lib/core/RefreshButton/ORefreshButton.vue`:
 * a relative time that re-renders on a timer, a dot whose colour crosses at 30s
 * and 5min, and an exact clock time on hover. DBM does not ADOPT that component
 * (see DbmRefreshButton.vue for why the geometry does not survive the
 * `#toolbar-trailing` slot), so the risk is that it grows a SECOND, subtly
 * different answer to the same question — a different threshold, a different
 * phrase — and the same data reads as fresh on one screen and stale on another.
 *
 * So the READING lives here and both presentations consume it. The thresholds
 * and the copy keys are `ORefreshButton`'s own, verbatim: this is deliberately
 * not a new staleness model, it is the existing one made reusable.
 *
 * The ticker is what makes the label honest without a fetch. A relative time
 * rendered once says "just now" forever — the number would be wrong within a
 * minute, and wrong in the direction that matters (claiming fresh data when it
 * is minutes old). It re-renders on the same 10s cadence ORefreshButton uses.
 */

import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";

import { useI18nTyped, type I18nText } from "@/types/i18n";

/** How often the relative label re-renders. ORefreshButton's own cadence. */
const TICK_MS = 10_000;

/** Green below this many seconds. */
const FRESH_SECONDS = 30;
/** Amber below this; red at or above it. */
const STALE_SECONDS = 300;

/** The dot's colour classes, by staleness band. ORefreshButton's tokens. */
const DOT_FRESH = "bg-refresh-dot-fresh";
const DOT_STALE = "bg-refresh-dot-stale";
const DOT_CRITICAL = "bg-refresh-dot-critical";
const DOT_IDLE = "bg-refresh-dot-idle";

export interface DbmLastRefreshedOptions {
  /** Epoch milliseconds of the last SUCCESSFUL load, or null before the first. */
  lastRunAt: Ref<number | null | undefined>;
  /** Suppresses the staleness verdict while a fetch is in flight. */
  loading?: Ref<boolean | undefined>;
}

export interface DbmLastRefreshedReturn {
  /** e.g. "just now", "45s ago", "3m ago". Empty before the first load. */
  relative: Ref<string>;
  /** The dot's colour class for the current band. */
  dotClass: Ref<string>;
  /** What the dot means, in words — the dot alone encodes nothing to a reader. */
  dotLabel: Ref<I18nText>;
  /** "Last refreshed: 14:02:11", or the not-yet phrase. For the hover text. */
  exact: Ref<I18nText>;
  /** Whether there is a timestamp to show at all. */
  hasRun: Ref<boolean>;
}

export function useDbmLastRefreshed({
  lastRunAt,
  loading,
}: DbmLastRefreshedOptions): DbmLastRefreshedReturn {
  const { t } = useI18nTyped();

  /**
   * Bumped by the ticker to re-evaluate the computeds below.
   *
   * The elapsed time is a function of the CLOCK, which Vue cannot track — so
   * without an explicit reactive input every computed here would be cached at
   * its first read and the label would freeze at "just now". This ref is that
   * input: nothing reads its value, only its version.
   */
  const tick = ref(0);

  const elapsedSeconds = (): number => {
    void tick.value;
    const at = lastRunAt.value;
    if (!at) return Infinity;
    return Math.floor((Date.now() - at) / 1000);
  };

  const hasRun = computed(() => !!lastRunAt.value);

  const relative = computed(() => {
    if (!lastRunAt.value) return "";
    const sec = elapsedSeconds();
    if (sec < 5) return t("refreshButton.justNow");
    if (sec < 60) return t("refreshButton.secondsAgo", { sec });
    const min = Math.floor(sec / 60);
    if (min < 60) return t("refreshButton.minutesAgo", { min });
    return t("refreshButton.hoursAgo", { h: Math.floor(min / 60) });
  });

  const dotClass = computed(() => {
    // A fetch in flight is not a staleness state — the answer is being
    // replaced, so colouring it red would flag as stale exactly the data that
    // is mid-refresh.
    if (loading?.value) return DOT_IDLE;
    const sec = elapsedSeconds();
    if (sec === Infinity) return DOT_IDLE;
    if (sec < FRESH_SECONDS) return DOT_FRESH;
    if (sec < STALE_SECONDS) return DOT_STALE;
    return DOT_CRITICAL;
  });

  const dotLabel = computed<I18nText>(() => {
    const sec = elapsedSeconds();
    if (sec === Infinity) return t("refreshButton.notYetRefreshed");
    if (sec < FRESH_SECONDS) return t("refreshButton.dataFresh");
    if (sec < STALE_SECONDS) return t("refreshButton.dataGettingStale");
    return t("refreshButton.dataStale");
  });

  const exact = computed<I18nText>(() => {
    const at = lastRunAt.value;
    if (!at) return t("refreshButton.notYetRefreshed");
    return t("refreshButton.lastRefreshed", { time: new Date(at).toLocaleTimeString() });
  });

  let timer: ReturnType<typeof setInterval> | null = null;

  onMounted(() => {
    timer = setInterval(() => {
      tick.value += 1;
    }, TICK_MS);
  });

  onBeforeUnmount(() => {
    if (timer) clearInterval(timer);
    timer = null;
  });

  // A new timestamp must re-read immediately rather than waiting out the
  // remainder of the current tick — otherwise a refresh the reader just clicked
  // can still show the previous "5m ago" for several seconds.
  watch(lastRunAt, () => {
    tick.value += 1;
  });

  return { relative, dotClass, dotLabel, exact, hasRun };
}
