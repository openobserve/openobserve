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

import { raw, type I18nKey } from "@/types/i18n";

import { diffCounts } from "../../lineDiff";
import {
  PROPOSAL_LANGUAGE_NAMES,
  proposalFor,
  type ProposalDecision,
  type ProposalLanguage,
} from "../../useEditorProposal";
import { registerApplier, type Applier } from "../registry";
import type { AssistantAction } from "../types";

type InsertAction = Extract<AssistantAction, { kind: "insert_into_editor" }>;

/** What the query block shows after the user decided in the editor. */
export interface InsertOutcome {
  decision: ProposalDecision;
  /** Set when the editor kept some of its own fields back (the JSON editor's protected fields). */
  note: I18nKey | null;
}

const ANNOUNCED: Partial<Record<ProposalDecision, I18nKey>> = {
  accepted: "assistant.diff.applied",
  no_change: "assistant.helper.noChange",
  discarded: "assistant.helper.discarded",
};

/** Insert as diff: the editor shows the proposal and nothing lands, runs or saves until the user accepts there. */
export const editorApplier: Applier<InsertAction> = async (sid, action, env) => {
  // The inline helper's hosts come with their own package; until then only a docked editor takes a proposal.
  if (action.hostId === "inline") return { ok: false, reason: "needs_host" };
  const host = env.hosts.get(action.hostId);
  const proposal = proposalFor(action.hostId);
  if (!host || !proposal || host.language !== action.language)
    return { ok: false, reason: "needs_host" };
  const handle = await proposal.propose(action.text, {
    mode: action.mode,
    provenance: action.provenance,
    canRun: !!host.run,
  });
  const shown = proposal.pending.value;
  if (shown) announceProposal(env, sid, shown.language, shown.before, shown.after);
  const decision = await handle.decision;
  const spoken = ANNOUNCED[decision];
  if (spoken) env.store().announce(sid, spoken);
  const note = decision === "accepted" ? (proposal.label.value?.note ?? null) : null;
  const outcome: InsertOutcome = { decision, note };
  return { ok: true, detail: outcome };
};

export function registerEditorAppliers(): void {
  registerApplier("insert_into_editor", editorApplier);
}

// Said once, as the diff opens: what changed in counts, never the text itself.
function announceProposal(
  env: Parameters<Applier<InsertAction>>[2],
  sid: string,
  language: ProposalLanguage,
  before: string,
  after: string,
): void {
  const name = raw(PROPOSAL_LANGUAGE_NAMES[language]);
  const counts = diffCounts(before, after);
  if (counts) env.store().announce(sid, "assistant.diff.announce", { language: name, ...counts });
  else env.store().announce(sid, "assistant.diff.title", { language: name });
}
