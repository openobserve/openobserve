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

import { afterEach, describe, expect, it, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import PrettyStackTrace from "@/components/rum/errorTracking/view/PrettyStackTrace.vue";
import sourcemapsService from "@/services/sourcemaps";
import i18n from "@/locales";

const { translateStackTrace } = vi.hoisted(() => ({ translateStackTrace: vi.fn() }));

vi.mock("@/services/sourcemaps", () => ({
  default: { translateStackTrace },
}));

vi.mock("vuex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuex")>()),
  useStore: () => ({ state: { selectedOrganization: { identifier: "default" } } }),
}));

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const UNAVAILABLE = '[data-test="rum-pretty-stack-trace-unavailable"]';
const MOBILE = '[data-test="rum-pretty-stack-trace-mobile-unsupported"]';

const nullFrames = {
  data: { stacktrace: [{ error: "boom", stack: [{ line: "a", source_info: null }] }] },
};

function mountPretty(source: string, editor: object = { template: "<div />" }) {
  return mount(PrettyStackTrace, {
    props: {
      error_stack: [
        `Fatal error on ${source}`,
        "2 MyApp 0x0000000102a10a08 0x0000000102a0c000 + 18952",
      ],
      error: { source, service: "my-app", version: "1.0.0" },
    },
    global: {
      plugins: [i18n],
      stubs: {
        OButton: { template: "<button><slot /></button>" },
        OIcon: { template: "<i />" },
        OSpinner: { template: "<i />" },
        CodeQueryEditor: editor,
      },
    },
  });
}

describe("PrettyStackTrace mobile sources", () => {
  beforeEach(() => {
    translateStackTrace.mockReset();
    translateStackTrace.mockResolvedValue(nullFrames);
    sessionStorage.clear();
    localStorage.clear();
  });

  it.each(["ios", "android"])(
    "shows the mobile message and no upload prompt for %s errors",
    async (source) => {
      const wrapper = mountPretty(source);
      await flushPromises();

      expect(wrapper.find(MOBILE).exists()).toBe(true);
      expect(wrapper.find(UNAVAILABLE).exists()).toBe(false);
      expect(wrapper.text()).not.toContain("Upload Source Maps");
    },
  );

  it.each(["ios", "android"])("does not call the translate API for %s errors", async (source) => {
    mountPretty(source);
    await flushPromises();

    expect(sourcemapsService.translateStackTrace).not.toHaveBeenCalled();
  });

  it("still skips the translate API when a mobile error_stack changes", async () => {
    const wrapper = mountPretty("android");
    await flushPromises();

    await wrapper.setProps({ error_stack: ["java.lang.Error: other", "\tat a.B.c(B.java:1)"] });
    await flushPromises();

    expect(wrapper.find(MOBILE).exists()).toBe(true);
    expect(sourcemapsService.translateStackTrace).not.toHaveBeenCalled();
  });

  it("keeps the upload prompt for browser errors with no source maps", async () => {
    const wrapper = mountPretty("browser");
    await flushPromises();

    expect(wrapper.find(UNAVAILABLE).exists()).toBe(true);
    expect(wrapper.find(MOBILE).exists()).toBe(false);
    expect(sourcemapsService.translateStackTrace).toHaveBeenCalledTimes(1);
  });
});

describe("PrettyStackTrace highlighted line", () => {
  const ERROR_LINE = '    throw new Error("boom");';
  const decorateRanges = vi.fn();
  const EditorStub = { props: ["query"], methods: { decorateRanges }, template: "<div />" };

  // The 11 lines the server sends around the error, which is the fifth of them.
  const sourceInfo = (top: string[]) => ({
    source: [
      ...top,
      ...Array(4 - top.length).fill("const before = 1;"),
      ERROR_LINE,
      ...Array(6).fill("const after = 2;"),
    ].join("\n"),
    source_line_start: 6,
    source_line_end: 16,
    stack_line: 11,
    stack_col: 17,
  });

  const frame = (top: string[]) => ({
    line: "at boom @ a.tsx:11:17",
    source_info: sourceInfo(top),
  });

  const translatesTo = (stack: object[]) =>
    translateStackTrace.mockResolvedValue({ data: { stacktrace: [{ error: "boom", stack }] } });

  // The real editor trims the text it is created with and writes new text to a live editor as is.
  const expectErrorLineHighlighted = (query: string) => {
    const [{ startLine, endLine }] = decorateRanges.mock.calls.at(-1)![0];
    expect(endLine).toBe(startLine);
    expect(query.trim().split("\n")[startLine - 1].trim()).toBe(ERROR_LINE.trim());
    expect(query.split("\n")[startLine - 1].trim()).toBe(ERROR_LINE.trim());
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    translateStackTrace.mockReset();
    decorateRanges.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["no blank line", []],
    ["one blank line", [""]],
    ["two blank lines", ["", ""]],
    ["a whitespace-only line", ["   "]],
    ["only blank lines above the error", ["", "", "", ""]],
  ])("highlights the error line when the snippet starts with %s", async (name, top) => {
    translatesTo([frame(top)]);
    // the translation cache is keyed on the stack, which is built from this name
    const wrapper = mountPretty(`browser ${name}`, EditorStub);
    await flushPromises();
    vi.advanceTimersByTime(500);

    expectErrorLineHighlighted(wrapper.findComponent(EditorStub).props("query") as string);
  });

  it("highlights the error line in a collapsed frame too", async () => {
    translatesTo([frame([]), frame([""])]);
    const wrapper = mountPretty("browser collapsed frame", EditorStub);
    await flushPromises();

    await wrapper.find(".show-more-button").trigger("click");
    await wrapper.find(".collapsed-frame-header").trigger("click");
    await flushPromises();
    vi.advanceTimersByTime(500);

    expectErrorLineHighlighted(wrapper.findAllComponents(EditorStub)[1].props("query") as string);
  });
});
