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

import http, { attemptTokenRefresh } from "./http";
import store from "@/stores";
import type {
  RcaBand,
  RcaConfidenceBreakdown,
  RcaEvidenceEntry,
  RcaSummaryHypothesis,
  RcaThread,
  RcaUnverifiedCitation,
} from "./incidents";

export type AutoResolveRunState =
  | "investigating"
  | "waiting_approval"
  | "proceeding"
  | "checking"
  | "worked"
  | "no_change"
  | "worse"
  | "declined"
  | "lapsed"
  | "step_failed"
  | "outcome_unknown"
  | "failed";

export type AutoResolveStepState =
  | "proposed"
  | "approved"
  | "running"
  | "done"
  | "failed"
  | "held"
  | "not_run"
  | "superseded"
  | "outcome_unknown";

export interface AutoResolveConnectionRef {
  id: string;
  /** The last known name; it stays after the connection is removed. */
  name: string;
  /** The connection was removed from the org; steps through it cannot run. */
  removed?: boolean;
}

export interface AutoResolveTrigger {
  kind: string;
  /** A sentence for free text: "Started by the alert X". */
  label: string;
  /** Who or what started it, for a slot already labelled "Started by": "the alert X". */
  by: string;
  /** The alert that started the run; null for a person-started run. */
  alert_id: string | null;
}

/** The server's cap on a run's connections, used until the summary says its own. */
export const DEFAULT_MAX_CONNECTIONS = 20;

/** `GET /summary`. */
export interface AutoResolveSummary {
  connections: (AutoResolveConnectionRef & { can_approve: boolean })[];
  region: string;
  triggers_fire_here: boolean;
  /** False when this deployment cannot post Slack approvals, so alert and incident triggers stay off. */
  slack_approval_available: boolean;
  /** How many connections one run may be given. */
  max_connections: number;
}

/** One row of `GET /runs`. */
export interface AutoResolveRunRow {
  id: string;
  goal: string;
  state: AutoResolveRunState;
  trigger: AutoResolveTrigger;
  requester: string;
  connections: AutoResolveConnectionRef[];
  created_at_us: number;
  ended_at_us: number | null;
  /** The run ended because no MCP of the run can make the fix its plan needs. */
  cant_fix: boolean;
  /** The run's re-read before its first approved step found the change no longer needed. */
  no_longer_needed: boolean;
}

/** Filters of `GET /runs`; `page` is 1-based. */
export interface AutoResolveRunQuery {
  /** Only the runs of this saved AutoResolve. */
  autoresolve_id?: string;
  /** Any of these states; sent as one comma list. */
  state?: AutoResolveRunState[];
  requester?: string;
  connection?: string;
  from_us?: number;
  to_us?: number;
  q?: string;
  page?: number;
  page_size?: number;
}

export interface AutoResolveRunList {
  runs: AutoResolveRunRow[];
  total: number;
}

export interface AutoResolveStepRef {
  arg_path: string;
  from_step: number;
  result_path: string;
}

export interface AutoResolveStep {
  id: string;
  seq: number;
  kind: "dry_run" | "change";
  connection: AutoResolveConnectionRef;
  tool: string;
  arguments: unknown;
  refs: AutoResolveStepRef[];
  reason: string;
  preview: string | null;
  dry_run_after_approval: boolean;
  state: AutoResolveStepState;
  result_summary: string | null;
  error: string | null;
  consumed_at_us: number | null;
  finished_at_us: number | null;
}

export interface AutoResolveOption {
  id: string;
  title: string;
  recommended: boolean;
  changes_production_directly: boolean;
  tradeoffs: string;
  reason: string;
  steps: AutoResolveStep[];
  /** A step goes through a removed connection, so this option cannot be approved. */
  uses_removed_connection?: boolean;
  /** What this option leaves undone or costs; such an option is never recommended. */
  partial_fix?: string | null;
  /** The live MCPs its steps use, once each in step order; approving changes these. */
  changes: AutoResolveChangedMcp[];
  /** The agent's claim capped by the cause's graded band; null for a plan without a cause. */
  band?: RcaBand | null;
  /** What the agent claimed for this option. */
  claimed?: RcaBand | null;
}

