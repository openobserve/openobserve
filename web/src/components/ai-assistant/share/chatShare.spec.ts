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

import { describe, it, expect } from "vitest";
import {
  EXPIRY_PRESETS,
  QUICK_SHARE_EXPIRY_SECS,
  canRedactAttachments,
  hasAttachments,
  isOutOfDate,
  presetOf,
  quickShareForm,
  shareButtonState,
  summarizeShares,
  switchVisibility,
  type ShareButtonInput,
  applyVisibility,
  buildCreateRequest,
  canShareChat,
  defaultShareForm,
  expiryPresetsFor,
  isChatPersistenceEnabled,
  isAdminInMembers,
  orgAdminFlag,
  isPublicChatEnabled,
  otherMode,
  publicMaxExpirySecs,
  serverMessageOf,
  shareUrl,
  statusOfError,
  visibilityChoices,
} from "./chatShare";

describe("chatShare", () => {
  const DAY = 86400;
  const MAX = 90 * DAY;

  it("defaults to an org snapshot that never expires and shows tool data", () => {
    expect(defaultShareForm()).toEqual({
      mode: "snapshot",
      visibility: "org",
      expiresInSecs: 0,
      redactTools: false,
    });
  });

  it("omits expires_in_secs for a never-expiring org link and keeps it otherwise", () => {
    const org = { mode: "live" as const, visibility: "org" as const, redactTools: false };
    expect(buildCreateRequest({ ...org, expiresInSecs: 0 }, false)).toEqual({
      mode: "live",
      visibility: "org",
      redact_tools: false,
    });
    expect(buildCreateRequest({ ...org, expiresInSecs: 3600 }, false)).toEqual({
      mode: "live",
      visibility: "org",
      expires_in_secs: 3600,
      redact_tools: false,
    });
  });

  it("never sends public visibility while public links are disabled", () => {
    const form = {
      mode: "snapshot" as const,
      visibility: "public" as const,
      expiresInSecs: 7 * DAY,
      redactTools: true,
    };
    expect(buildCreateRequest(form, false).visibility).toBe("org");
    expect(buildCreateRequest(form, true, MAX)).toEqual({
      mode: "snapshot",
      visibility: "public",
      expires_in_secs: 7 * DAY,
      redact_tools: true,
    });
  });

  it("always sends a public link an expiry within the maximum", () => {
    const form = {
      mode: "snapshot" as const,
      visibility: "public" as const,
      expiresInSecs: 0,
      redactTools: true,
    };
    expect(buildCreateRequest(form, true, MAX).expires_in_secs).toBe(30 * DAY);
    expect(
      buildCreateRequest({ ...form, expiresInSecs: 365 * DAY }, true, MAX).expires_in_secs,
    ).toBe(30 * DAY);
    expect(buildCreateRequest(form, true, 10 * DAY).expires_in_secs).toBe(7 * DAY);
  });

  it("switching visibility resets redaction to its default and keeps public expiry valid", () => {
    const form = defaultShareForm();
    applyVisibility(form, "public", MAX);
    expect(form).toMatchObject({
      visibility: "public",
      redactTools: true,
      expiresInSecs: 30 * DAY,
    });
    form.expiresInSecs = DAY;
    applyVisibility(form, "org", MAX);
    expect(form).toMatchObject({ visibility: "org", redactTools: false, expiresInSecs: DAY });
    applyVisibility(form, "public", MAX);
    expect(form.expiresInSecs).toBe(DAY);
  });

  it("offers public links only expiries within the maximum, never 'never'", () => {
    const publicValues = expiryPresetsFor("public", MAX).map((p) => p.value);
    expect(publicValues).not.toContain(0);
    expect(Math.max(...publicValues)).toBe(MAX);
    expect(expiryPresetsFor("org", MAX)).toBe(EXPIRY_PRESETS);
  });

  it("reads the public expiry cap from /config, defaulting to 90 days", () => {
    expect(publicMaxExpirySecs({})).toBe(MAX);
    expect(publicMaxExpirySecs({ public_ai_chat_max_expiry_days: 30 })).toBe(30 * DAY);
    expect(publicMaxExpirySecs({ public_ai_chat_max_expiry_days: 0 })).toBe(MAX);
  });

  it("reads the server's org admin flag first, then a root login, else unknown", () => {
    expect(orgAdminFlag({ zoConfig: { is_org_admin: true } })).toBe(true);
    expect(orgAdminFlag({ zoConfig: { is_org_admin: false }, userInfo: { role: "root" } })).toBe(
      false,
    );
    expect(
      orgAdminFlag({
        selectedOrganization: { identifier: "o1" },
        organizations: [{ identifier: "o1", is_org_admin: true }],
      }),
    ).toBe(true);
    expect(orgAdminFlag({ userInfo: { role: "root" } })).toBe(true);
    expect(orgAdminFlag({ userInfo: { role: "admin" } })).toBeUndefined();
    expect(orgAdminFlag({})).toBeUndefined();
  });

  it("finds an admin role for the user in the org member list", () => {
    const members = [
      { email: "Ada@x.io", role: "Admin" },
      { email: "bob@x.io", role: "editor" },
    ];
    expect(isAdminInMembers(members, "ada@x.io")).toBe(true);
    expect(isAdminInMembers(members, "bob@x.io")).toBe(false);
    expect(isAdminInMembers(undefined, "ada@x.io")).toBe(false);
  });

  it("offers the public option only when enabled", () => {
    expect(visibilityChoices(false)).toEqual(["org"]);
    expect(visibilityChoices(true)).toEqual(["org", "public"]);
  });

  it("keeps every expiry preset within the server's 60 s .. 365 d range", () => {
    for (const preset of EXPIRY_PRESETS.filter((p) => p.value > 0)) {
      expect(preset.value).toBeGreaterThanOrEqual(60);
      expect(preset.value).toBeLessThanOrEqual(365 * 24 * 3600);
    }
  });

  it("reads the persistence and public flags from /config", () => {
    expect(isChatPersistenceEnabled({ ai_enabled: true, ai_chat_persistence_enabled: true })).toBe(
      true,
    );
    expect(isChatPersistenceEnabled({ ai_enabled: false, ai_chat_persistence_enabled: true })).toBe(
      false,
    );
    expect(
      isPublicChatEnabled({
        ai_enabled: true,
        ai_chat_persistence_enabled: true,
        public_ai_chat_enabled: true,
      }),
    ).toBe(true);
    expect(isPublicChatEnabled({ ai_enabled: true, ai_chat_persistence_enabled: true })).toBe(
      false,
    );
  });

  it("allows sharing only a persisted, settled chat with messages", () => {
    const base = { persistenceEnabled: true, sessionId: "s", hasMessages: true };
    expect(canShareChat(base)).toBe(true);
    expect(canShareChat({ ...base, persistenceEnabled: false })).toBe(false);
    expect(canShareChat({ ...base, sessionId: null })).toBe(false);
    expect(canShareChat({ ...base, hasMessages: false })).toBe(false);
    expect(canShareChat({ ...base, isStreaming: true })).toBe(false);
  });

  it("flips the mode", () => {
    expect(otherMode("live")).toBe("snapshot");
    expect(otherMode("snapshot")).toBe("live");
  });

  it("rebases url_path onto the app's own base", () => {
    expect(shareUrl("/web/ai/public/tok", "https://o2.example", "/web/")).toBe(
      "https://o2.example/web/ai/public/tok",
    );
    expect(shareUrl("/web/ai/shared/tok?org_identifier=o1", "http://localhost:8081", "/")).toBe(
      "http://localhost:8081/ai/shared/tok?org_identifier=o1",
    );
    expect(shareUrl("/web/ai/public/tok", "https://h", "/o2/web/")).toBe(
      "https://h/o2/web/ai/public/tok",
    );
  });

  it("extracts the HTTP status and server message from errors", () => {
    const axiosError = { response: { status: 404, data: { message: "not found" } } };
    expect(statusOfError(axiosError)).toBe(404);
    expect(statusOfError({ status: 400 })).toBe(400);
    expect(statusOfError(null)).toBeUndefined();
    expect(serverMessageOf(axiosError)).toBe("not found");
    expect(serverMessageOf(new Error("x"))).toBeUndefined();
  });
});

