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

import { afterEach, describe, expect, it } from "vitest";

import { computeLlmObservabilityKey } from "./llmObservabilityKey";
import { computeUserOrgKey } from "./userOrgKey";

afterEach(() => localStorage.clear());

describe("computeLlmObservabilityKey", () => {
  it("is stable per user and org", async () => {
    const a = await computeLlmObservabilityKey("ana@example.com", "default");
    expect(await computeLlmObservabilityKey("ana@example.com", "default")).toBe(a);
    expect(await computeLlmObservabilityKey("bo@example.com", "default")).not.toBe(a);
    expect(await computeLlmObservabilityKey("ana@example.com", "other")).not.toBe(a);
  });

  it("never equals the assistant's userOrgKey for the same user and org", async () => {
    const llm = await computeLlmObservabilityKey("ana@example.com", "default");
    const assistant = await computeUserOrgKey("ana@example.com", "default");
    expect(llm).not.toBe(assistant);
    expect(llm).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps a Playground draft when the assistant clears everything under its own key", async () => {
    const llm = await computeLlmObservabilityKey("ana@example.com", "default");
    const assistant = await computeUserOrgKey("ana@example.com", "default");
    localStorage.setItem(`o2-playground-drafts:${llm}`, '[{"id":"d1"}]');
    localStorage.setItem(`ai-chat-query-history:${assistant}`, '["why 5xx"]');
    localStorage.setItem(`o2.assistant.sidebar:${assistant}`, "{}");

    // The assistant's clear-all and sign-out sweep remove every key scoped by its userOrgKey.
    for (const key of Object.keys(localStorage)) {
      if (key.includes(assistant) || key.startsWith("o2.assistant.")) localStorage.removeItem(key);
    }

    expect(localStorage.getItem(`o2-playground-drafts:${llm}`)).toBe('[{"id":"d1"}]');
    expect(localStorage.length).toBe(1);
  });
});