/** A change another run sent to one of this run's MCPs after this run's plan was made. */
export interface AutoResolveChangedBy {
  /** The MCP's name. */
  connection: string;
  run_id: string;
  at_us: number;
}

export interface AutoResolveChangedMcp {
  name: string;
  /** The first clause of the MCP's description when it is short; the server decides. */
  short_description: string | null;
}

/** The fix needs an org connection this run does not have (the plan's `needs <name>: <action>`). */
export interface AutoResolveMissingConnection {
  name: string;
  connection_id: string;
  action: string;
  /** The viewer may edit the AutoResolve and approve through this connection. */
  can_add: boolean;
  cannot_add_reason: string | null;
}

export interface AutoResolvePlan {
  fingerprint: string;
  options: AutoResolveOption[];
  omitted_count: number;
  omitted_reason: string | null;
  missing_capability: string | null;
  missing_connection?: AutoResolveMissingConnection | null;
  /** What the reads confirmed is wrong and why; null for a plan made before causes. */
  cause?: string | null;
  /** The cause's graded band; null without a cause or once the transcript is gone. */
  band?: RcaBand | null;
  confidence?: RcaConfidenceBreakdown | null;
  evidence?: RcaEvidenceEntry[];
  unverified?: RcaUnverifiedCitation[];
  /** h1 is the cause, then the alternatives the evidence ruled out. */
  hypotheses?: RcaSummaryHypothesis[];
}

/** One accepted plan of a run, as `plan_history` keeps it. */
export interface AutoResolvePlanRevision {
  revision: number;
  planned_at_us: number;
  cause: string | null;
  band: RcaBand | null;
  missing_capability: string | null;
  options: { id: string; title: string; band: RcaBand | null; partial_fix: string | null }[];
  /** Set once a replan moved the run past this plan: what was approved, ran and how it ended. */
  attempt?: AutoResolvePlanAttempt | null;
}

export interface AutoResolvePlanAttempt {
  option_id: string | null;
  approved_by: string | null;
  approved_at_us: number | null;
  steps: AutoResolveStep[];
  /** The state the run left, such as `worked`. */
  state: AutoResolveRunState;
  verdict: string | null;
  explanation: string | null;
  ended_at_us: number | null;
}

/** `not_fixed` comes from "No, it didn't" under an outcome; the others correct a waiting plan. */
export type AutoResolveCorrectionKind = "wrong_cause" | "wrong_fix" | "out_of_scope" | "not_fixed";

export const PLAN_CORRECTION_KINDS = ["wrong_cause", "wrong_fix", "out_of_scope"] as const;
export type AutoResolvePlanCorrectionKind = (typeof PLAN_CORRECTION_KINDS)[number];

/** Body of `POST runs/{run}/replan`; `remember` is ignored on a run without a saved AutoResolve. */
export interface AutoResolveReplanInput {
  note: string;
  kind?: AutoResolveCorrectionKind;
  remember?: boolean;
  option_id?: string;
}

/** A correction the current plan's turn read. */
export interface AutoResolveCorrectionUsed {
  kind: AutoResolveCorrectionKind;
  note: string;
  created_by: string;
  created_at_us: number;
  run_id: string;
  this_run: boolean;
}

/** A correction sent on this run. */
export interface AutoResolveRunCorrection {
  id: string;
  kind: AutoResolveCorrectionKind;
  note: string;
  created_by: string;
  created_at_us: number;
  /** Kept on the saved AutoResolve for later runs. */
  remembered: boolean;
  /** The option the person was looking at when they sent it. */
  option_title: string | null;
  /** The plan revision it was sent on. */
  revision: number;
}

export interface AutoResolveAddedConnection {
  name: string;
  by: string;
  at_us: number;
  /** This add turned the saved AutoResolve's alert trigger off. */
  trigger_off: boolean;
}

