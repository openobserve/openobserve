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
import { ref } from "vue";
import { useServiceGraphTree } from "./useServiceGraphTree";

vi.mock("@/utils/traces/convertTraceData", () => ({
  getServiceIconDataUrl: (_id: string, _isDarkMode: boolean, borderColor: string) => borderColor,
}));

const iconBorderColor = (errorRate: number, isDarkMode: boolean) => {
  const { treeData } = useServiceGraphTree(
    ref({ nodes: [{ id: "svc", error_rate: errorRate }], edges: [] }),
    ref(isDarkMode),
  );
  return treeData.value[0].metadata?.iconDataUrl;
};

describe("useServiceGraphTree node health colour", () => {
  it.each([
    [0.99, "#52c41a", "#10b981"],
    [1, "#faad14", "#fbbf24"],
    [5, "#faad14", "#fbbf24"],
    [5.01, "#fa8c16", "#f97316"],
    [10.01, "#f5222d", "#ef4444"],
  ])(
    "colours a node at an error rate of %s on the shared health scale",
    (errorRate, light, dark) => {
      expect(iconBorderColor(errorRate, false)).toBe(light);
      expect(iconBorderColor(errorRate, true)).toBe(dark);
    },
  );
});
