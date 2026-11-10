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

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createStore } from "vuex";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import InsightBlock from "./InsightBlock.vue";
import { ASK_AI_KEY } from "./insightCta";
import type { InsightCta, InsightParts } from "./insightCopy";

const cta: InsightCta = {
  key: "review-query",
  action: "reviewAlert",
  label: raw("Review query"),
  target: {
    type: "review_alert",
    action: { type: "review_alert", alert_id: "a2", focus: "query" },
    alertName: "payments-latency",
    findingId: "f1",
  },
  note: raw("Opens the alert editor at the query. Nothing is saved until you save."),
};

const logs: InsightCta = {
  key: "logs-app",
  action: "openInLogs",
  label: raw("Open in Logs"),
  target: { type: "route", to: { path: "/logs" } },
  note: null,
};

const insight = (over: Partial<InsightParts> = {}): InsightParts => ({
  id: "f1",
  chip: { label: raw("Not working"), variant: "error-soft", tone: "failure" },
  headline: raw("payments-latency filters on duration_ms, a field its stream no longer has"),
  why: raw("4 of 9 runs failed in the last calibration window."),
  whyDetail: null,
  next: raw("Check the field the query filters on: none of its streams has it."),
  cta,
  secondary: [logs],
  note: cta.note,
  facts: [],
  meta: null,
  dismissable: {
    finding_id: "f1",
    rule_id: "failure",
    scope_kind: "alert",
    scope_key: "a2",
  },
  ai: {
    kind: "alert_not_working",
    subject: "payments-latency",
    request: raw("Suggest a corrected query and don't save it."),
    facts: [["Alert", "payments-latency"]],
  },
  ...over,
});

const storeWith = (ai: boolean) =>
  createStore({
    state: { zoConfig: { ai_enabled: ai }, selectedOrganization: { identifier: "demo-org" } },
  });

const mountBlock = (
  parts: InsightParts,
  variant?: "card" | "details",
  opts: { ai?: boolean; ask?: (p: unknown) => void } = {},
) =>
  mount(InsightBlock, {
    props: { parts, ...(variant ? { variant } : {}) },
    global: {
      plugins: [i18n, storeWith(opts.ai ?? true)],
      provide: opts.ask ? { [ASK_AI_KEY as symbol]: opts.ask } : {},
    },
  });

const sel = (part: string) => `[data-test="insight-block-f1-${part}"]`;

describe("InsightBlock card (test 8)", () => {
  it("paints chip, headline, why and CTA with Details collapsed (M-L)", () => {
    const wrapper = mountBlock(insight());
    expect(wrapper.get(sel("chip")).text()).toBe("Not working");
    expect(wrapper.get(sel("headline")).text()).toContain("payments-latency");
    expect(wrapper.get(sel("why")).text()).toBe(
      "4 of 9 runs failed in the last calibration window.",
    );
    expect(wrapper.get(sel("cta")).text()).toBe("Review query");
    expect(wrapper.find(sel("details")).exists()).toBe(false);
    expect(wrapper.get(sel("details-toggle")).attributes("aria-expanded")).toBe("false");
    expect(wrapper.find("article > span").classes()).toContain("bg-status-error-text");
  });

  it("unclamps the why while Details is open", async () => {
    const wrapper = mountBlock(insight());
    const why = wrapper.get(sel("why"));
    expect(why.classes()).toContain("line-clamp-2");
    await wrapper.get(sel("details-toggle")).trigger("click");
    expect(why.classes()).not.toContain("line-clamp-2");
    await wrapper.get(sel("details-toggle")).trigger("click");
    expect(why.classes()).toContain("line-clamp-2");
  });

  it("keeps Dismiss… and the note on the card, and opens Details with Next and the secondary action", async () => {
    const wrapper = mountBlock(insight());
    expect(wrapper.get(sel("dismiss")).text()).toBe("Dismiss…");
    expect(wrapper.get(sel("note")).text()).toContain("Nothing is saved until you save.");
    const toggle = wrapper.get(sel("details-toggle"));
    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    const details = wrapper.get(sel("details"));
    expect(toggle.attributes("aria-controls")).toBe(details.attributes("id"));
    expect(wrapper.get(sel("next")).text()).toContain("Check the field");
    expect(wrapper.find(sel("why-detail")).exists()).toBe(false);
    expect(wrapper.get(sel("secondary-logs-app")).text()).toBe("Open in Logs");
    expect(details.findAll(sel("cta"))).toHaveLength(0);
    expect(details.findAll(sel("dismiss"))).toHaveLength(0);
  });

  it("shows Dismiss… only for a dismissable insight", async () => {
    const wrapper = mountBlock(insight({ dismissable: null }));
    await wrapper.get(sel("details-toggle")).trigger("click");
    expect(wrapper.find(sel("dismiss")).exists()).toBe(false);
  });

  it("offers Ask AI beside the fix and hands the chat a chip and a prefilled request, never sent", async () => {
    const ask = vi.fn();
    const wrapper = mountBlock(insight(), "card", { ask });
    const button = wrapper.get(sel("ask-ai"));
    expect(button.text()).toBe("Ask AI");
    await button.trigger("click");
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toMatchObject({
      prompt: "Suggest a corrected query and don't save it.",
      chipName: "AutoObserve finding · payments-latency",
      newChat: true,
      autoSend: false,
      context: { currentPage: "autoobserve", org_id: "demo-org" },
    });
  });

  it("leaves Ask AI out, not disabled, when AI is off or nothing can take the request", () => {
    expect(
      mountBlock(insight(), "card", { ai: false, ask: vi.fn() }).find(sel("ask-ai")).exists(),
    ).toBe(false);
    expect(mountBlock(insight()).find(sel("ask-ai")).exists()).toBe(false);
    expect(
      mountBlock(insight({ ai: null }), "card", { ask: vi.fn() })
        .find(sel("ask-ai"))
        .exists(),
    ).toBe(false);
  });

  it("shows a locked fix disabled with its lock and the reason line, and never emits it", async () => {
    const locked = {
      ...cta,
      locked: raw("You can't change alerts in folder ops. Ask an admin of this organization."),
    };
    const wrapper = mountBlock(insight({ cta: locked }), "card", { ask: vi.fn() });
    const button = wrapper.get(sel("cta"));
    expect(button.attributes("disabled")).toBeDefined();
    expect(wrapper.get(sel("locked")).text()).toBe(
      "You can't change alerts in folder ops. Ask an admin of this organization.",
    );
    await button.trigger("click");
    expect(wrapper.emitted("cta")).toBeUndefined();
    expect(wrapper.find(sel("ask-ai")).exists()).toBe(true);
  });

  it("keeps the CTA when there is no why", () => {
    const wrapper = mountBlock(insight({ why: null }));
    expect(wrapper.find(sel("why")).exists()).toBe(false);
    expect(wrapper.get(sel("cta")).text()).toBe("Review query");
  });

  it("emits each button's action and holds no data logic", async () => {
    const wrapper = mountBlock(insight());
    await wrapper.get(sel("cta")).trigger("click");
    await wrapper.get(sel("dismiss")).trigger("click");
    await wrapper.get(sel("details-toggle")).trigger("click");
    await wrapper.get(sel("secondary-logs-app")).trigger("click");
    expect(wrapper.emitted("cta")).toEqual([[cta]]);
    expect(wrapper.emitted("secondary")).toEqual([[logs]]);
    expect(wrapper.emitted("dismiss")).toHaveLength(1);
  });

  it("shows the CTA as busy while its target is looked up", () => {
    const wrapper = mount(InsightBlock, {
      props: { parts: insight(), pending: true },
      global: { plugins: [i18n, storeWith(false)] },
    });
    expect(wrapper.get(sel("cta")).attributes("aria-busy")).toBe("true");
  });

  it("draws a gap amber and information neutral", () => {
    const amber = mountBlock(
      insight({ chip: { label: raw("Coverage gap"), variant: "amber-soft", tone: "gap" } }),
    );
    expect(amber.find("article > span").classes()).toContain("bg-badge-amber-soft-text");
    const neutral = mountBlock(
      insight({ chip: { label: raw("Other"), variant: "default-soft", tone: "info" } }),
    );
    expect(neutral.find("article > span").classes()).toContain("bg-border-default");
  });
});