/** A person's verdict on an outcome, with the agent's verdict as it stood then. */
export interface AutoResolvePersonVerdict {
  verdict: "fixed" | "not_fixed";
  note: string | null;
  by: string;
  at_us: number;
  revision: number;
  /** The agent's verdict, or the run's end state when its check gave none (e.g. outcome_unknown). */
  agent_verdict?: AutoResolveVerdict | AutoResolveRunState | null;
  agent_explanation?: string | null;
  agent_checked_at_us?: number | null;
}

/** A remembered correction of a saved AutoResolve (`GET saved/{id}/corrections`). */
export interface AutoResolveCorrection {
  id: string;
  kind: AutoResolveCorrectionKind;
  note: string;
  option_title: string | null;
  run_id: string;
  revision: number;
  created_by: string;
  created_at_us: number;
  /** When the run the correction came from started. */
  run_started_at_us: number | null;
}

export interface AutoResolveCorrectionList {
  corrections: AutoResolveCorrection[];
  total: number;
  /** The viewer may edit the AutoResolve, so may remove its corrections. */
  can_remove: boolean;
}

export type AutoResolveVerdict = "worked" | "no_change" | "worse";

export interface AutoResolveOutcome {
  /** The model's verdict; null when the run ended without one (declined, failed, lapsed). */
  verdict: AutoResolveVerdict | null;
  /** "worse" when an earlier attempt in this run made things worse, whatever it ended as. */
  prior_verdict: "worse" | null;
  system_summary: string;
  explanation: string | null;
  /** The run's own error, kept apart from the model's explanation. */
  error?: string | null;
}

/** Who may approve: an IAM role, a group holding such a role, or org admins. */
export interface AutoResolveApprover {
  kind: "role" | "group" | "org_admins";
  name: string;
}

/** Every refusal's body; a 403 on a decision also lists who may. */
export interface AutoResolveErrorBody {
  /** The HTTP status. */
  code: number;
  /** A word naming the refusal when the status alone is ambiguous, such as "connection_removed". */
  reason?: string;
  message: string;
  approvers?: AutoResolveApprover[];
  /** The connection the refusal is about: not approvable, or removed. */
  connection?: AutoResolveConnectionRef;
}

export type AutoResolveTriggerKind = "person" | "alert" | "incident";

export interface AutoResolveSavedTrigger {
  kind: AutoResolveTriggerKind;
  alert_id: string | null;
  /** Null when the alert is gone. */
  alert_name: string | null;
  enabled: boolean;
  /** An edit turned it off; someone who may approve must turn it on again. */
  paused_for_reapproval: boolean;
  approved_by: string | null;
  approved_at_us: number | null;
}

/** One saved AutoResolve (the server's `SavedView`). */
export interface AutoResolveSaved {
  id: string;
  name: string;
  goal: string;
  connections: AutoResolveConnectionRef[];
  trigger: AutoResolveSavedTrigger;
  created_by: string;
  created_at_us: number;
  updated_at_us: number;
  from_run_id: string | null;
  /** This region evaluates alerts and incidents, so its triggers fire. */
  triggers_fire_here: boolean;
  /** Who may approve changes through its MCPs, read from IAM as for a run. */
  approvers: AutoResolveApprover[];
}

/** Body of `POST /saved` and `PUT /saved/{id}`; an edit ignores `from_run_id`. */
export interface AutoResolveSavedInput {
  name: string;
  goal: string;
  connection_ids: string[];
  trigger_kind: AutoResolveTriggerKind;
  trigger_alert_id: string | null;
  from_run_id: string | null;
}

/** Body of `POST /runs`: the goal and the connections the run may use. */
export interface AutoResolveStartInput {
  goal: string;
  connection_ids: string[];
  /** Makes it the incident's run; refused with 409 while the incident has a live run. */
  incident_id?: string;
}

