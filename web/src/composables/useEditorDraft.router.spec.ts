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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, reactive } from "vue";
import { createStore } from "vuex";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import EditorDraftDialogs from "@/components/common/drafts/EditorDraftDialogs.vue";
import { useEditorDraft, type EditorDraftController } from "./useEditorDraft";

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn(() => () => {}) }));

const Blank = { render: () => h("div") };

let draft: EditorDraftController;
let form: { name: string };
let router: Router;
let wrapper: VueWrapper | null = null;

const Editor = defineComponent({
  setup() {
    draft = useEditorDraft({
      kind: "function",
      entityLabel: () => raw("function"),
      entityId: () => "fn1",
      snapshot: () => ({ ...form }),
      apply: (data: { name: string }) => Object.assign(form, data),
      base: () => ({ name: "saved" }),
      save: async () => true,
    });
    return () => h("div", [h(EditorDraftDialogs, { draft })]);
  },
});

const mountEditor = async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/editor", component: Editor },
      { path: "/a", component: Blank },
      { path: "/b", component: Blank },
    ],
  });
  await router.push("/editor");
  const store = createStore({
    state: { selectedOrganization: { identifier: "org1" }, userInfo: { email: "me@x.io" } },
  });
  wrapper = mount(
    { render: () => h(RouterView) },
    { attachTo: document.body, global: { plugins: [i18n, router, store] } },
  );
  await flushPromises();
  await draft.start();
};

const leaveButton = (id: string) =>
  document.body.querySelector<HTMLElement>(
    `[data-test="editor-draft-leave-dialog"] [data-test="${id}"]`,
  );

describe("useEditorDraft leave guard on a real router", () => {
  beforeEach(() => {
    localStorage.clear();
    form = reactive({ name: "saved" });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    localStorage.clear();
  });

  it("answers the newest navigation when a second one starts while the dialog is open", async () => {
    await mountEditor();
    window.dispatchEvent(new Event("pointerdown"));
    form.name = "typed";
    await nextTick();

    const first = router.push("/a");
    await flushPromises();
    expect(leaveButton("o-dialog-neutral-btn")).not.toBeNull();
    const second = router.push("/b");
    expect(await first).toBeTruthy();
    await flushPromises();
    expect(draft.state.leaveOpen).toBe(true);

    leaveButton("o-dialog-neutral-btn")?.click();
    expect(await second).toBeUndefined();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/b");
    expect(document.body.querySelector('[data-test="editor-draft-leave-dialog"]')).toBeNull();
  });
});
