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

import { beforeAll, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import QueryErrorState from "@/components/common/QueryErrorState.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";

const SEARCH_CARD = '[data-test="query-error-search-text-card"]';
const RUN_CARD = '[data-test="query-error-run-suggestion-card"]';
const FIX_CARD = '[data-test="query-error-fix-query-card"]';

function mountState(props: Record<string, unknown>) {
  return mount(QueryErrorState, {
    props: { errorMsg: "Unknown field 'timeout'", ...props },
    global: { plugins: [store] },
  });
}

describe("QueryErrorState free-text cards", () => {
  beforeAll(() => {
    const global = i18n.global as unknown as {
      locale: string | { value: string };
      mergeLocaleMessage: (locale: string, messages: object) => void;
    };
    const locale = typeof global.locale === "string" ? global.locale : global.locale.value;
    global.mergeLocaleMessage(locale, {
      queryError: {
        runAs: "Run as",
        searchTextFor: 'Search text for "{text}"',
        searchTextDesc: "Search the whole input as one phrase",
      },
    });
  });

  it.each([[20001], [20004], [20005], [20007], [20008]])(
    "offers Search text next to Fix query for query error %s (AC5.1)",
    (errorCode) => {
      const wrapper = mountState({ errorCode, freeTextCandidate: "status = " });
      const card = wrapper.find(SEARCH_CARD);
      expect(card.exists()).toBe(true);
      expect(card.text()).toContain('Search text for "status ="');
      expect(card.text()).toContain("Search the whole input as one phrase");
      expect(wrapper.find(FIX_CARD).exists()).toBe(true);
      expect(wrapper.find(RUN_CARD).exists()).toBe(false);
    },
  );

  it("offers Run as with the exact suggestion text and hides Search text (AC5.3)", () => {
    const suggestion = "service_name='api' AND match_all('timeout')";
    const wrapper = mountState({
      errorCode: 20004,
      runSuggestion: suggestion,
      freeTextCandidate: "service_name='api' timeout",
    });
    const card = wrapper.find(RUN_CARD);
    expect(card.text()).toContain("Run as");
    expect(card.text()).toContain(suggestion);
    expect(wrapper.find(SEARCH_CARD).exists()).toBe(false);
    expect(wrapper.find(FIX_CARD).exists()).toBe(true);
  });

  it.each([[0], [10001], [20002], [20003], [20006]])(
    "shows neither card for non-query error %s",
    (errorCode) => {
      const wrapper = mountState({
        errorCode,
        freeTextCandidate: "timeout",
        runSuggestion: "match_all('timeout')",
      });
      expect(wrapper.find(SEARCH_CARD).exists()).toBe(false);
      expect(wrapper.find(RUN_CARD).exists()).toBe(false);
    },
  );

  it.each([[""], ["   "], [undefined]])(
    "shows no Search text card for candidate %j",
    (candidate) => {
      const wrapper = mountState({
        errorCode: 20001,
        freeTextCandidate: candidate,
        runSuggestion: " ",
      });
      expect(wrapper.find(SEARCH_CARD).exists()).toBe(false);
      expect(wrapper.find(RUN_CARD).exists()).toBe(false);
    },
  );

  it("renders no free-text cards in the block layout (AC5.4)", () => {
    const wrapper = mountState({
      errorCode: 20001,
      size: "block",
      freeTextCandidate: "timeout",
      runSuggestion: "match_all('timeout')",
    });
    expect(wrapper.find(SEARCH_CARD).exists()).toBe(false);
    expect(wrapper.find(RUN_CARD).exists()).toBe(false);
    expect(wrapper.find('[data-test="query-error-fix-query-btn"]').exists()).toBe(true);
  });

  it("delegates a long label to OTruncatedText while retaining the full search value", () => {
    const text = "connection reset by peer while reading the response body";
    const wrapper = mountState({ errorCode: 20001, freeTextCandidate: text });
    const label = wrapper.findComponent(OTruncatedText);
    expect(label.exists()).toBe(true);
    expect(label.text()).toBe(`Search text for "${text}"`);
    wrapper.find(SEARCH_CARD).trigger("click");
    expect(wrapper.emitted("search-text")?.[0]).toEqual([text]);
  });

  it("preserves the full short search label", () => {
    const text = "timeout";
    const wrapper = mountState({ errorCode: 20001, freeTextCandidate: text });
    expect(wrapper.findComponent(OTruncatedText).text()).toBe(`Search text for "${text}"`);
  });

  it("emits the trimmed candidate and the suggestion on click (L-21)", async () => {
    const searchWrapper = mountState({ errorCode: 20001, freeTextCandidate: "  status =  " });
    const searchCard = searchWrapper.find(SEARCH_CARD);
    expect(searchCard.element.tagName).toBe("BUTTON");
    expect(searchCard.attributes("type")).toBe("button");
    await searchCard.trigger("click");
    expect(searchWrapper.emitted("search-text")).toEqual([["status ="]]);
    expect(searchWrapper.emitted("fix-query")).toBeUndefined();

    const runWrapper = mountState({ errorCode: 20004, runSuggestion: "service_name='api'" });
    const runCard = runWrapper.find(RUN_CARD);
    expect(runCard.element.tagName).toBe("BUTTON");
    await runCard.trigger("click");
    expect(runWrapper.emitted("run-suggestion")).toEqual([["service_name='api'"]]);
  });

  it("keeps the existing cards unchanged without the new props (L-28)", () => {
    expect(mountState({ errorCode: 20001 }).find(FIX_CARD).exists()).toBe(true);
    expect(
      mountState({ errorCode: 20003 })
        .find('[data-test="query-error-configure-resource-card"]')
        .exists(),
    ).toBe(true);
    expect(
      mountState({ errorCode: 20006 }).find('[data-test="query-error-expand-range-card"]').exists(),
    ).toBe(true);
    const plain = mountState({ errorCode: 20001 });
    expect(plain.find(SEARCH_CARD).exists()).toBe(false);
    expect(plain.find(RUN_CARD).exists()).toBe(false);
  });

  it("lets a caller's #actions slot replace every card", () => {
    const wrapper = mount(QueryErrorState, {
      props: { errorCode: 20001, freeTextCandidate: "timeout", runSuggestion: "match_all('x')" },
      slots: { actions: '<span data-test="custom-action" />' },
      global: { plugins: [store] },
    });
    expect(wrapper.find('[data-test="custom-action"]').exists()).toBe(true);
    expect(wrapper.find(SEARCH_CARD).exists()).toBe(false);
    expect(wrapper.find(RUN_CARD).exists()).toBe(false);
  });

  it("keeps copy, Ask AI and detail toggling working alongside the new cards (L-28)", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    try {
      const hero = mountState({ errorCode: 20001, aiEnabled: true, freeTextCandidate: "status =" });
      await hero.find('[data-test="query-error-copy-btn"]').trigger("click");
      expect(writeText).toHaveBeenCalled();
      expect(hero.find('[data-test="query-error-copy-btn"]').text()).toContain("Copied!");
      vi.advanceTimersByTime(2000);
      await hero.vm.$nextTick();
      expect(hero.find('[data-test="query-error-copy-btn"]').text()).not.toContain("Copied!");
      await hero.find('[data-test="query-error-ask-ai-btn"]').trigger("click");
      expect(hero.emitted("ask-ai")).toHaveLength(1);

      const detail = "line one\n".repeat(30);
      const block = mountState({
        errorCode: 20001,
        size: "block",
        aiEnabled: true,
        errorDetail: detail,
      });
      await block.find('[data-test="query-error-copy-btn"]').trigger("click");
      expect(block.find('[data-test="query-error-copy-btn"]').text()).toContain("Copied!");
      await block.find('[data-test="query-error-copy-btn"]').trigger("click");
      await block.find('[data-test="query-error-ask-ai-btn"]').trigger("click");
      expect(block.emitted("ask-ai")).toHaveLength(1);
      await block.find('[data-test="query-error-fix-query-btn"]').trigger("click");
      expect(block.emitted("fix-query")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("QueryErrorState plain-language errors", () => {
  const PARSER_EOF =
    'Error# SQL error: ParserError("Expected: identifier, found: EOF") <br><span class="text-subtitle1">TraceID: 01a18663607a</span>';
  const tr = (key: string, params: Record<string, string> = {}) =>
    (i18n.global as unknown as { t: (k: string, p: object) => string }).t(key, params);

  it("leads with a plain sentence and keeps the raw text and trace id behind the toggle", async () => {
    const wrapper = mountState({
      errorMsg: PARSER_EOF,
      query: "SELECT * FROM",
      resourceName: "app_logs",
    });

    const expected = tr("queryError.explain.missingStream", {
      from: "FROM",
      example: 'FROM "app_logs"',
    });
    expect(wrapper.text()).toContain(expected);
    expect(wrapper.text()).toContain(tr("queryError.sqlError"));
    expect(wrapper.find('[data-test="error-detail-summary"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="error-detail-trace-id"]').text()).toContain("01a18663607a");
    expect(wrapper.find('[data-test="error-detail-body"]').exists()).toBe(false);

    await wrapper.find('[data-test="error-detail-toggle-btn"]').trigger("click");
    const body = wrapper.find('[data-test="error-detail-body"]').text();
    expect(body).toContain("ParserError");
    expect(body).not.toContain("TraceID");
  });

  it("draws no divider above the toggle when the summary row is absent", () => {
    const toggleRow = (errorMsg: string) =>
      mountState({ errorMsg, query: "SELECT * FROM", resourceName: "app_logs" }).find(
        '[data-test="error-detail-toggle-btn"]',
      ).element.parentElement!.classList;

    expect(
      toggleRow('Error# SQL error: ParserError("Expected: identifier, found: EOF")'),
    ).not.toContain("border-t");
    expect(toggleRow(PARSER_EOF)).toContain("border-t");
  });

  it("names the field the backend reported", () => {
    const wrapper = mountState({
      errorMsg: "Search field not found: Schema error: No field named nosuchfield.",
      errorDetail: "",
    });
    expect(wrapper.text()).toContain(
      tr("queryError.explain.unknownField", { name: '"nosuchfield"' }),
    );
  });

  it("keeps the generic sentence and the raw summary for an error it does not recognise", () => {
    const wrapper = mountState({
      errorMsg: "Search SQL execute error",
      errorDetail: "something new",
    });

    expect(wrapper.text()).toContain(tr("queryError.genericDesc"));
    expect(wrapper.find('[data-test="error-detail-summary"]').text()).toBe(
      "Search SQL execute error",
    );
  });

  it("shows the plain sentence as the summary in the compact layout", () => {
    const wrapper = mountState({
      size: "block",
      errorMsg: "Search stream not found: nosuch",
    });
    expect(wrapper.find('[data-test="query-error-summary"]').text()).toBe(
      tr("queryError.explain.streamNotFound", { name: '"nosuch"' }),
    );
  });
});
