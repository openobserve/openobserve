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

import http from "./http";

export type MemoryScope = "org" | "toolset" | "user";
export type AgentMemoryWrites = "review" | "auto" | "off" | "on";
export type EditFlag = "states_absence" | "suppression_text";

export interface Memory {
  scope: MemoryScope;
  scope_key: string;
  content: string;
  rev: number;
  size_bytes: number;
  max_bytes: number;
  user_max_bytes?: number;
  agent_memory_writes: AgentMemoryWrites | null;
  agent_memory_writes_effective: AgentMemoryWrites;
  updated_by: string | null;
  updated_at: number | null;
  pending_count: number;
  /** The caller's own writes apply without approval (a memory admin for shared scopes). */
  can_apply: boolean;
}

export type MemoryEdit =
  | { op: "add"; section: string; text: string }
  | { op: "replace"; old: string; new: string }
  | { op: "remove"; old: string };

export interface Revision {
  id: string;
  rev: number | null;
  state: "applied" | "pending" | "discarded";
  base_rev: number;
  edits: MemoryEdit[] | null;
  content?: string;
  updated_by: string;
  reason: string | null;
  evidence: { turn_id?: string; call_ref: string; tool?: string }[] | null;
  origin_region: string;
  op_id: string;
  created_at: number;
  flags: EditFlag[];
}

/** One id's result from a bulk accept or discard; `status` is the HTTP status it would get. */
export interface DecisionResult {
  id: string;
  status: number;
  code?: string;
  message?: string;
}

export interface PendingEdit extends Revision {
  scope: MemoryScope;
  scope_key: string;
}

export interface MemoryUpdate {
  content?: string;
  base_rev?: number;
  reason?: string;
  /** `inherit` stores no setting of the memory's own. */
  agent_memory_writes?: AgentMemoryWrites | "inherit";
  max_bytes?: number;
  user_max_bytes?: number;
}

/** Where one memory lives: the org's, a toolset's (by id), or the caller's own notes. */
export type MemoryTarget =
  { scope: "org" } | { scope: "toolset"; toolsetId: string } | { scope: "user" };

const base = (org: string, target: MemoryTarget) =>
  target.scope === "org"
    ? `/api/${org}/ai/memory/org`
    : target.scope === "user"
      ? `/api/${org}/ai/memory/me`
      : `/api/${org}/ai/toolsets/${target.toolsetId}/memory`;

const aiMemory = {
  get: (org: string, target: MemoryTarget) => http().get<Memory>(base(org, target)),
  update: (org: string, target: MemoryTarget, body: MemoryUpdate) =>
    http().put(base(org, target), body),
  revisions: (org: string, target: MemoryTarget) =>
    http().get<{ revisions: Revision[] }>(`${base(org, target)}/revisions`),
  revision: (org: string, target: MemoryTarget, id: string) =>
    http().get<Revision>(`${base(org, target)}/revisions/${id}`),
  revert: (org: string, target: MemoryTarget, rev: number) =>
    http().post(`${base(org, target)}/revert`, { rev }),
  pending: (org: string) => http().get<{ pending: PendingEdit[] }>(`/api/${org}/ai/memory/pending`),
  accept: (org: string, ids: string[]) =>
    http().post<{ results: DecisionResult[] }>(`/api/${org}/ai/memory/pending/accept`, { ids }),
  discard: (org: string, ids: string[]) =>
    http().post<{ results: DecisionResult[] }>(`/api/${org}/ai/memory/pending/discard`, { ids }),
};

export default aiMemory;
