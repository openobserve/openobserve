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

import type {
  CreateShareRequest,
  ShareMode,
  ShareView,
  ShareVisibility,
} from "@/services/ai_chat_share";
import type { I18nKey } from "@/types/i18n";
import { getPath } from "@/utils/queryUtils";

export interface ShareForm {
  mode: ShareMode;
  visibility: ShareVisibility;
  /** 0 means the link never expires. */
  expiresInSecs: number;
}

export interface ExpiryPreset {
  value: number;
  labelKey: I18nKey;
}

const HOUR = 3600;
const DAY = 24 * HOUR;

export const EXPIRY_PRESETS: readonly ExpiryPreset[] = [
  { value: 0, labelKey: "aiChatShare.expiryNever" },
  { value: HOUR, labelKey: "aiChatShare.expiryHour" },
  { value: DAY, labelKey: "aiChatShare.expiryDay" },
  { value: 7 * DAY, labelKey: "aiChatShare.expiryWeek" },
  { value: 30 * DAY, labelKey: "aiChatShare.expiryMonth" },
  { value: 90 * DAY, labelKey: "aiChatShare.expiryQuarter" },
  { value: 365 * DAY, labelKey: "aiChatShare.expiryYear" },
];

export const defaultShareForm = (): ShareForm => ({
  mode: "snapshot",
  visibility: "org",
  expiresInSecs: 0,
});

export const isChatPersistenceEnabled = (zoConfig: any): boolean =>
  !!zoConfig?.ai_enabled && !!zoConfig?.ai_chat_persistence_enabled;

export const isPublicChatEnabled = (zoConfig: any): boolean =>
  isChatPersistenceEnabled(zoConfig) && !!zoConfig?.public_ai_chat_enabled;

export const visibilityChoices = (publicEnabled: boolean): ShareVisibility[] =>
  publicEnabled ? ["org", "public"] : ["org"];

/** The server refuses `public` while public links are off, so never send it then. */
export const buildCreateRequest = (form: ShareForm, publicEnabled: boolean): CreateShareRequest => {
  const request: CreateShareRequest = {
    mode: form.mode,
    visibility: form.visibility === "public" && publicEnabled ? "public" : "org",
  };
  if (form.expiresInSecs > 0) request.expires_in_secs = form.expiresInSecs;
  return request;
};

/** A chat can be shared once it is stored server-side and has a finished turn. */
export const canShareChat = (chat: {
  persistenceEnabled: boolean;
  sessionId: string | null | undefined;
  hasMessages: boolean;
  isStreaming?: boolean;
}): boolean => chat.persistenceEnabled && !!chat.sessionId && chat.hasMessages && !chat.isStreaming;

export const otherMode = (mode: ShareMode): ShareMode => (mode === "live" ? "snapshot" : "live");

/** `url_path` is rooted at `/web/`; the app may be served from another base. */
export const shareUrl = (
  urlPath: string,
  origin: string = window.location.origin,
  base: string = getPath() || "/",
): string => {
  const relative = urlPath.replace(/^\/web\//, "").replace(/^\//, "");
  const root = base.endsWith("/") ? base : `${base}/`;
  return `${origin}${root}${relative}`;
};

export const shareLinkOf = (share: Pick<ShareView, "url_path">): string => shareUrl(share.url_path);

export const statusOfError = (error: unknown): number | undefined => {
  const e = error as { status?: number; response?: { status?: number } } | null;
  return e?.response?.status ?? e?.status;
};

export const serverMessageOf = (error: unknown): string | undefined => {
  const data = (error as { response?: { data?: { message?: string; error?: string } } } | null)
    ?.response?.data;
  return data?.message || data?.error || undefined;
};

/** Microsecond server timestamps to a local date-time string. */
export const formatMicros = (micros: number | null | undefined): string =>
  micros ? new Date(micros / 1000).toLocaleString() : "";
