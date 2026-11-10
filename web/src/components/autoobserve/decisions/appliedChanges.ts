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

import { computed, ref, type MaybeRefOrGetter, toValue } from "vue";
import type { DecisionView, FieldChange } from "@/services/autoobserveDecisions";
import type { ApplySuggestion } from "@/components/alert_calibration/applySuggestion";

/** What "Review change" opens: the finding, its alert and the change the finding stores. */
export interface ReviewChangeTarget {
  findingId: string;
  alertId: string;
  alertName: string;
  action: ApplySuggestion;
}

/** One apply shown in What I've changed, from the server's list or from this session's writes. */
export interface AppliedEntry {
  org: string;
  view: DecisionView;
  title: string;
  fields: FieldChange[];
  /** The changed alert, when the write knew it and the view does not carry it. */
  alertId?: string;
}

// Applies written from this browser, so an older server that lists none still shows them until reload.
const session = ref<AppliedEntry[]>([]);

export const recordApplied = (entry: AppliedEntry): void => {
  session.value = [
    entry,
    ...session.value.filter((e) => e.view.decision_id !== entry.view.decision_id),
  ];
};

/** Marks applies undone at the revision the undo returned; a server row joins the session, so it stays Undone after the list drops it. */
export const markUndone = (
  items: { org: string; view: DecisionView; title: string | null }[],
): void => {
  let next = session.value;
  for (const { org, view, title } of items) {
    if (view.action !== "apply") continue;
    const undone = { ...view, state: "undone" as const };
    const known = next.find((e) => e.view.decision_id === view.decision_id && e.org === org);
    const entry: AppliedEntry = {
      org,
      view: undone,
      title: title ?? view.change?.alert.title ?? known?.title ?? "",
      fields: view.change?.fields ?? known?.fields ?? [],
      ...(known?.alertId ? { alertId: known.alertId } : {}),
    };
    next = known ? next.map((e) => (e === known ? entry : e)) : [entry, ...next];
  }
  session.value = next;
};

export const clearAppliedSession = (): void => {
  session.value = [];
};

/** The org's applies: the server's list and this session's rows, one per decision id, the higher revision winning and this session's on a tie. */
export const useAppliedChanges = (
  org: MaybeRefOrGetter<string>,
  listed: MaybeRefOrGetter<DecisionView[]>,
) =>
  computed<AppliedEntry[]>(() => {
    const current = toValue(org);
    const rows = new Map<string, AppliedEntry>();
    for (const e of session.value) if (e.org === current) rows.set(e.view.decision_id, e);
    for (const view of toValue(listed)) {
      if (view.action !== "apply" || !view.change) continue;
      const mine = rows.get(view.decision_id);
      if (mine && mine.view.revision >= view.revision) continue;
      rows.set(view.decision_id, {
        org: current,
        view,
        title: view.change.alert.title || view.subject?.title || "",
        fields: view.change.fields,
      });
    }
    return [...rows.values()].sort((a, b) => b.view.decided_at - a.view.decided_at);
  });