describe("quick share", () => {
  it("is an org snapshot with tool data hidden for 90 days, and no hide_attachments unless advertised", () => {
    const body = buildCreateRequest(quickShareForm(), false, undefined, false);
    expect(body).toEqual({
      mode: "snapshot",
      visibility: "org",
      redact_tools: true,
      expires_in_secs: QUICK_SHARE_EXPIRY_SECS,
    });
    expect(QUICK_SHARE_EXPIRY_SECS).toBe(90 * 86_400);
    expect(buildCreateRequest(quickShareForm(), false, undefined, true).hide_attachments).toBe(
      true,
    );
  });

  it("reads attachment redaction only from an explicit true", () => {
    expect(canRedactAttachments({ ai_share_redact_attachments: true })).toBe(true);
    expect(canRedactAttachments({ ai_share_redact_attachments: "true" })).toBe(false);
    expect(canRedactAttachments(undefined)).toBe(false);
  });

  it("keeps redaction when visibility switches, and bounds a public expiry", () => {
    const form = { ...quickShareForm(), redactTools: false, expiresInSecs: 0 };
    switchVisibility(form, "public", 30 * 86_400);
    expect(form.redactTools).toBe(false);
    expect(form.expiresInSecs).toBe(30 * 86_400);
    form.redactTools = true;
    switchVisibility(form, "org", 30 * 86_400);
    expect(form.redactTools).toBe(true);
  });
});

