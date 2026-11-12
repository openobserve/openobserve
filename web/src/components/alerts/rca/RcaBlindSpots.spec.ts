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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import RcaBlindSpots from "./RcaBlindSpots.vue";
import type { RcaBlindSpot } from "@/services/incidents";
import {
  rcaBlindSpot,
  rcaRunSummary,
  rcaRunSummaryCancelled,
} from "@/test/unit/fixtures/rcaThread";

const mountSpots = (
  blindSpots: RcaBlindSpot[],
  live = false,
  extra: Record<string, unknown> = {},
) =>
  mount(RcaBlindSpots, {
    props: { blindSpots, org: "default", live, ...extra },
    global: { plugins: [i18n] },
  });

/** [title, button text or null] of each blind spot. */
const spots = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-test="rca-blind-spot"]').map((row) => {
    const button = row.find('[data-test="rca-blind-spot-action"]');
    return [row.find(".font-semibold").text(), button.exists() ? button.text() : null];
  });

describe("RcaBlindSpots (03 VE8, VE34, VE37)", () => {
  beforeEach(() => push.mockReset());

  it("frame B: two blind spots, each with its button and reason", () => {
    const wrapper = mountSpots(rcaRunSummary().blind_spots);

    expect(spots(wrapper)).toEqual([
      ["Feature-flag history", "Connect AI Toolset"],
      ["payments-worker logs are sampled", "Open pipeline"],
    ]);
    expect(wrapper.text()).toContain("No toolset in this org provides flag changes.");
    expect(wrapper.text()).toContain("What the agent could not check");
  });

  it.each([
    ["connect_toolset", "Connect AI Toolset", "aiToolsets"],
    ["ingest_data", "Ingest data", "ingestion"],
    ["open_pipeline", "Open pipeline", "pipelines"],
    ["sampling_rules", "Sampling rules", "pipelines"],
  ] as const)("%s: '%s' opens %s", async (fix, label, name) => {
    const wrapper = mountSpots([rcaBlindSpot({ fix })]);
    const button = wrapper.find('[data-test="rca-blind-spot-action"]');

    expect(button.text()).toBe(label);
    await button.trigger("click");
    expect(push).toHaveBeenCalledWith({ name, query: { org_identifier: "default" } });
  });

  it.each([
    ["connect_toolset", "ai_toolsets"],
    ["open_pipeline", "pipelines"],
  ] as const)("%s: disabled with a lock while %s is license-locked", async (fix, feature) => {
    store.state.zoConfig.features = { [feature]: "locked" };
    try {
      const wrapper = mount(RcaBlindSpots, {
        props: { blindSpots: [rcaBlindSpot({ fix })], org: "default", live: false },
        global: { plugins: [i18n, store] },
      });
      const button = wrapper.find('[data-test="rca-blind-spot-action"]');
      expect(button.attributes("disabled")).toBeDefined();
      expect(wrapper.find('[data-test="rca-blind-spot-action-lock"]').exists()).toBe(true);
      await button.trigger("click");
      expect(push).not.toHaveBeenCalled();
    } finally {
      delete store.state.zoConfig.features;
    }
  });

  it.each(["resume_run", "none"] as const)(
    "%s renders no button without canResume (VE37)",
    (fix) => {
      const wrapper = mountSpots([rcaBlindSpot({ fix })]);

      expect(wrapper.find('[data-test="rca-blind-spot-action"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain("Resume");
    },
  );

  it("J9: resume_run with canResume shows 'Resume run', which emits resume and never navigates", async () => {
    const wrapper = mountSpots([rcaBlindSpot({ fix: "resume_run" })], false, { canResume: true });
    const button = wrapper.find('[data-test="rca-blind-spot-action"]');

    expect(button.text()).toBe("Resume run");
    await button.trigger("click");
    expect(wrapper.emitted("resume")).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("J9: canResume adds no button to other fixes", () => {
    const wrapper = mountSpots(
      [rcaBlindSpot({ id: "a", fix: "none" }), rcaBlindSpot({ id: "b", fix: "open_pipeline" })],
      false,
      { canResume: true },
    );

    expect(spots(wrapper).map(([, button]) => button)).toEqual([null, "Open pipeline"]);
  });

  it("J9: the resume button is disabled while a trigger is in flight", async () => {
    const wrapper = mountSpots([rcaBlindSpot({ fix: "resume_run" })], false, {
      canResume: true,
      triggering: true,
    });
    const button = wrapper.find('[data-test="rca-blind-spot-action"]');

    expect(button.attributes("disabled")).toBeDefined();
    await button.trigger("click");
    expect(wrapper.emitted("resume")).toBeUndefined();
  });

  it("frame E: the run_end blind spot names the stages that did not run, with no button", () => {
    const wrapper = mountSpots(rcaRunSummaryCancelled().blind_spots);

    expect(spots(wrapper)).toEqual([["3 stages did not run", null]]);
    expect(wrapper.text()).toContain("Log patterns, Metrics, Converge");
  });

  it("no blind spots: the finished and the live empty lines", () => {
    expect(mountSpots([]).find('[data-test="rca-blind-spots-empty"]').text()).toBe(
      "None. The agent reported no gaps.",
    );
    expect(mountSpots([], true).find('[data-test="rca-blind-spots-empty"]').text()).toBe(
      "None so far. Gaps appear here as checks run.",
    );
  });
});
