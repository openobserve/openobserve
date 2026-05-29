import { describe, it, expect, beforeEach, vi } from "vitest"
import { toast, useToast, toastRecords } from "./useToast"

// Reset module state between tests
beforeEach(() => {
  // Clear all toasts between tests
  toastRecords.splice(0, toastRecords.length)
  vi.useFakeTimers()
})

describe("toast()", () => {
  it("adds a record to toastRecords", () => {
    toast({ variant: "success", message: "Saved!" })
    expect(toastRecords).toHaveLength(1)
    expect(toastRecords[0].message).toBe("Saved!")
    expect(toastRecords[0].open).toBe(true)
  })

  it("returns a DismissFn", () => {
    const dismiss = toast({ variant: "info", message: "Hello" })
    expect(typeof dismiss).toBe("function")
  })

  it("calling DismissFn() sets open: false on the record", () => {
    const dismiss = toast({ variant: "success", message: "Done" })
    expect(toastRecords[0].open).toBe(true)
    dismiss()
    expect(toastRecords[0].open).toBe(false)
  })

  it("calling DismissFn with replacement closes current and fires new toast", () => {
    const dismiss = toast({ variant: "loading", message: "Loading..." })
    // Loading is suppressed — no record is added to the UI
    expect(toastRecords).toHaveLength(0)
    dismiss({ variant: "success", message: "Done!" })
    // Only the replacement success toast appears in records
    expect(toastRecords).toHaveLength(1)
    expect(toastRecords[0].variant).toBe("success")
    expect(toastRecords[0].message).toBe("Done!")
  })

  it("applies default timeout for success variant", () => {
    toast({ variant: "success", message: "OK" })
    expect(toastRecords[0].timeout).toBe(5000)
  })

  it("applies default timeout for error variant", () => {
    toast({ variant: "error", message: "Fail" })
    expect(toastRecords[0].timeout).toBe(30000)
  })

  it("applies default timeout for warning variant", () => {
    toast({ variant: "warning", message: "Warn" })
    expect(toastRecords[0].timeout).toBe(30000)
  })

  it("applies default timeout for info variant", () => {
    toast({ variant: "info", message: "FYI" })
    expect(toastRecords[0].timeout).toBe(5000)
  })

  it("applies timeout: 0 for loading variant (persistent)", () => {
    // Loading is suppressed from UI — no record is added; caller uses the
    // returned DismissFn to swap in a success/error toast when done.
    toast({ variant: "loading", message: "Working..." })
    expect(toastRecords).toHaveLength(0)
  })

  it("applies default timeout for default variant", () => {
    toast({ message: "Hello" })
    expect(toastRecords[0].timeout).toBe(5000)
  })

  it("respects explicit timeout: 0 (persistent)", () => {
    toast({ variant: "success", message: "Persistent", timeout: 0 })
    vi.advanceTimersByTime(10000)
    expect(toastRecords[0].open).toBe(true)
  })

  it("auto-dismisses after timeout", () => {
    toast({ variant: "success", message: "Auto", timeout: 1000 })
    expect(toastRecords[0].open).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(toastRecords[0].open).toBe(false)
  })

  it("generates unique ids for multiple toasts", () => {
    toast({ message: "A" })
    toast({ message: "B" })
    toast({ message: "C" })
    const ids = toastRecords.map((r) => r.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(3)
  })
})

describe("useToast()", () => {
  it("returns toast function and toasts array", () => {
    const { toast: t, toasts } = useToast()
    expect(typeof t).toBe("function")
    expect(Array.isArray(toasts)).toBe(true)
  })

  it("toasts array is the same reactive store as toastRecords", () => {
    const { toasts } = useToast()
    toast({ message: "Hello" })
    expect(toasts).toHaveLength(1)
  })
})