/** The run `GET /incidents/{id}` shows: the incident's live run, else its latest. */
export interface AutoResolveIncidentRun {
  run_id: string;
  state: AutoResolveRunState;
  live: boolean;
  autoresolve_id: string | null;
  name: string | null;
  goal: string;
  trigger: Pick<AutoResolveTrigger, "kind" | "label">;
  created_at_us: number;
  ended_at_us: number | null;
}

/** A saved AutoResolve whose trigger alert is in the incident; incident-triggered come first. */
export interface AutoResolveIncidentRelated {
  id: string;
  name: string;
  goal: string;
  trigger_kind: AutoResolveTriggerKind;
  alert_id: string | null;
  alert_name: string | null;
  connections: AutoResolveConnectionRef[];
}

/** `GET /incidents/{id}`. */
export interface AutoResolveIncident {
  incident_id: string;
  run: AutoResolveIncidentRun | null;
  related: AutoResolveIncidentRelated[];
  /** The RCA's probable cause, once the RCA finished. */
  suggested_goal: string | null;
}

/** The live turn's clock (the server's `TurnStatus`); times are microseconds. */
export interface AutoResolveTurnStatus {
  started_at_us: number;
  /** When the sweep ends the turn. */
  deadline_us: number;
  /** The newest model output the server can see, else `started_at_us`. */
  last_output_us: number;
  /** The one retried check turn of a run whose approved steps ran. */
  check_retry: boolean;
}

/** `GET /runs/{run}` (the server's `RunDetail`). */
export interface AutoResolveRun {
  id: string;
  goal: string;
  state: AutoResolveRunState;
  trigger: AutoResolveTrigger;
  requester: string;
  created_at_us: number;
  ended_at_us: number | null;
  /** The run ended because no MCP of the run can make the fix its plan needs. */
  cant_fix: boolean;
  /** The run's re-read before its first approved step found the change no longer needed. */
  no_longer_needed: boolean;
  /** While it waits: other runs' changes to its MCPs since its plan, newest first. */
  changed_since_plan: AutoResolveChangedBy[];
  approval_deadline_us: number | null;
  /** When the current plan was accepted; null until one is. */
  planned_at_us: number | null;
  revision: number;
  plan: AutoResolvePlan | null;
  /** Every accepted plan, oldest first; the current one is last. */
  plan_history?: AutoResolvePlanRevision[];
  chosen_option_id: string | null;
  approved_by: string | null;
  approved_at_us: number | null;
  approvers: AutoResolveApprover[];
  can_approve: boolean;
  /** The connections chosen when the run started; each turn loads only these. */
  connections: AutoResolveConnectionRef[];
  steps: AutoResolveStep[];
  outcome: AutoResolveOutcome | null;
  thread: RcaThread;
  /** Set only while a turn is live: investigating, proceeding or checking. */
  turn: AutoResolveTurnStatus | null;
  /** The saved AutoResolve this run belongs to; null for a run started from the goal box. */
  autoresolve?: { id: string; name: string } | null;
  /** The org's connections this run does not have, by name. */
  not_connected?: string[];
  corrections_used?: AutoResolveCorrectionUsed[];
  corrections?: AutoResolveRunCorrection[];
  added_connections?: AutoResolveAddedConnection[];
  person_verdict?: AutoResolvePersonVerdict | null;
}

/** One event of `GET /runs/{run}/live_stream`; a snapshot is the whole run. */
export type AutoResolveLiveEvent =
  | { event: "snapshot"; data: AutoResolveRun }
  | { event: "end"; data: { state: AutoResolveRunState | null } };

/** The live stream did not open: `status` is the server's answer. */
export class AutoResolveLiveStreamRefused extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`The live stream was refused with status ${status}`);
    this.name = "AutoResolveLiveStreamRefused";
    this.status = status;
  }
}

export const TERMINAL_RUN_STATES: ReadonlySet<AutoResolveRunState> = new Set([
  "worked",
  "no_change",
  "worse",
  "declined",
  "lapsed",
  "step_failed",
  "outcome_unknown",
  "failed",
]);

