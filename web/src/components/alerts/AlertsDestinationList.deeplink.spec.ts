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
import { h, nextTick } from "vue";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import { queryClient } from "@/composables/query/queryClient";
import OForm from "@/lib/forms/Form/OForm.vue";
import { readEditorDraft, type EditorDraftScope } from "@/utils/drafts/editorDraftStore";
import AlertsDestinationList from "./AlertsDestinationList.vue";
import AddDestination from "./AddDestination.vue";

vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list: vi.fn(),
      create: vi.fn().mockResolvedValue({ data: { code: 200 } }),
      update: vi.fn().mockResolvedValue({ data: { code: 200 } }),
      test: vi.fn().mockResolvedValue({ data: { code: 200 } }),
    },
  });
});
vi.mock("@/services/alert_templates", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { list: vi.fn() },
  });
});
vi.mock("@/services/users", () => ({
  default: {
    orgUsers: vi.fn().mockResolvedValue({ data: { data: [] } }),
    getRoles: vi.fn().mockResolvedValue({ data: [] }),
  },
}));
vi.mock("@/services/reodotdev_analytics", () => ({ useReo: () => ({ track: vi.fn() }) }));

const hook = {
  name: "ops_hook",
  type: "http",
  url: "https://hooks.example.com/ops",
  method: "post",
  template: "plain_http",
  headers: {},
};
const otherHook = { ...hook, name: "other_hook", url: "https://hooks.example.com/other" };

const editScope: EditorDraftScope = {
  kind: "alert_destination",
  org: "default",
  entityId: "ops_hook",
  userEmail: "example@gmail.com",
};

let router: Router;
let wrapper: VueWrapper | null = null;

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

const mountList = async (query: Record<string, string>) => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/alert-destinations", name: "alertDestinations", component: AlertsDestinationList },
      { path: "/alert-templates", name: "alertTemplates", component: { render: () => h("div") } },
    ],
  });
  await router.push({ name: "alertDestinations", query: { org_identifier: "default", ...query } });
  await router.isReady();
  wrapper = mount(
    { render: () => h(RouterView) },
    {
      attachTo: document.body,
      global: {
        plugins: [i18n, store, router],
        stubs: {
          PrebuiltDestinationSelector: true,
          AddUser: true,
          DestinationPreview: true,
          SlackDestinationSetup: true,
        },
      },
    },
  );
};

const editor = () => wrapper!.findComponent(AddDestination);
const byTest = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);

describe("AlertsDestinationList deep link", () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    vi.mocked(templateService.list).mockResolvedValue({
      data: [{ name: "plain_http", body: "{}", type: "http" }],
    } as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("opens the named edit on a cold cache once the list lands, not a blank new form", async () => {
    const list = deferred<{ data: unknown[] }>();
    vi.mocked(destinationService.list).mockReturnValue(list.promise as never);
    await mountList({ action: "update", name: "ops_hook" });
    await flushPromises();

    expect(editor().exists()).toBe(false);
    expect(router.currentRoute.value.query.action).toBe("update");

    list.resolve({ data: [otherHook, hook] });
    await vi.waitFor(() => expect(editor().exists()).toBe(true));

    expect(editor().props("destination")).toMatchObject({ name: "ops_hook" });
    expect(router.currentRoute.value.query).toMatchObject({ action: "update", name: "ops_hook" });
  });

  it("offers the edit's own draft after a reload of the edit URL", async () => {
    vi.mocked(destinationService.list).mockResolvedValue({ data: [hook] } as never);
    await mountList({ action: "update", name: "ops_hook" });
    await vi.waitFor(() => expect(editor().exists()).toBe(true));
    await flushPromises();

    window.dispatchEvent(new Event("pointerdown"));
    (
      editor().findComponent(OForm).vm as unknown as {
        form: { setFieldValue: (k: string, v: unknown) => void };
      }
    ).form.setFieldValue("method", "put");
    await nextTick();
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(editScope)).not.toBeNull();
    wrapper!.unmount();
    wrapper = null;

    queryClient.clear();
    const list = deferred<{ data: unknown[] }>();
    vi.mocked(destinationService.list).mockReturnValue(list.promise as never);
    await mountList({ action: "update", name: "ops_hook" });
    await flushPromises();
    list.resolve({ data: [hook] });

    await vi.waitFor(() => expect(byTest("editor-draft-restore-dialog")).not.toBeNull());
    expect(editor().props("destination")).toMatchObject({ name: "ops_hook" });
  });
});
