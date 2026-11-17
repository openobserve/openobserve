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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import config from "@/aws-exports";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import OverviewAskAiButton from "./OverviewAskAiButton.vue";
import { buildOverviewAskAi, type OverviewAskAiBase } from "./overviewAskAi";

const base: OverviewAskAiBase = {
  orgId: "acme",
  startTime: 1_700_000_000_000_000,
  endTime: 1_700_000_900_000_000,
  rangeLabel: "Past 15 minutes",
  generatedAt: 1_700_000_950_000_000,
};
const t = ((key: string, params?: Record<string, unknown>) =>
  params?.name ? `${key}:${params.name}` : key) as never;

const mountButton = (props: Record<string, unknown> = {}) =>
  mount(OverviewAskAiButton, {
    props: { kind: "tile", itemKey: "firing", ...props },
    global: { plugins: [i18n, store] },
  });
const SEL = '[data-test="overview-ask-ai-tile-firing"]';

describe("buildOverviewAskAi", () => {
  it("builds a named-chip hand-off for a headline count with the time range", () => {
    const out = buildOverviewAskAi(
      { kind: "count", topic: "firing", count: 3, level: "critical" },
      base,
      t,
    );
    expect(out.query).toBe("Why are 3 alerts firing and what should I check first?");
    expect(out).toMatchObject({ newChat: true, autoSend: false });
    expect(out.chipName).toBe("overview.askAi.chip.firing");
    expect(out.context).toMatchObject({
      currentPage: "Alerts",
      kind: "firing",
      count: 3,
      level: "critical",
      org_id: "acme",
      start_time: base.startTime,
      end_time: base.endTime,
      range_label: "Past 15 minutes",
      generated_at: base.generatedAt,
    });
  });

  it.each([
    ["failing", "Alerts", "Why did 2 alert rules fail their last evaluation?"],
    ["incidents", "incidents", "Help me triage 2 open incidents."],
    ["pipelines", "Pipelines", "2 pipelines are errored. How do I find which and why?"],
    ["quiet", "Streams", "2 streams stopped receiving data. How do I find them and the cause?"],
    ["delivery", "Alerts", "2 alerts fired but could not notify. How do I find the cause?"],
  ] as const)("maps %s to its page and prompt", (topic, page, query) => {
    const out = buildOverviewAskAi({ kind: "count", topic, count: 2 }, base, t);
    expect(out.query).toBe(query);
    expect(out.context.currentPage).toBe(page);
    expect(out.context).not.toHaveProperty("level");
  });

  it.each([
    ["failing", "Why did 1 alert rule fail its last evaluation?"],
    ["incidents", "Help me triage 1 open incident."],
    ["pipelines", "1 pipeline is errored. How do I find which and why?"],
    ["quiet", "1 stream stopped receiving data. How do I find it and the cause?"],
    ["delivery", "1 alert fired but could not notify. How do I find the cause?"],
    ["firing", "Why is 1 alert firing and what should I check first?"],
    ["critical", "Why is 1 critical alert firing and what should I check first?"],
    ["warning", "Why is 1 warning alert firing and what should I check first?"],
  ] as const)("uses singular grammar for one %s", (topic, query) => {
    expect(buildOverviewAskAi({ kind: "count", topic, count: 1 }, base, t).query).toBe(query);
  });

  it("describes a firing alert row", () => {
    const out = buildOverviewAskAi(
      {
        kind: "alert",
        alert: { name: "high_cpu", stream: "cpu", level: "critical", since: 1_699_996_400_000_000 },
      },
      base,
      t,
    );
    expect(out.context).toMatchObject({
      currentPage: "Alerts",
      alert_name: "high_cpu",
      stream: "cpu",
      level: "critical",
      firing_since_us: 1_699_996_400_000_000,
      org_id: "acme",
    });
  });

  it("falls back to the id for an empty incident title", () => {
    const out = buildOverviewAskAi(
      { kind: "incident", incident: { id: "inc2", title: "" } },
      base,
      t,
    );
    expect(out.query).toBe('Help me triage the incident "inc2".');
    expect(out.chipName).toBe("overview.askAi.chip.incident:inc2");
  });

  it("describes an open incident row", () => {
    const out = buildOverviewAskAi(
      {
        kind: "incident",
        incident: {
          id: "inc1",
          title: "Checkout down",
          severity: "P1",
          alert_count: 4,
          group_values: { svc: "api" },
          first_alert_at: 1_699_996_400_000_000,
        },
      },
      base,
      t,
    );
    expect(out.context).toMatchObject({
      currentPage: "incidents",
      incident_id: "inc1",
      title: "Checkout down",
      severity: "P1",
      alert_count: 4,
      group_values: { svc: "api" },
      first_alert_at: 1_699_996_400_000_000,
    });
  });
});

describe("OverviewAskAiButton visibility", () => {
  let zo: Record<string, unknown>;
  let flag: string;
  let cloud: string;
  beforeEach(() => {
    zo = { ...store.state.zoConfig };
    flag = config.isEnterprise;
    cloud = config.isCloud;
    config.isEnterprise = "true";
    config.isCloud = "false";
    store.commit("setConfig", { ...zo, ai_enabled: true, features: { ai_assistant: "enabled" } });
  });
  afterEach(() => {
    config.isEnterprise = flag;
    config.isCloud = cloud;
    store.commit("setConfig", zo);
  });

  it("renders an icon-only, labelled button when AI is on", () => {
    const w = mountButton();
    expect(w.find(SEL).exists()).toBe(true);
    expect(w.get(SEL).attributes("aria-label")).toBe("Ask AI");
  });

  it("names the item in the label and tooltip when given one", () => {
    const w = mountButton({ label: "high_cpu" });
    expect(w.get(SEL).attributes("aria-label")).toBe("Ask AI about high_cpu");
  });

  it("emits ask on click without bubbling to a parent", async () => {
    let bubbled = false;
    const w = mount(
      {
        components: { B: OverviewAskAiButton },
        template: '<div @click="hit"><B kind="tile" item-key="firing" /></div>',
        methods: { hit: () => (bubbled = true) },
      },
      { global: { plugins: [i18n, store] } },
    );
    await w.get(SEL).trigger("click");
    expect(bubbled).toBe(false);
    expect(w.findComponent(OverviewAskAiButton).emitted("ask")).toHaveLength(1);
  });

  it("is hidden when AI is disabled", () => {
    store.commit("setConfig", { ...zo, ai_enabled: false, features: {} });
    expect(mountButton().find(SEL).exists()).toBe(false);
  });

  it("is hidden in an OSS build", () => {
    config.isEnterprise = "false";
    config.isCloud = "false";
    expect(mountButton().find(SEL).exists()).toBe(false);
  });

  it("is visible in a cloud build", () => {
    config.isEnterprise = "false";
    config.isCloud = "true";
    expect(mountButton().find(SEL).exists()).toBe(true);
  });

  it("is hidden when the assistant is license-locked", () => {
    store.commit("setConfig", { ...zo, ai_enabled: true, features: { ai_assistant: "locked" } });
    expect(mountButton().find(SEL).exists()).toBe(false);
  });

  it("is hidden when its card is not in a problem state", () => {
    expect(mountButton({ show: false }).find(SEL).exists()).toBe(false);
  });
});
