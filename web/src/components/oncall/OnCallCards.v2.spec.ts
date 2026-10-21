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
import { computed, defineComponent, h, nextTick } from "vue";

import i18n from "@/locales";
import type { OnCallResponseEvent } from "@/ts/interfaces/oncall";
import store from "@/test/unit/helpers/store";

const { admin } = vi.hoisted(() => ({ admin: { value: false } }));

vi.mock("@/composables/assistant/flags", () => ({ isAssistantV2: () => true }));
vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantCapability: () => computed(() => ({ isAdmin: admin.value })),
}));
vi.mock("@/components/ai-assistant/transcript/AssistantMessage.vue", () => ({
  __esModule: true,
  default: defineComponent({
    name: "AssistantMessage",
    props: { message: { type: Object, required: true } },
    setup: (props) => () =>
      h("div", { "data-test": "message" }, String((props.message as { content: string }).content)),
  }),
}));
vi.mock("@/components/ai-assistant/entry/AiEntryButton.vue", () => ({
  __esModule: true,
  default: defineComponent({
    name: "AiEntryButton",
    setup:
      (_props, { attrs }) =>
      () =>
        h("button", { "data-test": attrs["data-test"] }),
  }),
}));

import OnCallVerdictCard from "./OnCallVerdictCard.vue";
import OnCallReportCard from "./OnCallReportCard.vue";

const PAGE_AT = 1_786_000_000_000_000;

function event(over: Partial<OnCallResponseEvent> = {}): OnCallResponseEvent {
  return {
    kind: "ai_verdict",
    at: PAGE_AT + 120_000_000,
    actor: "o2-sre:model-x",
    body: "Connection pool exhausted after the deploy. Roll back.",
    ...over,
  } as OnCallResponseEvent;
}

const page = (at = PAGE_AT) => event({ kind: "page", at, body: "paged ana" });

async function renderVerdict(events: OnCallResponseEvent[]) {
  const wrapper = mount(OnCallVerdictCard, {
    props: { events },
    global: { plugins: [i18n, store] },
  });
  await vi.dynamicImportSettled();
  await flushPromises();
  return wrapper;
}

describe("OnCallVerdictCard on the v2 path", () => {
  it("renders nothing without a verdict, and the verdict as one default-card block with its door last", async () => {
    expect((await renderVerdict([page()])).find('[data-test="oncall-verdict-card"]').exists()).toBe(
      false,
    );
    const wrapper = await renderVerdict([page(), event()]);
    const card = wrapper.get('[data-test="oncall-verdict-card"]');
    expect(card.attributes("data-kind")).toBe("oncall_verdict");
    expect(card.classes().join(" ")).not.toContain("glass");
    expect(card.get('[data-test="agent-output-verdict"]').text()).toBe(
      "Connection pool exhausted after the deploy. Roll back.",
    );
    const controls = card.findAll("button");
    expect(controls.at(-1)?.attributes("data-test")).toBe("ai-entry-oncall-verdict-ask");
  });

  it("shows the follow-up note only for a verdict after the page went out", async () => {
    const late = await renderVerdict([page(), event({ at: PAGE_AT + 120_000_000 })]);
    expect(late.text()).toContain("sent as a follow-up");
    const early = await renderVerdict([page(), event({ at: PAGE_AT - 60_000_000 })]);
    expect(early.text()).not.toContain("sent as a follow-up");
  });

  it("tags only an applied promotion, in body text, never in the error colour", async () => {
    const applied = await renderVerdict([
      page(),
      event(),
      event({ kind: "severity_promoted", body: "severity promoted P3 → P1: error rate tripled" }),
    ]);
    expect(applied.get('[data-test="agent-output-note-tag"]').text()).toBe("Severity raised to P1");
    expect(applied.html()).not.toContain("text-status-error-text");
    const clamped = await renderVerdict([
      page(),
      event(),
      event({
        kind: "severity_promoted",
        body: "severity promoted P4 → P2 (the agent asked for P1, clamped to the promotion bound): x",
      }),
    ]);
    expect(clamped.find('[data-test="agent-output-note-tag"]').exists()).toBe(false);
    expect(clamped.text()).toContain("clamped to the promotion bound");
  });

  it("announces a verdict that arrives while the page is open, once", async () => {
    const wrapper = await renderVerdict([page()]);
    const region = () => wrapper.get('[data-test="oncall-verdict-announce"]').text();
    expect(region()).toBe("");
    await wrapper.setProps({ events: [page(), event()] });
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(region()).toBe("Verdict arrived: Connection pool exhausted after the deploy.");
    const open = await renderVerdict([page(), event()]);
    expect(open.get('[data-test="oncall-verdict-announce"]').text()).toBe("");
  });

  it("bylines the verdict with its actor and time", async () => {
    expect(
      (await renderVerdict([page(), event()])).get('[data-test="agent-output-byline"]').text(),
    ).toContain("o2-sre:model-x ·");
  });
});

describe("OnCallReportCard on the v2 path", () => {
  const report = {
    report: "## Found\nThe pool.",
    model: "model-x",
    generated_at: PAGE_AT,
  } as never;
  const renderReport = async (props: Record<string, unknown>) => {
    const wrapper = mount(OnCallReportCard, { props, global: { plugins: [i18n, store] } });
    await vi.dynamicImportSettled();
    await flushPromises();
    await nextTick();
    return wrapper;
  };

  it("keeps the tab's panel filled while loading, missing, failed or refetched to nothing", async () => {
    expect(
      (await renderReport({ report: null, loading: true }))
        .find('[data-test="oncall-report-loading"]')
        .exists(),
    ).toBe(true);
    expect(
      (await renderReport({ report: null, error: "missing" }))
        .get('[data-test="oncall-report-empty"]')
        .text(),
    ).toBe("No report for this response.");
    const failed = await renderReport({ report: null, error: "failed" });
    await failed.get('[data-test="oncall-report-retry"]').trigger("click");
    expect(failed.emitted("retry")).toHaveLength(1);
    expect(
      (await renderReport({ report: null })).find('[data-test="oncall-report-empty"]').exists(),
    ).toBe(true);
  });

  it("renders the report through the shared block, model hidden from members", async () => {
    admin.value = false;
    const wrapper = await renderReport({ report });
    expect(wrapper.get('[data-test="oncall-report-card"]').attributes("data-kind")).toBe(
      "oncall_report",
    );
    expect(wrapper.get('[data-test="message"]').text()).toContain("The pool.");
    expect(wrapper.text()).not.toContain("model-x");
    expect(wrapper.text()).not.toContain("AI SRE");
    admin.value = true;
    expect(
      (await renderReport({ report })).get('[data-test="agent-output-byline"]').text(),
    ).toContain("model-x ·");
    admin.value = false;
  });
});
