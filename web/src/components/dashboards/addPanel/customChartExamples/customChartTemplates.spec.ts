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

describe("customChartTemplateContent", () => {
  it("puts the query header above the bundled template code, callbacks included", async () => {
    const template = (await loadCustomChartTemplate("multiple-x-axis"))!;
    expect(template.code).toContain("function");

    expect(customChartTemplateContent("// header\n", template)).toBe("// header\n" + template.code);
  });
});
