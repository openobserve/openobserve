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

// Fixtures for an AutoResolve run. Times are microseconds.

import type { AutoResolveOption, AutoResolveRun, AutoResolveStep } from "@/services/autoresolve";
import { RCA_T0, rcaThread, sec } from "./rcaThread";

export function autoresolveStep(overrides: Partial<AutoResolveStep> = {}): AutoResolveStep {
  return {
    id: "step-1",
    seq: 1,
    kind: "change",
    connection: { id: "c-git", name: "Code host (infra repo)" },
    tool: "create_pull_request",
    arguments: { repo: "infra", base: "main", head: "revert-a41c9e7" },
    refs: [],
    reason: "The commit a41c9e7 lowered the route timeout.",
    preview: null,
    dry_run_after_approval: false,
    state: "proposed",
    result_summary: null,
    error: null,
    consumed_at_us: null,
    finished_at_us: null,
    ...overrides,
  };
}

export function autoresolveOption(overrides: Partial<AutoResolveOption> = {}): AutoResolveOption {
  return {
    id: "A",
    title: "Revert through a pull request",
    recommended: true,
    changes_production_directly: false,
    tradeoffs: "About 6 minutes. Leaves the repo and the cluster in agreement.",
    reason: "The fault came from a commit, so reverting it fixes the cause.",
    steps: [autoresolveStep()],
    changes: [{ name: "Code host (infra repo)", short_description: null }],
    ...overrides,
  };
}

/** A run waiting for approval of one recommended option; no step runs before approval. */
export function autoresolveRun(overrides: Partial<AutoResolveRun> = {}): AutoResolveRun {
  return {
    id: "run-1",
    goal: "Gateway returns 5xx on the token route. Find the cause and fix it.",
    state: "waiting_approval",
    trigger: {
      kind: "person",
      label: "Started by ana@example.com",
      by: "ana@example.com",
      alert_id: null,
    },
    requester: "ana@example.com",
    created_at_us: RCA_T0,
    ended_at_us: null,
    cant_fix: false,
    approval_deadline_us: RCA_T0 + sec(1800),
    revision: 1,
    plan: {
      fingerprint: "fp-1",
      options: [autoresolveOption()],
      omitted_count: 0,
      omitted_reason: null,
      missing_capability: null,
    },
    chosen_option_id: null,
    approved_by: null,
    approved_at_us: null,
    approvers: [
      { kind: "role", name: "sre" },
      { kind: "org_admins", name: "Org admins" },
    ],
    can_approve: true,
    connections: [],
    steps: [],
    outcome: null,
    thread: rcaThread({ active: false }),
    turn: null,
    autoresolve: null,
    not_connected: [],
    corrections_used: [],
    corrections: [],
    added_connections: [],
    person_verdict: null,
    ...overrides,
  };
}
