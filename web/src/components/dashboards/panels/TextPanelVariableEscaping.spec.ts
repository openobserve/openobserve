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
import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import HTMLRenderer from "./HTMLRenderer.vue";
import MarkdownRenderer from "./MarkdownRenderer.vue";
import i18n from "@/locales";
import { withTimeRangeVariables } from "@/utils/dashboard/variables/variablesUtils";

vi.mock("vuex", () => ({
  useStore: () => ({ state: { theme: "light" } }),
}));

const IMG = "<img src=x onerror=alert(1)>";
const QUOTE = "it's";

const variablesData = withTimeRangeVariables(
  {
    values: [
      { name: "x", type: "textbox", value: IMG },
      { name: "q", type: "textbox", value: QUOTE },
      { name: "m", type: "custom", value: [IMG, QUOTE] },
      { name: "all", type: "query_values", value: "_o2_all_" },
      { name: "end_time", type: "textbox", value: IMG },
    ],
  },
  { start_time: 1_000_000, end_time: 2_000_000 },
);

const CONTENT = [
  "<div id='plain' title='${q}'>${x}</div>",
  "<div id='quoted' title='${x}'>${q}</div>",
  "<a id='pct' href='https://e.com/?a=${q:percentencode}&b=${x:percentencode}'>p</a>",
  "<a id='qp' href='https://e.com/?${m:queryparam}'>q</a>",
  "<div id='fmt' title='${m:singlequote}'>${m:doublequote}</div>",
  "<div id='all' title='${all}'>${all}</div>",
  "<div id='time' title='${end_time}'>${start_time} ${end_time}</div>",
].join("\n");

const mountPanel = async (component: any, props: Record<string, unknown>) => {
  const wrapper: VueWrapper<any> = mount(component, {
    props: { ...props, variablesData, panelId: "p1" },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
};

const expectNoInjection = (root: Element) => {
  expect(root.querySelector("img")).toBeNull();
  for (const el of root.querySelectorAll("[id]")) {
    const names = el.getAttributeNames().filter((n) => !["id", "title", "href"].includes(n));
    expect(names.filter((n) => !["target", "rel"].includes(n))).toEqual([]);
  }
};

describe("text panel variable escaping", () => {
  let wrapper: VueWrapper<any> | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it.each([
    ["HTML", HTMLRenderer, "htmlContent", "html-renderer"],
    ["Markdown", MarkdownRenderer, "markdownContent", "markdown-renderer"],
  ])(
    "renders img and quote values as inert text in the %s panel",
    async (_, component, prop, testId) => {
      wrapper = await mountPanel(component, { [prop]: CONTENT });
      const root = wrapper.find(`[data-test="${testId}"]`).element;

      expectNoInjection(root);
      expect(root.querySelector("#plain")?.textContent).toBe(IMG);
      expect(root.querySelector("#plain")?.getAttribute("title")).toBe(QUOTE);
      expect(root.querySelector("#quoted")?.getAttribute("title")).toBe(IMG);
      expect(root.querySelector("#quoted")?.textContent).toBe(QUOTE);
      expect(root.querySelector("#pct")?.getAttribute("href")).toBe(
        `https://e.com/?a=${encodeURIComponent(QUOTE)}&b=${encodeURIComponent(IMG)}`,
      );
      expect(root.querySelector("#qp")?.getAttribute("href")).toBe(
        `https://e.com/?var-m=${encodeURIComponent(IMG)}&var-m=${encodeURIComponent(QUOTE)}`,
      );
      expect(root.querySelector("#fmt")?.getAttribute("title")).toBe(`'${IMG}','${QUOTE}'`);
      expect(root.querySelector("#fmt")?.textContent).toBe(`"${IMG}","${QUOTE}"`);
      expect(root.querySelector("#time")?.getAttribute("title")).toBe(IMG);
      expect(root.querySelector("#time")?.textContent).toBe(`1000000 ${IMG}`);
    },
  );

  it("prints the All label in Markdown and keeps the sentinel in HTML", async () => {
    wrapper = await mountPanel(MarkdownRenderer, { markdownContent: CONTENT });
    expect(wrapper.find("#all").attributes("title")).toBe("All");
    wrapper.unmount();

    wrapper = await mountPanel(HTMLRenderer, { htmlContent: CONTENT });
    expect(wrapper.find("#all").attributes("title")).toBe("_o2_all_");
  });
});
