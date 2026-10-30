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
import { mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { buildProfileModel, physicalPlanToProfile } from "@/utils/queryProfile";
import { AGG_PHYSICAL_PLAN } from "@/utils/__fixtures__/queryProfile.fixture";
import QueryPlanView from "./QueryPlanView.vue";

const profile = physicalPlanToProfile(AGG_PHYSICAL_PLAN)!;
const model = buildProfileModel(profile, [], { planOnly: true });

function opId(name: string, index = 0) {
  return model.order.filter((id) => model.operators[id].name === name)[index];
}

function mountView() {
  return mount(QueryPlanView, {
    props: { model },
    global: { plugins: [store, i18n] },
    attachTo: document.body,
  });
}

function cardText(wrapper: VueWrapper, id: string) {
  return wrapper.find(`[data-test="query-profile-card-${id}"]`).text();
}

describe("QueryPlanView", () => {
  let wrapper: VueWrapper;

  afterEach(() => wrapper?.unmount());

  it("draws every operator as a card without any runtime numbers", () => {
    wrapper = mountView();
    const cards = wrapper.findAll('[data-test^="query-profile-card-"][role="button"]');
    expect(cards).toHaveLength(model.order.length);
    expect(wrapper.find('[data-test="query-profile-canvas"] [role="progressbar"]').exists()).toBe(
      false,
    );
    expect(wrapper.findAll('[data-test$="-badge"]')).toHaveLength(1);
    expect(
      wrapper.find(`[data-test="query-profile-card-${opId("RemoteScanExec")}-badge"]`).text(),
    ).toBe("Stage 1");
    expect(wrapper.find('[data-test="query-profile-canvas"]').text()).not.toMatch(/%|rows/);
    expect(wrapper.find('[data-test="query-profile-scope-toolbar"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-test^="query-profile-variant-"]')).toHaveLength(0);
  });

  it("labels the stage as running everywhere instead of counting nodes", () => {
    wrapper = mountView();
    expect(wrapper.find('[data-test="query-profile-canvas"]').text()).toContain(
      "Stage 1 · runs on every querier and ingester",
    );
  });

  it("shows a short readable detail on each card", () => {
    wrapper = mountView();
    expect(cardText(wrapper, opId("NewEmptyExec"))).toContain("Scan · app_logs");
    expect(cardText(wrapper, opId("NewEmptyExec"))).toContain("app_logs · 2 columns");
    expect(cardText(wrapper, opId("FilterExec"))).toContain("level = error");
    expect(cardText(wrapper, opId("AggregateExec"))).toContain("by k8s_namespace_name");
    expect(cardText(wrapper, opId("SortExec"))).toContain("count(Int64(1)) DESC · fetch=10");
    expect(cardText(wrapper, opId("RepartitionExec"))).toContain("Hash(k8s_namespace_name) · 10");
    expect(cardText(wrapper, opId("RemoteScanExec"))).toContain("Sends stage 1 to every node");
  });

  it("summarises streams, operators, stages, limit and pushdown", async () => {
    wrapper = mountView();
    const text = (sel: string) => wrapper.find(`[data-test="${sel}"]`).text();
    expect(text("query-plan-tile-stream")).toContain("app_logs");
    expect(text("query-plan-tile-operators")).toContain("12");
    expect(text("query-plan-tile-operators")).toContain("7 leader · 5 remote");
    expect(text("query-plan-tile-stages")).toContain("2");
    expect(text("query-plan-tile-limit")).toContain("10 rows");
    const pushdown = text(`query-plan-pushdown-${opId("NewEmptyExec")}`);
    expect(pushdown).toContain("level = 'error'");
    expect(pushdown).toContain("k8s_namespace_name, level");
    expect(text("query-plan-where-s1")).toContain("Every querier and ingester");
    await wrapper.find('[data-test="query-plan-go-analyze"]').trigger("click");
    expect(wrapper.emitted("analyze")).toHaveLength(1);
  });

  it("selects the scan first and shows its parsed details without metrics", async () => {
    wrapper = mountView();
    const detail = () => wrapper.find('[data-test="query-plan-detail"]');
    expect(detail().text()).toContain("Scan · app_logs");
    expect(wrapper.find('[data-test="query-profile-detail-where"]').text()).toBe("Scan in stage 1");
    const entries = wrapper.find('[data-test="query-plan-detail-entries"]').text();
    expect(entries).toContain("projection");
    expect(entries).toContain("k8s_namespace_name, level");
    expect(entries).toContain("level = 'error'");
    expect(wrapper.find('[data-test="query-plan-detail-raw"]').text()).toContain("NewEmptyExec:");
    expect(wrapper.find('[data-test="query-plan-detail-note"]').exists()).toBe(true);
    expect(detail().find('[role="progressbar"]').exists()).toBe(false);

    await wrapper.find(`[data-test="query-profile-card-${opId("FilterExec")}"]`).trigger("click");
    expect(detail().text()).toContain("level = error");
    expect(wrapper.find('[data-test="query-profile-detail-where"]').text()).toBe(
      "Filter in stage 1",
    );
  });
});
