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

// Must match the server's `strip_harness` (src/config/src/meta/gen_ai.rs).

export interface HarnessPatternRule {
  agent: string;
  patterns: string[];
}

/** Mirrors the backend `HarnessStripped`. */
export interface HarnessStripped {
  text: string;
  hidden: number;
  /** Set when the text was only harness: what hid it (the tag). */
  only: string | null;
}

/** Tags known coding agents wrap requests in; "Apply defaults" fills these. */
export const DEFAULT_HARNESS_PATTERNS = [
  "tag system-reminder",
  "tag job",
  "tag command-message",
  "tag local-command-stdout",
];

/** The patterns saved for one agent, or none. */
export function patternsForAgent(rules: HarnessPatternRule[] | undefined, agent: string | null) {
  return (agent && rules?.find((r) => r.agent === agent)?.patterns) || [];
}
