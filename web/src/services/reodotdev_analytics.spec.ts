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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"

// ---------------------------------------------------------------------------
// Shared mock handles for Reo instance methods
// ---------------------------------------------------------------------------
const mockReoInit = vi.fn()
const mockPushData = vi.fn()
const mockIdentify = vi.fn()

const mockReoInstance = {
  init: mockReoInit,
  pushData: mockPushData,
  identify: mockIdentify,
}

// Mock the reodotdev SDK
vi.mock("reodotdev", () => ({
  loadReoScript: vi.fn().mockResolvedValue(mockReoInstance),
}))

// ---------------------------------------------------------------------------
// Helper to re-import the module with a specific config value.
// Because module state (isLoaded, reoInstance, eventQueue) is module-level,
// each describe block that needs a fresh state uses vi.resetModules().
// ---------------------------------------------------------------------------
async function importWithConfig(
  enableAnalytics: string,
  isCloud: string,
  clientKey = "test-client-key"
) {
  vi.doMock("../aws-exports", () => ({
    default: {
      enableAnalytics,
      isCloud,
      REO_CLIENT_KEY: clientKey,
    },
  }))

  const mod = await import("@/services/reodotdev_analytics")
  return mod
}

describe("reodotdev_analytics composable", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
  })

  // -------------------------------------------------------------------------
  describe("useReo – return shape", () => {
    it("returns reoInit, identify, track and isLoaded", async () => {
      const { useReo } = await importWithConfig("false", "false")
      const result = useReo()

      expect(result).toHaveProperty("reoInit")
      expect(result).toHaveProperty("identify")
      expect(result).toHaveProperty("track")
      expect(result).toHaveProperty("isLoaded")
    })

    it("reoInit is a function", async () => {
      const { useReo } = await importWithConfig("false", "false")
      const { reoInit } = useReo()
      expect(typeof reoInit).toBe("function")
    })

    it("identify is a function", async () => {
      const { useReo } = await importWithConfig("false", "false")
      const { identify } = useReo()
      expect(typeof identify).toBe("function")
    })

    it("track is a function", async () => {
      const { useReo } = await importWithConfig("false", "false")
      const { track } = useReo()
      expect(typeof track).toBe("function")
    })

    it("isLoaded is a Vue ref starting as false", async () => {
      const { useReo } = await importWithConfig("false", "false")
      const { isLoaded } = useReo()
      expect(isLoaded.value).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  describe("when analytics is disabled (enableAnalytics != true or isCloud != true)", () => {
    it("reoInit returns early without calling loadReoScript", async () => {
      const { loadReoScript } = await import("reodotdev")
      const { useReo } = await importWithConfig("false", "false")
      const { reoInit } = useReo()

      await reoInit()

      expect(loadReoScript).not.toHaveBeenCalled()
    })

    it("identify returns a resolved Promise without queueing", async () => {
      const { useReo } = await importWithConfig("false", "false")
      const { identify } = useReo()

      const result = identify({
        username: "user@example.com",
        type: "email",
      })

      await expect(result).resolves.toBeUndefined()
    })

    it("track returns undefined without queueing", async () => {
      const { useReo } = await importWithConfig("false", "false")
      const { track } = useReo()

      const result = track("some_event", { foo: "bar" })

      expect(result).toBeUndefined()
    })

    it("isLoaded remains false after reoInit when disabled", async () => {
      const { useReo } = await importWithConfig("false", "false")
      const { reoInit, isLoaded } = useReo()

      await reoInit()

      expect(isLoaded.value).toBe(false)
    })

    it("reoInit is a no-op when only isCloud is false", async () => {
      const { loadReoScript } = await import("reodotdev")
      const { useReo } = await importWithConfig("true", "false")
      const { reoInit } = useReo()

      await reoInit()

      expect(loadReoScript).not.toHaveBeenCalled()
    })

    it("reoInit is a no-op when only enableAnalytics is false", async () => {
      const { loadReoScript } = await import("reodotdev")
      const { useReo } = await importWithConfig("false", "true")
      const { reoInit } = useReo()

      await reoInit()

      expect(loadReoScript).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  describe("when analytics is enabled", () => {
    it("reoInit calls loadReoScript with the clientID and source", async () => {
      const { loadReoScript } = await import("reodotdev")
      const { useReo } = await importWithConfig("true", "true", "my-key")
      const { reoInit } = useReo()

      await reoInit()

      expect(loadReoScript).toHaveBeenCalledWith({
        clientID: "my-key",
        source: "app",
      })
    })

    it("reoInit calls Reo.init with the clientID", async () => {
      const { useReo } = await importWithConfig("true", "true", "my-key")
      const { reoInit } = useReo()

      await reoInit()

      expect(mockReoInit).toHaveBeenCalledWith({ clientID: "my-key" })
    })

    it("reoInit sets isLoaded to true after SDK initialisation", async () => {
      const { useReo } = await importWithConfig("true", "true")
      const { reoInit, isLoaded } = useReo()

      await reoInit()

      expect(isLoaded.value).toBe(true)
    })

    it("track calls reoInstance.pushData with activity and payload", async () => {
      const { useReo } = await importWithConfig("true", "true")
      const { reoInit, track } = useReo()

      await reoInit()
      track("button_clicked", { buttonName: "save" })

      expect(mockPushData).toHaveBeenCalledWith({
        activity: "button_clicked",
        buttonName: "save",
      })
    })

    it("track spreads extra payload properties into the pushData call", async () => {
      const { useReo } = await importWithConfig("true", "true")
      const { reoInit, track } = useReo()

      await reoInit()
      track("page_viewed", { page: "Logs", userId: "u1" })

      expect(mockPushData).toHaveBeenCalledWith({
        activity: "page_viewed",
        page: "Logs",
        userId: "u1",
      })
    })

    it("track works without an optional payload argument", async () => {
      const { useReo } = await importWithConfig("true", "true")
      const { reoInit, track } = useReo()

      await reoInit()
      track("simple_event")

      expect(mockPushData).toHaveBeenCalledWith({
        activity: "simple_event",
      })
    })

    it("identify calls reoInstance.identify with the identity payload", async () => {
      const { useReo } = await importWithConfig("true", "true")
      const { reoInit, identify } = useReo()

      await reoInit()

      const identity = {
        username: "user@example.com",
        type: "email" as const,
        firstname: "Jane",
        lastname: "Doe",
      }
      identify(identity)

      expect(mockIdentify).toHaveBeenCalledWith(identity)
    })
  })

  // -------------------------------------------------------------------------
  describe("event queue – events fired before SDK is ready", () => {
    it("queues a track call made before reoInit and flushes it after init", async () => {
      const { useReo } = await importWithConfig("true", "true")
      const { reoInit, track } = useReo()

      // Call track BEFORE initialisation
      track("early_event", { key: "value" })

      // Reo instance is not available yet – pushData must not be called yet
      expect(mockPushData).not.toHaveBeenCalled()

      // Now initialise – the queue should be flushed
      await reoInit()

      expect(mockPushData).toHaveBeenCalledWith({
        activity: "early_event",
        key: "value",
      })
    })

    it("queues an identify call made before reoInit and flushes it after init", async () => {
      const { useReo } = await importWithConfig("true", "true")
      const { reoInit, identify } = useReo()

      const identity = {
        username: "early@example.com",
        type: "github" as const,
      }

      identify(identity)

      expect(mockIdentify).not.toHaveBeenCalled()

      await reoInit()

      expect(mockIdentify).toHaveBeenCalledWith(identity)
    })

    it("clears the queue after flushing so events are not replayed", async () => {
      const { useReo } = await importWithConfig("true", "true")
      const { reoInit, track } = useReo()

      track("queued_event")
      await reoInit()

      // Reset the call history and call reoInit a second time
      mockPushData.mockClear()
      await reoInit()

      // The queue was emptied, so pushData should not be called again
      expect(mockPushData).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  describe("error handling", () => {
    it("logs an error and does not throw when loadReoScript rejects", async () => {
      const { loadReoScript } = await import("reodotdev")
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {})

      ;(loadReoScript as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("network error")
      )

      const { useReo } = await importWithConfig("true", "true")
      const { reoInit } = useReo()

      await expect(reoInit()).resolves.toBeUndefined()
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed initializing Reo.Dev"),
        expect.any(Error)
      )

      consoleSpy.mockRestore()
    })

    it("isLoaded remains false when initialisation fails", async () => {
      const { loadReoScript } = await import("reodotdev")
      ;(loadReoScript as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("network error")
      )

      const { useReo } = await importWithConfig("true", "true")
      const { reoInit, isLoaded } = useReo()

      await reoInit()

      expect(isLoaded.value).toBe(false)
    })
  })
})
