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

const mountGallery = (view: "traces" | "spans", fields: string[] = []) =>
  mount(TracesSqlTemplateGallery, {
    props: {
      view,
      templates: tracesSqlTemplates(view, "default", { services: ["cart", "redis"], fields }),
    },
    global: { plugins: [i18n] },
  });

describe("TracesSqlTemplateGallery", () => {
  it("shows the trace templates with name, description and SQL in the Traces view", () => {
    const wrapper = mountGallery("traces");
    expect(wrapper.find('[data-test="traces-sql-gallery-title"]').text()).toBe(
      i18n.global.t("traces.sqlMode.gallery.tracesTitle"),
    );
    const cards = wrapper.findAll('[data-test="traces-sql-template-card"]');
    expect(cards).toHaveLength(6);
    expect(cards[0].text()).toContain(i18n.global.t("traces.sqlMode.templates.slowTraces.name"));
    expect(cards[0].text()).toContain(
      i18n.global.t("traces.sqlMode.templates.slowTraces.description"),
    );
    expect(cards[0].find('[data-test="traces-sql-template-sql"]').text()).toContain(
      "HAVING max(end_time) - min(start_time) > 2000000000",
    );
  });

  it("wraps long SQL lines inside the card", () => {
    const codes = mountGallery("traces").findAllComponents(OCode);
    expect(codes).toHaveLength(6);
    expect(codes.every((code) => code.props("wrap"))).toBe(true);
  });

  it("marks the service names it filled in", () => {
    const wrapper = mountGallery("traces");
    const missing = wrapper.findAll('[data-test="traces-sql-template-card"]')[4];
    expect(
      missing.findAll('[data-test="traces-sql-template-service"]').map((m) => m.text()),
    ).toEqual(["'cart'", "'redis'"]);
    expect(missing.find('[data-test="traces-sql-template-sql"]').text()).toContain(
      "service_name = 'redis'",
    );
  });

  it("shows the aggregate templates in the Spans view, with Tokens by model only for LLM fields", () => {
    const plain = mountGallery("spans");
    expect(plain.find('[data-test="traces-sql-gallery-title"]').text()).toBe(
      i18n.global.t("traces.sqlMode.gallery.spansTitle"),
    );
    expect(plain.findAll('[data-test="traces-sql-template-card"]')).toHaveLength(4);
    expect(
      mountGallery("spans", ["gen_ai_request_model", "gen_ai_usage_input_tokens"]).findAll(
        '[data-test="traces-sql-template-card"]',
      ),
    ).toHaveLength(5);
  });

  it("hands the template SQL up on Use template", async () => {
    const wrapper = mountGallery("traces");
    await wrapper.findAll('[data-test="traces-sql-template-use-btn"]')[1].trigger("click");
    expect(wrapper.emitted("use")).toEqual([
      ['SELECT trace_id FROM "default"\nGROUP BY trace_id\nHAVING count(*) > 200'],
    ]);
  });
});
