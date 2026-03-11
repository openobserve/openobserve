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

// Mock RudderAnalytics before importing the module under test
const mockLoad = vi.fn()
const mockReady = vi.fn()
const mockIdentify = vi.fn()
const mockTrack = vi.fn()
const mockPage = vi.fn()
const mockReset = vi.fn()

vi.mock("@rudderstack/analytics-js", () => ({
  RudderAnalytics: vi.fn().mockImplementation(() => ({
    load: mockLoad,
    ready: mockReady,
    identify: mockIdentify,
    track: mockTrack,
    page: mockPage,
    reset: mockReset,
  })),
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
    it("does not call rudderanalytics.load when enableAnalytics is false", () => {
      // The module-level code runs at import time with analytics disabled
      // (mocked config has enableAnalytics: "false"), so load should not be called
      expect(mockLoad).not.toHaveBeenCalled()
    })

    it("does not call rudderanalytics.ready when enableAnalytics is false", () => {
      expect(mockReady).not.toHaveBeenCalled()
    })
  })

  describe("RudderAnalytics instantiation", () => {
    it("creates a RudderAnalytics instance", async () => {
      const { RudderAnalytics } = await import("@rudderstack/analytics-js")
      // The constructor was called during module initialisation
      expect(RudderAnalytics).toHaveBeenCalled()
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
