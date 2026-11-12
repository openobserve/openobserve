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

import type { CreditMode, GateCode } from "@/composables/assistant/pure";

const CHAT_GATES: ReadonlySet<GateCode> = new Set(["available", "unhealthy"]);

/** The Chats column beside Home's hero and beside a chat open on Home, so both draw one rail. */
export const HOME_RAIL_CLASS =
  "border-border-subtle bg-surface-base/40 h-full min-h-0 w-64 shrink-0 border-e";

/** The gates whose chats Home's rail lists: the same ones the hero and the full view chat under. */
export function railGate(gate: GateCode): boolean {
  return CHAT_GATES.has(gate);
}

/** What Home can offer: the agent, the agent out of credits, no agent here, or the Open Source build. */
export type AgentHomeState = "loading" | "ai" | "budget" | "noai" | "oss";

/** Why the Ask box is Go to only; null while the agent can answer. */
export type AskOffReason =
  "budget" | "oss" | "not_entitled" | "not_configured" | "off_for_org" | "no_permission";

export interface AgentHomeInput {
  gate: GateCode;
  creditMode: CreditMode | null;
  isEnterprise: boolean;
  isCloud: boolean;
}

export function agentHomeState(input: AgentHomeInput): AgentHomeState {
  if (!input.isEnterprise && !input.isCloud) return "oss";
  if (input.gate === "loading") return "loading";
  if (CHAT_GATES.has(input.gate)) return input.creditMode === "exhausted" ? "budget" : "ai";
  return "noai";
}

export function askOffReason(input: AgentHomeInput): AskOffReason | null {
  const state = agentHomeState(input);
  if (state === "ai" || state === "loading") return null;
  if (state === "budget" || state === "oss") return state;
  return input.gate as Exclude<AskOffReason, "budget" | "oss">;
}

/** Hidden: no assistant here (Open Source, AI off, not permitted). Default: the tab Home opens on. */
export type AiTabMode = "hidden" | "default";

export interface AiTabInput {
  gate: GateCode;
  isEnterprise: boolean;
  isCloud: boolean;
  /** The feature menu state: `hidden` when the config turns AI off, `locked` when the license lacks it. */
  menu: "hidden" | "locked" | "enabled" | string;
  /** False until the full config has arrived, so `menu` cannot be trusted yet. */
  configLoaded: boolean;
}

const HIDDEN_GATES: ReadonlySet<GateCode> = new Set([
  "not_entitled",
  "not_configured",
  "off_for_org",
  "no_permission",
]);

/** Where the AI Assistant tab sits; a loading gate keeps it only while the config is unknown, so a known AI-off never shows it. */
export function aiTabMode(input: AiTabInput): AiTabMode {
  if (!input.isEnterprise && !input.isCloud) return "hidden";
  if (input.menu === "locked") return "default";
  if (input.gate === "loading" && !input.configLoaded) return "default";
  if (input.menu === "hidden" || HIDDEN_GATES.has(input.gate)) return "hidden";
  return "default";
}

/** True when the gate itself, not a config still loading, keeps the AI tab away. */
export function gateHidesAiTab(gate: GateCode): boolean {
  return HIDDEN_GATES.has(gate);
}
