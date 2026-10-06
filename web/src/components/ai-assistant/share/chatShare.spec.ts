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
  applyVisibility,
  buildCreateRequest,
  canShareChat,
  defaultShareForm,
  expiryPresetsFor,
  isChatPersistenceEnabled,
  isOrgAdmin,
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

  it("treats root and org admins as admins", () => {
    expect(isOrgAdmin({ userInfo: { role: "root" } })).toBe(true);
    expect(isOrgAdmin({ userInfo: { role: "Admin" } })).toBe(true);
    expect(isOrgAdmin({ currentuser: { role: "admin" } })).toBe(true);
    expect(isOrgAdmin({ userInfo: { role: "editor" } })).toBe(false);
    expect(isOrgAdmin({})).toBe(false);
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
