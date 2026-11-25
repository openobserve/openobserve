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
import { promqlByLabels } from "./queryGroupLabels";

describe("promqlByLabels", () => {
  it.each([
    ["sum by (svc, le) (rate(m_bucket[5m]))", ["svc", "le"]],
    ["histogram_quantile(0.95, sum by (le, svc) (rate(m_bucket[5m])))", ["svc"]],
  ])("%s groups by %j", (query, labels) => {
    expect(promqlByLabels(query)).toEqual(labels);
  });
});
