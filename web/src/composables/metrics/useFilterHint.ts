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

import { computed, type Ref } from "vue";
import { useTypewriterPlaceholder } from "@/components/ai-assistant/welcome/useTypewriterPlaceholder";

/**
 * The typewriter hint on the empty filter row.
 *
 * Prefers the org's REAL label names — the way the Logs editor's placeholder is
 * generated from real stream fields rather than invented copy — and falls back to
 * static examples until they exist.
 *
 * The fallback is the common case, and deliberately so: label names are fetched
 * lazily, on the first click of `+ Filter` (`@focus-picker`), because the call
 * walks up to three widening time windows against a backend that already times
 * out on heavy metrics. Firing that on every page load to animate a hint would
 * be a bad trade. So the row teaches the SHAPE of a filter for free, and sharpens
 * itself into real names once the user has opened the picker once.
 */

/**
 * Matcher shapes, not real labels — examples of syntax, so they do not pretend
 * to be this org's data.
 *
 * Two of the four demonstrate ALTERNATION (`a|b`) rather than just regex,
 * because that is the one thing the UI cannot otherwise teach: chips are ANDed,
 * PromQL has no selector-level OR, and this engine rejects `or` matchers — so
 * `=~ "500|503"` is the ONLY way to say "either of these", and nothing else on
 * screen would ever show a user that. A bare `5..` proves regex works but leaves
 * the question they actually have unanswered.
 */
const EXAMPLES = [
  'pod = "api-1"',
  'status =~ "500|503"',
  'job != "canary"',
  'pod =~ "api-1|api-2"',
];

/** Each prompt costs ~2-4s to type, hold and erase; more is never reached. */
const MAX_PROMPTS = 4;

export function useFilterHint(
  /** Label names from the grid's schema; empty until the picker is first opened. */
  labelNames: Ref<string[]>,
  /** Paused unless the row is idle and unfiltered — see the call site. */
  enabled: Ref<boolean>,
) {
  const prompts = computed(() => {
    const names = labelNames.value;
    if (!names.length) return EXAMPLES;

    // Evenly spaced, not the first N: names arrive sorted, so the head is often
    // a run of one prefix (`__name__`, `_o2_*`) and the user would see only that
    // family typed out.
    const step = Math.max(1, Math.floor(names.length / MAX_PROMPTS));
    const picked: string[] = [];
    for (let i = 0; i < names.length && picked.length < MAX_PROMPTS; i += step) {
      picked.push(`${names[i]} = …`);
    }
    return picked.length ? picked : EXAMPLES;
  });

  return useTypewriterPlaceholder(prompts, { enabled });
}