export const isTerminalRunState = (state: AutoResolveRunState | null | undefined): boolean =>
  !!state && TERMINAL_RUN_STATES.has(state);

/** The HTTP status of a failed call or a refused live stream; 0 when it has none. */
export const autoresolveErrorStatus = (error: unknown): number => {
  const e = error as { status?: unknown; response?: { status?: unknown } } | null;
  const status = e?.response?.status ?? e?.status;
  return typeof status === "number" ? status : 0;
};

export const isForbidden = (error: unknown): boolean => autoresolveErrorStatus(error) === 403;

const errorBody = (error: unknown): Partial<AutoResolveErrorBody> | undefined =>
  (error as { response?: { data?: Partial<AutoResolveErrorBody> } } | null)?.response?.data;

/** The server's one-sentence reason for a refusal, when it sent one. */
export const autoresolveErrorMessage = (error: unknown): string | undefined => {
  const message = errorBody(error)?.message;
  return typeof message === "string" && message ? message : undefined;
};

/** Who may decide, from a 403's body; empty when the refusal names nobody. */
export const autoresolveErrorApprovers = (error: unknown): AutoResolveApprover[] => {
  const approvers = errorBody(error)?.approvers;
  return Array.isArray(approvers) ? approvers : [];
};

/** The connection a refusal names, when it names one. */
export const autoresolveErrorConnection = (error: unknown): AutoResolveConnectionRef | null => {
  const connection = errorBody(error)?.connection;
  return connection && typeof connection.name === "string" ? connection : null;
};

/** Approving was refused because a connection of the option was removed after planning. */
export const isConnectionRemovedRefusal = (error: unknown): boolean =>
  errorBody(error)?.reason === "connection_removed";

/** The option goes through a removed connection, by the server's flag or its steps. */
export const usesRemovedConnection = (option: AutoResolveOption): boolean =>
  option.uses_removed_connection === true ||
  option.steps.some((s) => s.connection.removed === true);

const LIVE_EVENTS: Record<AutoResolveLiveEvent["event"], true> = { snapshot: true, end: true };

/** One `event:`/`data:` frame of the live stream; null for a heartbeat or an unknown event. */
const parseLiveFrame = (frame: string): AutoResolveLiveEvent | null => {
  let name = "";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  if (!Object.hasOwn(LIVE_EVENTS, name) || data.length === 0) return null;
  try {
    return { event: name, data: JSON.parse(data.join("\n")) } as AutoResolveLiveEvent;
  } catch {
    return null;
  }
};

const base = (org: string) => `/api/v2/${org}/autoresolve`;
const runPath = (org: string, id: string) => `${base(org)}/runs/${encodeURIComponent(id)}`;
const savedPath = (org: string, id: string) => `${base(org)}/saved/${encodeURIComponent(id)}`;

// These calls show the server's 403 sentence themselves, so the access toast stays quiet.
const rendersForbidden = { skipAccessToast: true };

