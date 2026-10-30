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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { buildProfileModel } from "@/utils/queryProfile";
import { joinProfile } from "@/utils/__fixtures__/queryProfile.fixture";
import QueryProfileView from "./QueryProfileView.vue";

const took = {
  total: 1840,
  cache_took: 0,
  file_list_took: 162,
  wait_in_queue: 70,
  idx_took: 0,
  search_took: 1500,
};

function mountView() {
  return mount(QueryProfileView, {
    props: { profile: joinProfile(), stream: { hits: [], took_detail: took }, sql: "SELECT 1" },
    global: { plugins: [store, i18n] },
    attachTo: document.body,
  });
}

function opIdByName(name: string, samples: number) {
  const model = buildProfileModel(joinProfile());
  return model.order.find(
    (id) => model.operators[id].name === name && model.operators[id].samples.length === samples,
  )!;
}

describe("QueryProfileView", () => {
  let wrapper: VueWrapper;

  afterEach(() => wrapper?.unmount());

  it("draws every operator once, one box per stage and a label per plan shape", () => {
    wrapper = mountView();
    const model = buildProfileModel(joinProfile());
    expect(wrapper.findAll('[data-test^="query-profile-card-"][role="button"]')).toHaveLength(
      model.order.length,
    );
    expect(wrapper.findAll('[data-test^="query-profile-stage-"]')).toHaveLength(2);
    expect(wrapper.findAll('[data-test^="query-profile-variant-"]')).toHaveLength(3);
  });

  it("shows the summary tiles, phases and the straggler note", () => {
    wrapper = mountView();
    expect(wrapper.find('[data-test="query-profile-sql"]').text()).toBe("SELECT 1");
    expect(wrapper.find('[data-test="query-profile-tile-nodes"]').text()).toContain("4Q · 2I");
    expect(wrapper.find('[data-test="query-profile-phases"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="query-profile-straggler-note"]').text()).toContain("q-2");
  });

  it("selects the top hotspot first and follows card clicks in the detail panel", async () => {
    wrapper = mountView();
    expect(wrapper.find('[data-test="query-profile-detail"]').text()).toContain("DataSource");
    await wrapper.find(`[data-test="query-profile-card-op"]`).trigger("click");
    expect(wrapper.find('[data-test="query-profile-detail"]').text()).toContain(
      "SortPreservingMerge",
    );
  });

  it("dims operators that did not run on the chosen node and restores them", async () => {
    wrapper = mountView();
    const querierFilter = opIdByName("FilterExec", 4);
    const card = () =>
      wrapper.find(`[data-test="query-profile-card-${querierFilter}"]`).element.parentElement!;
    expect(card().className).not.toContain("opacity-40");
    await wrapper.find('[data-test="query-profile-timeline-i-0"]').trigger("click");
    expect(card().className).toContain("opacity-40");
    await wrapper.find('[data-test="query-profile-timeline-i-0"]').trigger("click");
    expect(card().className).not.toContain("opacity-40");
  });

  it("lists remote nodes with the straggler tag for a remote scan", async () => {
    wrapper = mountView();
    const model = buildProfileModel(joinProfile());
    const logsRemote = model.stages.find((s) => s.nodes.length === 6)!.remoteOpId;
    await wrapper.find(`[data-test="query-profile-card-${logsRemote}"]`).trigger("click");
    await flushPromises();
    const table = wrapper.find('[data-test="query-profile-remote-nodes"]');
    expect(table.exists()).toBe(true);
    expect(wrapper.find('[data-test="query-profile-node-q-2"]').text()).toContain("Straggler");
    expect(wrapper.find('[data-test="query-profile-node-q-0"]').text()).not.toContain("Straggler");
  });
});
