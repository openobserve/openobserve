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
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import RangeLimitStrip from "./RangeLimitStrip.vue";

const locale = i18n.global.locale;
const mountStrip = () =>
  mount(RangeLimitStrip, {
    props: {
      refusal: {
        asked: {
          startUs: Date.UTC(2026, 9, 1) * 1000,
          endUs: Date.UTC(2026, 9, 20) * 1000,
        },
        period: null,
        allowed: "1d",
        allowedPeriod: "24h",
        stream: "default",
      },
      timezone: "UTC",
      dataTest: "strip",
      nothingRunTest: "nothing-run",
    },
    global: { plugins: [i18n] },
  });

describe("RangeLimitStrip", () => {
  afterEach(() => {
    (i18n.global as any).locale = locale;
  });

  it("dates a refused fixed range in the user's locale (Codex pass 2 B-6)", () => {
    (i18n.global as any).locale = "fr";
    const text = mountStrip().text();
    expect(text).toMatch(/oct\./);
    expect(text).not.toContain("Oct ");
  });
});
