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
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { raw } from "@/types/i18n";
import CoverageSignalDetail from "./CoverageSignalDetail.vue";
import type { CoverageCell } from "./fixtures";

const noAlert: CoverageCell = {
  state: "gap",
  engine: { state: raw("none"), stateKey: "none", monitors: [] },
};

const mountDetail = (added: boolean) =>
  mount(CoverageSignalDetail, {
    props: { cell: noAlert, service: "svc-d", signal: "errors", ledger: [], added },
    global: { plugins: [i18n, store], stubs: { InsightBlock: true } },
  });

describe("CoverageSignalDetail on a check whose alert was just added (T2-N1)", () => {
  it("doesn't say no alert matches while the new alert waits for the next check", () => {
    expect(
      mountDetail(true).find('[data-test="autoobserve-coverage-detail-monitors"]').exists(),
    ).toBe(false);
    expect(
      mountDetail(false).find('[data-test="autoobserve-coverage-detail-monitors"]').text(),
    ).toContain("No alert matches");
  });
});
