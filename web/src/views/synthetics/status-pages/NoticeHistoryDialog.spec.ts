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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import type { StatusPageNotice } from "@/services/status_pages";

// ── Mocks (hoisted by Vitest) ──────────────────────────────────────────────

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

const { mockListNotices, mockListNoticeUpdates, mockMarkFalse, mockUndoFalse } = vi.hoisted(() => ({
  mockListNotices: vi.fn(),
  mockListNoticeUpdates: vi.fn(),
  mockMarkFalse: vi.fn(),
  mockUndoFalse: vi.fn(),
}));

vi.mock("@/services/status_pages", () => ({
  default: {
    listNotices: mockListNotices,
    listNoticeUpdates: mockListNoticeUpdates,
    deleteNotice: vi.fn(),
    markFalsePositive: mockMarkFalse,
    undoFalsePositive: mockUndoFalse,
  },
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(() => vi.fn()),
}));

const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));

// ── Component under test ───────────────────────────────────────────────────

import NoticeHistoryDialog from "./NoticeHistoryDialog.vue";

// ── Helpers ────────────────────────────────────────────────────────────────

const COMPONENTS = [
  { id: "comp-api", name: "API" },
  { id: "comp-web", name: "Web app" },
];

function makeNotice(overrides: Partial<StatusPageNotice> = {}): StatusPageNotice {
  return {
    id: "notice-1",
    kind: 0,
    impact: 2,
    source: 1,
    title: "Elevated error rates",
    body: "We are investigating.",
    state: 1,
    starts_at: 1_700_000_000_000_000,
    resolved_at: null,
    excluded_from_uptime: false,
    component_ids: ["comp-api"],
    created_at: 1_700_000_000_000_000,
    updated_at: 1_700_000_000_000_000,
    ...overrides,
  };
}

const ODialogStub = {
  template: "<div :data-test=\"$attrs['data-test']\"><slot /></div>",
  props: ["open", "size", "title", "secondaryButtonLabel"],
};

const OButtonStub = {
  template:
    "<button :data-test=\"$attrs['data-test']\" @click=\"$emit('click')\"><slot /></button>",
  props: ["variant", "size", "iconLeft", "disabled"],
  emits: ["click"],
};

const OBadgeStub = {
  template: '<span class="obadge-stub" :data-variant="variant"><slot /></span>',
  props: ["variant", "size"],
};

const OTagStub = {
  template: '<span class="otag-stub" :data-test="$attrs[\'data-test\']"><slot />{{ label }}</span>',
  props: ["size", "shape", "variant", "label"],
};

const OTooltipStub = {
  template: '<span class="otooltip-stub" :data-content="content"><slot /></span>',
  props: ["content", "side"],
};

const OTimeCellStub = {
  template: '<span class="otimecell-stub">{{ value }}</span>',
  props: ["value", "unit", "mode"],
};

