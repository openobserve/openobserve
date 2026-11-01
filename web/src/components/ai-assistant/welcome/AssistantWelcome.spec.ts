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

import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssistantScope, Starter } from "@/composables/assistant";
import { raw } from "@/types/i18n";

import AssistantWelcome, {
  resetWelcomeTelemetryForTests,
  type AssistantWelcomeProps,
} from "./AssistantWelcome.vue";

const { track } = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: track,
}));

const SCOPE: AssistantScope = {
  org: "acme",
  orgName: "acme",
  streamCount: 12,
  timeRange: raw("last 15 min"),
  canWrite: "yes",
};

const starter = (index: number, over: Partial<Starter> = {}): Starter => ({
  id: `s${index}`,
  kind: "page",
  label: raw(`Starter ${index} with a label long enough to wrap onto a second line`),
  prompt: `Starter ${index}`,
  chips: [],
  dataTest: `assistant-starter-${index}`,
  ...over,
});

const STARTERS = [starter(0), starter(1), starter(2, { kind: "recent", chatId: 42 })];

const mountWelcome = (props: Partial<AssistantWelcomeProps> = {}) =>
  mount(AssistantWelcome, {
    props: { variant: "compact", scope: SCOPE, starters: STARTERS, loading: false, ...props },
  });

beforeEach(() => resetWelcomeTelemetryForTests());
afterEach(() => track.mockClear());

describe("AssistantWelcome", () => {
  it("is a section of plain suggestion rows, nothing else (§8)", () => {
    const wrapper = mountWelcome();
    const section = wrapper.get('[data-test="assistant-welcome"]');
    expect(section.element.tagName).toBe("SECTION");
    expect(section.attributes("aria-label")).toBe("Suggestions");
    expect(wrapper.findAll("li")).toHaveLength(3);
    expect(wrapper.find("h2").exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-welcome-scope"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="assistant-starter-0"]').classes()).toContain(
      "whitespace-normal!",
    );
  });

  it("never offers more than three, and marks a fresh org", () => {
    const wrapper = mountWelcome({
      scope: { ...SCOPE, streamCount: 0 },
      starters: [...STARTERS, starter(3)],
    });
    expect(wrapper.findAll("li")).toHaveLength(3);
    expect(wrapper.get('[data-test="assistant-welcome"]').attributes("data-fresh")).toBe("");
  });

  it("sets a backticked name in the mono face", () => {
    const wrapper = mountWelcome({
      starters: [starter(0, { label: raw("Summarise errors in `app_logs`") })],
    });
    expect(wrapper.get("code").text()).toBe("app_logs");
    expect(wrapper.text()).not.toContain("`");
  });

  it("grows every starter to a 2.75 rem target on coarse pointers at any width", () => {
    for (const button of mountWelcome().findAll("ul > li button")) {
      expect(button.classes()).toContain("pointer-coarse:min-h-11");
    }
  });

  it("shows skeleton rows instead of the starters while loading", () => {
    const wrapper = mountWelcome({ loading: true });
    expect(wrapper.find('[data-test="assistant-welcome-loading"]').exists()).toBe(true);
    expect(wrapper.find("li").exists()).toBe(false);
  });

  it("emits a page starter for staging and opens a recent chat instead", async () => {
    const wrapper = mountWelcome();
    await wrapper.get('[data-test="assistant-starter-0"]').trigger("click");
    await wrapper.get('[data-test="assistant-starter-2"]').trigger("click");
    expect(wrapper.emitted("select-starter")).toEqual([[STARTERS[0]]]);
    expect(wrapper.emitted("open-chat")).toEqual([[{ chatId: 42 }]]);
    expect(track).toHaveBeenCalledWith("ai_welcome_starter", {
      starter_kind: "page",
      index: 0,
      via: "click",
    });
  });

  it("reports ai_welcome_shown once per container", () => {
    mountWelcome({ container: "sidebar" });
    mountWelcome({ container: "sidebar" });
    mountWelcome({ container: "full_view" });
    expect(track.mock.calls.filter(([name]) => name === "ai_welcome_shown")).toEqual([
      ["ai_welcome_shown", { fresh_org: false, starter_kinds: ["page", "page", "recent"] }],
      ["ai_welcome_shown", { fresh_org: false, starter_kinds: ["page", "page", "recent"] }],
    ]);
  });
});
