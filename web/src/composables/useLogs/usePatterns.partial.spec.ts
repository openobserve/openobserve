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

import { describe, it, expect, beforeEach, vi } from "vitest";
import patternsService from "@/services/patterns";
import usePatterns, { patternsState } from "@/composables/useLogs/usePatterns";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock("@/services/patterns", () => ({ default: { extractPatterns: vi.fn() } }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

const body = (extra: Record<string, unknown> = {}) => ({
  data: {
    patterns: [{ template: "a <:NUM>", frequency: 3 }],
    statistics: { total_logs_analyzed: 3 },
    ...extra,
  },
});

const run = async (response: unknown) => {
  vi.mocked(patternsService.extractPatterns).mockResolvedValue(response as any);
  const { extractPatterns } = usePatterns(((k: string) => k) as any);
  await extractPatterns("org", "app", { query: {} } as any);
};

describe("usePatterns partial extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patternsState.value.loading = false;
  });

  it("keeps the patterns and warns with the server reason when the sample is partial", async () => {
    await run(
      body({ is_partial: true, function_error: ["Patterns built from 11 of 12 time slices"] }),
    );

    expect(patternsState.value.patterns?.patterns).toHaveLength(1);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0]).toMatchObject({ variant: "warning" });
    expect(toastMock.mock.calls[0][0].message).toContain("11 of 12 time slices");
  });

  it("shows no warning for a complete extraction", async () => {
    await run(body());

    expect(toastMock).not.toHaveBeenCalled();
  });
});
