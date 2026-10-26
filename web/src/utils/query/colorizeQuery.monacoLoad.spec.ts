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

// The first Monaco service call freezes its singletons, so one made before editor.all.js leaves every later editor without suggest.
const calls = vi.hoisted(() => [] as string[]);

vi.mock("monaco-editor/esm/vs/editor/editor.all.js", () => {
  calls.push("editor.all");
  return {};
});
vi.mock("monaco-editor/esm/vs/editor/editor.api", () => ({
  editor: {
    colorize: vi.fn(async () => calls.push("editor.colorize")),
    tokenize: vi.fn(() => []),
  },
  languages: {
    register: vi.fn(() => calls.push("languages.register")),
    setMonarchTokensProvider: vi.fn(() => calls.push("languages.setMonarchTokensProvider")),
    setLanguageConfiguration: vi.fn(() => calls.push("languages.setLanguageConfiguration")),
  },
}));
vi.mock("monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js", () => ({}));
vi.mock("@/utils/query/promqlLanguageDefinition", () => ({
  loadPromqlLanguage: vi.fn().mockResolvedValue({
    language: { tokenizer: { root: [] } },
    languageConfiguration: {},
  }),
}));
vi.mock("@/utils/query/vrlLanguageDefinition", () => ({
  vrlLanguageDefinition: { tokenizer: { root: [] } },
}));

import { colorizeQuery } from "./colorizeQuery";

describe("colorizeQuery Monaco loading", () => {
  it("loads every editor contribution before its first Monaco call", async () => {
    await colorizeQuery("SELECT 1", "sql");
    expect(calls[0]).toBe("editor.all");
    expect(calls).toContain("languages.setMonarchTokensProvider");
  });
});
