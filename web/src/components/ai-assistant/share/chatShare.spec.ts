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
  buildCreateRequest,
  canShareChat,
  defaultShareForm,
  isChatPersistenceEnabled,
  isPublicChatEnabled,
  otherMode,
  serverMessageOf,
  shareUrl,
  statusOfError,
  visibilityChoices,
} from "./chatShare";

describe("chatShare", () => {
  it("defaults to an org snapshot that never expires", () => {
    expect(defaultShareForm()).toEqual({ mode: "snapshot", visibility: "org", expiresInSecs: 0 });
  });

  it("omits expires_in_secs for never and keeps it otherwise", () => {
    expect(
      buildCreateRequest({ mode: "live", visibility: "org", expiresInSecs: 0 }, false),
    ).toEqual({ mode: "live", visibility: "org" });
    expect(
      buildCreateRequest({ mode: "snapshot", visibility: "org", expiresInSecs: 3600 }, false),
    ).toEqual({ mode: "snapshot", visibility: "org", expires_in_secs: 3600 });
  });

  it("never sends public visibility while public links are disabled", () => {
    const form = { mode: "snapshot" as const, visibility: "public" as const, expiresInSecs: 0 };
    expect(buildCreateRequest(form, false).visibility).toBe("org");
    expect(buildCreateRequest(form, true).visibility).toBe("public");
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
