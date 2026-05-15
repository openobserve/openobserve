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
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import store from "@/test/unit/helpers/store";

// ── Module mocks (hoisted) ───────────────────────────────────────────────────

vi.mock("highlight.js", () => ({
  default: {
    highlight: vi.fn(() => ({ value: "" })),
    highlightAuto: vi.fn(() => ({ value: "" })),
    getLanguage: vi.fn(() => null),
    registerLanguage: vi.fn(),
  },
}));

vi.mock("marked", () => ({
  marked: {
    setOptions: vi.fn(),
    parse: vi.fn((content: string) => content),
    lexer: vi.fn(() => []),
    parser: vi.fn(() => ""),
  },
}));

const mockSaveToHistory = vi.fn().mockResolvedValue(42);
const mockLoadHistory = vi.fn().mockResolvedValue([]);
const mockLoadChat = vi.fn().mockResolvedValue(null);
const mockDeleteChatById = vi.fn().mockResolvedValue(true);
const mockClearAllHistory = vi.fn().mockResolvedValue(true);
const mockUpdateChatTitle = vi.fn().mockResolvedValue(true);

vi.mock("@/composables/useChatHistory", () => ({
  useChatHistory: vi.fn(() => ({
    saveToHistory: mockSaveToHistory,
    loadHistory: mockLoadHistory,
    loadChat: mockLoadChat,
    deleteChatById: mockDeleteChatById,
    clearAllHistory: mockClearAllHistory,
    updateChatTitle: mockUpdateChatTitle,
  })),
}));

vi.mock("@/composables/useAiChat", () => ({
  default: vi.fn(() => ({
    fetchAiChat: vi.fn(),
    submitFeedback: vi.fn().mockResolvedValue(true),
    registerAiChatHandler: vi.fn(),
    removeAiChatHandler: vi.fn(),
    getStructuredContext: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getImageURL: vi.fn((path: string) => `/mocked/${path}`),
    getUUIDv7: vi.fn(() => "mock-uuid-v7"),
    generateTraceContext: vi.fn(() => ({ traceId: "mock-trace" })),
  };
});

vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "true", isCloud: "false" },
}));

vi.mock("quasar", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useQuasar: () => ({ notify: vi.fn(), dialog: vi.fn() }),
  };
});

vi.mock("vue-router", () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    currentRoute: { value: { path: "/" } },
  })),
}));

vi.mock("dompurify", () => ({
  default: { sanitize: vi.fn((html: string) => html) },
}));

vi.mock("@/composables/contextProviders", () => ({
  contextRegistry: { getActiveContext: vi.fn().mockResolvedValue(null) },
  createDefaultContextProvider: vi.fn(),
}));

// Component import must come after all vi.mock() declarations.
import O2AIChat from "./O2AIChat.vue";

installQuasar();

// ── Stub definitions ─────────────────────────────────────────────────────────

