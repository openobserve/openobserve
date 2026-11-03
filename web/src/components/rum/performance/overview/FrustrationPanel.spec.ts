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
import FrustrationPanel from "./FrustrationPanel.vue";

const RouterLinkStub = { props: ["to"], template: "<a :data-to='JSON.stringify(to)'><slot /></a>" };

const mountPanel = (cur: unknown, prev: unknown) =>
  mount(FrustrationPanel, {
    props: {
      cur,
      prev,
      sessionsLink: (f: string) => ({ name: "Sessions", query: { query: f } }),
      replaysLink: { name: "Sessions", query: { health: "frustrated" } },
    } as never,
    global: {
      components: { "router-link": RouterLinkStub },
      stubs: { OTruncatedText: { template: "<span><slot /></span>" } },
    },
  });

describe("FrustrationPanel", () => {
  it("shows counts with a bad-toned increase and links to the matching sessions", () => {
    const w = mountPanel({ rage: 148, dead: 291 }, { rage: 100, dead: 290 });
    const rage = w.find('[data-test="rum-overview-frustration-rage"]');
    expect(rage.text()).toContain("148");
    expect(rage.text()).toContain("+48% vs previous period");
    expect(rage.find("span.text-status-error-text").exists()).toBe(true);
    expect(JSON.parse(rage.attributes("data-to") as string).query.query).toBe(
      "strpos(action_frustration_type, 'rage_click') > 0",
    );
  });

  it("offers frustrated sessions as the way to a replay, saying only recorded ones have one", () => {
    const w = mountPanel({ rage: 1, dead: 1 }, null);
    const link = w.find('[data-test="rum-overview-frustration-replays"]');
    expect(link.text()).toBe("Watch a replay →");
    expect(JSON.parse(link.attributes("data-to") as string)).toEqual({
      name: "Sessions",
      query: { health: "frustrated" },
    });
    expect(w.text()).toContain("Opens the frustrated sessions in this range");
  });

  it("hides the replay link when there were no rage or dead clicks", () => {
    const w = mountPanel({ rage: 0, dead: 0 }, null);
    expect(w.find('[data-test="rum-overview-frustration-replays"]').exists()).toBe(false);
    expect(w.text()).not.toContain("Opens the frustrated sessions");
  });

  it("names each tile's destination for assistive tech", () => {
    const w = mountPanel({ rage: 148, dead: 291 }, null);
    expect(w.find('[data-test="rum-overview-frustration-rage"]').attributes("aria-label")).toBe(
      "Rage clicks: 148. Open Sessions",
    );
  });

  it("treats a flat count as no change", () => {
    const w = mountPanel({ rage: 10, dead: 20 }, { rage: 10, dead: 20 });
    expect(w.find('[data-test="rum-overview-frustration-dead"]').text()).toContain(
      "No change vs previous period",
    );
  });

  it("says there is not enough previous data without a previous window", () => {
    const w = mountPanel({ rage: 10, dead: 20 }, null);
    expect(w.find('[data-test="rum-overview-frustration-rage"]').text()).toContain(
      "not enough previous data",
    );
  });
});
