import { describe, it, expect, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { h, nextTick } from "vue"
import OToastProvider from "./OToastProvider.vue"
import { toastRecords, toast } from "./useToast"

beforeEach(() => {
  toastRecords.splice(0, toastRecords.length)
})

describe("OToastProvider", () => {
  it("renders nothing (no OToast elements) when toastRecords is empty", () => {
    const wrapper = mount(OToastProvider, { attachTo: document.body })
    // No ToastRoot elements should be rendered
    expect(wrapper.findAll('[role="status"], [role="alert"]')).toHaveLength(0)
  })

  it("renders one OToast per record in toastRecords", async () => {
    toast({ variant: "success", message: "First", timeout: 0 })
    toast({ variant: "error", message: "Second", timeout: 0 })

    const wrapper = mount(OToastProvider, { attachTo: document.body })
    await nextTick()

    const toastElements = wrapper.findAll('[role="status"], [role="alert"]')
    expect(toastElements).toHaveLength(2)
  })

  it("removes a record after openChange(false) fires", async () => {
    toast({ variant: "info", message: "Temp", timeout: 0 })

    const wrapper = mount(OToastProvider, { attachTo: document.body })
    await nextTick()

    expect(toastRecords).toHaveLength(1)

    // Simulate Reka firing openChange(false) by directly calling the handler
    const id = toastRecords[0].id
    // Manually trigger handleOpenChange by emitting on the OToast child
    const oToast = wrapper.findComponent({ name: "OToast" })
    oToast.vm.$emit("openChange", false)
    await nextTick()

    expect(toastRecords).toHaveLength(0)
  })
})
