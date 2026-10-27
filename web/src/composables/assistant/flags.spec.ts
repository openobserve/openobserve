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

import { afterEach, describe, expect, it, vi } from "vitest";

import { assistantV2Source, isAssistantV2, resetAssistantV2ForTests } from "./flags";

afterEach(() => {
  delete window.__O2_ASSISTANT_V2__;
  localStorage.removeItem("o2.assistant.v2");
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetAssistantV2ForTests();
});

describe("isAssistantV2", () => {
  it("is off by default, decided by the build", () => {
    vi.stubEnv("VITE_ASSISTANT_V2", undefined);
    expect(isAssistantV2()).toBe(false);
    expect(assistantV2Source()).toBe("build");
  });

  it("follows the build default when nothing overrides it", () => {
    vi.stubEnv("VITE_ASSISTANT_V2", "true");
    expect(isAssistantV2()).toBe(true);
    expect(assistantV2Source()).toBe("build");
  });

  it("lets the dogfood opt-in in localStorage beat the build default", () => {
    vi.stubEnv("VITE_ASSISTANT_V2", "false");
    localStorage.setItem("o2.assistant.v2", "1");
    expect(isAssistantV2()).toBe(true);
    expect(assistantV2Source()).toBe("local");
  });

  it("ignores a localStorage value other than 1", () => {
    localStorage.setItem("o2.assistant.v2", "true");
    expect(isAssistantV2()).toBe(false);
    expect(assistantV2Source()).toBe("build");
  });

  it("lets the harness global beat localStorage in both directions", () => {
    localStorage.setItem("o2.assistant.v2", "1");
    window.__O2_ASSISTANT_V2__ = false;
    expect(isAssistantV2()).toBe(false);
    expect(assistantV2Source()).toBe("harness");

    resetAssistantV2ForTests();
    localStorage.removeItem("o2.assistant.v2");
    window.__O2_ASSISTANT_V2__ = true;
    expect(isAssistantV2()).toBe(true);
    expect(assistantV2Source()).toBe("harness");
  });

  it("resolves once per page load", () => {
    expect(isAssistantV2()).toBe(false);
    localStorage.setItem("o2.assistant.v2", "1");
    window.__O2_ASSISTANT_V2__ = true;
    expect(isAssistantV2()).toBe(false);
    expect(assistantV2Source()).toBe("build");

    resetAssistantV2ForTests();
    expect(isAssistantV2()).toBe(true);
  });

  it("falls back to the build default when storage access throws", () => {
    vi.stubEnv("VITE_ASSISTANT_V2", "true");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(isAssistantV2()).toBe(true);
    expect(assistantV2Source()).toBe("build");
  });
});
