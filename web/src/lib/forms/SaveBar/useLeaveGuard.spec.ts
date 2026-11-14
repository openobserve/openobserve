// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, KeepAlive, ref } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { confirmLeave, useLeaveGuard } from "./useLeaveGuard";
import { beginDraftSignOut, cancelDraftSignOut } from "@/utils/drafts/draftSession";

const dirty = ref(false);
const onDiscard = vi.fn();

const Page = defineComponent({
  setup() {
    useLeaveGuard(dirty, { count: () => 2, onDiscard });
    return () => h("div", "page");
  },
});
const Other = defineComponent({ render: () => h("div", "other") });

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/settings", component: Page },
      { path: "/other", component: Other },
    ],
  });
  const App = defineComponent({
    render: () =>
      h(RouterView, null, {
        default: ({ Component }: { Component: any }) => h(KeepAlive, null, () => h(Component)),
      }),
  });
  router.push(path);
  await router.isReady();
  const wrapper = mount(App, { global: { plugins: [router] } });
  return { router, wrapper };
}

describe("useLeaveGuard", () => {
  afterEach(() => {
    dirty.value = false;
    onDiscard.mockClear();
  });

  it.each([
    {
      name: "clean",
      isDirty: false,
      to: "/other?org_identifier=a",
      answer: undefined,
      lands: "/other",
    },
    {
      name: "dirty, confirmed",
      isDirty: true,
      to: "/other?org_identifier=a",
      answer: true,
      lands: "/other",
    },
    {
      name: "dirty, cancelled",
      isDirty: true,
      to: "/other?org_identifier=a",
      answer: false,
      lands: "/settings",
    },
    {
      name: "dirty, organization switch cancelled",
      isDirty: true,
      to: "/settings?org_identifier=b",
      answer: false,
      lands: "/settings",
    },
  ])("leaving asks only when dirty, and follows the answer ($name)", async (row) => {
    const { router, wrapper } = await mountAt("/settings?org_identifier=a");
    const dialog = useConfirmDialog();
    dirty.value = row.isDirty;

    const navigation = router.push(row.to);
    await flushPromises();
    expect(dialog.currentDialog.value !== null).toBe(row.answer !== undefined);
    if (row.answer === true) dialog.handleConfirm();
    if (row.answer === false) dialog.handleCancel();
    await navigation;

    expect(router.currentRoute.value.path).toBe(row.lands);
    expect(router.currentRoute.value.query.org_identifier).toBe("a");
    expect(onDiscard).toHaveBeenCalledTimes(row.answer === true ? 1 : 0);
    wrapper.unmount();
  });

  it.each([
    { name: "clean", isDirty: false, answer: undefined, allowed: true },
    { name: "dirty, confirmed", isDirty: true, answer: true, allowed: true },
    { name: "dirty, cancelled", isDirty: true, answer: false, allowed: false },
  ])(
    "a change the router cannot stop asks the page on screen first ($name)",
    async ({ isDirty, answer, allowed }) => {
      const { router, wrapper } = await mountAt("/settings?org_identifier=a");
      const dialog = useConfirmDialog();
      dirty.value = isDirty;

      const asked = confirmLeave();
      await flushPromises();
      expect(dialog.currentDialog.value !== null).toBe(answer !== undefined);
      if (answer === true) dialog.handleConfirm();
      if (answer === false) dialog.handleCancel();
      expect(await asked).toBe(allowed);
      expect(onDiscard).toHaveBeenCalledTimes(answer === true ? 1 : 0);

      // The page here keeps its edits after the answer; the switch it allowed must not ask again.
      if (allowed) {
        await router.push("/settings?org_identifier=b");
        expect(dialog.currentDialog.value).toBeNull();
        expect(router.currentRoute.value.query.org_identifier).toBe("b");
      }

      // A page that is no longer on screen has nothing to lose and is not asked.
      dirty.value = false;
      await router.push("/other");
      dirty.value = true;
      expect(await confirmLeave()).toBe(true);
      wrapper.unmount();
    },
  );

  it("a sign-out that cannot be cancelled offers no way to stay, and discards", async () => {
    const { router, wrapper } = await mountAt("/settings");
    const dialog = useConfirmDialog();
    dirty.value = true;
    beginDraftSignOut({ forced: true });
    try {
      const navigation = router.push("/other");
      await flushPromises();
      expect(dialog.currentDialog.value).toMatchObject({ confirmOnly: true });
      dialog.handleConfirm();
      await navigation;
      expect(router.currentRoute.value.path).toBe("/other");
      expect(onDiscard).toHaveBeenCalledTimes(1);
    } finally {
      cancelDraftSignOut();
      wrapper.unmount();
    }
  });

  it("the unload listener is removed when the page is deactivated", async () => {
    const { router, wrapper } = await mountAt("/settings");
    const prompted = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(prompted()).toBe(false);

    dirty.value = true;
    expect(prompted()).toBe(true);

    const navigation = router.push("/other");
    await flushPromises();
    // The page stays dirty: the kept-alive instance must stop prompting on its own.
    useConfirmDialog().handleConfirm();
    await navigation;
    await flushPromises();
    expect(prompted()).toBe(false);
    wrapper.unmount();
  });
});