const autoresolve = {
  getSummary: (org: string) => http().get<AutoResolveSummary>(`${base(org)}/summary`),

  listRuns: (org: string, q: AutoResolveRunQuery) =>
    http().get<AutoResolveRunList>(`${base(org)}/runs`, {
      params: { ...q, state: q.state?.length ? q.state.join(",") : undefined },
    }),

  startRun: (org: string, body: AutoResolveStartInput) =>
    http().post<{ run_id: string }>(`${base(org)}/runs`, body, rendersForbidden),

  getRun: (org: string, id: string) => http().get<AutoResolveRun>(runPath(org, id)),

  approveRun: (org: string, id: string, optionId: string, fingerprint: string) =>
    http().post<void>(
      `${runPath(org, id)}/approve`,
      { option_id: optionId, plan_fingerprint: fingerprint },
      rendersForbidden,
    ),

  declineRun: (org: string, id: string, fingerprint: string | null) =>
    http().post<void>(
      `${runPath(org, id)}/decline`,
      fingerprint ? { plan_fingerprint: fingerprint } : undefined,
      rendersForbidden,
    ),

  replanRun: (org: string, id: string, body: AutoResolveReplanInput) =>
    http().post<void>(`${runPath(org, id)}/replan`, body, rendersForbidden),

  postVerdict: (org: string, id: string) =>
    http().post<void>(`${runPath(org, id)}/verdict`, { verdict: "fixed" }, rendersForbidden),

  addConnection: (org: string, id: string, connectionId: string) =>
    http().post<void>(
      `${runPath(org, id)}/add_connection`,
      { connection_id: connectionId },
      rendersForbidden,
    ),

  listCorrections: (org: string, autoresolveId: string) =>
    http().get<AutoResolveCorrectionList>(`${savedPath(org, autoresolveId)}/corrections`),

  removeCorrection: (org: string, autoresolveId: string, correctionId: string) =>
    http().delete<void>(
      `${savedPath(org, autoresolveId)}/corrections/${encodeURIComponent(correctionId)}`,
      rendersForbidden,
    ),

  listSaved: (org: string) => http().get<{ autoresolve: AutoResolveSaved[] }>(`${base(org)}/saved`),

  getSaved: (org: string, id: string) => http().get<AutoResolveSaved>(savedPath(org, id)),

  createSaved: (org: string, body: AutoResolveSavedInput) =>
    http().post<AutoResolveSaved>(`${base(org)}/saved`, body, rendersForbidden),

  updateSaved: (org: string, id: string, body: AutoResolveSavedInput) =>
    http().put<AutoResolveSaved>(savedPath(org, id), body, rendersForbidden),

  deleteSaved: (org: string, id: string) =>
    http().delete<void>(savedPath(org, id), rendersForbidden),

  setTrigger: (org: string, id: string, enabled: boolean) =>
    http().post<AutoResolveSaved>(`${savedPath(org, id)}/trigger`, { enabled }, rendersForbidden),

  /** With `incidentId` the run becomes the incident's run; 409 while that incident has a live one. */
  runSaved: (org: string, id: string, incidentId?: string) =>
    http().post<{ run_id: string }>(
      `${savedPath(org, id)}/run`,
      incidentId ? { incident_id: incidentId } : undefined,
      rendersForbidden,
    ),

  // The incident page hides the section on a 403, so the access toast stays quiet.
  getIncident: (org: string, incidentId: string) =>
    http().get<AutoResolveIncident>(
      `${base(org)}/incidents/${encodeURIComponent(incidentId)}`,
      rendersForbidden,
    ),

  /** Stream the run into `onEvent`; rejects with AutoResolveLiveStreamRefused if refused. */
  openAutoResolveLiveStream: async (
    org: string,
    id: string,
    options: { onEvent: (event: AutoResolveLiveEvent) => void; signal?: AbortSignal },
  ): Promise<{ ended: boolean }> => {
    const url = `${store.state.API_ENDPOINT}${runPath(org, id)}/live_stream`;
    const init: RequestInit = {
      method: "GET",
      credentials: "include",
      headers: { Accept: "text/event-stream" },
      signal: options.signal,
    };
    // The axios interceptor never sees a fetch: refresh the token here, once.
    let response = await fetch(url, init);
    if (response.status === 401) {
      await attemptTokenRefresh(url);
      response = await fetch(url, init);
    }
    const reader = response.ok ? response.body?.getReader() : undefined;
    if (!reader) throw new AutoResolveLiveStreamRefused(response.status);

    const decoder = new TextDecoder();
    let buffer = "";
    let ended = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) return { ended };
      buffer += decoder.decode(value, { stream: true });
      // Events end with a blank line; a partial tail stays buffered.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const event = parseLiveFrame(frame);
        if (!event) continue;
        if (event.event === "end") ended = true;
        options.onEvent(event);
      }
    }
  },
};

export default autoresolve;