describe("shareButtonState", () => {
  const base: ShareButtonInput = {
    persistence: true,
    canShare: "yes",
    denied: false,
    hasTurn: true,
    running: false,
    notSaved: false,
    historyUnavailable: false,
    shared: false,
    hasAttachments: false,
    redactAttachments: false,
  };

  it.each<[Partial<ShareButtonInput>, ReturnType<typeof shareButtonState>]>([
    [{ persistence: false }, { kind: "absent" }],
    [{ canShare: "no" }, { kind: "blocked", reason: "assistant.gate.noShare.tooltip" }],
    [{ denied: true }, { kind: "blocked", reason: "assistant.gate.noShare.tooltip" }],
    [{ hasTurn: false }, { kind: "blocked", reason: "assistant.share.nothingToShare" }],
    [
      { running: true, shared: true },
      { kind: "blocked", reason: "assistant.share.waitForAnswer" },
    ],
    [{ notSaved: true }, { kind: "blocked", reason: "assistant.share.notSavedBlocked" }],
    [
      { historyUnavailable: true },
      { kind: "blocked", reason: "assistant.share.historyUnavailable" },
    ],
    [{ shared: true }, { kind: "manage", tooltip: "assistant.share.manage" }],
    [{ hasAttachments: true }, { kind: "review", tooltip: "assistant.share.reviewTooltip" }],
    [
      { hasAttachments: true, redactAttachments: true },
      { kind: "quick", tooltip: "assistant.share.tooltip" },
    ],
    [{ canShare: "unknown" }, { kind: "quick", tooltip: "assistant.share.tooltip" }],
  ])("%o → %o", (over, expected) => {
    expect(shareButtonState({ ...base, ...over })).toEqual(expected);
  });
});

describe("share summary", () => {
  const view = {
    id: "s1",
    mode: "snapshot" as const,
    visibility: "org" as const,
    snapshot_seq: 4,
    expires_at: 2_000_000_000_000,
    created_at: 1_000_000,
    updated_at: 1,
    access_count: 0,
    last_accessed_at: null,
    session_id: "c1",
    title: "t",
    redact_tools: true,
  };

  it("summarises the first link, counts the rest and marks a stale snapshot", () => {
    expect(summarizeShares([], 5)).toBeNull();
    expect(summarizeShares([view, { ...view, id: "s2" }], 6)).toEqual({
      id: "s1",
      visibility: "org",
      mode: "snapshot",
      expiresAt: 2_000_000_000,
      outOfDate: true,
      count: 2,
    });
    expect(isOutOfDate(view, 4)).toBe(false);
    expect(isOutOfDate({ ...view, mode: "live" }, 9)).toBe(false);
    expect(isOutOfDate(view, null)).toBe(false);
  });

  it("finds the preset a link was made with", () => {
    expect(presetOf({ expires_at: null, created_at: 0 })).toBe(0);
    expect(presetOf({ expires_at: 86_400 * 1_000_000, created_at: 0 })).toBe(86_400);
    expect(presetOf({ expires_at: 5 * 1_000_000, created_at: 0 })).toBeNull();
  });

  it("finds attachments in chips, images and attachment blocks of prompts only", () => {
    const user = (extra: object) => ({ role: "user" as const, content: "hi", ...extra });
    expect(hasAttachments([user({})])).toBe(false);
    expect(hasAttachments([user({ images: [{ data: "", mimeType: "image/png" }] })])).toBe(true);
    expect(hasAttachments([user({ chips: [{ id: "c" }] })] as never)).toBe(true);
    expect(hasAttachments([{ role: "assistant", content: "x", images: [{}] }] as never)).toBe(
      false,
    );
  });
});
