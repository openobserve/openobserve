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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { h } from "vue";
import type { UseEditorDraftOptions } from "@/composables/useEditorDraft";
import type { DashboardSettingsDraft } from "./dashboardSettingsDraft";
import DashboardSettingsDraftScope from "./DashboardSettingsDraftScope.vue";

const start = vi.fn(() => Promise.resolve());
vi.mock("@/composables/useEditorDraft", () => ({ useEditorDraft: () => ({ start }) }));
vi.mock("@/components/common/drafts/EditorDraftDialogs.vue", () => ({
  default: { name: "EditorDraftDialogs", props: ["draft"], render: () => null },
}));

const mountScope = (beforeStart: () => Promise<boolean>) =>
  mount(DashboardSettingsDraftScope, {
    props: {
      options: {} as UseEditorDraftOptions<DashboardSettingsDraft>,
      beforeStart,
    },
    slots: { default: () => h("div", { "data-test": "settings-body" }) },
  });

describe("DashboardSettingsDraftScope", () => {
  beforeEach(() => start.mockClear());

  it("adds no box of its own around the drawer content", () => {
    const wrapper = mountScope(() => Promise.resolve(false));
    const scope = wrapper.get('[data-test="dashboard-settings-draft-scope"]');
    expect(scope.classes()).toEqual(["contents"]);
    expect(scope.find('[data-test="settings-body"]').exists()).toBe(true);
  });

  it("starts the draft only when there is a dashboard to draft", async () => {
    mountScope(() => Promise.resolve(false));
    await flushPromises();
    expect(start).not.toHaveBeenCalled();

    mountScope(() => Promise.resolve(true));
    await flushPromises();
    expect(start).toHaveBeenCalledTimes(1);
  });
});
