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

// ── Mocks (hoisted by Vitest) ──────────────────────────────────────────────

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

const { mockGet, mockRouterPush } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockRouterPush: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { id: "page-1" }, query: {} }),
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock("@/services/status_pages", () => ({
  default: {
    get: mockGet,
    update: vi.fn(),
    updateComponents: vi.fn(),
    rotateSlug: vi.fn(),
  },
}));

vi.mock("@/services/synthetics", () => ({
  default: { listByFolderId: vi.fn().mockResolvedValue({ data: { checks: [] } }) },
}));

vi.mock("@/utils/commons", () => ({
  getFoldersListByType: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(() => vi.fn()),
}));

vi.mock("@/utils/clipboard", () => ({ copyToClipboard: vi.fn() }));

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      selectedOrganization: { identifier: "org-1" },
      zoConfig: { build_type: "enterprise", custom_logo_img: "" },
    },
  }),
}));

vi.mock("@/aws-exports", () => ({
  default: { isCloud: "true", isEnterprise: "false" },
}));

// ── Component under test ───────────────────────────────────────────────────

import StatusPageEditor from "./StatusPageEditor.vue";

// ── Stubs ──────────────────────────────────────────────────────────────────

// The focus assertion needs a real focusable <input> in the document, so
// OInput is stubbed down to one rather than shallow-rendered away.
const OInputStub = {
  props: ["modelValue", "label", "placeholder"],
  emits: ["update:modelValue"],
  template:
    "<div :data-test=\"$attrs['data-test']\"><input :data-test=\"$attrs['data-test'] ? $attrs['data-test'] + '-field' : undefined\" :value=\"modelValue\" @input=\"$emit('update:modelValue', $event.target.value)\" /></div>",
};

const OButtonStub = {
  props: ["variant", "size", "iconLeft", "disabled", "loading", "type", "form"],
  emits: ["click"],
  template:
    "<button :data-test=\"$attrs['data-test']\" @click=\"$emit('click')\"><slot /></button>",
};

const passThrough = (tag = "div") => ({
  template: `<${tag} :data-test="$attrs['data-test']"><slot /></${tag}>`,
});

const OSplitterStub = {
  props: ["modelValue", "limits", "separatorClass"],
  template: "<div><slot name='before' /><slot name='after' /></div>",
};

const OPageLayoutStub = {
  props: ["title", "subtitle", "back", "titleOverflow", "bleed"],
  template: "<div><slot name='actions' /><slot /></div>",
};

const OFormStub = {
  props: ["id", "form"],
  template: "<form><slot :isSubmitting='false' /></form>",
};

const OFormSectionStub = {
  props: ["title"],
  template: "<section :data-test=\"$attrs['data-test']\"><slot name='actions' /><slot /></section>",
};

const OFieldStub = {
  props: ["name", "label", "placeholder", "type", "rows", "required", "helpText", "width"],
  template: "<div :data-test=\"$attrs['data-test'] || name\"><slot /></div>",
};

function makeWrapper() {
  return mount(StatusPageEditor, {
    attachTo: document.body,
    global: {
      stubs: {
        OPageLayout: OPageLayoutStub,
        OForm: OFormStub,
        OFormSection: OFormSectionStub,
        OSplitter: OSplitterStub,
        OInput: OInputStub,
        OButton: OButtonStub,
        OFormInput: OFieldStub,
        OFormColor: OFieldStub,
        OFormSwitch: OFieldStub,
        OFormToggleGroup: OFieldStub,
        OToggleGroupItem: passThrough("span"),
        OSelect: OFieldStub,
        OFile: OFieldStub,
        OTooltip: true,
        OIcon: true,
        OSpinner: true,
        StatusPagePreview: true,
      },
    },
  });
}

function pageFixture() {
  return {
    id: "page-1",
    name: "Acme Status",
    slug: "acme",
    description: "",
    brand_name: "",
    accent_color: "",
    logo_img: "",
    visibility: 1,
    password_set: false,
    noindex: false,
    show_uptime_percent: true,
    show_timeline_bars: true,
    confirm_failures: 0,
    confirm_recovery: 0,
    components: [],
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("StatusPageEditor", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ data: pageFixture() });
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("branding layout", () => {
    it("renders the logo field and the accent colour field inside one shared row", async () => {
      wrapper = makeWrapper();
      await flushPromises();

      const row = wrapper.find('[data-test="status-page-branding-row"]');
      expect(row.exists()).toBe(true);
      expect(row.find('[data-test="status-page-logo-field"]').exists()).toBe(true);
      expect(row.find('[data-test="status-page-accent-color"]').exists()).toBe(true);
    });

    it("keeps both fields in the shared row when a logo preview is present", async () => {
      mockGet.mockResolvedValue({ data: { ...pageFixture(), logo_img: "AAAA" } });
      wrapper = makeWrapper();
      await flushPromises();

      const row = wrapper.find('[data-test="status-page-branding-row"]');
      expect(row.find('[data-test="status-page-logo-preview"]').exists()).toBe(true);
      expect(row.find('[data-test="status-page-accent-color"]').exists()).toBe(true);
    });
  });

  describe("adding a component", () => {
    it("appends a new component row", async () => {
      wrapper = makeWrapper();
      await flushPromises();

      expect(wrapper.findAll('[data-test^="status-page-component-row-"]')).toHaveLength(0);

      await wrapper.find('[data-test="status-page-add-component"]').trigger("click");
      await flushPromises();

      expect(wrapper.findAll('[data-test^="status-page-component-row-"]')).toHaveLength(1);
    });

    it("moves keyboard focus into the new row's name input", async () => {
      wrapper = makeWrapper();
      await flushPromises();

      await wrapper.find('[data-test="status-page-add-component"]').trigger("click");
      await flushPromises();

      const input = wrapper.find('[data-test="status-page-component-name-0-field"]');
      expect(input.exists()).toBe(true);
      expect(document.activeElement).toBe(input.element);
    });

    it("focuses the second row's input, not the first, on a second add", async () => {
      wrapper = makeWrapper();
      await flushPromises();

      await wrapper.find('[data-test="status-page-add-component"]').trigger("click");
      await flushPromises();
      await wrapper.find('[data-test="status-page-add-component"]').trigger("click");
      await flushPromises();

      const second = wrapper.find('[data-test="status-page-component-name-1-field"]');
      expect(second.exists()).toBe(true);
      expect(document.activeElement).toBe(second.element);
    });

    it("scrolls the new row's input into view gently", async () => {
      const scrollSpy = vi.fn();
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = scrollSpy;
      try {
        wrapper = makeWrapper();
        await flushPromises();

        await wrapper.find('[data-test="status-page-add-component"]').trigger("click");
        await flushPromises();

        expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest" });
      } finally {
        Element.prototype.scrollIntoView = original;
      }
    });
  });
});
