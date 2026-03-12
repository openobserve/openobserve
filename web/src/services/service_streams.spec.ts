// Copyright 2025 OpenObserve Inc.
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
import serviceStreams, {
  getSemanticGroups,
  correlate,
  getDimensionAnalytics,
  getGroupedServices,
} from "@/services/service_streams"
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

describe("service_streams service", () => {
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
      expect(serviceStreams).toBeDefined()
      expect(typeof serviceStreams).toBe("object")
    })

    it("default export includes getSemanticGroups", () => {
      expect(typeof serviceStreams.getSemanticGroups).toBe("function")
    })

    it("default export includes correlate", () => {
      expect(typeof serviceStreams.correlate).toBe("function")
    })

    it("default export includes getDimensionAnalytics", () => {
      expect(typeof serviceStreams.getDimensionAnalytics).toBe("function")
    })

    it("default export includes getGroupedServices", () => {
      expect(typeof serviceStreams.getGroupedServices).toBe("function")
    })

    it("also exports getSemanticGroups as a named export", () => {
      expect(typeof getSemanticGroups).toBe("function")
    })

    it("also exports correlate as a named export", () => {
      expect(typeof correlate).toBe("function")
    })

    it("also exports getDimensionAnalytics as a named export", () => {
      expect(typeof getDimensionAnalytics).toBe("function")
    })

    it("also exports getGroupedServices as a named export", () => {
      expect(typeof getGroupedServices).toBe("function")
    })
  })

  // -------------------------------------------------------------------------
  describe("getSemanticGroups", () => {
    it("calls GET /api/{org}/alerts/deduplication/semantic-groups", () => {
      getSemanticGroups(ORG)

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${ORG}/alerts/deduplication/semantic-groups`
      )
    })

    it("calls GET exactly once", () => {
      getSemanticGroups(ORG)

      expect(mockHttpInstance.get).toHaveBeenCalledTimes(1)
    })

    it("returns the promise from http().get", () => {
      const expected = Promise.resolve({ data: [] })
      mockHttpInstance.get.mockReturnValue(expected)

      const result = getSemanticGroups(ORG)

      expect(result).toBe(expected)
    })

    it("propagates rejection from http().get", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("not found"))

      await expect(getSemanticGroups(ORG)).rejects.toThrow("not found")
    })

    it("works when called via the default export", () => {
      serviceStreams.getSemanticGroups(ORG)

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${ORG}/alerts/deduplication/semantic-groups`
      )
    })
  })

  // -------------------------------------------------------------------------
  describe("correlate", () => {
    const request = {
      source_stream: "my-stream",
      source_type: "logs",
      available_dimensions: { cluster: "prod", namespace: "default" },
    }

    it("calls POST /api/{org}/service_streams/_correlate", () => {
      correlate(ORG, request)

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${ORG}/service_streams/_correlate`,
        request
      )
    })

    it("calls POST exactly once", () => {
      correlate(ORG, request)

      expect(mockHttpInstance.post).toHaveBeenCalledTimes(1)
    })

    it("passes the full request body verbatim", () => {
      const body = {
        source_stream: "traces-stream",
        source_type: "traces",
        available_dimensions: { pod: "my-pod-123" },
      }
      correlate(ORG, body)

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${ORG}/service_streams/_correlate`,
        body
      )
    })

    it("returns the promise from http().post", () => {
      const expected = Promise.resolve({ data: {} })
      mockHttpInstance.post.mockReturnValue(expected)

      const result = correlate(ORG, request)

      expect(result).toBe(expected)
    })

    it("propagates rejection from http().post", async () => {
      mockHttpInstance.post.mockRejectedValue(new Error("bad request"))

      await expect(correlate(ORG, request)).rejects.toThrow("bad request")
    })

    it("works when called via the default export", () => {
      serviceStreams.correlate(ORG, request)

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${ORG}/service_streams/_correlate`,
        request
      )
    })
  })

  // -------------------------------------------------------------------------
  describe("getDimensionAnalytics", () => {
    it("calls GET /api/{org}/service_streams/_analytics", () => {
      getDimensionAnalytics(ORG)

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${ORG}/service_streams/_analytics`
      )
    })

    it("calls GET exactly once", () => {
      getDimensionAnalytics(ORG)

      expect(mockHttpInstance.get).toHaveBeenCalledTimes(1)
    })

    it("returns the promise from http().get", () => {
      const expected = Promise.resolve({ data: {} })
      mockHttpInstance.get.mockReturnValue(expected)

      const result = getDimensionAnalytics(ORG)

      expect(result).toBe(expected)
    })

    it("propagates rejection from http().get", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("server error"))

      await expect(getDimensionAnalytics(ORG)).rejects.toThrow("server error")
    })

    it("works when called via the default export", () => {
      serviceStreams.getDimensionAnalytics(ORG)

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${ORG}/service_streams/_analytics`
      )
    })
  })

  // -------------------------------------------------------------------------
  describe("getGroupedServices", () => {
    it("calls GET /api/{org}/service_streams/_grouped", () => {
      getGroupedServices(ORG)

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${ORG}/service_streams/_grouped`
      )
    })

    it("calls GET exactly once", () => {
      getGroupedServices(ORG)

      expect(mockHttpInstance.get).toHaveBeenCalledTimes(1)
    })

    it("returns the promise from http().get", () => {
      const expected = Promise.resolve({
        data: { groups: [], total_fqns: 0, total_services: 0 },
      })
      mockHttpInstance.get.mockReturnValue(expected)

      const result = getGroupedServices(ORG)

      expect(result).toBe(expected)
    })

    it("propagates rejection from http().get", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("unauthorized"))

      await expect(getGroupedServices(ORG)).rejects.toThrow("unauthorized")
    })

    it("works when called via the default export", () => {
      serviceStreams.getGroupedServices(ORG)

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${ORG}/service_streams/_grouped`
      )
    })
  })

  // -------------------------------------------------------------------------
  describe("org_identifier scoping", () => {
    it("getSemanticGroups uses the provided org in the URL", () => {
      getSemanticGroups("acme-corp")

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/acme-corp/alerts/deduplication/semantic-groups"
      )
    })

    it("correlate uses the provided org in the URL", () => {
      const req = {
        source_stream: "s",
        source_type: "logs",
        available_dimensions: {},
      }
      correlate("acme-corp", req)

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/acme-corp/service_streams/_correlate",
        req
      )
    })

    it("getDimensionAnalytics uses the provided org in the URL", () => {
      getDimensionAnalytics("acme-corp")

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/acme-corp/service_streams/_analytics"
      )
    })

    it("getGroupedServices uses the provided org in the URL", () => {
      getGroupedServices("acme-corp")

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/acme-corp/service_streams/_grouped"
      )
    })
  })
})
