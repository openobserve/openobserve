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

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import OnCallActivityTimeline from "@/components/oncall/OnCallActivityTimeline.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import type { OnCallResponseEvent } from "@/ts/interfaces/oncall";

vi.mock("@/services/users", () => ({
  default: {
    orgUsers: vi.fn().mockResolvedValue({
      data: { data: [{ email: "ana@o2.ai", first_name: "Ana", last_name: "Ruiz" }] },
    }),
  },
}));

const OPENED = Date.UTC(2026, 10, 3, 14, 37) * 1000;
const TEAM = "3JLu2gX36MBdlQC54gmuy1cGHVf";

const events: OnCallResponseEvent[] = [
  {
    kind: "sys",
    at: OPENED,
    actor: "o2-engine",
    body: "opened for alert/3KGMcsdq6K4B29SoZ1XLpyUMpmY#1: checkout-errors",
  },
  {
    kind: "sys",
    at: OPENED,
    actor: "o2-engine",
    body: `no ownership rule covers service=test; no ownership rule matched, so it went to the default team ${TEAM}`,
  },
  {
    kind: "page",
    at: OPENED + 120_000_000,
    actor: "o2-engine",
    body: "paged ana@o2.ai",
    rung_micros: 300_000_000,
  },
  { kind: "ack", at: OPENED + 180_000_000, actor: "ana@o2.ai", body: "ana@o2.ai acknowledged" },
  {
    kind: "recovery",
    at: OPENED + 240_000_000,
    actor: "o2-engine",
    body: "the alert stopped firing",
  },
  {
    kind: "state",
    at: OPENED + 240_000_000,
    actor: "o2-engine",
    body: "resolved: recovered automatically",
  },
];

// The real shared timeline underneath, so the props this wrapper hands it are what the reader sees.
async function render() {
  const wrapper = mount(OnCallActivityTimeline, {
    props: {
      events,
      commentText: "",
      openedAt: OPENED,
      stepOf: (rung: number) => (rung === 300_000_000 ? 2 : null),
      teamNameOf: (id: string) => (id === TEAM ? "Checkout" : null),
    },
    global: { plugins: [i18n, store] },
  });
  await flushPromises();
  return wrapper;
}

const personTip = (wrapper: Awaited<ReturnType<typeof render>>) =>
  wrapper.findAllComponents({ name: "OTooltip" }).find((tip) => tip.props("anchor") !== undefined)!;

describe("OnCallActivityTimeline", () => {
  it("reads each line in plain words, with names and steps instead of ids and delays", async () => {
    store.state.timezone = "UTC";
    const text = (await render()).text();

    expect(text).toContain(
      "No routing rule covers service=test — sent to the default team Checkout",
    );
    expect(text).toContain("Paged Ana Ruiz (step 2)");
    expect(text).toContain("Ana Ruiz");
    expect(text).not.toContain("o2-engine");
    expect(text).not.toContain(TEAM);
    expect(text).not.toContain("rung");
  });

  it("drops the kind tags and the duplicate recovery line", async () => {
    const text = (await render()).text();

    expect(text).not.toContain("System");
    expect(text.match(/stopped firing/g)).toHaveLength(1);
  });

  /// Display names can repeat in an org, so each one carries its email on hover.
  it("puts the email behind each person's name in a tooltip, not a native title", async () => {
    const wrapper = await render();
    const person = wrapper.find('[data-oncall-person="ana@o2.ai"]');

    expect(person.exists()).toBe(true);
    expect(person.text()).toBe("Ana Ruiz");
    expect(wrapper.find("span[title]").exists()).toBe(false);

    await person.trigger("pointerover");
    const tooltip = personTip(wrapper);
    expect(tooltip.props("open")).toBe(true);
    expect(tooltip.props("content")).toBe("Ana Ruiz (ana@o2.ai)");
    expect(tooltip.props("anchor")).toBe(person.element);
  });

  /// The "Acknowledged" line leads with the actor, whose name needs the same email.
  it("gives the acting person's name the same tooltip", async () => {
    const wrapper = await render();
    const actor = wrapper.findAll("span.font-semibold").find((span) => span.text() === "Ana Ruiz");

    await actor!.trigger("pointerover");
    expect(personTip(wrapper).props("content")).toBe("Ana Ruiz (ana@o2.ai)");
    await actor!.trigger("pointerout");
    expect(personTip(wrapper).props("open")).toBe(false);
  });

  /// Every page is firing #1 at first, so the number only shows once it repeats.
  it("drops the firing number on a first firing", async () => {
    const text = (await render()).text();

    expect(text).toContain("Opened");
    expect(text).not.toContain("firing #1");
  });

  /// Without the policy the rung delay would sit beside the clock offset as a second, different time.
  it("says no delay when the step cannot be named", async () => {
    const wrapper = mount(OnCallActivityTimeline, {
      props: { events, commentText: "", openedAt: OPENED, stepOf: () => null },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();

    expect(wrapper.text()).not.toContain("(at +");
    expect(wrapper.text()).not.toContain("(step");
  });

  it("stamps lines with the clock time and the offset from opening", async () => {
    store.state.timezone = "UTC";
    const text = (await render()).text();

    expect(text).toContain("14:37");
    expect(text).toContain("14:39 · +2m");
  });
  /// The agent's paragraph is held to three lines with a way to read the rest; generated lines are not.
  it("clamps the AI verdict line and leaves the other lines whole", async () => {
    const verdict: OnCallResponseEvent = {
      kind: "ai_verdict",
      at: OPENED + 300_000_000,
      actor: "o2-sre",
      body: "The alert fired because the test stream carries synthetic data. ".repeat(8),
    };
    const wrapper = mount(OnCallActivityTimeline, {
      props: { events: [...events, verdict], commentText: "", openedAt: OPENED },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();

    const clamped = wrapper.findAll('[data-test="oncall-clamped-text-body"]');
    expect(clamped).toHaveLength(1);
    expect(clamped[0].text()).toContain("synthetic data");
    expect(clamped[0].classes()).toContain("line-clamp-3");
  });

  /// The page scrolls past a long feed, so the note box stays stuck to its foot rather than below the fold.
  it("sticks the note box to the page's foot when pinned", async () => {
    const wrapper = mount(OnCallActivityTimeline, {
      props: { events, commentText: "", openedAt: OPENED, pinComposer: true },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();

    const composer = wrapper
      .find('[data-test="oncall-response-note-input"]')
      .element.closest(".pt-2");
    const classes = composer?.className.split(" ") ?? [];
    expect(classes).toEqual(expect.arrayContaining(["sticky", "bg-surface-base", "border-t"]));
    expect(classes).toEqual(expect.arrayContaining(["-bottom-page-edge", "-mx-4", "px-4"]));
  });

  it("leaves the note box in the flow when not pinned", async () => {
    const wrapper = mount(OnCallActivityTimeline, {
      props: { events, commentText: "", openedAt: OPENED },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();

    const composer = wrapper
      .find('[data-test="oncall-response-note-input"]')
      .element.closest(".pt-2");
    expect(composer?.className).not.toContain("sticky");
  });
});
