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

import type { AgentSignalRecord } from "@/services/agent_signals";

/**
 * Predicate: does signal `s` match the selected agent scope (name + env +
 * version)? `env`/`version` narrow the match ONLY when the selected variant
 * has them (null = don't constrain) — mirrors buildAgentTraceFilter's guards,
 * and keeps agents without env/version behaving exactly as before.
 *
 * Colocated here (rather than inline in AgentBehaviorPanel.vue's
 * `<script setup>`) so it can be unit tested directly without mounting the
 * panel's heavier deps (OTable, OStatStrip, i18n, vuex, http service) —
 * `<script setup>` cannot contain module exports.
 */
export const matchesAgentScope = (
  s: Pick<AgentSignalRecord, "agent_name" | "gen_ai_agent_env" | "gen_ai_agent_version">,
  scope: { name: string; env?: string | null; version?: string | null },
): boolean => {
  const env = scope.env ?? null;
  const ver = scope.version ?? null;
  return (
    (s.agent_name ?? "") === scope.name &&
    (env == null || (s.gen_ai_agent_env ?? null) === env) &&
    (ver == null || (s.gen_ai_agent_version ?? null) === ver)
  );
};
