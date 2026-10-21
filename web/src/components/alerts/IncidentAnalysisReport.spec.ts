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
import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h } from "vue";

import i18n from "@/locales";

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantCapability: () => computed(() => ({ isAdmin: false })),
}));
vi.mock("@/components/ai-assistant/transcript/AssistantMessage.vue", () => ({
  __esModule: true,
  default: defineComponent({
    name: "AssistantMessage",
    props: { message: { type: Object, required: true } },
    setup: (props) => () =>
      h(
        "div",
        { "data-test": "message" },
        String((props.message as { content: string }).content)
          .split("\n")
          .filter(Boolean)
          .map((line) =>
            line.startsWith("### ")
              ? h("h3", line.slice(4))
              : line.startsWith("## ")
                ? h("h2", line.slice(3))
                : h("p", line),
          ),
      ),
  }),
}));

import IncidentAnalysisReport from "./IncidentAnalysisReport.vue";

const REPORT = "## Summary\nDisk filled.\n## Timeline\n### 02:14\nAlert fired.";

function mountReport(props: Record<string, unknown> = {}) {
  return mount(IncidentAnalysisReport, {
    props: { report: REPORT, live: false, reportKey: "r1", ...props },
    attachTo: document.body,
    global: { plugins: [i18n] },
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("IncidentAnalysisReport", () => {
  it("is a labelled region whose headings feed Jump to and the side list", async () => {
    const wrapper = mountReport();
    await flushPromises();
    const region = wrapper.get('[data-test="rca-report"]');
    expect(region.attributes("aria-label")).toBe("Incident analysis report");
    expect(wrapper.find('[data-test="rca-jump-to"]').exists()).toBe(true);
    const list = wrapper.get('[data-test="rca-jump-list"]');
    expect(list.attributes("aria-label")).toBe("Jump to");
    expect(list.findAll("button").map((button) => button.text())).toEqual([
      "Summary",
      "Timeline",
      "02:14",
    ]);
    wrapper.unmount();
  });

  it("scrolls to the section and moves focus to its heading", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const wrapper = mountReport();
    await flushPromises();
    await wrapper.get('[data-test="rca-jump-list"]').findAll("button")[1].trigger("click");
    const heading = wrapper.get("#rca-section-1");
    expect(heading.text()).toBe("Timeline");
    expect(document.activeElement).toBe(heading.element);
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    wrapper.unmount();
  });

  it("has no navigation for a report with one section, and keeps a live report's verdict as text", async () => {
    const single = mountReport({ report: "## Only\ntext" });
    await flushPromises();
    expect(single.find('[data-test="rca-jump-to"]').exists()).toBe(false);
    expect(single.find('[data-test="rca-jump-list"]').exists()).toBe(false);
    single.unmount();
    const verdict = '## A\nx\n```json\n{"likely_cause":"y","confidence":"low"}\n```';
    const live = mountReport({ report: verdict, live: true });
    await flushPromises();
    expect(live.get('[data-test="rca-report"]').attributes("aria-busy")).toBe("true");
    expect(live.find('[data-test="assistant-findings"]').exists()).toBe(false);
    live.unmount();
  });

  it("captions a partial report", async () => {
    const wrapper = mountReport({ partial: "Partial · stopped at 02:20" });
    expect(wrapper.get('[data-test="rca-partial-label"]').text()).toBe(
      "Partial · stopped at 02:20",
    );
    wrapper.unmount();
  });
});
