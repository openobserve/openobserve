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

// Use vi.hoisted so these spies are available when the vi.mock factory runs
// (vi.mock calls are hoisted before the rest of the module, so top-level
// const declarations wouldn't be initialised yet without vi.hoisted).
const {
  mockLoad,
  mockReady,
  mockIdentify,
  mockTrack,
  mockPage,
  mockReset,
  MockRudderAnalytics,
} = vi.hoisted(() => {
  const mockLoad = vi.fn()
  const mockReady = vi.fn()
  const mockIdentify = vi.fn()
  const mockTrack = vi.fn()
  const mockPage = vi.fn()
  const mockReset = vi.fn()
  const MockRudderAnalytics = vi.fn(function(this: any) {
    this.load = mockLoad
    this.ready = mockReady
    this.identify = mockIdentify
    this.track = mockTrack
    this.page = mockPage
    this.reset = mockReset
  })
  return { mockLoad, mockReady, mockIdentify, mockTrack, mockPage, mockReset, MockRudderAnalytics }
})

vi.mock("@rudderstack/analytics-js", () => ({
  RudderAnalytics: MockRudderAnalytics,
}))

// Mock aws-exports config
vi.mock("../aws-exports", () => ({
  default: {
    enableAnalytics: "false",
  },
}))

describe("segment_analytics service", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  describe("module export", () => {
    it("exports a rudderanalytics instance as default", async () => {
      const { default: rudderanalytics } = await import(
        "@/services/segment_analytics"
      )
      expect(rudderanalytics).toBeDefined()
    })

    it("exports an object with analytics methods", async () => {
      const { default: rudderanalytics } = await import(
        "@/services/segment_analytics"
      )
      expect(rudderanalytics).toBeTypeOf("object")
    })

    it("exposes a load method on the analytics instance", async () => {
      const { default: rudderanalytics } = await import(
        "@/services/segment_analytics"
      )
      expect(typeof rudderanalytics.load).toBe("function")
    })

    it("exposes a ready method on the analytics instance", async () => {
      const { default: rudderanalytics } = await import(
        "@/services/segment_analytics"
      )
      expect(typeof rudderanalytics.ready).toBe("function")
    })

    it("exposes an identify method on the analytics instance", async () => {
      const { default: rudderanalytics } = await import(
        "@/services/segment_analytics"
      )
      expect(typeof rudderanalytics.identify).toBe("function")
    })

    it("exposes a track method on the analytics instance", async () => {
      const { default: rudderanalytics } = await import(
        "@/services/segment_analytics"
      )
      expect(typeof rudderanalytics.track).toBe("function")
    })

    it("exposes a page method on the analytics instance", async () => {
      const { default: rudderanalytics } = await import(
        "@/services/segment_analytics"
      )
      expect(typeof rudderanalytics.page).toBe("function")
    })

    it("exposes a reset method on the analytics instance", async () => {
      const { default: rudderanalytics } = await import(
        "@/services/segment_analytics"
      )
      expect(typeof rudderanalytics.reset).toBe("function")
    })
  })

  describe("when analytics is disabled", () => {
    it("does not call rudderanalytics.load when enableAnalytics is false", async () => {
      await import("@/services/segment_analytics")
      expect(mockLoad).not.toHaveBeenCalled()
    })

    it("does not call rudderanalytics.ready when enableAnalytics is false", async () => {
      await import("@/services/segment_analytics")
      expect(mockReady).not.toHaveBeenCalled()
    })
  })

  describe("RudderAnalytics instantiation", () => {
    it("creates a RudderAnalytics instance", async () => {
      // Importing the module triggers the module-level `new RudderAnalytics()`
      await import("@/services/segment_analytics")
      expect(MockRudderAnalytics).toHaveBeenCalled()
    })
  })

  describe("analytics method delegation", () => {
    it("can call identify on the exported instance", async () => {
      const { default: rudderanalytics } = await import(
        "@/services/segment_analytics"
      )
      rudderanalytics.identify("user-1", { name: "Test User" })
      expect(mockIdentify).toHaveBeenCalledWith("user-1", { name: "Test User" })
    })

    it("can call track on the exported instance", async () => {
      const { default: rudderanalytics } = await import(
        "@/services/segment_analytics"
      )
      rudderanalytics.track("button_clicked", { buttonName: "save" })
      expect(mockTrack).toHaveBeenCalledWith("button_clicked", {
        buttonName: "save",
      })
    })

    it("can call page on the exported instance", async () => {
      const { default: rudderanalytics } = await import(
        "@/services/segment_analytics"
      )
      rudderanalytics.page("Logs", "SearchPage")
      expect(mockPage).toHaveBeenCalledWith("Logs", "SearchPage")
    })

    it("can call reset on the exported instance", async () => {
      const { default: rudderanalytics } = await import(
        "@/services/segment_analytics"
      )
      rudderanalytics.reset()
      expect(mockReset).toHaveBeenCalled()
    })
  })
})
