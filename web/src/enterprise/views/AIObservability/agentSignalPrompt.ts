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

import { UNSET } from "@/enterprise/composables/useAgentScope";

// Model input, so it stays English.

export interface SignalForPrompt {
  signalType: "loop" | "failure" | "cost";
  agent?: string;
  tool?: string;
  failClass?: string;
  calls?: number;
  traces?: number;
  ratio?: number;
  count?: number;
  cost?: number;
  tokens?: number;
  errors?: number;
}

export interface PromptEvidence {
  stream: string;
  /** The drill-down's env/version; UNSET = the variant has none. */
  env?: string | null;
  version?: string | null;
  startTime?: number;
  endTime?: number;
  /** Raw error messages with how often each occurred, most frequent first. */
  errors: Array<{ message: string; occurrences: number }>;
  /** Worst traces first, with what makes each one bad (repeats, cost or error spans). */
  traces: Array<{ trace_id: string; measure?: number | string }>;
}

/** How many error messages and traces the prompt names. */
const PROMPT_EVIDENCE_LIMIT = 5;
/** Raw errors can be long JSON blobs; the prompt needs their gist. */
const PROMPT_MESSAGE_MAX = 300;

/** "1 trace", "12 traces"; "? traces" when the count is unknown. */
const count = (n: number | undefined, noun: string): string =>
  `${n ?? "?"} ${n === 1 ? noun : `${noun}s`}`;

function subject(s: SignalForPrompt, agent: string): string {
  if (s.signalType === "loop") {
    return (
      `agent "${agent}" calls the tool "${s.tool ?? ""}" ${s.ratio ?? "?"} times per trace ` +
      `(${count(s.calls, "call")} over ${count(s.traces, "trace")})`
    );
  }
  if (s.signalType === "failure") {
    return `agent "${agent}" fails with "${s.failClass ?? "an error"}" (${count(s.count, "error")})`;
  }
  return (
    `what drives the cost of agent "${agent}": $${s.cost ?? 0} on ${s.tokens ?? 0} tokens, ` +
    `with ${s.errors ?? 0} errored spans`
  );
}

export function explainSignalPrompt(s: SignalForPrompt, e: PromptEvidence): string {
  const agent = s.agent || "unknown";
  const variant = [
    e.env && (e.env === UNSET ? "no env" : `env ${e.env}`),
    e.version && (e.version === UNSET ? "no version" : `version ${e.version}`),
  ]
    .filter(Boolean)
    .join(", ");
  const [from, to] = [e.startTime, e.endTime].map((us) =>
    us && us > 0 ? new Date(us / 1000).toISOString() : "unknown",
  );
  const lines = [
    `Investigate the root cause of this AI agent behaviour: ${subject(s, agent)}.`,
    `Trace stream: ${e.stream}${variant ? `. Agent ${variant}` : ""}. Window: ${from} to ${to}.`,
  ];
  // Failure classes resolve server-side, so the evidence cannot be narrowed to one.
  const allClasses = s.signalType === "failure" ? " (all of this agent's failure classes)" : "";
  const errors = e.errors.slice(0, PROMPT_EVIDENCE_LIMIT);
  if (errors.length) {
    lines.push(
      `Most frequent error messages${allClasses}: ` +
        errors
          .map((x) => `"${x.message.slice(0, PROMPT_MESSAGE_MAX)}" (${x.occurrences} times)`)
          .join("; ") +
        ".",
    );
  }
  const traces = e.traces.slice(0, PROMPT_EVIDENCE_LIMIT);
  if (traces.length) {
    lines.push(
      `Worst traces${allClasses}: ` +
        traces
          .map((x) => (x.measure === undefined ? x.trace_id : `${x.trace_id} (${x.measure})`))
          .join(", ") +
        ".",
    );
  }
  lines.push(
    "Look past the AI spans too: logs, metrics, Kubernetes state and recent deploys of the services these traces call.",
    "Give the probable cause in one sentence with a confidence, the hypotheses you ruled out with their evidence, and a short timeline.",
  );
  return lines.join("\n");
}
