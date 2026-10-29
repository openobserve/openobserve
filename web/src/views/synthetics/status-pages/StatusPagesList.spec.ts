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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import {
  deleteEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import type { StatusPageListItem } from "@/services/status_pages";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import StatusPagesList from "./StatusPagesList.vue";

const scope = (entityId: string): EditorDraftScope => ({
  kind: "status_page",
  org: store.state.selectedOrganization.identifier,
  entityId,
  userEmail: store.state.userInfo.email,
});

const page = (id: string, name: string) =>
  ({
    id,
    name,
    slug: `slug-${id}`,
    visibility: 1,
    health: "operational",
    component_count: 1,
    updated_at: 1793108642000000,
  }) as unknown as StatusPageListItem;

let wrapper: VueWrapper | null = null;

describe("StatusPagesList draft dots", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("marks the rows with a draft, and follows the store live", async () => {
    writeEditorDraft(scope("sp1"), { data: {} });
    wrapper = mount(StatusPagesList, {
      attachTo: document.body,
      props: { pages: [page("sp1", "Public"), page("sp2", "Internal")] },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();

    expect(wrapper.find('[data-test="status-pages-sp1-draft-dot"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="status-pages-sp2-draft-dot"]').exists()).toBe(false);
    // The name tooltips itself only while cut, never as an always-on repeat beside the dot.
    const names = wrapper.findAllComponents(OTruncatedText).map((n) => n.text());
    expect(names).toEqual(expect.arrayContaining(["Public", "Internal"]));
    expect(
      wrapper.findAllComponents(OTooltip).some((tip) => tip.props("content") === "Public"),
    ).toBe(false);

    writeEditorDraft(scope("sp2"), { data: {} });
    deleteEditorDraft(scope("sp1"));
    await flushPromises();
    expect(wrapper.find('[data-test="status-pages-sp1-draft-dot"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="status-pages-sp2-draft-dot"]').exists()).toBe(true);
  });
});
