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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { shallowMount, flushPromises } from "@vue/test-utils";

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

const { mockListNotices, mockUpdateNotice, mockAddNoticeUpdate } = vi.hoisted(() => ({
  mockListNotices: vi.fn(),
  mockUpdateNotice: vi.fn(),
  mockAddNoticeUpdate: vi.fn(),
}));

vi.mock("@/services/status_pages", () => ({
  default: {
    listNotices: mockListNotices,
    updateNotice: mockUpdateNotice,
    addNoticeUpdate: mockAddNoticeUpdate,
    createNotice: vi.fn(),
  },
}));

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(() => vi.fn()),
}));

import analytics from "@/services/product_analytics";
import PostUpdateDialog from "./PostUpdateDialog.vue";

interface DialogVm {
  onSubmitAttach: (values: { body: string; escalateTo: string }) => Promise<void>;
}

async function mountWithOpenIncident() {
  mockListNotices.mockResolvedValue({
    data: [{ id: "notice-1", kind: 0, state: 1, impact: 1 }],
  });
  const wrapper = shallowMount(PostUpdateDialog, {
    props: {
      open: true,
      orgIdentifier: "org-1",
      pageId: "page-1",
      pageName: "Acme Status",
      components: [],
    },
  });
  await flushPromises();
  return wrapper.vm as unknown as DialogVm;
}

describe("PostUpdateDialog analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockUpdateNotice.mockResolvedValue({ data: {} });
    mockAddNoticeUpdate.mockResolvedValue({ data: {} });
  });

  it("tracks one event for an escalated update, after both requests succeed", async () => {
    const vm = await mountWithOpenIncident();
    await vm.onSubmitAttach({ body: "Still investigating", escalateTo: "major_outage" });
    expect(mockUpdateNotice).toHaveBeenCalledTimes(1);
    expect(mockAddNoticeUpdate).toHaveBeenCalledTimes(1);
    expect(analytics.track).toHaveBeenCalledTimes(1);
    expect(analytics.track).toHaveBeenCalledWith("status_page_notice_update_posted", {
      escalated: true,
    });
  });

  it("tracks a plain update as not escalated", async () => {
    const vm = await mountWithOpenIncident();
    await vm.onSubmitAttach({ body: "Fixed", escalateTo: "none" });
    expect(mockUpdateNotice).not.toHaveBeenCalled();
    expect(analytics.track).toHaveBeenCalledTimes(1);
    expect(analytics.track).toHaveBeenCalledWith("status_page_notice_update_posted", {
      escalated: false,
    });
  });

  it("tracks nothing when posting the update fails after escalating", async () => {
    mockAddNoticeUpdate.mockRejectedValue(new Error("boom"));
    const vm = await mountWithOpenIncident();
    await vm.onSubmitAttach({ body: "Still investigating", escalateTo: "major_outage" });
    expect(analytics.track).not.toHaveBeenCalled();
  });
});
