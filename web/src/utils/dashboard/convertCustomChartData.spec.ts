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
import {
  CustomChartSkippedError,
  panelRefreshEpoch,
  panelRefreshTargets,
  prepareCustomChartRun,
  settlePanelRefresh,
  validateUserCode,
} from "./convertCustomChartData";

describe("convertCustomChartData", () => {
  afterEach(() => {
    panelRefreshTargets.clear();
  });

  describe("prepareCustomChartRun", () => {
    it("hands the code, data, context and panel id to the sandbox renderer", () => {
      const context = {
        variables: { env: "prod" },
        timeRange: { start: 1, end: 2 },
        timezone: "UTC",
        theme: "dark" as const,
      };
      const data = [[{ x: 1 }]];

      expect(
        prepareCustomChartRun({ id: "p1", customChartContent: "option = {}" }, data, context),
      ).toEqual({ code: "option = {}", data, context, panelId: "p1" });
    });

    it("throws CustomChartSkippedError while another panel is being refreshed", () => {
      panelRefreshTargets.set("panel1", false);

      expect(() =>
        prepareCustomChartRun({ id: "panel2", customChartContent: "option = {}" }, []),
      ).toThrow(CustomChartSkippedError);
    });

    it("runs a refreshed panel's code while its own refresh is in flight", () => {
      panelRefreshTargets.set("panel1", false);

      expect(
        prepareCustomChartRun({ id: "panel1", customChartContent: "option = {}" }, []).panelId,
      ).toBe("panel1");
    });
  });

  describe("settlePanelRefresh", () => {
    it("ends the refresh only once every target has settled", () => {
      panelRefreshTargets.set("panel1", false);
      panelRefreshTargets.set("panel2", false);

      settlePanelRefresh("panel1");
      expect([...panelRefreshTargets]).toEqual([
        ["panel1", true],
        ["panel2", false],
      ]);

      settlePanelRefresh("panel2");
      expect(panelRefreshTargets.size).toBe(0);
    });

    it("ignores a panel that is not a target", () => {
      panelRefreshTargets.set("panel1", false);

      settlePanelRefresh("panel2");

      expect([...panelRefreshTargets]).toEqual([["panel1", false]]);
    });

    it("bumps the refresh epoch once every target has settled", () => {
      const before = panelRefreshEpoch.value;
      panelRefreshTargets.set("a", false);
      panelRefreshTargets.set("b", false);

      settlePanelRefresh("a");
      expect(panelRefreshEpoch.value).toBe(before);

      settlePanelRefresh("b");
      expect(panelRefreshEpoch.value).toBe(before + 1);
    });
  });

  describe("validateUserCode", () => {
    it.each([
      ["fetch('http://evil.com');", "Use of 'fetch()' is not allowed."],
      ["setTimeout(function(){}, 50);", "Use of 'setTimeout()' with delay < 100ms is not allowed."],
      ["setTimeout(function(){}, variable);", "Invalid usage of 'setTimeout()'."],
      ["setTimeout(eval('code'), 1000);", "Use of eval inside 'setTimeout()' is not allowed."],
      ["['f','e','t','c','h'].join('');", "Obfuscated function call detected."],
      ["window.location.href;", "Access to 'window' is not allowed."],
      [
        "while(true) { console.log('infinite'); }",
        "Infinite loop using 'while(true)' is not allowed.",
      ],
      ["for(;;) { console.log('infinite'); }", "Infinite loop using 'for(;;)' is not allowed."],
      ["new Function('return 1');", "Use of 'new Function()' is not allowed."],
      ["invalid javascript syntax {", "Invalid JavaScript syntax."],
      ["this[['e','v','a','l'].join('')]('code');", "Obfuscated method/property access detected."],
    ])("rejects %s", (code, message) => {
      expect(validateUserCode(code)).toBe(message);
    });

    it("accepts chart code with callbacks and a long timer", () => {
      const code = `option = {
        tooltip: { formatter: function (p) { return p.name; } },
        o2_events: { finished: function (params, chart) { setTimeout(function () {}, 100); } },
      };`;

      expect(validateUserCode(code)).toBeNull();
    });
  });
});
