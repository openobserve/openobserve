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

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import LogsErrorState from "./LogsErrorState.vue";

describe("LogsErrorState recovery cards (J5)", () => {
  const mountError = (props: Record<string, unknown>) =>
    mount(LogsErrorState, {
      props: { errorCode: 20004, errorMsg: "Unknown field 'timeout'", aiEnabled: false, ...props },
      global: { plugins: [i18n], provide: { store } },
    });

  it("passes the Run-as suggestion through and emits it verbatim (AC5.6)", async () => {
    const wrapper = mountError({ runSuggestion: "level='api' AND match_all('timeout')" });
    const card = wrapper.find('[data-test="query-error-run-suggestion-card"]');
    expect(card.text()).toContain("level='api' AND match_all('timeout')");
    expect(wrapper.find('[data-test="query-error-search-text-card"]').exists()).toBe(false);

    await card.trigger("click");
    expect(wrapper.emitted("run-suggestion")).toEqual([["level='api' AND match_all('timeout')"]]);
  });

  it("passes the Search-text candidate through (AC5.1)", async () => {
    const wrapper = mountError({ freeTextCandidate: "status =" });
    const card = wrapper.find('[data-test="query-error-search-text-card"]');
    expect(card.text()).toContain('Search text for "status ="');

    await card.trigger("click");
    expect(wrapper.emitted("search-text")).toEqual([["status ="]]);
  });

  it("shows neither card for a non-query error (AC5.3)", () => {
    const wrapper = mountError({ errorCode: 10001, freeTextCandidate: "x", runSuggestion: "y" });
    expect(wrapper.find('[data-test="query-error-search-text-card"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="query-error-run-suggestion-card"]').exists()).toBe(false);
  });

  it("reads the query-error code from the stream's message, in filter mode only", () => {
    const fieldError = {
      errorCode: 0,
      errorMsg: 'Search field not found: Schema error: No field named "connection refused".',
      runSuggestion: "match_all('connection refused') AND service_name='api'",
    };
    expect(
      mountError({ ...fieldError, filterMode: true })
        .find('[data-test="query-error-run-suggestion-card"]')
        .exists(),
    ).toBe(true);
    expect(
      mountError({ ...fieldError, errorMsg: "Search query timed out", filterMode: true })
        .find('[data-test="query-error-run-suggestion-card"]')
        .exists(),
    ).toBe(false);
  });

  it("treats a filter-mode parser error sent as HTTP 400 as a syntax error", () => {
    const parserError = {
      errorCode: 400,
      errorMsg: 'Error# SQL error: ParserError("Expected: end of statement, found: timeout")',
      runSuggestion: "level='api' AND match_all('timeout')",
    };
    expect(
      mountError({ ...parserError, filterMode: true })
        .find('[data-test="query-error-run-suggestion-card"]')
        .exists(),
    ).toBe(true);
    expect(
      mountError({ ...parserError, filterMode: false })
        .find('[data-test="query-error-run-suggestion-card"]')
        .exists(),
    ).toBe(false);
  });
});
