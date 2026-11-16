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

import { describe, expect, it } from "vitest";
import { ref } from "vue";

import {
  isAutoNavigationEnabled,
  useAutoNavigationPreferences,
} from "./useAutoNavigationPreferences";

describe("useAutoNavigationPreferences", () => {
  it("is on by default for every chat", () => {
    const { isAutoNavigationEnabled: on } = useAutoNavigationPreferences(ref("s1"), ref("scope-a"));
    expect(on.value).toBe(true);
    expect(isAutoNavigationEnabled("scope-a", "s2")).toBe(true);
  });

  it("keeps a chat's choice per user+org in localStorage", () => {
    const chat = ref<string | null>("s1");
    const { isAutoNavigationEnabled: on } = useAutoNavigationPreferences(chat, ref("scope-b"));
    on.value = false;
    expect(on.value).toBe(false);
    expect(JSON.parse(localStorage.getItem("ai-chat-auto-navigation:scope-b")!)).toEqual({
      s1: false,
    });
    // Another chat and another scope keep the default.
    chat.value = "s2";
    expect(on.value).toBe(true);
    expect(isAutoNavigationEnabled("scope-c", "s1")).toBe(true);
  });

  it("reads a choice saved before the page loaded", () => {
    localStorage.setItem("ai-chat-auto-navigation:scope-d", JSON.stringify({ s9: false }));
    expect(isAutoNavigationEnabled("scope-d", "s9")).toBe(false);
  });

  it("gives a choice made before a chat exists to the chat that appears, then resets to on", () => {
    const chat = ref<string | null>(null);
    const { isAutoNavigationEnabled: on } = useAutoNavigationPreferences(chat, ref("scope-e"));
    expect(on.value).toBe(true);
    on.value = false;
    expect(on.value).toBe(false);
    chat.value = "s1";
    expect(on.value).toBe(false);
    expect(isAutoNavigationEnabled("scope-e", "s1")).toBe(false);
    chat.value = null;
    expect(on.value).toBe(true);
    chat.value = "s2";
    expect(on.value).toBe(true);
  });
});
