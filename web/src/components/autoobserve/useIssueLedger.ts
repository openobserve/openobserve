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

import { computed, reactive, type Ref } from "vue";
import { raw, type TranslateFn } from "@/types/i18n";
import { DEMO_NOW, scenarioFacts, type Scenario } from "./data/facts";
import { allLedger, issueByIncidentId, ledgerFor, type LedgerEntry } from "./fixtures";
import { overridesFor } from "./v2/fixtures";
import { useDecisions } from "./v2/useDecisions";

// One state per entry id, shared by both views, so an edit made in either is seen in the other.
let entries: Record<string, LedgerEntry> | undefined;

// The issue panel's ledger and its approve, reject and undo wiring, the same in both views.
export const useIssueLedger = (scenario: Ref<Scenario>, t: TranslateFn) => {
  entries ??= reactive(Object.fromEntries(allLedger(t).map((e) => [e.id, e])));
  const local = entries;
  const store = useDecisions();
  const overrides = computed(() => overridesFor(scenario.value, store.decisions, store.phases));
  const requestIds = computed(
    () => new Set(scenarioFacts(scenario.value).requests.map((r) => r.ledgerId)),
  );

  const decisionNote = (id: string) => {
    if (store.decisions[id] === "no") return t("autoobserve.activity.declinedNote");
    const phase = store.phases[id];
    if (phase === "fixing") return t("autoobserve.activity.applyingNote", { time: raw(DEMO_NOW) });
    if (phase === "fixed") return t("autoobserve.activity.appliedNote", { time: raw(DEMO_NOW) });
    return t("autoobserve.activity.approvedNote", { time: raw(DEMO_NOW) });
  };

  // Requests answered in either view show the viewer's decision, from the shared store.
  const withDecision = (entry: LedgerEntry): LedgerEntry => {
    const decision = store.decisions[entry.id];
    if (!requestIds.value.has(entry.id) || !decision) return entry;
    return {
      ...entry,
      status: decision === "yes" ? "approved" : "rejected",
      note: decisionNote(entry.id),
      decided: true,
    };
  };

  const ledger = computed(() => ledgerFor(scenario.value, t).map((e) => withDecision(local[e.id])));

  const updateEntry = (id: string, patch: Partial<LedgerEntry>) => {
    if (!requestIds.value.has(id)) {
      local[id] = { ...local[id], ...patch };
      return;
    }
    // A request's status and note come from the shared store; only an edited proposal is kept here.
    const status = patch.status;
    if (patch.after) local[id] = { ...local[id], after: patch.after };
    if (status === "approved") store.decide(id, "yes");
    else if (status === "rejected") store.decide(id, "no");
    else if (status === "awaiting") store.undo(id);
  };

  const issueByIncident = (incidentId: string) =>
    issueByIncidentId(incidentId, t, overrides.value.fixed);

  return { overrides, ledger, updateEntry, issueByIncident };
};
