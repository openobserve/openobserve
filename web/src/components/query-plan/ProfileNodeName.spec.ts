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
import { mount } from "@vue/test-utils";
import ProfileNodeName from "./ProfileNodeName.vue";
import type { NodeNameRow } from "./profileStyles";
import i18n from "@/locales";

function row(overrides: Partial<NodeNameRow> = {}): NodeNameRow {
  return {
    id: "n1",
    name: "o2-ingester-0",
    cluster: "",
    role: "ingester",
    straggler: false,
    active: false,
    error: "",
    skipped: false,
    ...overrides,
  };
}

function mountName(r: NodeNameRow) {
  return mount(ProfileNodeName, { props: { row: r }, global: { plugins: [i18n] } });
}

describe("ProfileNodeName", () => {
  it("shows the cluster beside a node from a super cluster", () => {
    const w = mountName(row({ cluster: "cluster-b" }));
    expect(w.find('[data-test="query-profile-node-cluster-n1"]').text()).toBe(
      "cluster-b · Ingester",
    );
  });

  it("shows no cluster badge inside a single cluster", () => {
    const w = mountName(row());
    expect(w.find('[data-test="query-profile-node-cluster-n1"]').exists()).toBe(false);
  });
});
