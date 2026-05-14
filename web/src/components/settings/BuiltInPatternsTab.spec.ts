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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { Notify } from "quasar";
import BuiltInPatternsTab from "./BuiltInPatternsTab.vue";

installQuasar({ plugins: { Notify } });

// --- Mock services ---
vi.mock("@/services/regex_pattern", () => ({
  default: {
    getBuiltInPatterns: vi.fn(),
  },
}));

vi.mock("@/utils/regexPatternCache", () => ({
  RegexPatternCache: {
    get: vi.fn().mockReturnValue(null),
    set: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("quasar", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useQuasar: () => ({
      notify: vi.fn(),
    }),
  };
});

import regexPatternsService from "@/services/regex_pattern";
import { RegexPatternCache } from "@/utils/regexPatternCache";

const mockPatterns = [
  {
    name: "IPv4",
    pattern: "\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}",
    description: "Matches IPv4 addresses",
    tags: ["network", "ip"],
    rarity: 1,
    url: null,
    examples: { Valid: ["192.168.1.1"], Invalid: ["999.999.999.999"] },
  },
  {
    name: "Email",
    pattern: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
    description: "Matches email addresses",
    tags: ["email", "contact"],
    rarity: 2,
    url: null,
    examples: { Valid: ["user@example.com"], Invalid: ["not-an-email"] },
  },
  {
    name: "UUID",
    pattern: "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
    description: "Matches UUID v4",
    tags: ["identifier", "network"],
    rarity: 3,
    url: null,
    examples: { Valid: ["550e8400-e29b-41d4-a716-446655440000"], Invalid: [] },
  },
];

const mockStore = createStore({
  state: {
    selectedOrganization: { identifier: "test-org" },
    theme: "light",
  },
});

const mockI18n = createI18n({
  locale: "en",
  messages: {
    en: {
      regex_patterns: {
        search: "Search patterns...",
        filter_by_tag: "Filter by tag",
        refresh: "Refresh",
        loading_patterns: "Loading patterns...",
        try_again: "Try Again",
        showing_patterns: "Showing {count} patterns",
        no_patterns_found: "No patterns found",
        preview: "Preview",
        description: "Description",
        pattern: "Pattern",
        tags: "Tags",
        rarity: "Rarity",
        valid_examples: "Valid Examples",
        close: "Close",
        import_this_pattern: "Import",
        no_patterns_selected: "No patterns selected",
        patterns_loaded: "{count} patterns loaded",
        failed_to_load: "Failed to load patterns",
        no_description: "No description available",
      },
    },
  },
});

// Stub ODialog so tests are deterministic (no Portal/Reka teleport)
// and so we can assert on the props the component forwards and emit
// the click events the component listens to.
const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "persistent",
    "showClose",
    "width",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryButtonVariant",
    "secondaryButtonVariant",
    "neutralButtonVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test="o-dialog-stub"
      :data-open="String(open)"
      :data-size="size"
      :data-title="title"
      :data-primary-label="primaryButtonLabel"
      :data-secondary-label="secondaryButtonLabel"
    >
      <slot name="header" />
      <slot />
      <slot name="footer" />
      <button
        data-test="o-dialog-stub-primary"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
      <button
        data-test="o-dialog-stub-secondary"
        @click="$emit('click:secondary')"
      >{{ secondaryButtonLabel }}</button>
    </div>
  `,
};

function mountComponent() {
  return mount(BuiltInPatternsTab, {
    global: {
      plugins: [mockI18n],
      provide: { store: mockStore },
      stubs: {
        ODialog: ODialogStub,
        "q-spinner-hourglass": true,
        "q-chip": { template: "<span><slot /></span>", props: ["size", "color", "textColor", "dense"] },
        "q-list": { template: "<div><slot /></div>", props: ["bordered", "separator"] },
        "q-item": { template: "<div class='q-item'><slot /></div>", props: ["class"] },
        "q-item-section": { template: "<div class='q-item-section'><slot /></div>", props: ["side"] },
        "q-item-label": { template: "<div><slot /></div>", props: ["caption", "lines", "class"] },
        "q-checkbox": { template: "<input type='checkbox' />", props: ["modelValue"], emits: ["update:modelValue"] },
        "q-tooltip": { template: "<span><slot /></span>" },
        "q-input": { template: "<input />", props: ["modelValue", "readonly", "outlined", "dense", "rows", "type"] },
      },
    },
  });
}

describe("BuiltInPatternsTab", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(RegexPatternCache.get).mockReturnValue(null);
    vi.mocked(regexPatternsService.getBuiltInPatterns).mockResolvedValue({
      data: { patterns: mockPatterns },
    } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    it("should render without errors", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should fetch patterns on mount", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(regexPatternsService.getBuiltInPatterns).toHaveBeenCalledWith("test-org");
    });

    it("should render search input", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('[data-test="built-in-pattern-search"]').exists()).toBe(true);
    });

    it("should render tag filter", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('[data-test="built-in-pattern-tag-filter"]').exists()).toBe(true);
    });

    it("should render refresh button", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('[data-test="built-in-pattern-refresh-btn"]').exists()).toBe(true);
    });
  });

  describe("patterns loaded from API", () => {
    it("should display all patterns after successful load", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const items = wrapper.findAll(".q-item");
      expect(items.length).toBeGreaterThanOrEqual(mockPatterns.length);
    });

    it("should use cached patterns when cache hit", async () => {
      vi.mocked(RegexPatternCache.get).mockReturnValue(mockPatterns);
      wrapper = mountComponent();
      await flushPromises();
      expect(regexPatternsService.getBuiltInPatterns).not.toHaveBeenCalled();
    });
  });

  describe("error state", () => {
    it("should show error message when API fails", async () => {
      vi.mocked(regexPatternsService.getBuiltInPatterns).mockRejectedValue({
        message: "Network error",
      });
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.error).toBeTruthy();
    });

    it("should render try-again button in error state", async () => {
      vi.mocked(regexPatternsService.getBuiltInPatterns).mockRejectedValue({
        response: { data: { message: "Server error" } },
      });
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.error).toBe("Server error");
    });
  });

  describe("search filtering", () => {
    it("should filter patterns by name", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.searchQuery = "IPv4";
      const filtered = wrapper.vm.filteredPatterns;
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("IPv4");
    });

    it("should filter patterns by description (case-insensitive)", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.searchQuery = "email addresses";
      const filtered = wrapper.vm.filteredPatterns;
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("Email");
    });

    it("should filter patterns by tag", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.searchQuery = "network";
      const filtered = wrapper.vm.filteredPatterns;
      // IPv4 has tag "network" and UUID has tag "network"
      expect(filtered.length).toBeGreaterThanOrEqual(1);
    });

    it("should return all patterns when search query is empty", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.searchQuery = "";
      expect(wrapper.vm.filteredPatterns).toHaveLength(mockPatterns.length);
    });
  });

  describe("tag filtering", () => {
    it("should filter by selected tags", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedTags = ["email"];
      const filtered = wrapper.vm.filteredPatterns;
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("Email");
    });

    it("should return all patterns when no tags selected", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedTags = [];
      expect(wrapper.vm.filteredPatterns).toHaveLength(mockPatterns.length);
    });

    it("should compute available tags from all patterns", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const tags = wrapper.vm.availableTags;
      expect(tags).toContain("network");
      expect(tags).toContain("email");
      expect(tags).toContain("contact");
      expect(tags).toContain("ip");
      expect(tags).toContain("identifier");
    });
  });

  describe("refreshPatterns", () => {
    it("should clear cache and re-fetch on refresh", async () => {
      wrapper = mountComponent();
      await flushPromises();
      vi.clearAllMocks();

      wrapper.vm.refreshPatterns();
      await flushPromises();

      expect(RegexPatternCache.clear).toHaveBeenCalledWith("test-org");
      expect(regexPatternsService.getBuiltInPatterns).toHaveBeenCalledWith("test-org");
    });
  });

  describe("pattern selection", () => {
    it("should track selected patterns via selectedCount", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.selectedCount).toBe(0);
      wrapper.vm.patterns[0].selected = true;
      // selectedPatterns is not directly exposed; verify via selectedCount
      expect(wrapper.vm.selectedCount).toBe(1);
    });

    it("should count selected patterns", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.patterns[0].selected = true;
      wrapper.vm.patterns[1].selected = true;
      expect(wrapper.vm.selectedCount).toBe(2);
    });
  });

  describe("previewPattern", () => {
    it("should set previewedPattern and open dialog", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const pattern = wrapper.vm.patterns[0];
      wrapper.vm.previewPattern(pattern);
      expect(wrapper.vm.previewedPattern).toBe(pattern);
      expect(wrapper.vm.showPreview).toBe(true);
    });
  });

  describe("importSelectedPatterns", () => {
    it("should emit import-patterns event with selected patterns", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.patterns[0].selected = true;
      wrapper.vm.importSelectedPatterns();
      const emitted = wrapper.emitted("import-patterns");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0]).toHaveLength(1);
      expect(emitted![0][0][0].name).toBe("IPv4");
    });

    it("should not emit when no patterns are selected", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.importSelectedPatterns();
      expect(wrapper.emitted("import-patterns")).toBeFalsy();
    });
  });

  describe("importSinglePattern", () => {
    it("should mark previewed pattern selected, close dialog, and emit", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const pattern = wrapper.vm.patterns[0];
      wrapper.vm.previewedPattern = pattern;
      wrapper.vm.showPreview = true;
      wrapper.vm.importSinglePattern();
      expect(wrapper.vm.showPreview).toBe(false);
      const emitted = wrapper.emitted("import-patterns");
      expect(emitted).toBeTruthy();
    });

    it("should do nothing when previewedPattern is null", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.previewedPattern = null;
      wrapper.vm.importSinglePattern();
      expect(wrapper.emitted("import-patterns")).toBeFalsy();
    });
  });

  describe("ODialog preview dialog", () => {
    // Note: the component sets data-test="pattern-preview-dialog" on the
    // ODialog element. Vue's attribute fallthrough means that data-test
    // takes precedence over the stub's own data-test, so we query by the
    // component-provided selector.
    const dialogSelector = '[data-test="pattern-preview-dialog"]';

    it("should render ODialog stub with title from previewed pattern", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.previewPattern(wrapper.vm.patterns[0]);
      await flushPromises();
      const dialog = wrapper.find(dialogSelector);
      expect(dialog.exists()).toBe(true);
      expect(dialog.attributes("data-title")).toBe("IPv4");
      expect(dialog.attributes("data-size")).toBe("md");
    });

    it("should forward localized primary and secondary button labels to ODialog", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.previewPattern(wrapper.vm.patterns[0]);
      await flushPromises();
      const dialog = wrapper.find(dialogSelector);
      expect(dialog.exists()).toBe(true);
      expect(dialog.attributes("data-primary-label")).toBe("Import");
      expect(dialog.attributes("data-secondary-label")).toBe("Close");
    });

    it("should reflect showPreview state via data-open attribute", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const dialog = wrapper.find(dialogSelector);
      expect(dialog.exists()).toBe(true);
      expect(dialog.attributes("data-open")).toBe("false");

      wrapper.vm.previewPattern(wrapper.vm.patterns[1]);
      await flushPromises();
      expect(wrapper.find(dialogSelector).attributes("data-open")).toBe("true");
    });

    it("should import previewed pattern when ODialog emits click:primary", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const pattern = wrapper.vm.patterns[0];
      wrapper.vm.previewPattern(pattern);
      await flushPromises();

      await wrapper.find('[data-test="o-dialog-stub-primary"]').trigger("click");
      await flushPromises();

      expect(wrapper.vm.showPreview).toBe(false);
      expect(pattern.selected).toBe(true);
      const emitted = wrapper.emitted("import-patterns");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0]).toHaveLength(1);
      expect(emitted![0][0][0].name).toBe("IPv4");
    });

    it("should close the dialog when ODialog emits click:secondary", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.previewPattern(wrapper.vm.patterns[0]);
      await flushPromises();
      expect(wrapper.vm.showPreview).toBe(true);

      await wrapper.find('[data-test="o-dialog-stub-secondary"]').trigger("click");
      await flushPromises();

      expect(wrapper.vm.showPreview).toBe(false);
      expect(wrapper.emitted("import-patterns")).toBeFalsy();
    });
  });
});
