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

import { describe, it, expect, vi } from "vitest";
import { ref } from "vue";

/**
 * Only the PROMPT SELECTION is this file's logic; the typing loop is the shared
 * `useTypewriterPlaceholder`, covered by its own spec. So the loop is captured
 * rather than run.
 */
const captured = vi.hoisted(() => ({ prompts: null as any, options: null as any }));
vi.mock("@/components/ai-assistant/welcome/useTypewriterPlaceholder", () => ({
  useTypewriterPlaceholder: (prompts: any, options: any) => {
    captured.prompts = prompts;
    captured.options = options;
    return { placeholder: ref("") };
  },
}));

import { useFilterHint } from "./useFilterHint";

const promptsFor = (names: string[]) => {
  useFilterHint(ref(names), ref(true));
  return captured.prompts.value as string[];
};

describe("useFilterHint", () => {
  describe("the static examples (shown until label names load)", () => {
    it("demonstrates OR via alternation — the only way to express it", () => {
      const prompts = promptsFor([]);

      // Chips are ANDed, PromQL has no selector-level OR, and this engine
      // rejects `or` matchers — so `=~ "a|b"` is the ONLY way to say "either of
      // these", and nothing else on screen teaches it.
      expect(prompts.some((p) => p.includes("=~") && p.includes("|"))).toBe(
        true,
      );
    });

    it("covers the operators a user cannot guess, not just the obvious =", () => {
      const prompts = promptsFor([]);
      const all = prompts.join(" ");
      expect(all).toContain("=~");
      expect(all).toContain("!=");
    });
  });

  describe("real label names, once the schema has loaded", () => {
    it("prefers the org's actual labels over invented copy", () => {
      // The same principle as the Logs placeholder, which is generated from real
      // stream fields.
      expect(promptsFor(["pod", "status"])).toEqual(["pod = …", "status = …"]);
    });

    it("spreads its picks instead of taking the first N", () => {
      // Names arrive sorted, so the head is often one prefix (`__name__`,
      // `_o2_*`) — first-N would type that family and nothing else.
      const names = Array.from({ length: 40 }, (_, i) => `label_${i}`);
      const prompts = promptsFor(names);

      expect(prompts).toHaveLength(4);
      expect(prompts[0]).toBe("label_0 = …");
      expect(prompts[1]).toBe("label_10 = …");
    });

    it("re-reads the names when the schema lands — no re-mount", () => {
      const names = ref<string[]>([]);
      useFilterHint(names, ref(true));
      expect(captured.prompts.value[0]).toBe('pod = "api-1"'); // static fallback

      // Label names load lazily, on the first `+ Filter` click, so this row is
      // mounted long before they exist.
      names.value = ["job"];
      expect(captured.prompts.value).toEqual(["job = …"]);
    });
  });

  it("passes `enabled` through, so the timer loop can be paused", () => {
    const enabled = ref(false);
    useFilterHint(ref([]), enabled);
    expect(captured.options.enabled).toBe(enabled);
  });
});