describe("InsightBlock fact hints", () => {
  it("explains a fact chip that carries a hint in a tooltip, and leaves the others plain", () => {
    const wrapper = mountBlock(
      insight({
        facts: [
          {
            label: raw("Confirmed condition"),
            variant: "default-soft",
            hint: raw("What A means."),
          },
          { label: raw("High"), variant: "warning-soft" },
        ],
      }),
      "details",
    );
    const tips = wrapper.findAllComponents(OTooltip);
    expect(tips).toHaveLength(1);
    expect(tips[0].props("content")).toBe("What A means.");
    expect(wrapper.text()).toContain("Confirmed condition");
    expect(wrapper.text()).toContain("High");
  });
});

describe("InsightBlock details only (drawer row)", () => {
  it("is the open Details with the why and the CTA as the main action", () => {
    const wrapper = mountBlock(insight(), "details");
    expect(wrapper.find(sel("chip")).exists()).toBe(false);
    expect(wrapper.get(sel("why-detail")).text()).toBe(
      "4 of 9 runs failed in the last calibration window.",
    );
    expect(wrapper.get(sel("details")).find(sel("cta")).text()).toBe("Review query");
  });

  it("draws the CTA as a card's one outline button, the size of the rail's (T5-8)", () => {
    const button = mountBlock(insight(), "details").findComponent(sel("cta"));
    expect(button.props("variant")).toBe("outline");
    expect(button.props("size")).toBe("sm");
  });

  it("prefers the longer Details why when a kind has one", () => {
    const wrapper = mountBlock(
      insight({ whyDetail: raw("Errors: none, latency: none") }),
      "details",
    );
    expect(wrapper.get(sel("why-detail")).text()).toBe("Errors: none, latency: none");
  });
});

describe("InsightBlock details under a row that shows the CTA itself (T5-N7)", () => {
  const mountRow = () =>
    mount(InsightBlock, {
      props: { parts: insight(), variant: "details", hideCta: true },
      global: { plugins: [i18n, storeWith(true)] },
    });

  it("drops the hidden CTA's note, which would describe a button that isn't there", () => {
    expect(mountRow().find(sel("note")).exists()).toBe(false);
  });

  it("draws link-like actions ghost-primary xs and Dismiss ghost-muted at the row's xs size", () => {
    const wrapper = mountRow();
    const logs = wrapper.getComponent(sel("secondary-logs-app"));
    expect([logs.props("variant"), logs.props("size")]).toEqual(["ghost-primary", "xs"]);
    const dismiss = wrapper.getComponent(sel("dismiss"));
    expect([dismiss.props("variant"), dismiss.props("size")]).toEqual(["ghost-muted", "xs"]);
  });

  it("keeps the note under a details block that shows its own CTA", () => {
    const wrapper = mountBlock(insight(), "details");
    expect(wrapper.get(sel("note")).text()).toContain("Opens the alert editor at the query.");
  });
});
