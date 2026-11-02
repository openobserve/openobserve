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
import { buildProfileModel, modelForClusterView } from "@/utils/queryProfile";
import { joinProfile, superClusterJoinProfile } from "@/utils/__fixtures__/queryProfile.fixture";
import QueryProfileView from "./QueryProfileView.vue";

const took = {
  total: 1840,
  cache_took: 0,
  file_list_took: 162,
  wait_in_queue: 70,
  idx_took: 0,
  search_took: 1500,
};

function mountView(profile = joinProfile()) {
  return mount(QueryProfileView, {
    props: { model: buildProfileModel(profile), stream: { hits: [], took_detail: took } },
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

  it("draws every operator once, one box per stage and a label per plan shape", async () => {
    wrapper = mountView();
    await wrapper.find('[data-test="query-profile-fold-plumbing"]').trigger("click");
    const model = buildProfileModel(joinProfile());
    expect(wrapper.findAll('[data-test^="query-profile-card-"][role="button"]')).toHaveLength(
      model.order.length,
    );
    expect(wrapper.findAll('[data-test^="query-profile-stage-"]')).toHaveLength(2);
    expect(wrapper.findAll('[data-test^="query-profile-variant-"]')).toHaveLength(3);
  });

  it("shows the summary tiles, phases and the straggler note", () => {
    wrapper = mountView();
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

  it("adds files and disk cache per node for an operator inside a stage", async () => {
    wrapper = mountView();
    const model = buildProfileModel(joinProfile());
    const logsScan = model.order.find((id) => {
      const op = model.operators[id];
      return op.name === "DataSourceExec" && model.stageById[op.stageId!].nodes.length === 6;
    })!;
    await wrapper.find(`[data-test="query-profile-card-${logsScan}"]`).trigger("click");
    await flushPromises();
    const table = wrapper.find('[data-test="query-profile-op-nodes"]');
    expect(table.text()).toContain("Files");
    expect(table.text()).toContain("Cache");
    const straggler = table.findAll("tr").find((r) => r.text().includes("q-2"))!;
    expect(straggler.text()).toContain("104");
    expect(straggler.text()).toContain("8.7%");
    expect(straggler.find(".text-status-error-text").exists()).toBe(true);
  });

  it("leaves the cache column out when no node reports one", async () => {
    wrapper = mountView();
    await wrapper
      .find(`[data-test="query-profile-card-${opIdByName("DataSourceExec", 2)}"]`)
      .trigger("click");
    await flushPromises();
    const table = wrapper.find('[data-test="query-profile-op-nodes"]');
    expect(table.text()).toContain("Files");
    expect(table.text()).not.toContain("Cache");
  });

  describe("folding", () => {
    const model = buildProfileModel(joinProfile());
    const join = model.order.find((id) => model.operators[id].name === "HashJoinExec")!;
    const repartition = model.order.find((id) => model.operators[id].name === "RepartitionExec")!;
    const cards = () => wrapper.findAll('[data-test^="query-profile-card-"][role="button"]');
    const find = (test: string) => wrapper.find(`[data-test="${test}"]`);

    it("collapses a branch from the card toggle and opens it from the fold card", async () => {
      wrapper = mountView();
      const before = cards().length;
      await find(`query-profile-card-${join}-branch`).trigger("click");
      expect(cards().length).toBeLessThan(before);
      expect(find(`query-profile-fold-branch-${join}`).text()).toContain("operators hidden");
      await find(`query-profile-fold-branch-${join}`).trigger("click");
      expect(cards()).toHaveLength(before);
    });

    it("opens a folded operator from its edge and folds it back from the card", async () => {
      wrapper = mountView();
      await find(`query-profile-chip-${repartition}`).trigger("click");
      expect(find(`query-profile-card-${repartition}`).exists()).toBe(true);
      await find(`query-profile-card-${repartition}-refold`).trigger("click");
      expect(find(`query-profile-card-${repartition}`).exists()).toBe(false);
      expect(find(`query-profile-chip-${repartition}`).exists()).toBe(true);
    });

    it("collapses a stage into a summary card that names it", async () => {
      wrapper = mountView();
      const stage = model.stages[1];
      await find(`query-profile-collapse-stage-${stage.id}`).trigger("click");
      expect(find(`query-profile-stage-${stage.id}`).exists()).toBe(false);
      expect(find(`query-profile-fold-stage-${stage.id}`).text()).toContain("Stage 2");
    });

    it("moves the selection up when a fold hides the selected operator", async () => {
      wrapper = mountView();
      expect(find("query-profile-detail").text()).toContain("DataSource");
      await find(`query-profile-card-${join}-branch`).trigger("click");
      await flushPromises();
      expect(find("query-profile-detail").text()).toContain("HashJoin");
    });

    it("focuses one branch from the detail panel and shows the whole plan from the notice", async () => {
      wrapper = mountView();
      await find("query-profile-detail-focus").trigger("click");
      expect(find("query-profile-fold-notice").text()).toContain("Showing only the branch through");
      expect(wrapper.findAll('[data-test^="query-profile-fold-group-"]').length).toBeGreaterThan(0);
      await find("query-profile-fold-notice-action").trigger("click");
      expect(find("query-profile-fold-notice").exists()).toBe(false);
      expect(wrapper.findAll('[data-test^="query-profile-fold-group-"]')).toHaveLength(0);
    });

    it("expands everything and keeps hotspots open on the hot path", async () => {
      wrapper = mountView();
      await find(`query-profile-card-${join}-branch`).trigger("click");
      await find("query-profile-expand-all").trigger("click");
      expect(find(`query-profile-fold-branch-${join}`).exists()).toBe(false);
      await find("query-profile-hot-path").trigger("click");
      expect(find("query-profile-fold-notice").text()).toContain("top hotspots");
    });
  });

  describe("super-cluster views", () => {
    const find = (test: string) => wrapper.find(`[data-test="${test}"]`);
    const stageBoxes = () => wrapper.findAll('[data-test^="query-profile-stage-"]');

    it("offers the cluster switch and the clusters table only for a super cluster", () => {
      wrapper = mountView();
      expect(find("query-profile-cluster-toolbar").exists()).toBe(false);
      expect(find("query-profile-clusters").exists()).toBe(false);
      wrapper.unmount();
      wrapper = mountView(superClusterJoinProfile());
      expect(find("query-profile-cluster-toolbar").exists()).toBe(true);
      expect(find("query-profile-clusters").text()).toContain("sc-c");
    });

    it("shows one cluster from its table row and goes back from the notice", async () => {
      wrapper = mountView(superClusterJoinProfile());
      expect(find("query-profile-tile-nodes").text()).toContain("9Q · 6I");
      const row = find("query-profile-clusters")
        .findAll("tr")
        .find((r) => r.text().includes("sc-b"))!;
      await row.trigger("click");
      expect(find("query-profile-tile-nodes").text()).toContain("3Q · 2I");
      expect(find("query-profile-fold-notice").text()).toContain(
        "Showing only sc-b: 5 of 15 nodes",
      );
      await find("query-profile-fold-notice-action").trigger("click");
      expect(find("query-profile-tile-nodes").text()).toContain("9Q · 6I");
      expect(find("query-profile-fold-notice").exists()).toBe(false);
    });

    it("draws a branch per cluster leader when split by cluster", async () => {
      wrapper = mountView(superClusterJoinProfile());
      await find("query-profile-fold-plumbing").trigger("click");
      expect(stageBoxes()).toHaveLength(4);
      await find("query-profile-cluster-split").trigger("click");
      expect(stageBoxes()).toHaveLength(8);
      expect(wrapper.text()).toContain("sc-c leader");
    });

    it("names the cluster of every node in one cluster's own stage", async () => {
      wrapper = mountView(superClusterJoinProfile());
      await find("query-profile-cluster-split").trigger("click");
      const split = modelForClusterView(buildProfileModel(superClusterJoinProfile()), "split");
      const stage = split.stages.find((s) => s.cluster === "sc-b")!;
      await find(`query-profile-card-${stage.remoteOpId}`).trigger("click");
      await flushPromises();
      const labels = find("query-profile-remote-nodes").findAll(
        '[data-test^="query-profile-node-cluster-"]',
      );
      expect(labels).toHaveLength(5);
      expect(labels.every((l) => l.text().startsWith("sc-b"))).toBe(true);
    });

    it("lists each cluster with its own nodes under it in one table", async () => {
      wrapper = mountView(superClusterJoinProfile());
      const model = buildProfileModel(superClusterJoinProfile());
      const top = model.stages.find((s) => !s.parentStageId)!;
      await find(`query-profile-card-${top.remoteOpId}`).trigger("click");
      await flushPromises();
      const table = find("query-profile-remote-nodes");
      expect(table.find('[data-test="query-profile-node-meta-sc-a"]').text()).toContain("5 nodes");
      expect(table.text()).toContain("querier-2");
      expect(table.text()).toContain("Fetch");
      await find("query-profile-remote-read").trigger("click");
      expect(find("query-profile-remote-nodes").text()).toContain("Files");
    });
  });
});
