// Copyright 2023 OpenObserve Inc.
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

import { describe, expect, it, beforeEach, vi } from "vitest"
import alertInsights from "@/services/alertInsights"
import http from "@/services/http"

vi.mock("@/services/http", () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  })),
}))

const ORG = "test-org"

describe("alertInsights service", () => {
  let mockHttpInstance: {
    get: ReturnType<typeof vi.fn>
    post: ReturnType<typeof vi.fn>
    put: ReturnType<typeof vi.fn>
    patch: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockHttpInstance = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    }
    ;(http as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      mockHttpInstance
    )
  })

  // -------------------------------------------------------------------------
  describe("module export", () => {
    it("exports a default object", () => {
      expect(alertInsights).toBeDefined()
      expect(typeof alertInsights).toBe("object")
    })

    it("exposes getSummary method", () => {
      expect(typeof alertInsights.getSummary).toBe("function")
    })

    it("exposes getTimeseries method", () => {
      expect(typeof alertInsights.getTimeseries).toBe("function")
    })

    it("exposes getFrequency method", () => {
      expect(typeof alertInsights.getFrequency).toBe("function")
    })

    it("exposes getCorrelation method", () => {
      expect(typeof alertInsights.getCorrelation).toBe("function")
    })

    it("exposes getQuality method", () => {
      expect(typeof alertInsights.getQuality).toBe("function")
    })

    it("exposes getAllInsights method", () => {
      expect(typeof alertInsights.getAllInsights).toBe("function")
    })
  })

  // -------------------------------------------------------------------------
  describe("getSummary", () => {
    it("calls GET /api/{org}/alerts/insights/summary", () => {
      const params = { start_time: 1000, end_time: 2000 }
      alertInsights.getSummary(ORG, params)

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${ORG}/alerts/insights/summary`,
        { params }
      )
    })

    it("passes an empty params object when no params are provided", () => {
      alertInsights.getSummary(ORG, {})

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${ORG}/alerts/insights/summary`,
        { params: {} }
      )
    })

    it("forwards alert_name param", () => {
      const params = { alert_name: "high-latency" }
      alertInsights.getSummary(ORG, params)

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${ORG}/alerts/insights/summary`,
        { params }
      )
    })

    it("returns the promise from http().get", () => {
      const expected = Promise.resolve({ data: {} })
      mockHttpInstance.get.mockReturnValue(expected)

      const result = alertInsights.getSummary(ORG, {})

      expect(result).toBe(expected)
    })

    it("propagates rejection from http().get", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("network error"))

      await expect(alertInsights.getSummary(ORG, {})).rejects.toThrow(
        "network error"
      )
    })
  })

  // -------------------------------------------------------------------------
  describe("getTimeseries", () => {
    it("calls GET /api/{org}/alerts/insights/timeseries", () => {
      const params = { start_time: 1000, end_time: 2000 }
      alertInsights.getTimeseries(ORG, params)

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${ORG}/alerts/insights/timeseries`,
        { params }
      )
    })

    it("returns the promise from http().get", () => {
      const expected = Promise.resolve({ data: { volume: [], success_rate: [] } })
      mockHttpInstance.get.mockReturnValue(expected)

      const result = alertInsights.getTimeseries(ORG, {})

      expect(result).toBe(expected)
    })

    it("propagates rejection from http().get", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("timeout"))

      await expect(alertInsights.getTimeseries(ORG, {})).rejects.toThrow(
        "timeout"
      )
    })
  })

  // -------------------------------------------------------------------------
  describe("getFrequency", () => {
    it("calls GET /api/{org}/alerts/insights/frequency", () => {
      const params = { min_fires_per_hour: 5 }
      alertInsights.getFrequency(ORG, params)

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${ORG}/alerts/insights/frequency`,
        { params }
      )
    })

    it("passes min_fires_per_hour as part of params", () => {
      const params = { start_time: 100, min_fires_per_hour: 10 }
      alertInsights.getFrequency(ORG, params)

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${ORG}/alerts/insights/frequency`,
        { params }
      )
    })

    it("returns the promise from http().get", () => {
      const expected = Promise.resolve({
        data: { top_alerts: [], dedup_candidates: [], hourly_pattern: [] },
      })
      mockHttpInstance.get.mockReturnValue(expected)

      const result = alertInsights.getFrequency(ORG, {})

      expect(result).toBe(expected)
    })

    it("propagates rejection from http().get", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("forbidden"))

      await expect(alertInsights.getFrequency(ORG, {})).rejects.toThrow(
        "forbidden"
      )
    })
  })

  // -------------------------------------------------------------------------
  describe("getCorrelation", () => {
    it("calls GET /api/{org}/alerts/insights/correlation", () => {
      const params = { correlation_window_seconds: 300, storm_threshold: 10 }
      alertInsights.getCorrelation(ORG, params)

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${ORG}/alerts/insights/correlation`,
        { params }
      )
    })

    it("passes storm_threshold param", () => {
      const params = { storm_threshold: 5 }
      alertInsights.getCorrelation(ORG, params)

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${ORG}/alerts/insights/correlation`,
        { params }
      )
    })

    it("returns the promise from http().get", () => {
      const expected = Promise.resolve({
        data: { correlations: [], storms: [], error_patterns: [] },
      })
      mockHttpInstance.get.mockReturnValue(expected)

      const result = alertInsights.getCorrelation(ORG, {})

      expect(result).toBe(expected)
    })

    it("propagates rejection from http().get", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("server error"))

      await expect(alertInsights.getCorrelation(ORG, {})).rejects.toThrow(
        "server error"
      )
    })
  })

  // -------------------------------------------------------------------------
  describe("getQuality", () => {
    it("calls GET /api/{org}/alerts/insights/quality", () => {
      const params = { start_time: 1000, end_time: 2000 }
      alertInsights.getQuality(ORG, params)

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${ORG}/alerts/insights/quality`,
        { params }
      )
    })

    it("returns the promise from http().get", () => {
      const expected = Promise.resolve({
        data: {
          effectiveness: [],
          retry_analysis: [],
          slow_alerts: [],
        },
      })
      mockHttpInstance.get.mockReturnValue(expected)

      const result = alertInsights.getQuality(ORG, {})

      expect(result).toBe(expected)
    })

    it("propagates rejection from http().get", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("not found"))

      await expect(alertInsights.getQuality(ORG, {})).rejects.toThrow(
        "not found"
      )
    })
  })

  // -------------------------------------------------------------------------
  describe("getAllInsights", () => {
    const summaryData = {
      total_alerts: 10,
      success_rate: 0.9,
      avg_execution_time_us: 500,
      failed_count: 1,
      status_distribution: {},
      time_range: { start_time: 0, end_time: 1 },
    }
    const timeseriesData = { volume: [], success_rate: [] }
    const frequencyData = {
      top_alerts: [],
      dedup_candidates: [],
      hourly_pattern: [],
    }
    const correlationData = { correlations: [], storms: [], error_patterns: [] }
    const qualityData = {
      effectiveness: [],
      retry_analysis: [],
      slow_alerts: [],
    }

    beforeEach(() => {
      mockHttpInstance.get
        .mockResolvedValueOnce({ data: summaryData })
        .mockResolvedValueOnce({ data: timeseriesData })
        .mockResolvedValueOnce({ data: frequencyData })
        .mockResolvedValueOnce({ data: correlationData })
        .mockResolvedValueOnce({ data: qualityData })
    })

    it("calls all five individual insight endpoints", async () => {
      await alertInsights.getAllInsights(ORG, {})

      expect(mockHttpInstance.get).toHaveBeenCalledTimes(5)
    })

    it("calls the summary endpoint", async () => {
      await alertInsights.getAllInsights(ORG, {})

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${ORG}/alerts/insights/summary`,
        expect.any(Object)
      )
    })

    it("calls the timeseries endpoint", async () => {
      await alertInsights.getAllInsights(ORG, {})

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${ORG}/alerts/insights/timeseries`,
        expect.any(Object)
      )
    })

    it("calls the frequency endpoint", async () => {
      await alertInsights.getAllInsights(ORG, {})

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${ORG}/alerts/insights/frequency`,
        expect.any(Object)
      )
    })

    it("calls the correlation endpoint", async () => {
      await alertInsights.getAllInsights(ORG, {})

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${ORG}/alerts/insights/correlation`,
        expect.any(Object)
      )
    })

    it("calls the quality endpoint", async () => {
      await alertInsights.getAllInsights(ORG, {})

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${ORG}/alerts/insights/quality`,
        expect.any(Object)
      )
    })

    it("resolves with summary, timeseries, frequency, correlation and quality keys", async () => {
      const result = await alertInsights.getAllInsights(ORG, {})

      expect(result).toHaveProperty("summary")
      expect(result).toHaveProperty("timeseries")
      expect(result).toHaveProperty("frequency")
      expect(result).toHaveProperty("correlation")
      expect(result).toHaveProperty("quality")
    })

    it("maps each endpoint response to the correct key", async () => {
      const result = await alertInsights.getAllInsights(ORG, {})

      expect(result.summary).toEqual(summaryData)
      expect(result.timeseries).toEqual(timeseriesData)
      expect(result.frequency).toEqual(frequencyData)
      expect(result.correlation).toEqual(correlationData)
      expect(result.quality).toEqual(qualityData)
    })

    it("forwards all params to every sub-request", async () => {
      const params = {
        start_time: 1000,
        end_time: 2000,
        alert_name: "test-alert",
        min_fires_per_hour: 3,
        correlation_window_seconds: 120,
        storm_threshold: 5,
      }

      await alertInsights.getAllInsights(ORG, params)

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${ORG}/alerts/insights/summary`,
        { params }
      )
    })

    it("rejects with the first error when any sub-request fails", async () => {
      mockHttpInstance.get.mockReset()
      mockHttpInstance.get
        .mockResolvedValueOnce({ data: summaryData })
        .mockRejectedValueOnce(new Error("timeseries failed"))

      await expect(alertInsights.getAllInsights(ORG, {})).rejects.toThrow(
        "timeseries failed"
      )
    })
  })
})
