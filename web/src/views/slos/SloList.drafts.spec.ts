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
import { h } from "vue";

vi.mock("@/services/slos", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { list: vi.fn(), delete: vi.fn(), move: vi.fn(), setEnabled: vi.fn() },
  });
});
vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { list_by_slo: vi.fn(() => Promise.resolve({ data: { list: [] } })) },
  });
});

import SloList from "@/views/slos/SloList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import sloService from "@/services/slos";
import {
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import { byTest, click, clickIn } from "@/test/unit/helpers/draftDom";

const ORG = store.state.selectedOrganization.identifier;
const EMAIL = store.state.userInfo.email;
const draftScope = (entityId: string | null, userEmail = EMAIL): EditorDraftScope => ({
  kind: "slo",
  org: ORG,
  entityId,
  userEmail,
});
const seed = (scope: EditorDraftScope) => writeEditorDraft(scope, { data: {} });

const sloRow = (id: string, name: string) => ({
  id,
  name,
  enabled: true,
  target: 99.9,
  window_secs: 30 * 86400,
  slice_interval_secs: 300,
  tags: [],
  folder_id: "default",
  status: { sli: 99.95, error_budget_remaining: 0.6, burn_rate: 0.4, coverage: 1, no_data: false },
});

let wrapper: VueWrapper | null = null;

const mountList = async () => {
  vi.mocked(sloService.list).mockResolvedValue({
    data: { list: [sloRow("slo-1", "checkout"), sloRow("slo-2", "search")] },
  } as never);
  wrapper = mount(SloList, {
    attachTo: document.body,
    global: {
      plugins: [i18n, store, router],
      stubs: {
        FolderList: { render: () => h("div") },
        SelectFolderDropDown: true,
      },
    },
  });
  // OTable holds its skeleton for MIN_SKELETON_MS before rows render.
  await vi.waitFor(() => expect(byTest("slos-slolist-delete-checkout")).not.toBeNull());
  return wrapper;
};

const deleteRow = async (name: string) => {
  click(`slos-slolist-delete-${name}`);
  await flushPromises();
  clickIn("slos-slolist-delete-dialog", "slos-slolist-delete-confirm");
  await flushPromises();
};

describe("SloList editor drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(sloService.delete)
      .mockReset()
      .mockResolvedValue({ data: { code: 200 } } as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("dots the rows and the New button that have this user's drafts", async () => {
    seed(draftScope("slo-1"));
    seed(draftScope("slo-2", "other@x.io"));
    seed(draftScope(null));
    await mountList();

    const dot = wrapper!.get('[data-test="slos-slolist-checkout-draft-dot"]');
    expect(dot.attributes("aria-label")).toMatch(/^Unsaved draft · /);
    expect(wrapper!.find('[data-test="slos-slolist-search-draft-dot"]').exists()).toBe(false);
    const newButton = wrapper!.get('[data-test="slos-slolist-new"]');
    expect(newButton.attributes("aria-label")).toMatch(/unsaved draft$/);
    expect(newButton.find('[data-test="slos-slolist-new-draft-dot"]').exists()).toBe(true);
  });

  it("drops every user's draft of a deleted SLO", async () => {
    seed(draftScope("slo-1"));
    seed(draftScope("slo-1", "other@x.io"));
    seed(draftScope("slo-2"));
    await mountList();
    await deleteRow("checkout");

    expect(sloService.delete).toHaveBeenCalledTimes(1);
    expect(readEditorDraft(draftScope("slo-1"))).toBeNull();
    expect(readEditorDraft(draftScope("slo-1", "other@x.io"))).toBeNull();
    expect(readEditorDraft(draftScope("slo-2"))).not.toBeNull();
  });

  it("keeps the draft when the delete fails", async () => {
    vi.mocked(sloService.delete).mockRejectedValue({ response: { status: 500, data: {} } });
    seed(draftScope("slo-1"));
    await mountList();
    await deleteRow("checkout");

    expect(sloService.delete).toHaveBeenCalledTimes(1);
    expect(readEditorDraft(draftScope("slo-1"))).not.toBeNull();
  });
});
