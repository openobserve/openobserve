// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import CheckDetails from "./CheckDetails.vue";
import { mockMonitorHttp } from "@/test/unit/mockData/synthetics";
import type { BrowserCheck, SyntheticsFolder } from "@/types/synthetics";

// ── O2 component stubs ─────────────────────────────────────────────────────
const OInputStub = {
  props: [
    "modelValue",
    "error",
    "errorMessage",
    "placeholder",
    "label",
    "required",
    "type",
    "rows",
  ],
  emits: ["update:modelValue", "keydown", "blur", "focus"],
  template: `
    <div>
      <label>{{ label }}<span v-if="required">*</span></label>
      <input
        :value="modelValue"
        :placeholder="placeholder"
        @input="$emit('update:modelValue', $event.target.value)"
        @keydown="$emit('keydown', $event)"
        @blur="$emit('blur', $event)"
      />
      <span v-if="error" class="o-input-error">{{ errorMessage }}</span>
    </div>
  `,
};

const OSelectStub = {
  props: ["modelValue", "options", "label", "placeholder"],
  emits: ["update:modelValue"],
  template: `
    <div>
      <label>{{ label }}</label>
      <select
        :value="modelValue"
        @change="$emit('update:modelValue', $event.target.value)"
      >
        <option
          v-for="opt in options"
          :key="opt.value"
          :value="opt.value"
        >{{ opt.label }}</option>
      </select>
    </div>
  `,
};

const OSwitchStub = {
  props: ["modelValue", "label"],
  emits: ["update:modelValue"],
  template: `
    <div>
      <label>{{ label }}</label>
      <input
        type="checkbox"
        :checked="modelValue"
        @change="$emit('update:modelValue', $event.target.checked)"
      />
    </div>
  `,
};

const OButtonStub = {
  emits: ["click"],
  template: '<button @click="$emit(\'click\')"><slot /></button>',
};

const OIconStub = {
  props: ["name", "size"],
  template: "<i />",
};

const STUBS = {
  OInput: OInputStub,
  OSelect: OSelectStub,
  OSwitch: OSwitchStub,
  OButton: OButtonStub,
  OIcon: OIconStub,
};

