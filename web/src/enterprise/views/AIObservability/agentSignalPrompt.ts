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
 * The question "Explain with O2 AI" hands to the AI panel for one Agent Behavior
 * signal (AIO-36). It carries the evidence the drill-down drawer already loaded,
 * the error messages and the worst traces, so the answer starts from them.
 * Model input, so it stays English.
 */

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

function subject(s: SignalForPrompt, agent: string): string {
  if (s.signalType === "loop") {
    return (
      `agent "${agent}" calls the tool "${s.tool ?? ""}" ${s.ratio ?? "?"} times per trace ` +
      `(${s.calls ?? "?"} calls over ${s.traces ?? "?"} traces)`
    );
  }
  if (s.signalType === "failure") {
    return `agent "${agent}" fails with "${s.failClass ?? "an error"}" (${s.count ?? "?"} errors)`;
  }
  return (
    `what drives the cost of agent "${agent}": $${s.cost ?? 0} on ${s.tokens ?? 0} tokens, ` +
    `with ${s.errors ?? 0} errored spans`
  );
}

export function explainSignalPrompt(s: SignalForPrompt, e: PromptEvidence): string {
  const agent = s.agent || "unknown";
  const variant = [e.env && `env ${e.env}`, e.version && `version ${e.version}`]
    .filter(Boolean)
    .join(", ");
  const [from, to] = [e.startTime, e.endTime].map((us) =>
    us && us > 0 ? new Date(us / 1000).toISOString() : "unknown",
  );
  const lines = [
    `Investigate the root cause of this AI agent behaviour: ${subject(s, agent)}.`,
    `Trace stream: ${e.stream}${variant ? `. Agent ${variant}` : ""}. Window: ${from} to ${to}.`,
  ];
  // The drill-down cannot narrow evidence to one failure class (the taxonomy is
  // resolved server-side), so say the evidence spans all of the agent's errors.
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
