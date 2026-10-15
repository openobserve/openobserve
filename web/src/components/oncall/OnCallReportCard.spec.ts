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
import { describe, expect, it } from "vitest";

import OnCallReportCard from "@/components/oncall/OnCallReportCard.vue";
import i18n from "@/locales";
import type { OnCallResponseReport } from "@/ts/interfaces/oncall";

const stubs = {
  OCard: { name: "OCard", template: "<div><slot /></div>" },
  OCardSection: { name: "OCardSection", template: "<div><slot /></div>" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  OSkeleton: { name: "OSkeleton", template: "<div class='skeleton' />" },
  OTimeCell: { name: "OTimeCell", props: ["value", "unit"], template: "<time>{{ value }}</time>" },
};

function render(report: OnCallResponseReport | null, loading = false) {
  return mount(OnCallReportCard, {
    props: { report, loading },
    global: { plugins: [i18n], stubs },
  });
}

const report = (body: string): OnCallResponseReport => ({
  report: body,
  model: "sonnet",
  generated_at: 1_759_000_000_000_000,
});

describe("OnCallReportCard", () => {
  it("renders nothing at all when no agent reported", () => {
    const wrapper = render(null);

    expect(wrapper.find('[data-test="oncall-report-card"]').exists()).toBe(false);
  });

  it("renders the report's markdown as html", () => {
    const wrapper = render(report("## Subject Summary\n\nThe pool was **exhausted**."));

    const html = wrapper.find('[data-test="oncall-report-card"]').html();
    expect(html).toContain("<h2");
    expect(html).toContain("<strong>exhausted</strong>");
  });

  it("drops the verdict block the card above already renders as a sentence", () => {
    const wrapper = render(
      report('# Alert Analysis Report\n\nBody.\n\n```json verdict\n{"probable_cause":"x"}\n```'),
    );

    const text = wrapper.text();
    expect(text).toContain("Body.");
    expect(text).not.toContain("probable_cause");
  });

  it("strips anything the sanitizer does not allow", () => {
    const wrapper = render(
      report("Fine.\n\n<img src=x onerror=alert(1)>\n\n<script>bad()</script>"),
    );

    const html = wrapper.find('[data-test="oncall-report-card"]').html();
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
  });

  it("skeletons while loading rather than reading as an empty report", () => {
    const wrapper = render(null, true);

    expect(wrapper.find('[data-test="oncall-report-loading"]').exists()).toBe(true);
  });
});
