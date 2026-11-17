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
import type { RiskGraph } from "@/services/securityInvestigate";
import SecurityRiskGraph from "./SecurityRiskGraph.vue";

// VueFlow measures the DOM, which jsdom cannot; this renders each node through the real slot.
const VueFlowStub = {
  name: "VueFlow",
  props: ["nodes", "edges"],
  emits: ["node-click"],
  template: `<div class="vue-flow-stub">
    <div v-for="n in nodes" :key="n.id" @click="$emit('node-click', { node: n })">
      <slot name="node-risk" :data="n.data" />
    </div>
    <span v-for="e in edges" :key="e.id" class="edge" :data-label="e.label" />
  </div>`,
};

let wrapper: VueWrapper | null = null;
const mountGraph = (graph: RiskGraph = { nodes: [], edges: [], total: 0 }) => {
  wrapper = mount(SecurityRiskGraph, {
    props: { graph },
    global: { stubs: { VueFlow: VueFlowStub, Background: true, Controls: true, Handle: true } },
  });
  return wrapper;
};

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("SecurityRiskGraph", () => {
  it("shows an empty state, not invented assets, when there is no data", () => {
    const w = mountGraph();
    expect(w.find('[data-test="security-risk-graph-empty"]').exists()).toBe(true);
    expect(w.text()).not.toContain("prod-db");
    expect(w.text()).not.toContain("jump-host");
  });

  it("draws real entities with their spellings and opens one on click", async () => {
    // As the server scores it: one P1 case on carol, linked to the IP by 30 events.
    const graph: RiskGraph = {
      nodes: [
        {
          id: "user:carol",
          kind: "user",
          value: "carol",
          aliases: ["carol@acme.io"],
          events: 30,
          failures: 28,
          cases: [{ id: "c1", title: "Okta account takeover", severity: "P1" }],
          detectionScore: 40,
          failureScore: 0,
          neighbourScore: 0,
          score: 40,
          tone: "high",
        },
        {
          id: "ip:185.220.101.47",
          kind: "ip",
          value: "185.220.101.47",
          aliases: ["185.220.101.47"],
          events: 30,
          failures: 28,
          cases: [],
          detectionScore: 0,
          failureScore: 0,
          neighbourScore: 10,
          score: 10,
          tone: "low",
        },
      ],
      edges: [
        {
          id: "ip:185.220.101.47|user:carol",
          source: "ip:185.220.101.47",
          target: "user:carol",
          events: 30,
          failures: 28,
          streams: ["okta_auth"],
          caseIds: [],
          type: "event",
        },
      ],
      total: 2,
    };
    const w = mountGraph(graph);
    const carol = w.find('[data-test="risk-node-user:carol"]');
    expect(carol.text()).toContain("carol");
    expect(carol.text()).toContain("carol@acme.io");
    expect(carol.text()).toContain("1 case");
    expect(w.find('[data-test="risk-node-score-user:carol"]').text()).toBe("40");
    expect(w.find(".edge").attributes("data-label")).toBe("30 events");
    await carol.trigger("click");
    expect(w.emitted("node-select")).toEqual([["user", "carol"]]);
  });
});