function makeWrapper(components: { id: string; name: string }[] = COMPONENTS) {
  return mount(NoticeHistoryDialog, {
    props: {
      open: true,
      orgIdentifier: "org-1",
      pageId: "page-1",
      pageName: "Acme Status",
      components,
    },
    global: {
      stubs: {
        ODialog: ODialogStub,
        OButton: OButtonStub,
        OBadge: OBadgeStub,
        OTag: OTagStub,
        OTooltip: OTooltipStub,
        OTimeCell: OTimeCellStub,
        OSpinner: true,
        OIcon: true,
        OTextarea: {
          template:
            '<textarea :data-test="$attrs[\'data-test\']" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          props: ["modelValue", "label", "rows", "maxlength", "autofocus"],
          emits: ["update:modelValue"],
        },
      },
    },
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("NoticeHistoryDialog", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    mockListNotices.mockResolvedValue({ data: [] });
    mockListNoticeUpdates.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("affected components", () => {
    it("names each component a notice maps to", async () => {
      mockListNotices.mockResolvedValue({
        data: [makeNotice({ component_ids: ["comp-api", "comp-web"] })],
      });
      wrapper = makeWrapper();
      await flushPromises();

      const affected = wrapper.find('[data-test="status-page-notice-components-notice-1"]');
      expect(affected.exists()).toBe(true);
      expect(affected.text()).toContain("API");
      expect(affected.text()).toContain("Web app");
    });

    it("renders the all-components copy when the notice maps to no ids", async () => {
      mockListNotices.mockResolvedValue({ data: [makeNotice({ component_ids: [] })] });
      wrapper = makeWrapper();
      await flushPromises();

      const affected = wrapper.find('[data-test="status-page-notice-components-notice-1"]');
      expect(affected.exists()).toBe(true);
      expect(affected.text()).toContain("statusPages.notices.allComponents");
      expect(affected.text()).not.toContain("API");
    });

    it("does not leak a raw id for a component that no longer exists", async () => {
      mockListNotices.mockResolvedValue({
        data: [makeNotice({ component_ids: ["comp-api", "comp-deleted-9f2c"] })],
      });
      wrapper = makeWrapper();
      await flushPromises();

      const affected = wrapper.find('[data-test="status-page-notice-components-notice-1"]');
      expect(affected.exists()).toBe(true);
      expect(affected.text()).toContain("API");
      expect(wrapper.text()).not.toContain("comp-deleted-9f2c");
    });

    it("falls back to the all-components copy when every mapped id is unresolvable", async () => {
      mockListNotices.mockResolvedValue({
        data: [makeNotice({ component_ids: ["comp-gone"] })],
      });
      wrapper = makeWrapper();
      await flushPromises();

      const affected = wrapper.find('[data-test="status-page-notice-components-notice-1"]');
      expect(affected.text()).toContain("statusPages.notices.componentsUnavailable");
      expect(wrapper.text()).not.toContain("comp-gone");
    });
  });

  describe("delete confirm", () => {
    it("names the update and asks with a destructive confirm", async () => {
      confirmMock.mockResolvedValue(false);
      mockListNotices.mockResolvedValue({ data: [makeNotice()] });
      wrapper = makeWrapper();
      await flushPromises();

      await wrapper.find('[data-test="status-page-notice-delete-notice-1"]').trigger("click");
      await flushPromises();

      expect(confirmMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messageKeypath: "statusPages.notices.deleteBody",
          messageName: "Elevated error rates",
          confirmVariant: "destructive",
        }),
      );
    });
  });

  describe("false alarm", () => {
    const auto = () => makeNotice({ id: "n-auto", source: 0 });

    it("offers the action only on an incident that synthetics opened", async () => {
      mockListNotices.mockResolvedValue({ data: [auto(), makeNotice({ id: "n-manual" })] });
      wrapper = makeWrapper();
      await flushPromises();
      expect(
        wrapper.find('[data-test="status-page-notice-mark-false-alarm-n-auto"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="status-page-notice-mark-false-alarm-n-manual"]').exists(),
      ).toBe(false);
    });

    it("sends the reason and reloads", async () => {
      mockListNotices.mockResolvedValue({ data: [auto()] });
      mockMarkFalse.mockResolvedValue({});
      wrapper = makeWrapper();
      await flushPromises();
      await wrapper
        .find('[data-test="status-page-notice-mark-false-alarm-n-auto"]')
        .trigger("click");
      await wrapper
        .find('[data-test="status-page-notice-false-alarm-reason-n-auto"]')
        .setValue("  probe outage ");
      await wrapper
        .find('[data-test="status-page-notice-false-alarm-confirm-n-auto"]')
        .trigger("click");
      await flushPromises();
      expect(mockMarkFalse).toHaveBeenCalledWith("org-1", "n-auto", "probe outage");
      expect(mockListNotices).toHaveBeenCalledTimes(2);
      expect(wrapper.emitted("deleted")).toHaveLength(1);
    });

    it("shows who marked it and lets the owner undo it", async () => {
      mockListNotices.mockResolvedValue({
        data: [
          {
            ...auto(),
            excluded_from_uptime: true,
            false_alarm: { by: "a@b.c", at: 5, reason: "probe outage" },
          },
        ],
      });
      mockUndoFalse.mockResolvedValue({});
      wrapper = makeWrapper();
      await flushPromises();
      expect(wrapper.find('[data-test="status-page-notice-false-alarm-n-auto"]').exists()).toBe(
        true,
      );
      expect(
        wrapper.find('[data-test="status-page-notice-mark-false-alarm-n-auto"]').exists(),
      ).toBe(false);
      await wrapper
        .find('[data-test="status-page-notice-undo-false-alarm-n-auto"]')
        .trigger("click");
      await flushPromises();
      expect(mockUndoFalse).toHaveBeenCalledWith("org-1", "n-auto");
    });
  });
});
