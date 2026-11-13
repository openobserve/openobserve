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
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import RcaReportIndex from "./RcaReportIndex.vue";
import { renderRcaReport } from "@/utils/incidents/rcaReportMarkdown";

const HTML = renderRcaReport(
  [
    "# Incident Analysis Report",
    "## Executive Summary",
    "Benign scanning.",
    "## Subject Summary",
    "Text.",
    "## Timeline",
    "More.",
  ].join("\n"),
);

const mountIndex = (html = HTML) =>
  mount(RcaReportIndex, {
    props: { html, isDarkMode: false },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });

describe("RcaReportIndex", () => {
  it("lists the report's sections beside it, the first one current", async () => {
    const wrapper = mountIndex();
    await flushPromises();

    const index = wrapper.get('[data-test="rca-report-index"]');
    expect(index.attributes("aria-label")).toBe("Report sections");
    expect(index.text()).toContain("On this report");
    const items = wrapper.findAll('[data-test="rca-report-index-item"]');
    expect(items.map((item) => item.text())).toEqual([
      "Executive Summary",
      "Subject Summary",
      "Timeline",
    ]);
    expect(items[0].attributes("aria-current")).toBe("true");
    expect(wrapper.get('[data-test="rca-report-content"]').text()).toContain("Benign scanning.");
    wrapper.unmount();
  });

  it("a section jumps the report to its heading and becomes current", async () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this.textContent ?? "");
    });
    const wrapper = mountIndex();
    await flushPromises();

    const items = wrapper.findAll('[data-test="rca-report-index-item"]');
    await items[2].trigger("click");
    expect(scrolled).toEqual(["Timeline"]);
    expect(items[2].attributes("aria-current")).toBe("true");
    expect(items[0].attributes("aria-current")).toBeUndefined();
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    wrapper.unmount();
  });

  it("keeps the topmost visible heading current as others enter and leave the reading area", async () => {
    let notify!: (entries: Partial<IntersectionObserverEntry>[]) => void;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          notify = (entries) =>
            callback(
              entries as IntersectionObserverEntry[],
              this as unknown as IntersectionObserver,
            );
        }
        observe() {}
        disconnect() {}
      },
    );
    const wrapper = mountIndex();
    await flushPromises();
    const headings = wrapper.findAll("h2").map((h) => h.element);
    const seen = (i: number, isIntersecting: boolean) => ({
      target: headings[i],
      isIntersecting,
      boundingClientRect: { top: i * 100 } as DOMRect,
    });
    const items = wrapper.findAll('[data-test="rca-report-index-item"]');
    notify([seen(1, true)]);
    notify([seen(2, true)]);
    await flushPromises();
    expect(items[1].attributes("aria-current")).toBe("true");
    notify([seen(1, false)]);
    await flushPromises();
    expect(items[2].attributes("aria-current")).toBe("true");
    vi.unstubAllGlobals();
    wrapper.unmount();
  });

  it("a report with one section or none shows no index", async () => {
    const wrapper = mountIndex(renderRcaReport("Just a paragraph."));
    await flushPromises();
    expect(wrapper.find('[data-test="rca-report-index"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
