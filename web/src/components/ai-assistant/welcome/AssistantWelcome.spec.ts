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
import OCard from "@/lib/core/Card/OCard.vue";
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
  it("is a section labelled by its capability line, with the scope as a paragraph", () => {
    const wrapper = mountWelcome();
    const section = wrapper.get('[data-test="assistant-welcome"]');
    expect(section.element.tagName).toBe("SECTION");
    const heading = wrapper.get('[data-test="assistant-welcome-capability"]');
    expect(heading.element.tagName).toBe("H2");
    expect(section.attributes("aria-labelledby")).toBe(heading.attributes("id"));
    expect(wrapper.get('[data-test="assistant-welcome-scope"]').element.tagName).toBe("P");
  });

  it("states the capability by canWrite, treating unknown as read-write", () => {
    const readWrite =
      "Ask about your logs, traces, metrics, alerts and dashboards. It runs read-only queries, links to what it finds and asks before changing anything.";
    expect(mountWelcome().get("h2").text()).toBe(readWrite);
    expect(
      mountWelcome({ scope: { ...SCOPE, canWrite: "unknown" } })
        .get("h2")
        .text(),
    ).toBe(readWrite);
    expect(
      mountWelcome({ scope: { ...SCOPE, canWrite: "no" } })
        .get("h2")
        .text(),
    ).toContain("can't change anything in this organization.");
  });

  it("lists what it sees as neutral tags, with Beta only in the roomy variant", () => {
    const compact = mountWelcome();
    expect(compact.get('[data-test="assistant-welcome-scope"]').text()).toContain("Sees:");
    expect(compact.get('[data-test="assistant-welcome-scope-org"]').text()).toBe("org acme");
    expect(compact.get('[data-test="assistant-welcome-scope-streams"]').text()).toBe("12 streams");
    expect(compact.get('[data-test="assistant-welcome-scope-time"]').text()).toBe("last 15 min");
    expect(compact.get('[data-test="assistant-welcome-sent-with-first"]').text()).toBe(
      "Sent with your first message",
    );
    expect(compact.text()).not.toContain("Beta");
    const roomy = mountWelcome({ variant: "roomy" });
    expect(roomy.get('[data-test="assistant-welcome-beta"]').text()).toBe("Beta");
    expect(roomy.get('[data-test="assistant-welcome-scope"]').text()).not.toContain("Beta");
  });

  it("says no streams yet for a fresh org and marks it", () => {
    const wrapper = mountWelcome({ scope: { ...SCOPE, streamCount: 0 } });
    expect(wrapper.get('[data-test="assistant-welcome-scope-streams"]').text()).toBe(
      "no streams yet",
    );
    expect(wrapper.get('[data-test="assistant-welcome"]').attributes("data-fresh")).toBe("");
  });

  it("renders three wrapping secondary buttons in a list under a hidden Suggestions heading", () => {
    const wrapper = mountWelcome();
    expect(wrapper.get("h3").text()).toBe("Suggestions");
    expect(wrapper.get("h3").classes()).toContain("sr-only");
    const buttons = wrapper.findAll("ul > li button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0].classes()).toContain("whitespace-normal!");
    expect(buttons[0].classes()).toContain("max-md:min-h-11");
    expect(wrapper.get("ul").html()).not.toMatch(/truncate|line-clamp/);
  });

  it("grows every starter to a 2.75 rem target on coarse pointers at any width", () => {
    for (const button of mountWelcome().findAll("ul > li button")) {
      expect(button.classes()).toContain("pointer-coarse:min-h-11");
    }
  });

  it("renders neutral cards in the roomy variant", () => {
    expect(mountWelcome({ variant: "roomy" }).findAllComponents(OCard)).toHaveLength(3);
  });

  it("shows skeleton rows instead of the scope and starters while loading", () => {
    const wrapper = mountWelcome({ loading: true });
    expect(wrapper.find('[data-test="assistant-welcome-loading"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-welcome-capability"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-starter-0"]').exists()).toBe(false);
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

  it("renders the scope tags as read-only tray chips that open What the assistant sees (`70` §8)", async () => {
    const wrapper = mount(AssistantWelcome, {
      props: { variant: "compact", scope: SCOPE, starters: STARTERS, loading: false },
      attachTo: document.body,
    });
    const tag = wrapper.get('[data-test="assistant-welcome-scope-org"]');
    expect(tag.attributes("data-assistant-chip")).toBe("");
    expect(tag.find('[data-test="assistant-context-chip-remove"]').exists()).toBe(false);
    await tag.get('[data-test="assistant-context-chip-button"]').trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      document.body.querySelector('[data-test="assistant-context-sees-popover"]'),
    ).not.toBeNull();
    wrapper.unmount();
  });

  it("marks and hands focus back to the scope chip that opened What the assistant sees (U2, V7)", async () => {
    const wrapper = mount(AssistantWelcome, {
      props: { variant: "compact", scope: SCOPE, starters: STARTERS, loading: false },
      attachTo: document.body,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const button = wrapper
      .get('[data-test="assistant-welcome-scope-time"]')
      .get('[data-test="assistant-context-chip-button"]');
    (button.element as HTMLElement).focus();
    await button.trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      document.body.querySelector('[data-test="assistant-context-sees-popover"]'),
    ).not.toBeNull();
    expect(button.attributes("aria-expanded")).toBe("true");
    expect(
      wrapper
        .get('[data-test="assistant-welcome-scope-org"]')
        .get('[data-test="assistant-context-chip-button"]')
        .attributes("aria-expanded"),
    ).toBe("false");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body.querySelector('[data-test="assistant-context-sees-popover"]')).toBeNull();
    expect(document.activeElement).toBe(button.element);
    wrapper.unmount();
  });
});

describe("AssistantWelcome docked", () => {
  it("leads the scope line with the editor's object, then its stream and range", () => {
    const wrapper = mountWelcome({
      scope: {
        ...SCOPE,
        timeRange: raw("last 1 h"),
        editor: { language: "sql", stream: "default" },
      },
    });
    const tags = wrapper
      .findAll('[data-test^="assistant-welcome-scope-"]')
      .map((tag) => tag.text());
    expect(tags).toEqual(["this SQL", "stream default", "last 1 h"]);
  });
});
