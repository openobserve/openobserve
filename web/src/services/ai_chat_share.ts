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
  token: string;
  url_path: string;
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
}

/** A shared chat, as a viewer reads it. `turns` is absent when `not_modified`. */
export interface SharedChat {
  title: string;
  mode: ShareMode;
  seq: number;
  created_at: number;
  shared_at: number;
  owner_name: string;
  turns?: StoredTurn[];
  not_modified: boolean;
}

export interface CreateShareRequest {
  mode: ShareMode;
  visibility: ShareVisibility;
  expires_in_secs?: number;
}

export interface UpdateShareRequest {
  mode?: ShareMode;
  expires_in_secs?: number;
  refresh_snapshot?: boolean;
}

export interface ForkResult {
  session_id: string;
  title: string;
}

const enc = encodeURIComponent;

const aiChatShare = {
  create: (org: string, sessionId: string, body: CreateShareRequest) =>
    http().post<ShareView>(`/api/${enc(org)}/ai/chats/${enc(sessionId)}/shares`, body),

  listForChat: (org: string, sessionId: string) =>
    http().get<{ shares: ShareView[] }>(`/api/${enc(org)}/ai/chats/${enc(sessionId)}/shares`),

  listMine: (org: string) => http().get<{ shares: ShareView[] }>(`/api/${enc(org)}/ai/shares`),

  update: (org: string, shareId: string, body: UpdateShareRequest) =>
    http().patch<ShareView>(`/api/${enc(org)}/ai/shares/${enc(shareId)}`, body),

  revoke: (org: string, shareId: string) =>
    http().delete<{ revoked: boolean }>(`/api/${enc(org)}/ai/shares/${enc(shareId)}`),

  getShared: (org: string, token: string, knownSeq?: number) =>
    http().get<SharedChat>(`/api/${enc(org)}/ai/shared/${enc(token)}`, {
      params: knownSeq === undefined ? undefined : { known_seq: knownSeq },
    }),

  fork: (org: string, token: string) =>
    http().post<ForkResult>(`/api/${enc(org)}/ai/shared/${enc(token)}/fork`),

  getPublic: (token: string) => http().get<SharedChat>(`/api/public/ai_chats/${enc(token)}`),
};

export default aiChatShare;
