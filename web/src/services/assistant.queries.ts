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

import { keepPreviousData, mutationOptions, queryOptions } from "@tanstack/vue-query";

import { LIVE_STALE_TIME, SESSION_STALE_TIME } from "@/composables/query/cachePolicy";

import assistant, { type ChatDetail } from "./assistant";
import { assistantKeys } from "./assistant.querykeys";

/** B-06 capabilities; `enabled` is false on an unentitled or unconfigured build, so nothing is requested there. */
export const capabilitiesQuery = (org: string, enabled = true) =>
  queryOptions({
    queryKey: assistantKeys.capabilities(org),
    queryFn: () => assistant.capabilities(org),
    staleTime: SESSION_STALE_TIME,
    refetchOnWindowFocus: true,
    retry: false,
    enabled: enabled && !!org,
  });

/** Cloud only: every caller gates the read on the edition; every turn end invalidates it. */
export const assistantUsageQuery = (org: string) =>
  queryOptions({
    queryKey: assistantKeys.usage(org),
    queryFn: () => assistant.usage(org),
    staleTime: LIVE_STALE_TIME,
    refetchOnWindowFocus: true,
    retry: false,
    enabled: !!org,
  });

/** One page of the list; the cursor is part of the key, so Load older never replaces the first page. */
export const assistantChatsQuery = (org: string, cursor?: string, q?: string) =>
  queryOptions({
    queryKey: [...assistantKeys.chats(org), { cursor: cursor ?? null, q: q ?? "" }] as const,
    queryFn: () => assistant.listChats(org, { cursor, ...(q && { q }) }),
    staleTime: LIVE_STALE_TIME,
    placeholderData: keepPreviousData,
    retry: false,
    enabled: !!org,
  });

/** Sends what the cache holds, so an unchanged chat costs no turns and a stale one only its newer turns. */
export const assistantChatQuery = (
  org: string,
  sid: string,
  known?: { seq?: number; version?: string },
) =>
  queryOptions({
    queryKey: assistantKeys.chat(org, sid),
    queryFn: async ({ client, queryKey }): Promise<ChatDetail> => {
      const cached = client.getQueryData<ChatDetail>(queryKey);
      const have = cached?.turns
        ? { seq: cached.last_committed_seq, version: cached.state_version }
        : known;
      const fresh = await assistant.getChat(org, sid, have);
      return mergeChatDetail(cached, fresh);
    },
    staleTime: LIVE_STALE_TIME,
    retry: false,
  });

export const renameChatMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { sid: string; title: string }) =>
      assistant.renameChat(org, vars.sid, vars.title),
    meta: { invalidates: [assistantKeys.chats(org)], silentError: true },
  });

export const pinChatMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { sid: string; pinned: boolean }) =>
      assistant.pinChat(org, vars.sid, vars.pinned),
    meta: { invalidates: [assistantKeys.chats(org)], silentError: true },
  });

export const deleteChatMutation = (org: string, sid: string) =>
  mutationOptions({
    mutationFn: () => assistant.deleteChat(org, sid),
    meta: {
      invalidates: [assistantKeys.chats(org)],
      removes: [assistantKeys.chat(org, sid)],
      silentError: true,
    },
  });

export const deleteAllChatsMutation = (org: string) =>
  mutationOptions({
    mutationFn: () => assistant.deleteAllChats(org),
    meta: {
      invalidates: [assistantKeys.chats(org)],
      removes: [assistantKeys.all(org)],
      silentError: true,
    },
  });

/** A returned turn replaces its cached copy; turns past `partial_from_seq` follow in server order. */
export function mergeChatDetail(cached: ChatDetail | undefined, fresh: ChatDetail): ChatDetail {
  if (fresh.not_modified && cached?.turns) return { ...cached, ...fresh, turns: cached.turns };
  if (typeof fresh.partial_from_seq !== "number" || !cached?.turns) return fresh;
  const incoming = fresh.turns ?? [];
  const ids = new Set(incoming.map((turn) => turn.turn_id).filter(Boolean));
  const kept = cached.turns.filter(
    (turn) =>
      !ids.has(turn.turn_id) &&
      (typeof turn.last_seq !== "number" || turn.last_seq <= fresh.partial_from_seq!),
  );
  return { ...cached, ...fresh, turns: [...kept, ...incoming] };
}
