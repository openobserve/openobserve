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

import { afterEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { Marked, marked } from "marked";
import DOMPurify from "dompurify";
import i18n from "@/locales";
import LLMContentRenderer from "./LLMContentRenderer.vue";
import { renderMarkdown } from "./markdown";

enableAutoUnmount(afterEach);

const token = "<AGW_EMAIL_4f89279340ab4e28a9b9ce0f57aca0b2_0>";

function render(
  content: InstanceType<typeof LLMContentRenderer>["$props"]["content"],
  contentType: "input" | "output" = "input",
) {
  return mount(LLMContentRenderer, {
    props: { content, contentType, viewMode: "formatted" },
    global: { plugins: [i18n] },
  });
}

describe("LLM content Markdown with real parsing and sanitization", () => {
  it.each([
    ["input", [{ role: "user", content: `My email is ${token}.` }]],
    ["output", { role: "assistant", content: `Your email is ${token}.` }],
    ["output", [{ type: "text", text: `Your email is ${token}.` }]],
  ] as const)("preserves placeholders in %s messages", (type, content) => {
    expect(render(content, type).get(".message-content").text()).toContain(token);
  });

  it("preserves Markdown, escaped entities, code and image markers", () => {
    const content = `**Email**: ${token} &amp; &lt;PERSON_1&gt;\n\n\`${token}\`\n\n[Image: https://example.com/image.png]`;
    const message = render([{ role: "assistant", content }]).get(".message-content");
    expect(message.get("strong").text()).toBe("Email");
    expect(message.text()).toContain(`${token} & <PERSON_1>`);
    expect(message.get("code").text()).toBe(token);
    expect(message.get("img").attributes("src")).toBe("https://example.com/image.png");
  });

  it("still sanitizes dangerous URLs in Markdown-generated HTML", () => {
    const message = render([{ role: "assistant", content: "[unsafe](javascript:alert(1))" }]).get(
      ".message-content",
    );
    expect(message.get("a").text()).toBe("unsafe");
    expect(message.get("a").attributes("href")).toBeUndefined();
  });

  it("preserves placeholders in both truncated and expanded previews", async () => {
    const lastToken = "<PERSON_1>";
    const content = [token, ...Array(20).fill("Another line"), lastToken].join("\n");
    const wrapper = render([{ role: "user", content }]);
    expect(wrapper.get(".message-content").text()).toContain(token);
    expect(wrapper.get(".message-content").text()).not.toContain(lastToken);
    await wrapper.get('[data-test="traces-llm-content-renderer-expand-btn"]').trigger("click");
    expect(wrapper.get(".message-content").text()).toContain(lastToken);
  });

  it("preserves placeholders in the shared trace renderer", () => {
    expect(renderMarkdown("My email is <PERSON_1>.")).toContain("My email is &lt;PERSON_1&gt;.");
  });

  it("preserves GFM tables, fenced code and autolinks in the shared renderer", () => {
    const message = document.createElement("div");
    message.innerHTML = renderMarkdown(
      `| Name |\n| --- |\n| Alice |\n\n\`\`\`text\n${token}\n\`\`\`\n\nSee <https://example.com>`,
    );
    expect(message.querySelector("td")?.textContent).toBe("Alice");
    expect(message.querySelector("pre code")?.textContent).toBe(`${token}\n`);
    expect(message.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
  });

  it("scales across many separate native HTML blocks", () => {
    const native = new Marked({ gfm: true, breaks: false });
    const block = "<div>hello</div>\n\n";
    for (const count of [500, 1000, 2000, 4000]) {
      const content = block.repeat(count);
      const actual = renderMarkdown(content);
      expect(actual).toBe(DOMPurify.sanitize(native.parse(content) as string));
    }

    // Count tag scans rather than asserting a machine-dependent timing threshold.
    const count = 200;
    let tagScans = 0;
    const originalExec = RegExp.prototype.exec;
    const exec = vi.spyOn(RegExp.prototype, "exec").mockImplementation(function (
      this: RegExp,
      source: string,
    ) {
      const match = originalExec.call(this, source);
      if ((this.global || this.sticky) && match?.[1] === "div") tagScans++;
      return match;
    });
    try {
      renderMarkdown(block.repeat(count));
    } finally {
      exec.mockRestore();
    }
    expect(tagScans).toBeLessThan(count * 20);
  }, 30000);
});

describe.each([
  [
    "preview",
    (content: string) => render([{ role: "assistant", content }]).get(".message-content").element,
  ],
  [
    "shared trace renderer",
    (content: string) => {
      const message = document.createElement("div");
      message.innerHTML = renderMarkdown(content);
      return message;
    },
  ],
] as const)("%s Markdown behavior", (_name, renderMessage) => {
  it.each([
    ["table", "<table>\n<tr><td>Alice</td></tr>\n</table>"],
    ["div containing a paragraph", "<div>\n  <p>hi</p>\n</div>"],
    ["literal Markdown in a raw div", "<div>\n*x*\n</div>"],
    ["unclosed div before indented code", "<div>\nunclosed\n\n    code\n"],
    ["leading indentation and mixed case", "   <DiV>\n  <P>hi</P>\n</dIv>"],
    [
      "table with blank lines and indentation",
      "<table>\n\n    <tr><td>Alice</td></tr>\n\n</table>",
    ],
    [
      "table with deep indentation",
      `<table>\n\n${" ".repeat(16000)}<tr><td>Alice</td></tr>\n\n</table>`,
    ],
    ["div with blank lines and indentation", "<div>\n\n    <span>Alice</span>\n\n</div>"],
    ["raw pre and code", "<pre><code>*x* &amp; <b>bold</b></code></pre>"],
  ])("matches native safe block HTML: %s", (_name, content) => {
    const native = new Marked({ gfm: true, breaks: false });
    const expected = document.createElement("div");
    expected.innerHTML = DOMPurify.sanitize(native.parse(content) as string);
    const message = renderMessage(content);
    expect(message.innerHTML).toBe(expected.innerHTML);
    expect(message.querySelector("p:empty")).toBeNull();
  });

  it.each([
    ["inline break", "first<br>second", "br", ""],
    ["superscript", "x<sup>2</sup>", "sup", "2"],
    ["bold", "<b>bold</b>", "b", "bold"],
    ["mixed-case tags", "<DiV>first<BR/>x<SUP>2</sUp></dIv>", "div sup", "2"],
    ["Markdown table break", "| Name |\n| --- |\n| first<br>second |", "td br", ""],
    [
      "HTML table",
      "<table>\n<thead><tr><th>Name</th></tr></thead>\n<tbody><tr><td>Alice</td></tr></tbody>\n</table>",
      "table tbody td",
      "Alice",
    ],
  ])("renders safe HTML: %s", (_name, content, selector, text) => {
    const message = renderMessage(content);
    expect(message.querySelector(selector)?.textContent).toBe(text);
  });

  it.each([
    "<EMAIL_ADDRESS> and <PERSON_1>",
    token,
    "<custom-element>unknown</custom-element>",
    '<instructions title="quoted > value">unknown</instructions>',
  ])("preserves unknown tags and placeholders: %s", (content) => {
    const message = renderMessage(content);
    expect(message.textContent?.trim()).toBe(content);
    expect(
      message.querySelector("email_address, person_1, custom-element, instructions"),
    ).toBeNull();
  });

  it.each(["<br>", "<img src='https://example.com/image.png'>"])(
    "keeps %s inside unknown-tag attributes literal",
    (attribute) => {
      const content = `<instructions title="${attribute}">unknown</instructions>`;
      for (const source of [content, `<div>${content}</div>`]) {
        const message = renderMessage(source);
        expect(message.textContent?.trim()).toBe(content);
        expect(message.querySelector("br, img, instructions")).toBeNull();
      }
    },
  );

  it.each(["<br>", "<img src='https://example.com/image.png'>"])(
    "keeps quoted pre-block terminators and %s inside unknown tags literal",
    (markup) => {
      const content = `<instructions title="</pre>\n${markup}">unknown</instructions>`;
      const message = renderMessage(`<pre>${content}</pre>`);
      expect(message.querySelector("pre")?.textContent).toBe(content);
      expect(message.querySelector("br, img, instructions")).toBeNull();
    },
  );

  it("keeps indented HTML examples as code outside HTML blocks", () => {
    const content = "<table><tr><td>Alice</td></tr></table>";
    const message = renderMessage(`<div>before</div>\n\n    ${content}`);
    expect(message.querySelector("pre code")?.textContent?.trim()).toBe(content);
    expect(message.querySelector("table")).toBeNull();
  });

  it.each(["div", "pre", "code"])("preserves placeholders and entities inside %s", (tag) => {
    const message = renderMessage(
      `<${tag}>\n<EMAIL_ADDRESS> <span>${token}</span> <PERSON_1> &amp;\n</${tag}>`,
    );
    expect(message.querySelector(tag)?.textContent?.trim()).toBe(
      `<EMAIL_ADDRESS> ${token} <PERSON_1> &`,
    );
    expect(message.querySelector("span")?.textContent).toBe(token);
  });

  it("preserves placeholders in raw HTML table cells", () => {
    const message = renderMessage(`<table>\n<tr><td>${token} <PERSON_1></td></tr>\n</table>`);
    expect(message.querySelector("td")?.textContent).toBe(`${token} <PERSON_1>`);
    expect(message.querySelector("person_1")).toBeNull();
  });

  it("keeps Markdown literal inside unknown wrappers nested in raw HTML blocks", () => {
    const message = renderMessage(
      "<div>\n<instructions>\nDo **X**.\n- a\n- b\n</instructions>\n</div>",
    );
    expect(message.querySelector("div strong, div li")).toBeNull();
    expect(message.querySelector("div")?.textContent).toContain("Do **X**.\n- a\n- b");
    expect(message.querySelector("div")?.textContent).toContain("<instructions>");
    expect(message.querySelector("div")?.textContent).toContain("</instructions>");
    expect(message.querySelector("instructions")).toBeNull();
  });

  it("keeps indented Markdown code inside unknown wrappers in safe HTML", () => {
    const message = renderMessage(
      "<div>\n<instructions>\n\n    <b>example</b>\n\n</instructions>\n</div>",
    );
    expect(message.querySelector("div pre code")?.textContent?.trim()).toBe("<b>example</b>");
    expect(message.querySelector("b")).toBeNull();
  });

  it("renders HTML and Markdown images with dangerous attributes removed", () => {
    const message = renderMessage(
      '<img src="https://example.com/image.png" alt="HTML image" onerror="alert(1)">\n\n![Markdown image](https://example.com/markdown.png)',
    );
    const images = message.querySelectorAll("img");
    expect(images).toHaveLength(2);
    expect(images[0].getAttribute("src")).toBe("https://example.com/image.png");
    expect(images[0].getAttribute("alt")).toBe("HTML image");
    expect(images[1].getAttribute("src")).toBe("https://example.com/markdown.png");
    expect(message.querySelector("[onerror]")).toBeNull();
  });

  it("keeps scripts inert and sanitizes unsafe HTML and Markdown URLs", () => {
    const message = renderMessage(
      '<div><script>alert(1)</script><a href="javascript:alert(1)" onclick="alert(2)">HTML</a></div>\n\n[Markdown](javascript:alert(3))',
    );
    expect(message.querySelector("script, [onclick]")).toBeNull();
    expect(message.textContent).toContain("<script>alert(1)</script>");
    const links = message.querySelectorAll("a");
    expect(links).toHaveLength(2);
    expect(Array.from(links, (link) => link.getAttribute("href"))).toEqual([null, null]);
  });

  it("keeps unsafe element tags as text outside and inside raw HTML", () => {
    const content =
      "<script>x</script><style>x</style><iframe>x</iframe><form>x</form><svg>x</svg>";
    for (const source of [content, `<div>${content}</div>`]) {
      const message = renderMessage(source);
      expect(message.textContent?.trim()).toBe(content);
      expect(message.querySelector("script, style, iframe, form, svg")).toBeNull();
    }
  });

  it("parses Markdown inside literal tag blocks", () => {
    const message = renderMessage("<instructions>\nDo **X**.\n- a\n- b\n</instructions>");
    expect(message.querySelector("strong")?.textContent).toBe("X");
    expect(message.querySelectorAll("li")).toHaveLength(2);
    expect(message.textContent).toContain("<instructions>");
    expect(message.textContent).toContain("</instructions>");
    expect(message.querySelector("instructions")).toBeNull();
  });

  it("decodes entities once inside literal tag blocks", () => {
    const message = renderMessage("<note>\nTom &amp; Jerry\n</note>");
    expect(message.textContent?.trim()).toBe("<note>\nTom & Jerry\n</note>");
  });

  it("is isolated from app-wide Markdown options", () => {
    const originalOptions = { ...marked.defaults };
    try {
      marked.setOptions({ breaks: true, gfm: true });
      const message = renderMessage("line one\nline two");
      expect(message.textContent?.trim()).toBe("line one\nline two");
      expect(message.querySelector("br")).toBeNull();
      expect(marked.parse("line one\nline two")).toContain("<br>");
      expect(marked.parse("<b>bold</b>")).toContain("<b>bold</b>");
    } finally {
      marked.setOptions(originalOptions);
    }
  });
});
