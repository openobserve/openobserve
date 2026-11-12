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

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import { raw } from "@/types/i18n";
import AlertCalibrationSkipGroup, { type SkipGroupRow } from "./AlertCalibrationSkipGroup.vue";

const row = (n: number, group = "probe_timeout"): SkipGroupRow => ({
  key: `a${n}`,
  group,
  label: raw(`alert_${n}`),
  why: raw(`why ${group}`),
});

const mountGroup = (rows: SkipGroupRow[], run = vi.fn()) =>
  mount(AlertCalibrationSkipGroup, {
    props: {
      titleKey: "alertCalibration.notChecked.title",
      whyKey: "alertCalibration.notChecked.why",
      rows,
      nextFor: (r: SkipGroupRow) => raw(`next ${r.group}`),
      ctaFor: (r: SkipGroupRow) => ({ label: raw("Review query"), run: () => run(r.key) }),
    },
    global: { plugins: [store] },
  });

const shownRows = (wrapper: ReturnType<typeof mountGroup>) =>
  wrapper.findAll('[data-test="alert-calibration-skip-group-row"]').map((r) => r.text());

const heading = (wrapper: ReturnType<typeof mountGroup>) => [
  wrapper.get('[data-test="alert-calibration-skip-group-title"]').text(),
  wrapper.get('[data-test="alert-calibration-skip-group-count"]').text(),
];

describe("AlertCalibrationSkipGroup", () => {
  it("renders nothing for no rows", () => {
    expect(mountGroup([]).find('[data-test="alert-calibration-skip-group"]').exists()).toBe(false);
  });

  it("one row has its count heading, the singular why, the cause once and one next step", async () => {
    const run = vi.fn();
    const wrapper = mountGroup([row(1)], run);
    expect(heading(wrapper)).toEqual(["Definition not checked", "1"]);
    expect(wrapper.text()).toContain(
      "AutoObserve could not check what 1 alert reads, so a missing stream, field or label would go unnoticed.",
    );
    const causes = wrapper.findAll('[data-test="alert-calibration-skip-group-cause"]');
    expect(causes).toHaveLength(1);
    expect(causes[0].findAll("dt").map((dt) => dt.text())).toEqual(["Why", "Next"]);
    expect(causes[0].get('[data-test="alert-calibration-skip-group-cause-why"]').text()).toBe(
      "why probe_timeout",
    );
    expect(causes[0].get('[data-test="alert-calibration-skip-group-cause-next"]').text()).toBe(
      "next probe_timeout",
    );
    expect(shownRows(wrapper)).toEqual(["alert_1Review query"]);
    expect(wrapper.text().split("why probe_timeout")).toHaveLength(2);
    expect(wrapper.text().split("next probe_timeout")).toHaveLength(2);
    await wrapper.get('[data-test="alert-calibration-skip-group-row"] button').trigger("click");
    expect(run).toHaveBeenCalledWith("a1");
  });

  it("groups by cause in the given order and folds a cause past five behind Show all", async () => {
    const rows = [...Array.from({ length: 7 }, (_, n) => row(n + 1)), row(8, "probe_error")];
    const wrapper = mountGroup(rows);
    expect(heading(wrapper)).toEqual(["Definition not checked", "8"]);
    expect(wrapper.text()).toContain("what 8 alerts read");
    const causes = wrapper.findAll('[data-test="alert-calibration-skip-group-cause"]');
    expect(
      causes.map((c) => c.get('[data-test="alert-calibration-skip-group-cause-why"]').text()),
    ).toEqual(["why probe_timeout", "why probe_error"]);
    expect(shownRows(wrapper)).toHaveLength(6);
    const line = wrapper.get('[data-test="alert-calibration-skip-group-more-line"]');
    expect(line.text().replace(/\s+/g, " ")).toBe("and 2 more · Show all 7");
    await wrapper.get('[data-test="alert-calibration-skip-group-more"]').trigger("click");
    expect(shownRows(wrapper)).toHaveLength(8);
    expect(wrapper.find('[data-test="alert-calibration-skip-group-more-line"]').exists()).toBe(
      false,
    );
  });
});
