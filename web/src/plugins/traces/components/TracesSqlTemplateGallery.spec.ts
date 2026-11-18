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
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import TracesSqlTemplateGallery from "./TracesSqlTemplateGallery.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import { tracesSqlTemplates } from "@/utils/traces/tracesSqlTemplates";

const mountGallery = (fields: string[] = []) =>
  mount(TracesSqlTemplateGallery, {
    props: {
      templates: tracesSqlTemplates("default", { services: ["cart", "redis"], fields }),
    },
    global: { plugins: [i18n] },
  });

const groupCards = (wrapper: ReturnType<typeof mountGallery>, group: string) =>
  wrapper
    .find(`[data-test="traces-sql-template-group-${group}"]`)
    .findAll('[data-test="traces-sql-template-card"]');

describe("TracesSqlTemplateGallery", () => {
  it("titles the gallery for span queries", () => {
    const wrapper = mountGallery();
    expect(wrapper.find('[data-test="traces-sql-gallery-title"]').text()).toBe(
      "Query spans with SQL",
    );
    expect(wrapper.find('[data-test="traces-sql-gallery-lede"]').text()).toBe(
      "Your query runs over spans, and the result shows as a table with one column per field. Start from a template or write your own.",
    );
  });

  it("shows Trace questions first, then Span summaries", () => {
    const wrapper = mountGallery();
    const headings = wrapper.findAll('[data-test="traces-sql-template-group-title"]');
    expect(headings.map((h) => h.text())).toEqual(["Trace questions", "Span summaries"]);
    const trace = groupCards(wrapper, "traceQuestions");
    expect(trace).toHaveLength(6);
    expect(trace[0].text()).toContain("Slow traces");
    expect(trace[0].text()).toContain("Whole trace longer than 2 s");
    expect(trace[0].find('[data-test="traces-sql-template-sql"]').text()).toContain(
      "ORDER BY trace_duration DESC",
    );
    expect(groupCards(wrapper, "spanSummaries")).toHaveLength(4);
  });

  it("says plainly that N+1 is one row per parent over client spans", () => {
    const nPlusOne = groupCards(mountGallery(), "traceQuestions")[3];
    expect(nPlusOne.text()).toContain("N+1 database calls");
    expect(nPlusOne.text()).toContain(
      "One row per parent with more than 50 client spans. Columns cover client spans only, so duration_ms is not the trace duration.",
    );
  });

  it("wraps long SQL lines inside the card", () => {
    const codes = mountGallery().findAllComponents(OCode);
    expect(codes).toHaveLength(10);
    expect(codes.every((code) => code.props("wrap"))).toBe(true);
  });

  it("marks the service names it filled in", () => {
    const missing = groupCards(mountGallery(), "traceQuestions")[4];
    expect(
      missing.findAll('[data-test="traces-sql-template-service"]').map((m) => m.text()),
    ).toEqual(["'cart'", "'redis'"]);
    expect(missing.find('[data-test="traces-sql-template-sql"]').text()).toContain(
      "service_name = 'redis'",
    );
  });

  it("adds Tokens by model only for LLM fields", () => {
    expect(
      groupCards(
        mountGallery(["gen_ai_request_model", "gen_ai_usage_input_tokens"]),
        "spanSummaries",
      ),
    ).toHaveLength(5);
  });

  it("hides a group with no templates", () => {
    const wrapper = mount(TracesSqlTemplateGallery, {
      props: {
        templates: tracesSqlTemplates("default", { services: [], fields: [] }).filter(
          (tpl) => tpl.group === "spanSummaries",
        ),
      },
      global: { plugins: [i18n] },
    });
    expect(wrapper.find('[data-test="traces-sql-template-group-traceQuestions"]').exists()).toBe(
      false,
    );
  });

  it("hands the template SQL up on Use template", async () => {
    const wrapper = mountGallery();
    const templates = tracesSqlTemplates("default", { services: ["cart", "redis"], fields: [] });
    await wrapper.findAll('[data-test="traces-sql-template-use-btn"]')[1].trigger("click");
    expect(wrapper.emitted("use")).toEqual([[templates[1].sql]]);
  });
});
