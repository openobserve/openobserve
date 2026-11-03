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

import { describe, it, expect, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import OTimeCell from "./OTimeCell.vue";

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const MIN = 60_000;

const relative = (agoMs: number) =>
  mount(OTimeCell, {
    props: { value: NOW - agoMs, unit: "ms", now: NOW },
    global: { stubs: { OTooltip: true } },
  }).text();

describe("OTimeCell", () => {
  afterEach(() => {
    i18n.global.locale = "en-us";
  });

  it("tells a relative time in the largest unit it reaches", () => {
    expect(relative(30_000)).toBe("30 seconds ago");
    expect(relative(24 * MIN)).toBe("24 minutes ago");
    expect(relative(3 * 60 * MIN)).toBe("3 hours ago");
    expect(relative(2 * 24 * 60 * MIN)).toBe("2 days ago");
    expect(relative(-5 * MIN)).toBe("in 5 minutes");
  });

  it("speaks the active UI language", () => {
    i18n.global.locale = "de";
    expect(relative(24 * MIN)).toBe("vor 24 Minuten");
  });
});
