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

import { computed, type ComputedRef, type Ref, ref } from "vue";
import { gt, type I18nText } from "@/types/i18n";
import {
  EVIDENCE_GROUP_ORDER,
  evidenceGroupKind,
  type EvidenceEvent,
  type EvidenceGroup,
} from "@/composables/synthetics/syntheticResultsSchema";

/**
 * Three views, not five kind chips.
 *
 * The chips were one per anomaly kind — console errors, page errors, non-2xx,
 * failed requests — which asked the reader to pick a severity before they knew
 * what happened, and left the two that matter most (a page error, a failed
 * request) sitting in separate filters from the surfaces they belong to. The
 * split here is DevTools': what the page SAID (console, uncaught exceptions and
 * dialogs included) versus what it ASKED FOR (every request, the ones that never
 * completed included). Severity survives inside each view as the group sections,
 * which are already ordered worst-first.
 */
export type EvidenceView = "all" | "network" | "console";

export interface EvidenceViewOption {
  key: EvidenceView;
  label: I18nText;
  count: number;
}

const VIEW_GROUPS: Record<EvidenceView, EvidenceGroup["kind"][]> = {
  all: ["pageErrors", "requestsFailed", "console", "network"],
  network: ["requestsFailed", "network"],
  console: ["pageErrors", "console"],
};

/**
 * Shared state for the evidence toolbar (view / first-party-only / wrap), so
 * the run-level panel and the per-step card read one filter instead of two
 * that could drift apart.
 *
 * `events` arrive already named (`stepName` filled by the caller, e.g.
 * `foldEvidenceBundle`) and already scoped to whatever step filter is active;
 * this composable does not know about `stepDefs` or step scoping.
 *
 * `gt`, not `useI18nTyped`: this composable is constructed from a plain
 * `Ref`/`ComputedRef` of events, with no component dependency, so its own test
 * constructs it outside a component too — and `useI18n()` throws there.
 */
export function useEvidenceFilters(events: Ref<EvidenceEvent[]> | ComputedRef<EvidenceEvent[]>) {
  const t = gt;

  const view = ref<EvidenceView>("all");
  const firstPartyOnly = ref(false);
  /** Local, not persisted: the drawer is transient and closes with the run. */
  const wrap = ref(false);

  /** The one axis the tabs do not cover: whose code it was. */
  function matches(e: EvidenceEvent): boolean {
    return !firstPartyOnly.value || e.firstParty;
  }

  /**
   * Badge counts describe the ATTEMPT, not the current view: they are folded
   * before the first-party filter, so unchecking it never makes a number move
   * under the reader. Scoped to the step filter, though — a badge that counts the
   * run while the list shows one step is a lie, not a shortcut.
   */
  function countIn(kinds: EvidenceGroup["kind"][]): number {
    return events.value.filter((e) => kinds.includes(evidenceGroupKind(e))).length;
  }

  const views = computed<EvidenceViewOption[]>(() => [
    {
      key: "all",
      label: t("synthetics.evidence.filterAll"),
      count: events.value.length,
    },
    {
      key: "network",
      label: t("synthetics.evidence.groupNetwork"),
      count: countIn(VIEW_GROUPS.network),
    },
    {
      key: "console",
      label: t("synthetics.evidence.groupConsole"),
      count: countIn(VIEW_GROUPS.console),
    },
  ]);

  /**
   * One list for the view, in time order.
   *
   * Was one table PER GROUP KIND, which bought four pagination bars, four column
   * grids and four restarting timelines to say something the view toggle above
   * already says. Kind moved onto the row as a badge — the same conclusion step
   * attribution reached earlier, applied to the other axis.
   *
   * Chronological, not worst-first: one table means one timeline, and a timeline
   * that does not run in time order is not one. Severity survives per row (the
   * rail, the coloured status) and is one header click away.
   */
  const visibleEvents = computed(() =>
    events.value
      .filter((e) => VIEW_GROUPS[view.value].includes(evidenceGroupKind(e)))
      .filter(matches)
      .sort((a, b) => {
        const byTime = (a.initiatedTs ?? a.ts) - (b.initiatedTs ?? b.ts);
        // Tie-break worse-kind-first, which is what flat-mapping the folded
        // groups used to give implicitly — otherwise simultaneous events fall
        // in arrival order, which means nothing to the reader.
        return byTime !== 0
          ? byTime
          : EVIDENCE_GROUP_ORDER.indexOf(evidenceGroupKind(a)) -
              EVIDENCE_GROUP_ORDER.indexOf(evidenceGroupKind(b));
      }),
  );

  return { view, firstPartyOnly, wrap, views, visibleEvents };
}
