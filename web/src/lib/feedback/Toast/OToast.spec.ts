import { describe, it, expect, vi, afterEach, nextTick } from "vitest"
import { mount } from "@vue/test-utils"
import { h, nextTick as vueNextTick } from "vue"
import { ToastProvider, ToastViewport } from "reka-ui"
import OToast from "./OToast.vue"
import type { ToastProps } from "./OToast.types"

// ToastViewport uses Teleport to portal its <ol> into document.body.
// We include a ToastViewport in the wrapper, mount with attachTo: document.body,
// and query document.body for rendered content.
function mountToast(props: ToastProps) {
  return mount(
    {
      render() {
        return h(ToastProvider, { duration: 0 }, () => [
          h(OToast, props),
          h(ToastViewport),
        ])
      },
    },
    { attachTo: document.body },
  )
}

afterEach(() => {
  document.body.innerHTML = ""
})

describe("OToast", () => {
  it("renders message text", async () => {
    mountToast({ id: "1", open: true, message: "Hello world" })
    await vueNextTick()
    expect(document.body.textContent).toContain("Hello world")
  })

  it("renders title when provided", async () => {
    mountToast({ id: "1", open: true, message: "Body text", title: "My Title" })
    await vueNextTick()
    expect(document.body.textContent).toContain("My Title")
    expect(document.body.textContent).toContain("Body text")
  })

  it("renders success icon for success variant", async () => {
    mountToast({ id: "1", open: true, message: "Done", variant: "success" })
    await vueNextTick()
    expect(document.body.querySelector("svg")).not.toBeNull()
  })

  it("renders error icon for error variant", async () => {
    mountToast({ id: "1", open: true, message: "Error", variant: "error" })
    await vueNextTick()
    expect(document.body.querySelector("svg")).not.toBeNull()
  })

  it("renders warning icon for warning variant", async () => {
    mountToast({ id: "1", open: true, message: "Warn", variant: "warning" })
    await vueNextTick()
    expect(document.body.querySelector("svg")).not.toBeNull()
  })

  it("renders info icon for info variant", async () => {
    mountToast({ id: "1", open: true, message: "FYI", variant: "info" })
    await vueNextTick()
    expect(document.body.querySelector("svg")).not.toBeNull()
  })

  it("does not render an icon for default variant", async () => {
    mountToast({ id: "1", open: true, message: "Plain", variant: "default" })
    await vueNextTick()
    // default variant has no variant-icon div — only the dismiss button X renders
    const toastEl = document.body.querySelector('[role="status"]')
    expect(toastEl).not.toBeNull()
    // The variant icon is wrapped in a <div aria-hidden="true">; close button X is not
    expect(toastEl!.querySelector('div[aria-hidden="true"]')).toBeNull()
  })

  it("renders a spinning icon for loading variant", async () => {
    mountToast({ id: "1", open: true, message: "Loading…", variant: "loading" })
    await vueNextTick()
    const svg = document.body.querySelector("svg")
    expect(svg).not.toBeNull()
    expect(svg!.classList.toString()).toContain("animate-spin")
  })

  it("renders action button when action prop is provided", async () => {
    const handler = vi.fn()
    mountToast({
      id: "1",
      open: true,
      message: "Reload needed",
      action: { label: "Refresh", handler },
    })
    await vueNextTick()
    const btn = document.body.querySelector('button[type="button"]')
    expect(btn).not.toBeNull()
    expect(btn!.textContent).toContain("Refresh")
  })

  it("calls action.handler when action button is clicked", async () => {
    const handler = vi.fn()
    mountToast({
      id: "1",
      open: true,
      message: "Reload needed",
      action: { label: "Refresh", handler },
    })
    await vueNextTick()
    const btn = document.body.querySelector<HTMLButtonElement>('button[type="button"]')
    btn!.click()
    expect(handler).toHaveBeenCalledOnce()
  })

  it("emits openChange(false) when close button is clicked", async () => {
    const wrapper = mountToast({ id: "1", open: true, message: "Hello" })
    await vueNextTick()
    const closeBtn = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss notification"]',
    )
    expect(closeBtn).not.toBeNull()
    closeBtn!.click()
    await vueNextTick()
    const emitted = wrapper.findComponent(OToast).emitted("openChange")
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual([false])
  })

  it("has role=alert for error variant", async () => {
    mountToast({ id: "1", open: true, message: "Bad", variant: "error" })
    await vueNextTick()
    expect(document.body.querySelector('[role="alert"]')).not.toBeNull()
  })

  it("has role=alert for warning variant", async () => {
    mountToast({ id: "1", open: true, message: "Careful", variant: "warning" })
    await vueNextTick()
    expect(document.body.querySelector('[role="alert"]')).not.toBeNull()
  })

  it("has role=status for success variant", async () => {
    mountToast({ id: "1", open: true, message: "Great", variant: "success" })
    await vueNextTick()
    expect(document.body.querySelector('[role="status"]')).not.toBeNull()
  })

  it("has role=status for info variant", async () => {
    mountToast({ id: "1", open: true, message: "Note", variant: "info" })
    await vueNextTick()
    expect(document.body.querySelector('[role="status"]')).not.toBeNull()
  })
})
