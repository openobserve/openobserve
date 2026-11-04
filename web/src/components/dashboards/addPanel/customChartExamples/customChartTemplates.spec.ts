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
import { customChartTemplateContent, loadCustomChartTemplate } from "./customChartTemplates";
import { isTrustedCustomChartCode } from "@/utils/dashboard/convertCustomChartData";

describe("customChartTemplateContent", () => {
  it("trusts a bundled template with callbacks exactly as inserted, and nothing edited from it", async () => {
    const template = (await loadCustomChartTemplate("multiple-x-axis"))!;
    expect(template.code).toContain("function");

    const content = customChartTemplateContent("// header\n", template);

    expect(content).toBe("// header\n" + template.code);
    expect(isTrustedCustomChartCode(content)).toBe(true);
    expect(isTrustedCustomChartCode(content + "\n// edited")).toBe(false);
  });
});
