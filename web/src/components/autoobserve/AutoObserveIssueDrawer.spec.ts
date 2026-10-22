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

import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { gt } from "@/types/i18n";
import AutoObserveIssueDrawer from "./AutoObserveIssueDrawer.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import { issuesFor } from "./fixtures";

const stubs = {
  ODrawer: { template: "<div><slot /></div>" },
  AutoObserveAnalysis: { template: "<div data-test='analysis-stub'><slot name='report' /></div>" },
  AutoObserveUnfoldGraph: true,
  IncidentAlertTriggersTable: true,
  ProblemSpark: true,
};

describe("AutoObserveIssueDrawer report viewer", () => {
  it("renders the issue report HTML in the shared report view, without the incident analysis panel", async () => {
    const issue = issuesFor("demo", gt)[0];
    const wrapper = mount(AutoObserveIssueDrawer, {
      props: { open: true, issue, ledger: [], scenario: "demo" },
      global: { plugins: [i18n, store, router], stubs },
    });
    // The analysis tab: OTabs drives the drawer's `tab` through v-model.
    wrapper.findComponent(OTabs).vm.$emit("update:modelValue", "analysis");
    await flushPromises();

    const report = wrapper.find('[data-test="rca-report-content"]');
    expect(report.exists()).toBe(true);
    expect(report.find(".rca-report-content").exists()).toBe(true);
    expect(report.findAll(".rca-h2").length).toBeGreaterThanOrEqual(4);
    expect(report.text()).toContain(issue.summary);
    expect(report.text()).toContain(issue.likelyCause);
    expect(report.findAll(".rca-list-item")).toHaveLength(issue.evidence.length);
    expect(wrapper.find('[data-test="rca-analysis-bar"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="rca-thread-column"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
