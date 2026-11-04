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
 * The openobserve-instrument skill, served from the openobserve repo so any
 * coding agent can fetch and follow it without installing a plugin.
 */
export const INSTRUMENT_SKILL_URL =
  "https://raw.githubusercontent.com/openobserve/openobserve/main/skills/openobserve-instrument/SKILL.md";

/** `?tab=` value that opens an AI integration on its "With a coding agent" tab. */
export const CODING_AGENT_TAB = "agent";
/** The default tab: the integration's existing stepped card. */
export const STEP_BY_STEP_TAB = "steps";

/** Stream names the installer accepts (letters, digits, underscore). */
export const STREAM_NAME_RE = /^[a-zA-Z0-9_]+$/;

/**
 * The prompt the user pastes into their coding agent. It carries the org and
 * stream but never the token: the skill reads that from the downloaded .env.
 * Agent-facing text, so it stays English regardless of the UI locale.
 */
export function buildCodingAgentPrompt(org: string, stream: string): string {
  return (
    `Instrument this app for OpenObserve with the openobserve-instrument skill (${INSTRUMENT_SKILL_URL}).\n` +
    `Use the .env in the project root, org ${org}, stream ${stream}.\n` +
    `Run one sample request, then check the data.`
  );
}
