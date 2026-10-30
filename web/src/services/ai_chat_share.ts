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
import type { StoredTurn } from "@/components/O2AIChat.history";

export type ShareMode = "snapshot" | "live";
export type ShareVisibility = "org" | "public";

/** A share of a persisted chat, as the owner sees it. Times are microseconds. */
export interface ShareView {
  id: string;
  /** Omitted from the org-wide admin list, which must not hand out other members' links. */
  token?: string;
  url_path?: string;
  mode: ShareMode;
  visibility: ShareVisibility;
  snapshot_seq: number | null;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
  access_count: number;
  last_accessed_at: number | null;
  session_id: string;
  title: string;
  /** Tool inputs and outputs are hidden from viewers; only tool names show. */
  redact_tools: boolean;
  /** Set on the org-wide admin list only. */
  owner_name?: string;
  owner_email?: string;
}

/** A shared chat, as a viewer reads it. `turns` is absent when `not_modified`. */
export interface SharedChat {
  title: string;
  mode: ShareMode;
  seq: number;
  /** Changes whenever what the viewer sees changes; pass back as `known_version`. */
  state_version?: string;
  created_at: number;
  shared_at: number;
  owner_name?: string | null;
  redact_tools?: boolean;
  /** A turn of the source chat is still being generated. */
  active_turn?: boolean;
  turns?: StoredTurn[];
  not_modified: boolean;
}

/** What a viewer already holds, so an unchanged share answers `not_modified`. */
export interface SharedChatKnown {
  seq: number;
  version?: string;
}

export interface CreateShareRequest {
  mode: ShareMode;
  visibility: ShareVisibility;
  /** Required for public links. */
  expires_in_secs?: number;
  redact_tools: boolean;
}

export interface UpdateShareRequest {
  mode?: ShareMode;
  expires_in_secs?: number;
  refresh_snapshot?: boolean;
  redact_tools?: boolean;
}

export interface ForkResult {
  session_id: string;
  title: string;
}

const enc = encodeURIComponent;

const knownParams = (known?: SharedChatKnown) =>
  known
    ? { known_seq: known.seq, ...(known.version !== undefined && { known_version: known.version }) }
    : undefined;

const aiChatShare = {
  create: (org: string, sessionId: string, body: CreateShareRequest) =>
    http().post<ShareView>(`/api/${enc(org)}/ai/chats/${enc(sessionId)}/shares`, body),

  listForChat: (org: string, sessionId: string) =>
    http().get<{ shares: ShareView[] }>(`/api/${enc(org)}/ai/chats/${enc(sessionId)}/shares`),

  listMine: (org: string) => http().get<{ shares: ShareView[] }>(`/api/${enc(org)}/ai/shares`),

  /** Every active share in the org; org admins only (403 otherwise). */
  listAll: (org: string) =>
    http().get<{ shares: ShareView[] }>(`/api/${enc(org)}/ai/shares`, { params: { all: true } }),

  update: (org: string, shareId: string, body: UpdateShareRequest) =>
    http().patch<ShareView>(`/api/${enc(org)}/ai/shares/${enc(shareId)}`, body),

  revoke: (org: string, shareId: string) =>
    http().delete<{ revoked: boolean }>(`/api/${enc(org)}/ai/shares/${enc(shareId)}`),

  getShared: (org: string, token: string, known?: SharedChatKnown) =>
    http().get<SharedChat>(`/api/${enc(org)}/ai/shared/${enc(token)}`, {
      params: knownParams(known),
    }),

  // The server only accepts a JSON body here, which a cross-site form post cannot send.
  fork: (org: string, token: string) =>
    http().post<ForkResult>(
      `/api/${enc(org)}/ai/shared/${enc(token)}/fork`,
      {},
      { headers: { "Content-Type": "application/json" } },
    ),

  getPublic: (token: string, known?: SharedChatKnown) =>
    http().get<SharedChat>(`/api/public/ai_chats/${enc(token)}`, { params: knownParams(known) }),
};

export default aiChatShare;
