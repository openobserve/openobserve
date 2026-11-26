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
import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import { createRouter, createMemoryHistory } from "vue-router";
import SearchBar from "@/plugins/logs/SearchBar.vue";
import { resetLogsAutoRunForTests } from "@/composables/useLogs/logsAutoRun";

const { toastMock, postView } = vi.hoisted(() => ({ toastMock: vi.fn(), postView: vi.fn() }));

vi.mock("@/services/saved_views", async () => {
  const actual = await vi.importActual<any>("@/services/saved_views");
  return { default: { ...actual.default, post: postView } };
});

vi.mock("@/lib/feedback/Toast/useToast", async () => {
  const actual = await vi.importActual<any>("@/lib/feedback/Toast/useToast");
  return { ...actual, toast: toastMock };
});

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/logs", name: "logs", component: { template: "<div />" } }],
});

describe("SearchBar - creating a saved view that fails", () => {
  let wrapper: VueWrapper<any> | undefined;

  const createWith = async (failure: unknown) => {
    resetLogsAutoRunForTests();
    toastMock.mockClear();
    postView.mockRejectedValueOnce(failure);
    wrapper = mount(SearchBar, {
      global: {
        provide: { store },
        plugins: [i18n, router, [VueQueryPlugin, { queryClient }]],
        stubs: { QueryEditor: true },
      },
    });
    wrapper.vm.searchObj.data.query = "level = 'error'";
    wrapper.vm.searchObj.data.editorValue = "level = 'error'";
    await flushPromises();
    await wrapper.vm.createSavedViews("errors");
    await flushPromises();
    return toastMock.mock.calls.map(([arg]) => arg.message as string);
  };

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it("shows the server's reason when the name is already taken", async () => {
    const messages = await createWith({
      response: {
        status: 400,
        data: { message: "Saved view with name 'errors' already exists in this organization" },
      },
    });
    expect(messages.join(" ")).toContain("already exists in this organization");
  });

  it("keeps the generic message when the failure carries no reason", async () => {
    const messages = await createWith(new Error(""));
    expect(messages).toContain("Error while creating saved view.");
  });
});
