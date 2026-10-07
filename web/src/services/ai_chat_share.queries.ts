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

import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/vue-query";
import aiChatShare, {
  type CreateShareRequest,
  type ShareView,
  type SharedChat,
  type SharedChatKnown,
  type UpdateShareRequest,
} from "./ai_chat_share";
import { aiChatShareKeys } from "./ai_chat_share.querykeys";
import { LIVE_STALE_TIME, MEDIUM_STALE_TIME } from "@/composables/query/cachePolicy";

// A running turn is worth watching closely; a finished live share only moves when its owner chats again.
const ACTIVE_TURN_POLL_MS = 5_000;
const LIVE_SHARE_POLL_MS = 30_000;

export const chatSharesQuery = (org: string, sessionId: string) =>
  queryOptions({
    queryKey: aiChatShareKeys.forChat(org, sessionId),
    queryFn: async (): Promise<ShareView[]> =>
      (await aiChatShare.listForChat(org, sessionId)).data?.shares ?? [],
    staleTime: MEDIUM_STALE_TIME,
  });

export const mySharesQuery = (org: string) =>
  queryOptions({
    queryKey: aiChatShareKeys.mine(org),
    queryFn: async (): Promise<ShareView[]> => (await aiChatShare.listMine(org)).data?.shares ?? [],
    staleTime: MEDIUM_STALE_TIME,
  });

export const allSharesQuery = (org: string) =>
  queryOptions({
    queryKey: aiChatShareKeys.orgWide(org),
    queryFn: async (): Promise<ShareView[]> => (await aiChatShare.listAll(org)).data?.shares ?? [],
    staleTime: MEDIUM_STALE_TIME,
  });

/** How often an open shared-chat page re-reads the share. */
export const sharedChatPollInterval = (chat: SharedChat | undefined): number | false => {
  if (!chat) return false;
  if (chat.active_turn) return ACTIVE_TURN_POLL_MS;
  return chat.mode === "live" ? LIVE_SHARE_POLL_MS : false;
};

// Sends what the cache already holds, so an unchanged share costs no turns; `not_modified` keeps the cached ones.
const readShared = async (
  client: QueryClient,
  key: readonly unknown[],
  read: (known?: SharedChatKnown) => Promise<{ data: SharedChat }>,
): Promise<SharedChat> => {
  const cached = client.getQueryData<SharedChat>(key);
  const known = cached?.turns ? { seq: cached.seq, version: cached.state_version } : undefined;
  const fresh = (await (known ? read(known) : read())).data;
  if (fresh.not_modified && cached?.turns) return { ...cached, ...fresh, turns: cached.turns };
  return fresh;
};

/** A live share moves with the source chat, so it sits on the live tier. */
export const sharedChatQuery = (org: string, token: string) =>
  queryOptions({
    queryKey: aiChatShareKeys.shared(org, token),
    queryFn: ({ client, queryKey }): Promise<SharedChat> =>
      readShared(client, queryKey, (known) =>
        known ? aiChatShare.getShared(org, token, known) : aiChatShare.getShared(org, token),
      ),
    staleTime: LIVE_STALE_TIME,
  });

export const publicSharedChatQuery = (token: string) =>
  queryOptions({
    queryKey: aiChatShareKeys.public(token),
    queryFn: ({ client, queryKey }): Promise<SharedChat> =>
      readShared(client, queryKey, (known) =>
        known ? aiChatShare.getPublic(token, known) : aiChatShare.getPublic(token),
      ),
    staleTime: LIVE_STALE_TIME,
  });

export const createShareMutation = (org: string, sessionId: string) =>
  mutationOptions({
    mutationFn: async (body: CreateShareRequest): Promise<ShareView> =>
      (await aiChatShare.create(org, sessionId, body)).data,
    meta: { invalidates: [aiChatShareKeys.all(org)], silentError: true },
  });

export const updateShareMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (vars: { id: string; body: UpdateShareRequest }): Promise<ShareView> =>
      (await aiChatShare.update(org, vars.id, vars.body)).data,
    meta: { invalidates: [aiChatShareKeys.all(org)], silentError: true },
  });

export const revokeShareMutation = (org: string) =>
  mutationOptions({
    mutationFn: (id: string) => aiChatShare.revoke(org, id),
    meta: {
      invalidates: [aiChatShareKeys.all(org)],
      removes: [aiChatShareKeys.all(org)],
      silentError: true,
    },
  });

export const forkSharedChatMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (token: string) => (await aiChatShare.fork(org, token)).data,
    meta: { silentError: true },
  });