const stubs = {
  RichTextInput: {
    template: "<div data-test=\"rich-text-input\" />",
    props: [
      "modelValue",
      "placeholder",
      "disabled",
      "theme",
      "references",
      "borderless",
    ],
    emits: [
      "update:modelValue",
      "keydown",
      "submit",
      "update:references",
    ],
  },
  ConfirmDialog: {
    template: "<div data-test=\"confirm-dialog\" />",
    props: ["modelValue", "title", "message"],
    emits: ["update:ok", "update:cancel", "update:modelValue"],
  },
  O2AIConfirmDialog: {
    template: "<div data-test=\"o2-ai-confirm-dialog\" />",
    props: ["visible", "confirmation"],
    emits: ["confirm", "cancel", "always-confirm"],
  },
  // Stub ODialog with the same surface as the real component so the parent's
  // v-model:open binding, slot content, and click:primary/secondary emits all
  // exercise the migrated path.
  ODialog: {
    name: "ODialog",
    template:
      "<div data-test=\"o-dialog\" v-if=\"open\">" +
      "<div data-test=\"o-dialog-title\">{{ title }}</div>" +
      "<div data-test=\"o-dialog-body\"><slot /></div>" +
      "<button data-test=\"o-dialog-primary\" @click=\"$emit('click:primary')\">{{ primaryButtonLabel }}</button>" +
      "<button data-test=\"o-dialog-secondary\" @click=\"$emit('click:secondary')\">{{ secondaryButtonLabel }}</button>" +
      "<button data-test=\"o-dialog-close\" @click=\"$emit('update:open', false)\">x</button>" +
      "</div>",
    props: [
      "open",
      "title",
      "subTitle",
      "size",
      "width",
      "persistent",
      "showClose",
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
    emits: [
      "update:open",
      "click:primary",
      "click:secondary",
      "click:neutral",
    ],
  },
  // Stub ODrawer with the same surface (default slot, v-model:open) so the
  // History drawer can be asserted without pulling in the real component.
  ODrawer: {
    name: "ODrawer",
    template:
      "<div data-test=\"o-drawer\" v-if=\"open\">" +
      "<div data-test=\"o-drawer-title\">{{ title }}</div>" +
      "<div data-test=\"o-drawer-body\"><slot /></div>" +
      "<button data-test=\"o-drawer-close\" @click=\"$emit('update:open', false)\">x</button>" +
      "</div>",
    props: [
      "open",
      "title",
      "subTitle",
      "size",
      "width",
      "persistent",
      "showClose",
      "primaryButtonLabel",
      "secondaryButtonLabel",
      "neutralButtonLabel",
    ],
    emits: [
      "update:open",
      "click:primary",
      "click:secondary",
      "click:neutral",
    ],
  },
};

function mountO2AIChat(props: Record<string, unknown> = {}) {
  return mount(O2AIChat, {
    global: {
      plugins: [store],
      stubs,
    },
    props: {
      isOpen: false,
      headerHeight: 0,
      aiChatInputContext: "",
      appendMode: true,
      ...props,
    },
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("O2AIChat", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    it("should render without errors when isOpen is false", () => {
      wrapper = mountO2AIChat({ isOpen: false });
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the chat content wrapper when isOpen is true", async () => {
      wrapper = mountO2AIChat({ isOpen: true });
      await flushPromises();
      const chatContent = wrapper.find(".chat-content-wrapper");
      expect(chatContent.exists()).toBe(true);
    });

    it("should show empty state when no chat messages are present", async () => {
      wrapper = mountO2AIChat({ isOpen: true });
      await flushPromises();
      const welcomeSection = wrapper.find(".welcome-section");
      expect(welcomeSection.exists()).toBe(true);
    });
  });

  describe("addNewChat", () => {
    beforeEach(() => {
      wrapper = mountO2AIChat({ isOpen: true });
    });

    it("should reset chatMessages when addNewChat is called", async () => {
      // Seed some messages first so we can verify they are cleared.
      (wrapper.vm as any).chatMessages = [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ];
      await nextTick();

      (wrapper.vm as any).addNewChat();
      await nextTick();

      expect((wrapper.vm as any).chatMessages).toHaveLength(0);
    });

    it("should reset currentChatId to null when addNewChat is called", async () => {
      (wrapper.vm as any).currentChatId = 99;
      (wrapper.vm as any).addNewChat();
      await nextTick();

      expect((wrapper.vm as any).currentChatId).toBeNull();
    });

    it("should reset displayedTitle to empty string when addNewChat is called", async () => {
      (wrapper.vm as any).displayedTitle = "My old chat";
      (wrapper.vm as any).addNewChat();
      await nextTick();

      expect((wrapper.vm as any).displayedTitle).toBe("");
    });
  });

  describe("loadHistory", () => {
    it("should call dbLoadHistory and populate chatHistory", async () => {
      const mockEntries = [
        {
          id: 1,
          title: "First chat",
          timestamp: new Date().toISOString(),
          model: "gpt-4",
          messages: [],
          sessionId: "s1",
          userOrgKey: "key",
        },
        {
          id: 2,
          title: "Second chat",
          timestamp: new Date().toISOString(),
          model: "gpt-4",
          messages: [],
          sessionId: "s2",
          userOrgKey: "key",
        },
      ];
      mockLoadHistory.mockResolvedValueOnce(mockEntries);

      wrapper = mountO2AIChat({ isOpen: true });
      await flushPromises();

      // loadHistory is called on mount when isOpen=true; reset and call again
      mockLoadHistory.mockClear();
      mockLoadHistory.mockResolvedValueOnce(mockEntries);

      await (wrapper.vm as any).loadHistory();
      await flushPromises();

      expect(mockLoadHistory).toHaveBeenCalledTimes(1);
      expect((wrapper.vm as any).chatHistory).toHaveLength(2);
      expect((wrapper.vm as any).chatHistory[0].title).toBe("First chat");
    });
  });

  describe("filteredChatHistory", () => {
    beforeEach(() => {
      wrapper = mountO2AIChat({ isOpen: false });
    });

    it("should return all history when historySearchTerm is empty", async () => {
      (wrapper.vm as any).chatHistory = [
        { id: 1, title: "SQL query help" },
        { id: 2, title: "Log analysis" },
      ];
      (wrapper.vm as any).historySearchTerm = "";
      await nextTick();

      expect((wrapper.vm as any).filteredChatHistory).toHaveLength(2);
    });

    it("should filter history case-insensitively by historySearchTerm", async () => {
      (wrapper.vm as any).chatHistory = [
        { id: 1, title: "SQL query help" },
        { id: 2, title: "Log analysis" },
        { id: 3, title: "sql performance tips" },
      ];
      (wrapper.vm as any).historySearchTerm = "sql";
      await nextTick();

      const result = (wrapper.vm as any).filteredChatHistory;
      expect(result).toHaveLength(2);
      expect(result.map((c: any) => c.id)).toEqual([1, 3]);
    });

    it("should return empty array when no chats match the search term", async () => {
      (wrapper.vm as any).chatHistory = [
        { id: 1, title: "SQL query help" },
        { id: 2, title: "Log analysis" },
      ];
      (wrapper.vm as any).historySearchTerm = "dashboard";
      await nextTick();

      expect((wrapper.vm as any).filteredChatHistory).toHaveLength(0);
    });
  });

  describe("deleteChat", () => {
    beforeEach(() => {
      wrapper = mountO2AIChat({ isOpen: false });
    });

    it("should set chatToDelete and show confirm dialog when deleteChat is called", async () => {
      (wrapper.vm as any).deleteChat(42);
      await nextTick();

      expect((wrapper.vm as any).chatToDelete).toBe(42);
      expect((wrapper.vm as any).showDeleteChatConfirmDialog).toBe(true);
    });
  });

  describe("confirmDeleteChat", () => {
    beforeEach(() => {
      wrapper = mountO2AIChat({ isOpen: false });
    });

    it("should call dbDeleteChatById with the chatToDelete id", async () => {
      (wrapper.vm as any).chatToDelete = 7;
      mockDeleteChatById.mockResolvedValueOnce(true);

      await (wrapper.vm as any).confirmDeleteChat();
      await flushPromises();

      expect(mockDeleteChatById).toHaveBeenCalledWith(7);
    });

    it("should call addNewChat when the deleted chat is the current chat", async () => {
      (wrapper.vm as any).currentChatId = 7;
      (wrapper.vm as any).chatToDelete = 7;
      (wrapper.vm as any).chatMessages = [{ role: "user", content: "test" }];
      mockDeleteChatById.mockResolvedValueOnce(true);

      await (wrapper.vm as any).confirmDeleteChat();
      await flushPromises();

      expect((wrapper.vm as any).chatMessages).toHaveLength(0);
      expect((wrapper.vm as any).currentChatId).toBeNull();
    });

    it("should not reset currentChatId when a different chat is deleted", async () => {
      (wrapper.vm as any).currentChatId = 10;
      (wrapper.vm as any).chatToDelete = 7;
      mockDeleteChatById.mockResolvedValueOnce(true);

      await (wrapper.vm as any).confirmDeleteChat();
      await flushPromises();

      expect((wrapper.vm as any).currentChatId).toBe(10);
    });

    it("should reset chatToDelete and hide confirm dialog after deletion", async () => {
      (wrapper.vm as any).chatToDelete = 7;
      (wrapper.vm as any).showDeleteChatConfirmDialog = true;
      mockDeleteChatById.mockResolvedValueOnce(true);

      await (wrapper.vm as any).confirmDeleteChat();
      await flushPromises();

      expect((wrapper.vm as any).chatToDelete).toBeNull();
      expect((wrapper.vm as any).showDeleteChatConfirmDialog).toBe(false);
    });
  });

  describe("clearAllConversations", () => {
    beforeEach(() => {
      wrapper = mountO2AIChat({ isOpen: false });
    });

    it("should set showClearAllConfirmDialog to true when clearAllConversations is called", async () => {
      (wrapper.vm as any).showClearAllConfirmDialog = false;
      (wrapper.vm as any).clearAllConversations();
      await nextTick();

      expect((wrapper.vm as any).showClearAllConfirmDialog).toBe(true);
    });
  });

  describe("saveEditedTitle", () => {
    beforeEach(() => {
      wrapper = mountO2AIChat({ isOpen: false });
    });

    it("should call dbUpdateChatTitle when currentChatId and editingTitle are set", async () => {
      (wrapper.vm as any).currentChatId = 5;
      (wrapper.vm as any).editingTitle = "My new title";
      mockUpdateChatTitle.mockResolvedValueOnce(true);

      await (wrapper.vm as any).saveEditedTitle();
      await flushPromises();

      expect(mockUpdateChatTitle).toHaveBeenCalledWith(5, "My new title");
    });

    it("should update displayedTitle after successful title save", async () => {
      (wrapper.vm as any).currentChatId = 5;
      (wrapper.vm as any).editingTitle = "Updated Title";
      (wrapper.vm as any).displayedTitle = "Old Title";
      mockUpdateChatTitle.mockResolvedValueOnce(true);

      await (wrapper.vm as any).saveEditedTitle();
      await flushPromises();

      expect((wrapper.vm as any).displayedTitle).toBe("Updated Title");
    });

    it("should not call dbUpdateChatTitle when editingTitle is empty", async () => {
      (wrapper.vm as any).currentChatId = 5;
      (wrapper.vm as any).editingTitle = "";

      await (wrapper.vm as any).saveEditedTitle();
      await flushPromises();

      expect(mockUpdateChatTitle).not.toHaveBeenCalled();
    });

    it("should not call dbUpdateChatTitle when currentChatId is null", async () => {
      (wrapper.vm as any).currentChatId = null;
      (wrapper.vm as any).editingTitle = "Some title";

      await (wrapper.vm as any).saveEditedTitle();
      await flushPromises();

      expect(mockUpdateChatTitle).not.toHaveBeenCalled();
    });
  });

  // ── Migration: ODrawer (Chat History) ────────────────────────────────────
  describe("history drawer (ODrawer)", () => {
    beforeEach(() => {
      wrapper = mountO2AIChat({ isOpen: true });
    });

    it("should not render the ODrawer when showHistory is false", async () => {
      (wrapper.vm as any).showHistory = false;
      await nextTick();

      expect(wrapper.find('[data-test="o-drawer"]').exists()).toBe(false);
    });

    it("should render the ODrawer with the Chat History title when showHistory is true", async () => {
      (wrapper.vm as any).showHistory = true;
      await nextTick();

      const drawer = wrapper.findComponent({ name: "ODrawer" });
      expect(drawer.exists()).toBe(true);
      expect(drawer.props("open")).toBe(true);
      expect(drawer.props("title")).toBe("Chat History");
      expect(drawer.props("size")).toBe("sm");
      expect(wrapper.find('[data-test="o-drawer-title"]').text()).toBe(
        "Chat History",
      );
    });

    it("should close the drawer when update:open is emitted with false", async () => {
      (wrapper.vm as any).showHistory = true;
      await nextTick();

      const drawer = wrapper.findComponent({ name: "ODrawer" });
      drawer.vm.$emit("update:open", false);
      await nextTick();

      expect((wrapper.vm as any).showHistory).toBe(false);
    });

    it("should render the chat history items inside the drawer slot", async () => {
      (wrapper.vm as any).chatHistory = [
        { id: 1, title: "Alpha", timestamp: Date.now(), model: "gpt-4" },
        { id: 2, title: "Beta", timestamp: Date.now(), model: "gpt-4" },
      ];
      (wrapper.vm as any).showHistory = true;
      await nextTick();

      const body = wrapper.find('[data-test="o-drawer-body"]');
      expect(body.exists()).toBe(true);
      expect(body.text()).toContain("Alpha");
      expect(body.text()).toContain("Beta");
    });
  });

  // ── Migration: ODialog (Edit Title) ──────────────────────────────────────
  describe("edit title dialog (ODialog)", () => {
    beforeEach(() => {
      wrapper = mountO2AIChat({ isOpen: true });
    });

    function findEditTitleDialog() {
      return wrapper
        .findAllComponents({ name: "ODialog" })
        .find((d) => d.props("title") === "Edit Chat Title");
    }

    it("should not render the edit title dialog when showEditTitleDialog is false", async () => {
      (wrapper.vm as any).showEditTitleDialog = false;
      await nextTick();

      const dialog = findEditTitleDialog();
      // ODialog stub is always in the tree but only renders its body when open=true.
      expect(dialog?.props("open")).toBe(false);
      expect(wrapper.find('[data-test="o-dialog"]').exists()).toBe(false);
    });

    it("should render the edit title dialog with primary/secondary button labels", async () => {
      (wrapper.vm as any).showEditTitleDialog = true;
      await nextTick();

      const dialog = findEditTitleDialog();
      expect(dialog).toBeDefined();
      expect(dialog!.props("primaryButtonLabel")).toBe("Save");
      expect(dialog!.props("secondaryButtonLabel")).toBe("Cancel");
      expect(dialog!.props("size")).toBe("sm");
    });

    it("should call saveEditedTitle and update title when click:primary is emitted", async () => {
      (wrapper.vm as any).currentChatId = 11;
      (wrapper.vm as any).editingTitle = "Brand New Title";
      (wrapper.vm as any).showEditTitleDialog = true;
      mockUpdateChatTitle.mockResolvedValueOnce(true);
      await nextTick();

      const dialog = findEditTitleDialog();
      expect(dialog).toBeDefined();
      dialog!.vm.$emit("click:primary");
      await flushPromises();

      expect(mockUpdateChatTitle).toHaveBeenCalledWith(11, "Brand New Title");
      expect((wrapper.vm as any).showEditTitleDialog).toBe(false);
    });

    it("should close the dialog without calling updateChatTitle when click:secondary is emitted", async () => {
      (wrapper.vm as any).currentChatId = 11;
      (wrapper.vm as any).editingTitle = "Whatever";
      (wrapper.vm as any).showEditTitleDialog = true;
      await nextTick();

      const dialog = findEditTitleDialog();
      expect(dialog).toBeDefined();
      dialog!.vm.$emit("click:secondary");
      await nextTick();

      expect((wrapper.vm as any).showEditTitleDialog).toBe(false);
      expect(mockUpdateChatTitle).not.toHaveBeenCalled();
    });

    it("should close the dialog when update:open is emitted with false", async () => {
      (wrapper.vm as any).showEditTitleDialog = true;
      await nextTick();

      const dialog = findEditTitleDialog();
      dialog!.vm.$emit("update:open", false);
      await nextTick();

      expect((wrapper.vm as any).showEditTitleDialog).toBe(false);
    });
  });

  // ── Migration: ODialog (Image Preview) ───────────────────────────────────
  describe("image preview dialog (ODialog)", () => {
    beforeEach(() => {
      wrapper = mountO2AIChat({ isOpen: true });
    });

    function findImagePreviewDialog() {
      // The image preview dialog has no primary/secondary labels.
      return wrapper
        .findAllComponents({ name: "ODialog" })
        .find(
          (d) =>
            d.props("size") === "lg" &&
            d.props("primaryButtonLabel") === undefined,
        );
    }

    it("should not render the image preview dialog when showImagePreview is false", async () => {
      (wrapper.vm as any).showImagePreview = false;
      await nextTick();

      const dialog = findImagePreviewDialog();
      // ODialog stub is always in the tree but only renders its body when open=true.
      expect(dialog?.props("open")).toBe(false);
    });

    it("should render the dialog with previewImage filename as the title", async () => {
      (wrapper.vm as any).previewImage = {
        filename: "screenshot.png",
        mimeType: "image/png",
        data: "AAAA",
      };
      (wrapper.vm as any).showImagePreview = true;
      await nextTick();

      const dialog = findImagePreviewDialog();
      expect(dialog).toBeDefined();
      expect(dialog!.props("title")).toBe("screenshot.png");
      expect(dialog!.props("size")).toBe("lg");
    });

    it("should clear preview state when update:open is emitted with false", async () => {
      (wrapper.vm as any).previewImage = {
        filename: "foo.png",
        mimeType: "image/png",
        data: "ZZ",
      };
      (wrapper.vm as any).showImagePreview = true;
      await nextTick();

      const dialog = findImagePreviewDialog();
      expect(dialog).toBeDefined();
      dialog!.vm.$emit("update:open", false);
      await nextTick();

      // closeImagePreview should have run
      expect((wrapper.vm as any).showImagePreview).toBe(false);
      expect((wrapper.vm as any).previewImage).toBeNull();
    });

    it("should render the image element inside the dialog body when previewImage is set", async () => {
      (wrapper.vm as any).previewImage = {
        filename: "diag.jpg",
        mimeType: "image/jpeg",
        data: "BASE64",
      };
      (wrapper.vm as any).showImagePreview = true;
      await nextTick();

      const img = wrapper.find('[data-test="o-dialog-body"] img');
      expect(img.exists()).toBe(true);
      expect(img.attributes("src")).toBe("data:image/jpeg;base64,BASE64");
      expect(img.attributes("alt")).toBe("diag.jpg");
    });
  });

  describe("org-switch watcher", () => {
    it("should call loadHistory when selectedOrganization.identifier changes and isOpen is true", async () => {
      wrapper = mountO2AIChat({ isOpen: true });
      await flushPromises();

      mockLoadHistory.mockClear();
      mockLoadHistory.mockResolvedValue([]);

      // Simulate an org switch via the store mutation
      store.commit("setSelectedOrganization", {
        label: "New Org",
        id: 999,
        identifier: "new-org",
        user_email: "example@gmail.com",
        subscription_type: "",
      });

      await nextTick();
      await flushPromises();

      expect(mockLoadHistory).toHaveBeenCalled();
    });

    it("should reset chatMessages on org switch regardless of isOpen", async () => {
      wrapper = mountO2AIChat({ isOpen: false });
      await flushPromises();

      (wrapper.vm as any).chatMessages = [{ role: "user", content: "test" }];
      await nextTick();

      store.commit("setSelectedOrganization", {
        label: "Another Org",
        id: 888,
        identifier: "another-org",
        user_email: "example@gmail.com",
        subscription_type: "",
      });

      await nextTick();
      await flushPromises();

      expect((wrapper.vm as any).chatMessages).toHaveLength(0);

      // Restore original org for subsequent tests
      store.commit("setSelectedOrganization", {
        label: "default Organization",
        id: 159,
        identifier: "default",
        user_email: "example@gmail.com",
        subscription_type: "",
      });
    });
  });
});
