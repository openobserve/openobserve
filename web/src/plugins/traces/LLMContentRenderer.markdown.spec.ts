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

import { afterEach, describe, expect, it } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { marked } from "marked";
import i18n from "@/locales";
import LLMContentRenderer from "./LLMContentRenderer.vue";

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

  it.each([
    "<EMAIL_ADDRESS> and <PERSON_1>",
    "<b>literal HTML</b>",
    '<img src=x onerror="alert(1)">',
    "<script>alert(1)</script>",
    "<div>\n<EMAIL_ADDRESS>\n</div>",
  ])("displays HTML-like message content as inert text: %s", (content) => {
    const message = render([{ role: "user", content }]).get(".message-content");
    expect(message.text()).toBe(content);
    expect(message.find("b, img, script, div, [onerror]").exists()).toBe(false);
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

  it("does not change HTML rendering for other Markdown consumers", () => {
    render([{ role: "user", content: "<b>literal HTML</b>" }]);
    expect(marked.parse("<b>bold</b>")).toContain("<b>bold</b>");
  });
});
