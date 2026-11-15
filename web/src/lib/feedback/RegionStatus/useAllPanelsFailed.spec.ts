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

import { describe, it, expect } from "vitest";
import { ref } from "vue";
import { useAllPanelsFailed, type PanelOutcome } from "./useAllPanelsFailed";

const failed = (status?: number): PanelOutcome => ({
  pending: false,
  error: status ? { response: { status } } : new Error("boom"),
});
const ok: PanelOutcome = { pending: false, error: null };

describe("useAllPanelsFailed", () => {
  it("is false with no panels, while any panel loads, or when one succeeded", () => {
    const panels = ref<PanelOutcome[]>([]);
    const { allFailed, kind } = useAllPanelsFailed(panels);
    expect(allFailed.value).toBe(false);
    panels.value = [failed(), { pending: true, error: null }];
    expect(allFailed.value).toBe(false);
    panels.value = [failed(), ok];
    expect(allFailed.value).toBe(false);
    expect(kind.value).toBeNull();
  });

  it("reports one page-level error when every panel failed", () => {
    const { allFailed, kind } = useAllPanelsFailed(() => [failed(500), failed(), failed(404)]);
    expect(allFailed.value).toBe(true);
    expect(kind.value).toBe("error");
  });

  it("reports denied only when every failure was a 401 or 403", () => {
    expect(useAllPanelsFailed(() => [failed(403), failed(401)]).kind.value).toBe("denied");
    expect(useAllPanelsFailed(() => [failed(403), failed(500)]).kind.value).toBe("error");
  });
});
