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

// Monaco's tokenizer is the one piece not runnable in jsdom; colorizeQuery and DOMPurify run for real.
vi.mock("monaco-editor/esm/vs/editor/editor.api", () => ({
  editor: {
    colorize: vi.fn().mockResolvedValue('<span class="mtk6">SELECT</span>'),
    tokenize: vi.fn(() => [
      [
        { offset: 0, type: "keyword.sql", language: "sql" },
        { offset: 6, type: "white.sql", language: "sql" },
        { offset: 7, type: "predefined.sql", language: "sql" },
        { offset: 12, type: "delimiter.parenthesis.sql", language: "sql" },
      ],
    ]),
  },
  languages: {
    register: vi.fn(),
    setMonarchTokensProvider: vi.fn(),
    setLanguageConfiguration: vi.fn(),
  },
}));
vi.mock("monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js", () => ({}));
vi.mock("@/utils/query/promqlLanguageDefinition", () => ({
  loadPromqlLanguage: vi.fn().mockResolvedValue({ language: {}, languageConfiguration: {} }),
}));

import DbmQueryText from "./DbmQueryText.vue";

describe("DbmQueryText", () => {
  it("paints keywords with the theme-aware query-syntax token, not a Monaco theme class", async () => {
    const wrapper = mount(DbmQueryText, {
      props: { query: "SELECT count(*)", dbSystem: "postgresql" },
    });
    await flushPromises();

    const keyword = wrapper.find("pre span.text-query-syntax-keyword");
    expect(keyword.exists()).toBe(true);
    expect(keyword.text()).toBe("SELECT");
    expect(wrapper.find("pre span.text-query-syntax-function").text()).toBe("count");
    expect(wrapper.html()).not.toMatch(/mtk\d/);
    expect(wrapper.find("pre").text()).toBe("SELECT count(*)");
  });
});
