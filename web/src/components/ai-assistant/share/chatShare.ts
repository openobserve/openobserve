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
  /** Viewers see tool names only, not tool inputs or outputs. */
  redactTools: boolean;
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

export const DEFAULT_PUBLIC_MAX_EXPIRY_DAYS = 90;

const PREFERRED_PUBLIC_EXPIRY = 30 * DAY;

const ADMIN_ROLES = ["root", "admin"];

export const defaultShareForm = (): ShareForm => ({
  mode: "snapshot",
  visibility: "org",
  expiresInSecs: 0,
  redactTools: false,
});

/** Longest lifetime the server accepts for a public link, in seconds. */
export const publicMaxExpirySecs = (zoConfig: any): number => {
  const days = Number(zoConfig?.public_ai_chat_max_expiry_days);
  return (Number.isFinite(days) && days > 0 ? days : DEFAULT_PUBLIC_MAX_EXPIRY_DAYS) * DAY;
};

/** Public links must expire within the server's maximum, so "never" and longer presets drop out. */
export const expiryPresetsFor = (
  visibility: ShareVisibility,
  maxPublicSecs: number,
): readonly ExpiryPreset[] =>
  visibility === "public"
    ? EXPIRY_PRESETS.filter((preset) => preset.value > 0 && preset.value <= maxPublicSecs)
    : EXPIRY_PRESETS;

const validPublicExpiry = (secs: number, maxPublicSecs: number) =>
  secs > 0 && secs <= maxPublicSecs;

const defaultPublicExpiry = (maxPublicSecs: number): number => {
  const allowed = expiryPresetsFor("public", maxPublicSecs);
  const preferred = allowed.find((preset) => preset.value === PREFERRED_PUBLIC_EXPIRY);
  return (preferred ?? allowed[allowed.length - 1])?.value ?? maxPublicSecs;
};

/** Switch visibility, resetting tool redaction to its default for it and keeping a public expiry valid. */
export const applyVisibility = (
  form: ShareForm,
  visibility: ShareVisibility,
  maxPublicSecs: number,
): void => {
  form.visibility = visibility;
  form.redactTools = visibility === "public";
  if (visibility === "public" && !validPublicExpiry(form.expiresInSecs, maxPublicSecs)) {
    form.expiresInSecs = defaultPublicExpiry(maxPublicSecs);
  }
};

export const isChatPersistenceEnabled = (zoConfig: any): boolean =>
  !!zoConfig?.ai_enabled && !!zoConfig?.ai_chat_persistence_enabled;

export const isPublicChatEnabled = (zoConfig: any): boolean =>
  isChatPersistenceEnabled(zoConfig) && !!zoConfig?.public_ai_chat_enabled;

/** Whether the user is an admin of the selected org, from the server's explicit flag or a root login; undefined when unknown. */
export const orgAdminFlag = (state: any): boolean | undefined => {
  const selected = state?.selectedOrganization?.identifier;
  const org = (state?.organizations ?? []).find((o: any) => o?.identifier === selected);
  const explicit = [
    state?.zoConfig?.is_org_admin,
    state?.selectedOrganization?.is_org_admin,
    org?.is_org_admin,
    state?.userInfo?.is_org_admin,
  ].find((flag) => typeof flag === "boolean");
  if (explicit !== undefined) return explicit;
  const loginRole = String(state?.userInfo?.role ?? state?.currentuser?.role ?? "").toLowerCase();
  return loginRole === "root" ? true : undefined;
};

/** Whether a member list (the IAM users page's source) gives `email` an admin role. */
export const isAdminInMembers = (
  members: any[] | undefined,
  email: string | undefined,
): boolean => {
  const me = email?.toLowerCase();
  if (!me || !members) return false;
  const mine = members.find((member) => member?.email?.toLowerCase() === me);
  return ADMIN_ROLES.includes(String(mine?.role ?? "").toLowerCase());
};

export const visibilityChoices = (publicEnabled: boolean): ShareVisibility[] =>
  publicEnabled ? ["org", "public"] : ["org"];

/** The server refuses `public` while public links are off, and a public link without a bounded expiry. */
export const buildCreateRequest = (
  form: ShareForm,
  publicEnabled: boolean,
  maxPublicSecs: number = DEFAULT_PUBLIC_MAX_EXPIRY_DAYS * DAY,
): CreateShareRequest => {
  const visibility = form.visibility === "public" && publicEnabled ? "public" : "org";
  const request: CreateShareRequest = {
    mode: form.mode,
    visibility,
    redact_tools: form.redactTools,
  };
  if (visibility === "public") {
    request.expires_in_secs = validPublicExpiry(form.expiresInSecs, maxPublicSecs)
      ? form.expiresInSecs
      : defaultPublicExpiry(maxPublicSecs);
  } else if (form.expiresInSecs > 0) {
    request.expires_in_secs = form.expiresInSecs;
  }
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

/** Empty for a share listed without its link (the org-wide admin list). */
export const shareLinkOf = (share: Pick<ShareView, "url_path">): string =>
  share.url_path ? shareUrl(share.url_path) : "";

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