// ── Mount factory ──────────────────────────────────────────────────────────
function mountCheckDetails(
  overrides: Partial<{
    check: BrowserCheck;
    folders: SyntheticsFolder[];
    validationErrors: Record<string, string>;
    targetLabel: string;
    targetPlaceholder: string;
  }> = {},
) {
  return mount(CheckDetails, {
    props: {
      check: mockMonitorHttp,
      ...overrides,
    },
    global: { plugins: [i18n], stubs: STUBS },
  }) as VueWrapper;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe("CheckDetails", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("initial render", () => {
    beforeEach(() => {
      wrapper = mountCheckDetails();
    });

    it("should render the title", () => {
      expect(wrapper.text()).toContain("Check Details");
    });

    it("should render the name input with check name value", () => {
      const nameInput = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-details-name-input"] input',
      );
      expect(nameInput.exists()).toBe(true);
      expect(nameInput.element.value).toBe(mockMonitorHttp.name);
    });

    it("should render the URL input with check url value", () => {
      const urlInput = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-details-url-input"] input',
      );
      expect(urlInput.exists()).toBe(true);
      expect(urlInput.element.value).toBe(mockMonitorHttp.url);
    });

    it("should render description textarea with check description", () => {
      const descInput = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-details-description-textarea"] input',
      );
      expect(descInput.exists()).toBe(true);
      expect(descInput.element.value).toBe(mockMonitorHttp.description);
    });

    it("should render the enabled switch as checked", () => {
      const switchInput = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-details-enabled-switch"] input[type="checkbox"]',
      );
      expect(switchInput.exists()).toBe(true);
      expect(switchInput.element.checked).toBe(true);
    });

    it("should render existing tags", () => {
      expect(wrapper.text()).toContain("production");
      expect(wrapper.text()).toContain("critical");
    });

    it("should render tag input and add button", () => {
      expect(
        wrapper.find('[data-test="synthetics-check-details-tag-input"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="synthetics-check-details-add-tag-btn"]').exists(),
      ).toBe(true);
    });
  });

  describe("name input", () => {
    beforeEach(() => {
      wrapper = mountCheckDetails();
    });

    it('should emit update:check with updated name when name input changes', async () => {
      const nameInput = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-details-name-input"] input',
      );

      await nameInput.setValue("Updated Check Name");

      const emitted = wrapper.emitted("update:check") as BrowserCheck[][];
      expect(emitted).toBeTruthy();
      const lastEmit = emitted[emitted.length - 1][0];
      expect(lastEmit.name).toBe("Updated Check Name");
      // Other fields should be preserved
      expect(lastEmit.url).toBe(mockMonitorHttp.url);
      expect(lastEmit.enabled).toBe(mockMonitorHttp.enabled);
    });
  });

  describe("folder select", () => {
    const mockFolders: SyntheticsFolder[] = [
      { folderId: "folder-1", name: "Critical Monitors" },
      { folderId: "folder-2", name: "Non-Critical Monitors" },
    ];

    it("should render folder options when folders are provided", () => {
      wrapper = mountCheckDetails({ folders: mockFolders });
      const select = wrapper.find<HTMLSelectElement>(
        '[data-test="synthetics-check-details-folder-select"] select',
      );
      expect(select.exists()).toBe(true);
      const options = select.findAll("option");
      expect(options).toHaveLength(2);
      expect(options[0].text()).toBe("Critical Monitors");
      expect(options[1].text()).toBe("Non-Critical Monitors");
    });

    it("should render default option when no folders are provided", () => {
      wrapper = mountCheckDetails({ folders: undefined });
      const select = wrapper.find<HTMLSelectElement>(
        '[data-test="synthetics-check-details-folder-select"] select',
      );
      const options = select.findAll("option");
      expect(options).toHaveLength(1);
      expect(options[0].text()).toBe("Default");
    });

    it("should render default option when folders array is empty", () => {
      wrapper = mountCheckDetails({ folders: [] });
      const select = wrapper.find<HTMLSelectElement>(
        '[data-test="synthetics-check-details-folder-select"] select',
      );
      const options = select.findAll("option");
      expect(options).toHaveLength(1);
      expect(options[0].text()).toBe("Default");
    });

    it("should emit update:check with updated folder when a folder is selected", async () => {
      wrapper = mountCheckDetails({ folders: mockFolders });
      const select = wrapper.find<HTMLSelectElement>(
        '[data-test="synthetics-check-details-folder-select"] select',
      );

      await select.setValue("folder-2");

      const emitted = wrapper.emitted("update:check") as BrowserCheck[][];
      expect(emitted).toBeTruthy();
      const lastEmit = emitted[emitted.length - 1][0];
      expect(lastEmit.folder).toBe("folder-2");
    });
  });

  describe("enabled toggle", () => {
    it("should emit update:check with enabled=false when switch is toggled off", async () => {
      wrapper = mountCheckDetails();
      const switchInput = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-details-enabled-switch"] input[type="checkbox"]',
      );

      await switchInput.setValue(false);

      const emitted = wrapper.emitted("update:check") as BrowserCheck[][];
      expect(emitted).toBeTruthy();
      const lastEmit = emitted[emitted.length - 1][0];
      expect(lastEmit.enabled).toBe(false);
    });

    it("should emit update:check with enabled=true when switch is toggled on from disabled check", async () => {
      const disabledCheck = { ...mockMonitorHttp, enabled: false };
      wrapper = mountCheckDetails({ check: disabledCheck });
      const switchInput = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-details-enabled-switch"] input[type="checkbox"]',
      );

      expect(switchInput.element.checked).toBe(false);

      await switchInput.setValue(true);

      const emitted = wrapper.emitted("update:check") as BrowserCheck[][];
      expect(emitted).toBeTruthy();
      const lastEmit = emitted[emitted.length - 1][0];
      expect(lastEmit.enabled).toBe(true);
    });
  });

  describe("URL input", () => {
    beforeEach(() => {
      wrapper = mountCheckDetails();
    });

    it("should emit update:check with updated URL when URL input changes", async () => {
      const urlInput = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-details-url-input"] input',
      );

      await urlInput.setValue("https://new.example.com/check");

      const emitted = wrapper.emitted("update:check") as BrowserCheck[][];
      expect(emitted).toBeTruthy();
      const lastEmit = emitted[emitted.length - 1][0];
      expect(lastEmit.url).toBe("https://new.example.com/check");
      expect(lastEmit.name).toBe(mockMonitorHttp.name);
    });
  });

  describe("tags", () => {
    beforeEach(() => {
      wrapper = mountCheckDetails();
    });

    it("should add a tag when input is filled and add button is clicked", async () => {
      const tagInput = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-details-tag-input"] input',
      );
      const addBtn = wrapper.find(
        '[data-test="synthetics-check-details-add-tag-btn"]',
      );

      await tagInput.setValue("new-tag");
      await addBtn.trigger("click");

      await flushPromises();

      const emitted = wrapper.emitted("update:check") as BrowserCheck[][];
      expect(emitted).toBeTruthy();
      const lastEmit = emitted[emitted.length - 1][0];
      expect(lastEmit.tags).toContain("new-tag");
      // Original tags should still be present
      expect(lastEmit.tags).toContain("production");
      expect(lastEmit.tags).toContain("critical");
      expect(lastEmit.tags).toHaveLength(3);
    });

    it("should not add duplicate tags", async () => {
      const tagInput = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-details-tag-input"] input',
      );
      const addBtn = wrapper.find(
        '[data-test="synthetics-check-details-add-tag-btn"]',
      );

      // Record emit count before attempting duplicate add
      const emitCountBefore = (wrapper.emitted("update:check") ?? []).length;

      // Try to add a tag that already exists
      await tagInput.setValue("production");
      await addBtn.trigger("click");

      await flushPromises();

      // No new emits should have fired — addTag returns early for duplicates
      const emitCountAfter = (wrapper.emitted("update:check") ?? []).length;
      expect(emitCountAfter).toBe(emitCountBefore);

      // tagInput ref should be cleared even for duplicates
      expect(tagInput.element.value).toBe("");
    });

    it("should remove a tag when the remove button is clicked", async () => {
      // The mock data has tags: ["production", "critical"]
      const removeBtn = wrapper.find(
        '[data-test="synthetics-check-details-remove-tag-0-btn"]',
      );
      expect(removeBtn.exists()).toBe(true);

      await removeBtn.trigger("click");

      const emitted = wrapper.emitted("update:check") as BrowserCheck[][];
      expect(emitted).toBeTruthy();
      const lastEmit = emitted[emitted.length - 1][0];
      expect(lastEmit.tags).not.toContain("production");
      expect(lastEmit.tags).toContain("critical");
      expect(lastEmit.tags).toHaveLength(1);
    });

    it("should add a tag when Enter key is pressed in the tag input", async () => {
      const tagInput = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-details-tag-input"] input',
      );

      await tagInput.setValue("enter-tag");
      await tagInput.trigger("keydown", { key: "Enter" });

      await flushPromises();

      const emitted = wrapper.emitted("update:check") as BrowserCheck[][];
      expect(emitted).toBeTruthy();
      const lastEmit = emitted[emitted.length - 1][0];
      expect(lastEmit.tags).toContain("enter-tag");
    });

    it("should not add empty tag when input is empty", async () => {
      const addBtn = wrapper.find(
        '[data-test="synthetics-check-details-add-tag-btn"]',
      );

      // Ensure tag input is empty (it should be initially)
      await addBtn.trigger("click");

      await flushPromises();

      const emitted = wrapper.emitted("update:check") as BrowserCheck[][] | undefined;
      if (emitted) {
        const lastEmit = emitted[emitted.length - 1][0];
        // Tags should remain unchanged (no new empty tag)
        expect(lastEmit.tags).toHaveLength(mockMonitorHttp.tags.length);
      }
      // If nothing was emitted, that's also fine — update wasn't called
    });
  });

  describe("validation errors", () => {
    it("should show name error message when validationErrors.name is provided", () => {
      wrapper = mountCheckDetails({
        validationErrors: { name: "Name is required" },
      });

      const nameWrapper = wrapper.find(
        '[data-test="synthetics-check-details-name-input"]',
      );
      expect(nameWrapper.exists()).toBe(true);
      expect(nameWrapper.find(".o-input-error").exists()).toBe(true);
      expect(nameWrapper.find(".o-input-error").text()).toBe("Name is required");
    });

    it("should show URL error message when validationErrors.url is provided", () => {
      wrapper = mountCheckDetails({
        validationErrors: { url: "URL is required" },
      });

      const urlWrapper = wrapper.find(
        '[data-test="synthetics-check-details-url-input"]',
      );
      expect(urlWrapper.exists()).toBe(true);
      expect(urlWrapper.find(".o-input-error").exists()).toBe(true);
      expect(urlWrapper.find(".o-input-error").text()).toBe("URL is required");
    });

    it("should not show error when validationErrors is undefined", () => {
      wrapper = mountCheckDetails({ validationErrors: undefined });

      const nameWrapper = wrapper.find(
        '[data-test="synthetics-check-details-name-input"]',
      );
      expect(nameWrapper.find(".o-input-error").exists()).toBe(false);
    });

    it("should not show error when validationErrors is an empty object", () => {
      wrapper = mountCheckDetails({ validationErrors: {} });

      const nameWrapper = wrapper.find(
        '[data-test="synthetics-check-details-name-input"]',
      );
      expect(nameWrapper.find(".o-input-error").exists()).toBe(false);
    });
  });

  describe("target label overrides", () => {
    it("should use default target label when targetLabel is not provided", () => {
      wrapper = mountCheckDetails();

      const urlWrapper = wrapper.find(
        '[data-test="synthetics-check-details-url-input"]',
      );
      expect(urlWrapper.text()).toContain("Starting URL");
    });

    it("should use custom target label when targetLabel is provided", () => {
      wrapper = mountCheckDetails({ targetLabel: "Target Host" });

      const urlWrapper = wrapper.find(
        '[data-test="synthetics-check-details-url-input"]',
      );
      expect(urlWrapper.text()).toContain("Target Host");
      expect(urlWrapper.text()).not.toContain(
        "Starting URL",
      );
    });

    it("should use default target placeholder when targetPlaceholder is not provided", () => {
      wrapper = mountCheckDetails();

      const urlInput = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-details-url-input"] input',
      );
      expect(urlInput.element.placeholder).toBe(
        "https://example.com",
      );
    });

    it("should use custom target placeholder when targetPlaceholder is provided", () => {
      wrapper = mountCheckDetails({
        targetPlaceholder: "e.g. db.internal:5432",
      });

      const urlInput = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-details-url-input"] input',
      );
      expect(urlInput.element.placeholder).toBe("e.g. db.internal:5432");
    });
  });

  describe("edge cases", () => {
    it("should handle check.description being undefined", () => {
      const checkWithoutDesc = {
        ...mockMonitorHttp,
        description: undefined,
      };
      wrapper = mountCheckDetails({ check: checkWithoutDesc });

      const descInput = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-details-description-textarea"] input',
      );
      expect(descInput.element.value).toBe("");
    });

    it("should handle check.folder being undefined", () => {
      const checkWithoutFolder = {
        ...mockMonitorHttp,
        folder: undefined,
      };
      wrapper = mountCheckDetails({ check: checkWithoutFolder });

      const select = wrapper.find<HTMLSelectElement>(
        '[data-test="synthetics-check-details-folder-select"] select',
      );
      // When folder is undefined, folder computed returns ''
      // The select should show the default option with value "default"
      const defaultOption = select.find('option[value="default"]');
      expect(defaultOption.exists()).toBe(true);
    });

    it("should handle empty tags array", () => {
      const checkWithNoTags = {
        ...mockMonitorHttp,
        tags: [],
      };
      wrapper = mountCheckDetails({ check: checkWithNoTags });

      // Tag list should not render when empty
      const tagList = wrapper.find("ul");
      expect(tagList.exists()).toBe(false);
    });

    it("should clean tag input after adding a tag", async () => {
      wrapper = mountCheckDetails();
      const tagInput = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-details-tag-input"] input',
      );
      const addBtn = wrapper.find(
        '[data-test="synthetics-check-details-add-tag-btn"]',
      );

      await tagInput.setValue("cleaned-tag");
      await addBtn.trigger("click");

      await flushPromises();

      // The tagInput ref should be cleared after addTag() sets it to ''
      // After the emit, the input should reflect the empty tagInput value
      expect(tagInput.element.value).toBe("");
    });
  });
});
