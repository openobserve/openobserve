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
import type { StatusPageDomain } from "@/services/status_pages";

// ── Mocks (hoisted by Vitest) ──────────────────────────────────────────────

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

const { mockCopyToClipboard, mockListDomains, mockCreateDomain } = vi.hoisted(() => ({
  mockCopyToClipboard: vi.fn(),
  mockListDomains: vi.fn(),
  mockCreateDomain: vi.fn(),
}));

vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: mockCopyToClipboard,
}));

vi.mock("@/services/status_pages", () => ({
  default: {
    listDomains: mockListDomains,
    createDomain: mockCreateDomain,
    deleteDomain: vi.fn(),
    verifyDomain: vi.fn(),
  },
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(() => vi.fn()),
}));

vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}));

// ── Component under test ───────────────────────────────────────────────────

import DomainsDialog from "./DomainsDialog.vue";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeDomain(overrides: Partial<StatusPageDomain> = {}): StatusPageDomain {
  return {
    id: "dom-1",
    domain: "status.brandname.com",
    verification_state: 0,
    verification_failure_reason: null,
    verified_at: null,
    last_checked_at: null,
    created_at: 1_700_000_000_000_000,
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
  props: ["variant", "size", "iconLeft", "disabled", "title"],
  emits: ["click"],
};

const OInputStub = {
  template:
    '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  props: ["modelValue", "label", "placeholder"],
  emits: ["update:modelValue"],
};

const OBadgeStub = {
  template: '<span class="obadge-stub" :data-variant="variant"><slot /></span>',
  props: ["variant", "size"],
};

const OBannerStub = {
  template: '<div :data-test="$attrs[\'data-test\']" :data-variant="variant"><slot /></div>',
  props: ["variant", "icon", "dense", "content"],
};

const OCodeStub = {
  template: "<code :data-test=\"$attrs['data-test']\"><slot /></code>",
  props: ["block", "copyable", "truncate"],
};

const OTooltipStub = {
  template: '<span class="otooltip-stub" :data-content="content"><slot /></span>',
  props: ["content", "side"],
};

function makeWrapper() {
  return mount(DomainsDialog, {
    props: {
      open: true,
      orgIdentifier: "org-1",
      pageId: "page-1",
      pageName: "Acme Status",
    },
    global: {
      stubs: {
        ODialog: ODialogStub,
        OButton: OButtonStub,
        OInput: OInputStub,
        OBadge: OBadgeStub,
        OBanner: OBannerStub,
        OCode: OCodeStub,
        OTooltip: OTooltipStub,
        OSpinner: true,
        OIcon: true,
      },
    },
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("DomainsDialog", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    mockListDomains.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("TXT record copy affordances", () => {
    it("renders a copy button for the TXT name and one for the TXT value", async () => {
      mockListDomains.mockResolvedValue({ data: [makeDomain()] });
      mockCreateDomain.mockResolvedValue({
        data: {
          id: "dom-1",
          domain: "status.brandname.com",
          txt_name: "_o2-verify.status.brandname.com",
          txt_value: "o2v_abc123",
        },
      });
      wrapper = makeWrapper();
      await flushPromises();

      await wrapper.find('[data-test="status-page-domain-input"]').setValue("status.brandname.com");
      await wrapper.find('[data-test="status-page-domain-add-btn"]').trigger("click");
      await flushPromises();

      expect(wrapper.find('[data-test="status-page-domain-copy-txt-name-dom-1"]').exists()).toBe(
        true,
      );
      expect(wrapper.find('[data-test="status-page-domain-copy-txt-value-dom-1"]').exists()).toBe(
        true,
      );
    });

    it("copies the TXT name through the shared clipboard helper", async () => {
      mockListDomains.mockResolvedValue({ data: [makeDomain()] });
      mockCreateDomain.mockResolvedValue({
        data: {
          id: "dom-1",
          domain: "status.brandname.com",
          txt_name: "_o2-verify.status.brandname.com",
          txt_value: "o2v_abc123",
        },
      });
      wrapper = makeWrapper();
      await flushPromises();

      await wrapper.find('[data-test="status-page-domain-input"]').setValue("status.brandname.com");
      await wrapper.find('[data-test="status-page-domain-add-btn"]').trigger("click");
      await flushPromises();

      await wrapper.find('[data-test="status-page-domain-copy-txt-name-dom-1"]').trigger("click");

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        "_o2-verify.status.brandname.com",
        expect.any(Function),
        expect.objectContaining({ successMessage: expect.anything() }),
      );
    });

    it("copies the write-once TXT value through the shared clipboard helper", async () => {
      mockListDomains.mockResolvedValue({ data: [makeDomain()] });
      mockCreateDomain.mockResolvedValue({
        data: {
          id: "dom-1",
          domain: "status.brandname.com",
          txt_name: "_o2-verify.status.brandname.com",
          txt_value: "o2v_abc123",
        },
      });
      wrapper = makeWrapper();
      await flushPromises();

      await wrapper.find('[data-test="status-page-domain-input"]').setValue("status.brandname.com");
      await wrapper.find('[data-test="status-page-domain-add-btn"]').trigger("click");
      await flushPromises();

      await wrapper.find('[data-test="status-page-domain-copy-txt-value-dom-1"]').trigger("click");

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        "o2v_abc123",
        expect.any(Function),
        expect.objectContaining({ successMessage: expect.anything() }),
      );
    });
  });

  describe("next-steps guidance", () => {
    it("renders the next-steps block alongside a freshly claimed domain", async () => {
      mockListDomains.mockResolvedValue({ data: [makeDomain()] });
      mockCreateDomain.mockResolvedValue({
        data: {
          id: "dom-1",
          domain: "status.brandname.com",
          txt_name: "_o2-verify.status.brandname.com",
          txt_value: "o2v_abc123",
        },
      });
      wrapper = makeWrapper();
      await flushPromises();

      await wrapper.find('[data-test="status-page-domain-input"]').setValue("status.brandname.com");
      await wrapper.find('[data-test="status-page-domain-add-btn"]').trigger("click");
      await flushPromises();

      expect(wrapper.find('[data-test="status-page-domain-next-steps-dom-1"]').exists()).toBe(true);
    });

    it("warns that the TXT value is shown only once", async () => {
      mockListDomains.mockResolvedValue({ data: [makeDomain()] });
      mockCreateDomain.mockResolvedValue({
        data: {
          id: "dom-1",
          domain: "status.brandname.com",
          txt_name: "_o2-verify.status.brandname.com",
          txt_value: "o2v_abc123",
        },
      });
      wrapper = makeWrapper();
      await flushPromises();

      await wrapper.find('[data-test="status-page-domain-input"]').setValue("status.brandname.com");
      await wrapper.find('[data-test="status-page-domain-add-btn"]').trigger("click");
      await flushPromises();

      const warning = wrapper.find('[data-test="status-page-domain-write-once-warning-dom-1"]');
      expect(warning.exists()).toBe(true);
      expect(warning.attributes("data-variant")).toBe("warning");
    });

    it("points a domain whose token was never seen this session at re-claiming", async () => {
      mockListDomains.mockResolvedValue({ data: [makeDomain()] });
      wrapper = makeWrapper();
      await flushPromises();

      expect(wrapper.find('[data-test="status-page-domain-record-lost-dom-1"]').exists()).toBe(
        true,
      );
    });

    it("hides the next-steps block for a domain whose token was never seen this session", async () => {
      mockListDomains.mockResolvedValue({ data: [makeDomain()] });
      wrapper = makeWrapper();
      await flushPromises();

      expect(wrapper.find('[data-test="status-page-domain-next-steps-dom-1"]').exists()).toBe(
        false,
      );
      expect(
        wrapper.find('[data-test="status-page-domain-write-once-warning-dom-1"]').exists(),
      ).toBe(false);
    });
  });

  describe("verification state clarity", () => {
    it("surfaces the failure reason when verification failed", async () => {
      mockListDomains.mockResolvedValue({
        data: [makeDomain({ verification_state: 2, verification_failure_reason: 1 })],
      });
      wrapper = makeWrapper();
      await flushPromises();

      const failure = wrapper.find('[data-test="status-page-domain-failure-dom-1"]');
      expect(failure.exists()).toBe(true);
      expect(failure.attributes("data-variant")).toBe("error");
    });

    it("shows no failure banner while the domain is still pending", async () => {
      mockListDomains.mockResolvedValue({ data: [makeDomain({ verification_state: 0 })] });
      wrapper = makeWrapper();
      await flushPromises();

      expect(wrapper.find('[data-test="status-page-domain-failure-dom-1"]').exists()).toBe(false);
    });

    it("renders the verified hint and no verify action once verified", async () => {
      mockListDomains.mockResolvedValue({
        data: [makeDomain({ verification_state: 1, verified_at: 1_700_000_000_000_000 })],
      });
      wrapper = makeWrapper();
      await flushPromises();

      expect(wrapper.find('[data-test="status-page-domain-verify-dom-1"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="status-page-domain-serving-dom-1"]').exists()).toBe(true);
    });
  });
});
