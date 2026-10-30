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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import ConfirmDialogProvider from "@/components/ConfirmDialogProvider.vue";
import { beginDraftSignOut, cancelDraftSignOut } from "@/utils/drafts/draftSession";
import { byTest } from "@/test/unit/helpers/draftDom";
import EditGroup from "./EditGroup.vue";

vi.mock("@/services/iam", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    getGroup: vi.fn(() => Promise.resolve({ data: { name: "dev", roles: [], users: [] } })),
  });
});
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/aws-exports", () => ({ default: { isCloud: "false" } }));
vi.mock("./GroupRoles.vue", () => ({ default: { template: "<div />" } }));
vi.mock("./GroupUsers.vue", () => ({ default: { template: "<div />" } }));
vi.mock("./GroupServiceAccounts.vue", () => ({ default: { template: "<div />" } }));

interface GroupVm {
  addedUsers: Set<string>;
}

let router: Router;
let wrapper: VueWrapper | null = null;
let provider: VueWrapper | null = null;

const mountEditor = async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/iam/groups/edit/:group_name", name: "editGroup", component: EditGroup },
      {
        path: "/iam/groups",
        name: "groups",
        component: defineComponent({ render: () => h("div") }),
      },
    ],
  });
  await router.push("/iam/groups/edit/dev");
  const plugins = [i18n, store, router];
  wrapper = mount(
    { render: () => h(RouterView) },
    { attachTo: document.body, global: { plugins } },
  );
  provider = mount(ConfirmDialogProvider, { attachTo: document.body, global: { plugins } });
  await flushPromises();
};

describe("EditGroup leave guard", () => {
  afterEach(() => {
    cancelDraftSignOut();
    wrapper?.unmount();
    provider?.unmount();
    wrapper = null;
    provider = null;
  });

  it("a forced sign-out offers only Discard, which cannot be dismissed", async () => {
    await mountEditor();
    (wrapper!.findComponent(EditGroup).vm as unknown as GroupVm).addedUsers.add("u@x.io");
    await flushPromises();
    beginDraftSignOut({ forced: true });

    const navigation = router.push("/iam/groups");
    await flushPromises();
    const dialog = byTest("confirm-dialog-provider");
    expect(dialog?.textContent).toContain(
      "Your password changed, so you are being signed out and your unsaved changes here cannot be saved. They will be discarded.",
    );
    expect(dialog?.querySelector('[data-test="o-dialog-secondary-btn"]')).toBeNull();
    expect(dialog?.querySelector('[data-test="o-dialog-close-btn"]')).toBeNull();

    dialog?.querySelector<HTMLElement>('[data-test="o-dialog-primary-btn"]')?.click();
    await navigation;
    expect(router.currentRoute.value.name).toBe("groups");
  });
});
