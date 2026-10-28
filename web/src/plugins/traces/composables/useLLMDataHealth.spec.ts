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

import { describe, it, expect, vi, beforeEach } from "vitest";

const getDataHealth = vi.fn();
vi.mock("@/services/gen-ai-data-health.service", () => ({
  getDataHealth: (...args: unknown[]) => getDataHealth(...args),
}));

import { useLLMDataHealth } from "./useLLMDataHealth";

const params = { stream_name: "llm", start_time: 1, end_time: 2, agent: "a" };

const response = (samples?: string[]) => ({
  data: {
    checked_at: 1,
    checks: [
      { id: "missing_session_id", status: "warning", affected: 2, total: 4, samples },
      { id: "zero_duration_spans", status: "pass", affected: 0, total: 4, samples: samples && [] },
    ],
  },
});

beforeEach(() => {
  getDataHealth.mockReset();
});

describe("useLLMDataHealth — samples", () => {
  it("the default load asks for no samples; the drawer's request asks once", async () => {
    const h = useLLMDataHealth();
    getDataHealth.mockResolvedValueOnce(response());
    await h.fetchHealth("org", params);
    expect(getDataHealth).toHaveBeenCalledTimes(1);
    expect(getDataHealth.mock.calls[0][1].include_samples).toBe(false);
    expect(h.samples.value).toBeNull();

    getDataHealth.mockResolvedValueOnce(response(["t1", "t2"]));
    await h.fetchSamples();
    expect(getDataHealth.mock.calls[1]).toEqual(["org", { ...params, include_samples: true }]);
    expect(h.samples.value).toEqual({ missing_session_id: ["t1", "t2"], zero_duration_spans: [] });

    // Loaded for this scope: reopening the drawer costs nothing.
    await h.fetchSamples();
    expect(getDataHealth).toHaveBeenCalledTimes(2);
  });

  it("a new scope clears the samples and drops a samples answer still in flight", async () => {
    const h = useLLMDataHealth();
    getDataHealth.mockResolvedValueOnce(response());
    await h.fetchHealth("org", params);

    const late = Promise.withResolvers<unknown>();
    getDataHealth.mockReturnValueOnce(late.promise);
    const pending = h.fetchSamples();

    getDataHealth.mockResolvedValueOnce(response());
    await h.fetchHealth("org", { ...params, agent: "b" });
    late.resolve(response(["old"]));
    await pending;
    expect(h.samples.value).toBeNull();
    expect(h.samplesLoading.value).toBe(false);
  });
});
