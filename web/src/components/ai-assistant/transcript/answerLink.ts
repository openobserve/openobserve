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

import { isOutOfDate, shareLinkOf } from "@/components/ai-assistant/share/chatShare";
import { AI_HOME_TAB, HOME_TAB_QUERY_KEY, THREAD_QUERY_KEY } from "@/composables/assistant/pure";
import type { ShareView } from "@/services/ai_chat_share";
import { getPath } from "@/utils/queryUtils";

export interface AnswerLinkInput {
  org: string;
  sid: string;
  turnId: string;
  /** The chat's share link, when it has one; the answer anchor is added to it. */
  shareUrl?: string | null;
}

const ANCHOR_PREFIX = "answer-";

/** The element id an answer carries, so a link's fragment lands on it. */
export function answerAnchor(turnId: string): string {
  return `${ANCHOR_PREFIX}${encodeURIComponent(turnId)}`;
}

/** The turn a location hash names, or null when it names no answer. */
export function answerTurnOf(hash: string | null | undefined): string | null {
  const fragment = (hash ?? "").replace(/^#/, "");
  if (!fragment.startsWith(ANCHOR_PREFIX)) return null;
  try {
    return decodeURIComponent(fragment.slice(ANCHOR_PREFIX.length)) || null;
  } catch {
    return null;
  }
}

/** The link of a chat's share that still opens and holds the whole chat, or null; a stale snapshot may lack the answer. */
export function activeShareUrl(
  shares: readonly ShareView[] | undefined,
  lastSeq: number | null,
  nowMicros: number = Date.now() * 1000,
): string | null {
  const share = shares?.find(
    (item) =>
      !!shareLinkOf(item) &&
      (item.expires_at === null || item.expires_at > nowMicros) &&
      !isOutOfDate(item, lastSeq),
  );
  return share ? shareLinkOf(share) : null;
}

/** A link to one answer: the chat's share page when it has one, else the thread on Home; opening it never runs a query. */
export function answerLink(
  input: AnswerLinkInput,
  origin: string = window.location.origin,
  base: string = getPath() || "/",
): string {
  const anchor = answerAnchor(input.turnId);
  if (input.shareUrl) return `${input.shareUrl.replace(/#.*$/, "")}#${anchor}`;
  const root = base.endsWith("/") ? base : `${base}/`;
  const query = new URLSearchParams({
    org_identifier: input.org,
    [HOME_TAB_QUERY_KEY]: AI_HOME_TAB,
    [THREAD_QUERY_KEY]: input.sid,
  });
  return `${origin}${root}?${query.toString()}#${anchor}`;
}
