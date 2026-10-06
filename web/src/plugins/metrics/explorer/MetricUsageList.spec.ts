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

import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MetricUsageList from "./MetricUsageList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const EMPTY = { dashboards: [], alerts: [], slos: [], pipelines: [], unparsed: 0 };
const USAGE = {
  dashboards: [{ id: "d1", title: "Board", folder_id: "f1" }],
  alerts: [
    { id: "a1", name: "High errors", folder_id: "f2" },
    { id: "a2", name: "Other", folder_id: "f2" },
  ],
  slos: [{ id: "s1", name: "Availability" }],
  pipelines: [{ id: "p1", name: "Rollup", match: "text" }],
  unparsed: 2,
};

const mountList = (props: Record<string, any>) =>
  mount(MetricUsageList, { props, global: { plugins: [i18n, store] } });

const find = (w: VueWrapper<any>, test: string) => w.find(`[data-test="${test}"]`);

describe("MetricUsageList", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => wrapper?.unmount());

  it("shows a loading state", () => {
    wrapper = mountList({ usage: null, status: "loading" });
    expect(find(wrapper, "metrics-detail-used-in-loading").exists()).toBe(true);
  });

  it("says so when the lookup failed", () => {
    wrapper = mountList({ usage: null, status: "error" });
    expect(find(wrapper, "metrics-detail-used-in-error").exists()).toBe(true);
  });

  it("says so when nothing uses the metric", () => {
    wrapper = mountList({ usage: EMPTY, status: "done" });
    expect(find(wrapper, "metrics-detail-used-in-empty").exists()).toBe(true);
    expect(find(wrapper, "metrics-detail-used-in-unparsed").exists()).toBe(false);
  });

  it("lists each non-empty group with its count", () => {
    wrapper = mountList({ usage: USAGE, status: "done" });
    expect(find(wrapper, "metrics-detail-used-in-dashboards").text()).toContain("Dashboards (1)");
    expect(find(wrapper, "metrics-detail-used-in-alerts").text()).toContain("Alerts (2)");
    expect(find(wrapper, "metrics-detail-used-in-slos").text()).toContain("SLOs (1)");
    expect(find(wrapper, "metrics-detail-used-in-pipelines").text()).toContain(
      "Scheduled pipelines (1)",
    );
    expect(find(wrapper, "metrics-detail-used-in-empty").exists()).toBe(false);

    wrapper.unmount();
    wrapper = mountList({ usage: { ...EMPTY, slos: USAGE.slos }, status: "done" });
    expect(find(wrapper, "metrics-detail-used-in-dashboards").exists()).toBe(false);
  });

  it("says how many queries were matched only by name, and marks those objects", () => {
    wrapper = mountList({ usage: USAGE, status: "done" });
    expect(find(wrapper, "metrics-detail-used-in-unparsed").text()).toContain(
      "2 queries could not be parsed and were matched by name",
    );
    expect(find(wrapper, "metrics-detail-used-in-text-match-pipelines-p1").exists()).toBe(true);
    expect(find(wrapper, "metrics-detail-used-in-text-match-dashboards-d1").exists()).toBe(false);
  });

  it("links each object to its own page", async () => {
    wrapper = mountList({ usage: USAGE, status: "done" });
    const org = store.state.selectedOrganization.identifier;
    const open = async (kind: string, id: string) => {
      await find(wrapper, `metrics-detail-used-in-link-${kind}-${id}`).trigger("click");
      return push.mock.calls.at(-1)![0];
    };

    expect(find(wrapper, "metrics-detail-used-in-link-dashboards-d1").text()).toBe("Board");
    expect(await open("dashboards", "d1")).toEqual({
      name: "viewDashboard",
      query: { org_identifier: org, dashboard: "d1", folder: "f1" },
    });
    expect(await open("alerts", "a1")).toEqual({
      name: "alertDetail",
      params: { alert_id: "a1" },
      query: { org_identifier: org, folder: "f2" },
    });
    expect(await open("slos", "s1")).toEqual({
      name: "sloDetail",
      params: { slo_id: "s1" },
      query: { org_identifier: org },
    });
    expect(await open("pipelines", "p1")).toEqual({
      name: "pipelineEditor",
      query: { id: "p1", name: "Rollup", org_identifier: org },
    });
  });
});
