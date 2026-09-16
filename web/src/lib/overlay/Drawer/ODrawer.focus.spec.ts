import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import ODrawer from "./ODrawer.vue";

const mountedWrappers: VueWrapper[] = [];

async function openDrawer(options: Parameters<typeof mount<typeof ODrawer>>[1] = {}) {
  const behind = document.createElement("button");
  behind.textContent = "Behind drawer";
  document.body.appendChild(behind);
  behind.focus();

  const wrapper = mount(ODrawer, {
    ...options,
    attachTo: document.body,
    props: { ...options.props, open: false },
  });
  mountedWrappers.push(wrapper);

  await wrapper.setProps({ open: true });
  await nextTick();
  await nextTick();

  const panel = document.querySelector<HTMLElement>("[data-o2-drawer]");
  expect(panel).not.toBeNull();
  expect(panel?.contains(document.activeElement)).toBe(true);
  return { behind, panel: panel!, wrapper };
}

afterEach(() => {
  mountedWrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

describe("ODrawer focus on open", () => {
  it("focuses an eligible body field before an explicit autofocus target", async () => {
    await openDrawer({
      slots: {
        default: '<input data-testid="body-field"><button autofocus>Explicit</button>',
      },
    });

    expect(document.activeElement?.getAttribute("data-testid")).toBe("body-field");
  });

  it("honors an explicit autofocus target when there is no eligible body field", async () => {
    await openDrawer({
      slots: {
        default: '<button data-testid="explicit-target" autofocus>Explicit</button>',
      },
    });

    expect(document.activeElement?.getAttribute("data-testid")).toBe("explicit-target");
  });

  it("focuses the primary action when there is no field or autofocus target", async () => {
    await openDrawer({ props: { primaryButtonLabel: "Save" } });

    expect(document.activeElement?.getAttribute("data-test")).toBe("o-drawer-primary-btn");
  });

  it("focuses the panel for a read-only drawer without another target", async () => {
    const { panel } = await openDrawer({
      props: { showClose: false },
      slots: { default: "<p>Read-only content</p>" },
    });

    expect(document.activeElement).toBe(panel);
    expect(panel.getAttribute("tabindex")).toBe("-1");
  });

  it("restores focus to the control behind the drawer after close", async () => {
    const { behind, wrapper } = await openDrawer({
      props: { showClose: false },
      slots: { default: "<p>Read-only content</p>" },
    });

    await wrapper.setProps({ open: false });
    await nextTick();
    await nextTick();

    expect(document.activeElement).toBe(behind);
  });
});
