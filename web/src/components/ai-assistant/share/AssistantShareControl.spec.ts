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

import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { createStore } from "vuex";

import type { AssistantCapability } from "@/composables/assistant/pure";
import type { ShareView } from "@/services/ai_chat_share";

import { fakeAssistant } from "../__tests__/fakeAssistant";
import AssistantShareControl from "./AssistantShareControl.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";

import AssistantShareSettings from "./AssistantShareSettings.vue";
import { resetAttachmentChecks } from "./chatAttachments";
import { isShareDenied, resetShareDenials } from "./useQuickShare";

const { fake, api, copy, toast } = vi.hoisted(() => ({
  fake: { current: null as any },
  api: {
    create: vi.fn(),
    listForChat: vi.fn(),
    update: vi.fn(),
    revoke: vi.fn(),
    chatTurns: vi.fn(),
  },
  copy: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/composables/assistant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/assistant")>();
  return {
    ...actual,
    useAssistantStore: () => fake.current.store,
    useAssistantCapability: () => fake.current.handle,
    useAssistantSession: (sid: () => string) => actual.useAssistantSession(sid, fake.current.store),
  };
});
vi.mock("@/services/ai_chat_share", () => ({ default: api }));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: copy }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast }));
vi.mock("@/services/assistantAnalytics", () => ({ trackAssistant: vi.fn() }));

const share = (over: Partial<ShareView> = {}): ShareView => ({
  id: "s1",
  token: "tok",
  url_path: "/web/ai/shared/tok?org_identifier=default",
  mode: "snapshot",
  visibility: "org",
  snapshot_seq: 3,
  expires_at: null,
  created_at: 1,
  updated_at: 1_700_000_000_000_000,
  access_count: 0,
  last_accessed_at: null,
  session_id: "c1",
  title: "Checkout",
  redact_tools: true,
  ...over,
});

function vuex(zoConfig: Record<string, unknown> = {}) {
  return createStore({
    state: { selectedOrganization: { identifier: "default", label: "Acme" }, zoConfig },
  });
}

function chat(opts: { turns?: boolean; running?: boolean; chips?: boolean } = {}) {
  const store = fake.current.store;
  const sid = store.createSession({
    origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
  });
  const session = store.state.sessions[sid];
  if (opts.turns !== false) {
    session.messages = [
      { role: "user", content: "why", ...(opts.chips && { chips: [{ id: "x" }] }) },
      { role: "assistant", content: "because" },
    ];
  }
  session.turn = opts.running ? { state: "responding.writing" } : { state: "idle" };
  return sid;
}

async function setup(
  over: Partial<AssistantCapability> = {},
  opts: Parameters<typeof chat>[0] & {
    shares?: ShareView[];
    zoConfig?: Record<string, unknown>;
  } = {},
) {
  fake.current = fakeAssistant("available", over);
  api.listForChat.mockResolvedValue({ data: { shares: opts.shares ?? [] } });
  const sid = chat(opts);
  const wrapper = mount(AssistantShareControl, {
    props: { sid, variant: "header" },
    global: { plugins: [vuex(opts.zoConfig)] },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrapper, sid, button: () => wrapper.find('[data-test="assistant-thread-share"]') };
}

enableAutoUnmount(afterEach);

beforeEach(() => {
  api.create.mockResolvedValue({ data: share() });
  api.update.mockResolvedValue({ data: share() });
  api.revoke.mockResolvedValue({ data: { revoked: true } });
  copy.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
  resetShareDenials();
  resetAttachmentChecks();
});

// The menu item needs a menu around it; a history row's chat has no session.
async function setupMenu(
  opts: Parameters<typeof chat>[0] & { row?: boolean; zoConfig?: Record<string, unknown> } = {},
) {
  fake.current = fakeAssistant("available", {});
  api.listForChat.mockResolvedValue({ data: { shares: [] } });
  const sid = opts.row ? "0190a1b2-c3d4-7e5f-8a9b-00000000r0w1" : chat(opts);
  const onSettings = vi.fn();
  const wrapper = mount(ODropdown, {
    props: { open: true },
    slots: {
      trigger: "<button>Open</button>",
      default: {
        render: () => h(AssistantShareControl, { sid, variant: "menu-item", onSettings }),
      },
    },
    global: { plugins: [vuex(opts.zoConfig)] },
    attachTo: document.body,
  });
  await flushPromises();
  const item = () =>
    document.querySelector<HTMLElement>('[data-test="assistant-thread-menu-share"]');
  return { wrapper, onSettings, item };
}

describe("AssistantShareControl menu item", () => {
  it.each([
    ["a chat with attachments", { chips: true }],
    ["a history row whose chat isn't loaded", { row: true }],
    ["a plain chat", {}],
  ])("asks the shell for the Share surface on %s and never posts", async (_label, opts) => {
    const { onSettings, item } = await setupMenu(opts);
    expect(item()?.textContent?.trim()).toBe("Share…");
    item()?.click();
    await flushPromises();
    expect(api.create).not.toHaveBeenCalled();
    expect(onSettings).toHaveBeenCalledTimes(1);
  });
});

describe("AssistantShareControl drawer", () => {
  it("opens the same Share chat form through its model, and creates only on confirm", async () => {
    fake.current = fakeAssistant("available", {});
    api.listForChat.mockResolvedValue({ data: { shares: [] } });
    const sid = chat();
    const wrapper = mount(AssistantShareControl, {
      props: { sid, variant: "drawer", open: true },
      global: { plugins: [vuex()] },
      attachTo: document.body,
    });
    await flushPromises();
    expect(document.querySelector('[data-test="assistant-share-settings"]')).not.toBeNull();
    expect(api.create).not.toHaveBeenCalled();
    (document.querySelector('[data-test="assistant-share-create"]') as HTMLElement).click();
    await flushPromises();
    expect(api.create).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});

describe("AssistantShareControl", () => {
  it("renders nothing without persistence (G5)", async () => {
    const { wrapper } = await setup({ persistence: false });
    expect(wrapper.find('[data-test="assistant-share-control"]').exists()).toBe(false);
  });

  it("keeps Share focusable but unavailable for G3, with the reason, and never posts", async () => {
    const { button } = await setup({ canShare: "no" });
    expect(button().attributes("aria-disabled")).toBe("true");
    expect(button().text()).toContain("Only admins can share chats");
    await button().trigger("click");
    expect(api.create).not.toHaveBeenCalled();
  });

  it("is unavailable before the chat has an answer", async () => {
    const { button } = await setup({}, { turns: false });
    expect(button().attributes("aria-disabled")).toBe("true");
    expect(button().text()).toContain("Send a message first");
  });

  it("opens while an answer runs with only Live available, and creates a live link", async () => {
    const { button } = await setup({}, { running: true });
    expect(button().attributes("aria-disabled")).toBeUndefined();
    await button().trigger("click");
    await flushPromises();
    const snapshot = document.querySelector('[data-test="assistant-share-mode-snapshot"]');
    expect(
      snapshot?.hasAttribute("disabled") || snapshot?.getAttribute("data-disabled") === "",
    ).toBe(true);
    expect(document.querySelector('[data-test="assistant-share-settings"]')?.textContent).toContain(
      "Available when the answer finishes",
    );
    const create = document.querySelector('[data-test="assistant-share-create"]') as HTMLElement;
    expect(create.textContent?.trim()).toBe("Create live link and copy");
    create.click();
    await flushPromises();
    expect(api.create.mock.calls[0][2]).toMatchObject({ mode: "live" });
  });

  it("keeps an existing link's Copy and Revoke reachable while an answer runs", async () => {
    const { button } = await setup({}, { running: true, shares: [share()] });
    expect(button().attributes("aria-disabled")).toBeUndefined();
    await button().trigger("click");
    await flushPromises();
    expect(document.querySelector('[data-test="assistant-share-copy"]')).not.toBeNull();
    expect(document.querySelector('[data-test="assistant-share-revoke"]')).not.toBeNull();
    expect(
      document
        .querySelector('[data-test="assistant-share-update-snapshot"]')
        ?.getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("creates a second link for another audience beside an existing one, without revoking", async () => {
    api.create.mockResolvedValue({ data: share({ id: "s2", visibility: "public" }) });
    const { button } = await setup(
      { publicLinks: true, publicMaxExpiryDays: 30 },
      { shares: [share()] },
    );
    await button().trigger("click");
    await flushPromises();
    (document.querySelector('[data-test="assistant-share-new-link"]') as HTMLElement).click();
    await flushPromises();
    expect(document.querySelector('[data-test="assistant-share-copy"]')).toBeNull();
    expect(document.querySelector('[data-test="assistant-share-new-cancel"]')).not.toBeNull();
    (
      document.querySelector('[data-test="assistant-share-visibility-public"]') as HTMLElement
    ).click();
    await flushPromises();
    (document.querySelector('[data-test="assistant-share-create"]') as HTMLElement).click();
    await flushPromises();
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.create.mock.calls[0][2]).toMatchObject({ visibility: "public" });
    expect(api.revoke).not.toHaveBeenCalled();
    expect(document.querySelector('[data-test="assistant-share-copy"]')).not.toBeNull();
    expect(button().attributes("aria-label")).toBe("Shared with anyone who has the link");
  });

  it("goes back to the existing link from Create another link's Cancel", async () => {
    const { button } = await setup({}, { shares: [share()] });
    await button().trigger("click");
    await flushPromises();
    (document.querySelector('[data-test="assistant-share-new-link"]') as HTMLElement).click();
    await flushPromises();
    (document.querySelector('[data-test="assistant-share-new-cancel"]') as HTMLElement).click();
    await flushPromises();
    expect(document.querySelector('[data-test="assistant-share-copy"]')).not.toBeNull();
    expect(api.create).not.toHaveBeenCalled();
  });

  it("opens Share chat with the defaults visible and creates nothing until Create and copy link", async () => {
    const { button } = await setup();
    await button().trigger("click");
    await flushPromises();
    expect(api.create).not.toHaveBeenCalled();
    const form = document.querySelector('[data-test="assistant-share-settings"]');
    expect(form).not.toBeNull();
    expect(form?.textContent).toContain("People in Acme with shared-chat access can read it.");
    expect(form?.textContent).toContain("Continuing it in their own chats also needs AI access.");
    expect(form?.textContent).toContain("Snapshot of the chat as it is now");
    const create = document.querySelector('[data-test="assistant-share-create"]') as HTMLElement;
    expect(create.textContent?.trim()).toBe("Create and copy link");
    create.click();
    await flushPromises();
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.create.mock.calls[0][2]).toEqual({
      mode: "snapshot",
      visibility: "org",
      redact_tools: true,
      expires_in_secs: 90 * 86_400,
    });
  });

  it("collapses Share to its icon in a narrow header, keeping the label for assistive tech", async () => {
    const { button } = await setup();
    const label = button().get('[data-test="assistant-thread-share-label"]');
    expect(label.text()).toBe("Share");
    expect(label.classes()).toContain("@max-[32rem]:sr-only");
  });

  it("reads Shared once a link exists and opens it in the popover, with All shared links", async () => {
    const { button, wrapper } = await setup({}, { shares: [share()] });
    expect(button().text()).toContain("Shared");
    expect(button().attributes("aria-label")).toBe("Shared with your organization");
    expect(wrapper.find('[data-test="assistant-thread-share-chip"]').exists()).toBe(false);
    await button().trigger("click");
    await flushPromises();
    expect(api.create).not.toHaveBeenCalled();
    expect(document.querySelector('[data-test="assistant-share-copy"]')).not.toBeNull();
    const all = document.querySelector('[data-test="assistant-share-see-all"]') as HTMLElement;
    expect(all.textContent?.trim()).toBe("All shared links");
    all.click();
    await flushPromises();
    expect(wrapper.emitted("manage")).toHaveLength(1);
  });

  it("reviews a chat with attachments before any request when the server cannot hide them", async () => {
    const { button } = await setup({ publicLinks: true, publicMaxExpiryDays: 30 }, { chips: true });
    await button().trigger("click");
    await flushPromises();
    expect(api.create).not.toHaveBeenCalled();
    expect(
      document.querySelector('[data-test="assistant-share-attachments-included"]'),
    ).not.toBeNull();
    expect(document.querySelector('[data-test="assistant-share-hide-attachments"]')).toBeNull();
    const publicRadio = document.querySelector('[data-test="assistant-share-visibility-public"]');
    expect(
      publicRadio?.hasAttribute("disabled") || publicRadio?.getAttribute("data-disabled") === "",
    ).toBe(true);
    (document.querySelector('[data-test="assistant-share-create"]') as HTMLElement).click();
    await flushPromises();
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.create.mock.calls[0][2]).not.toHaveProperty("hide_attachments");
  });

  it("shows the new link for copying when the clipboard refuses, never a second create form", async () => {
    copy.mockResolvedValue(false);
    const { button } = await setup();
    await button().trigger("click");
    await flushPromises();
    (document.querySelector('[data-test="assistant-share-create"]') as HTMLElement).click();
    await flushPromises();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(document.querySelector('[data-test="assistant-share-link"]')).not.toBeNull();
    expect(document.querySelector('[data-test="assistant-share-create"]')).toBeNull();
    expect(button().text()).toContain("Shared");
  });

  it("flips to the G3 state after the server refuses a create", async () => {
    const { button } = await setup({ canShare: "unknown" });
    api.create.mockRejectedValue({ response: { status: 403, data: {} } });
    await button().trigger("click");
    await flushPromises();
    (document.querySelector('[data-test="assistant-share-create"]') as HTMLElement).click();
    await flushPromises();
    expect(button().attributes("aria-disabled")).toBe("true");
    expect(button().text()).toContain("Only admins can share chats");
  });
});

describe("AssistantShareSettings", () => {
  const props = (over: Record<string, unknown> = {}) => ({
    org: "default",
    sid: "c1",
    share: share(),
    running: false,
    publicLinks: true,
    publicMaxExpiryDays: 30,
    redactAttachments: false,
    hasAttachments: false,
    ...over,
  });
  const mountSettings = (over: Record<string, unknown> = {}) => {
    fake.current = fakeAssistant();
    return mount(AssistantShareSettings, { props: props(over), attachTo: document.body });
  };
  const at = (wrapper: ReturnType<typeof mountSettings>, id: string) =>
    wrapper.find(`[data-test="${id}"]`);

  it("applies every change live, with no Done button", async () => {
    const wrapper = mountSettings();
    await at(wrapper, "assistant-share-mode-live").trigger("click");
    await flushPromises();
    expect(api.update).toHaveBeenCalledWith("default", "s1", { mode: "live" });
    expect(wrapper.text()).not.toContain("Done");
  });

  it("asks once before showing tool data on a public link, and never on an org link", async () => {
    const pub = mountSettings({ share: share({ visibility: "public" }) });
    await at(pub, "assistant-share-redact-tools").trigger("click");
    await flushPromises();
    expect(api.update).not.toHaveBeenCalled();
    expect(at(pub, "assistant-share-show-tools-confirm").exists()).toBe(true);
    await at(pub, "assistant-share-show-tools-confirm-show").trigger("click");
    await flushPromises();
    expect(api.update).toHaveBeenCalledWith("default", "s1", { redact_tools: false });
    pub.unmount();
    api.update.mockClear();
    const org = mountSettings();
    await at(org, "assistant-share-redact-tools").trigger("click");
    await flushPromises();
    expect(at(org, "assistant-share-show-tools-confirm").exists()).toBe(false);
    expect(api.update).toHaveBeenCalledWith("default", "s1", { redact_tools: false });
  });

  it("keeps redaction across visibility switches in create mode", async () => {
    const wrapper = mountSettings({ share: null });
    const redact = () =>
      at(wrapper, "assistant-share-redact-tools").find("button, [role=checkbox]");
    expect(redact().attributes("aria-checked") ?? redact().attributes("data-state")).toMatch(
      /true|checked/,
    );
    await at(wrapper, "assistant-share-visibility-public").trigger("click");
    await at(wrapper, "assistant-share-visibility-org").trigger("click");
    expect(redact().attributes("aria-checked") ?? redact().attributes("data-state")).toMatch(
      /true|checked/,
    );
  });

  it("blocks Update snapshot while a turn runs", async () => {
    const wrapper = mountSettings({ running: true });
    const button = at(wrapper, "assistant-share-update-snapshot");
    expect(button.attributes("aria-disabled")).toBe("true");
    expect(button.text()).toContain("Finish or stop the answer first");
    await button.trigger("click");
    expect(api.update).not.toHaveBeenCalled();
  });

  it("revokes only after the inline confirm", async () => {
    const wrapper = mountSettings();
    await at(wrapper, "assistant-share-revoke").trigger("click");
    expect(api.revoke).not.toHaveBeenCalled();
    await at(wrapper, "assistant-share-revoke-confirm-revoke").trigger("click");
    await flushPromises();
    expect(api.revoke).toHaveBeenCalledWith("default", "s1");
    expect(wrapper.emitted("revoked")).toHaveLength(1);
    expect(wrapper.emitted("announce")?.[0]).toEqual(["assistant.share.revoked"]);
  });

  it("restores the link and offers Retry when revoke fails", async () => {
    api.revoke.mockRejectedValue(new Error("down"));
    const wrapper = mountSettings();
    await at(wrapper, "assistant-share-revoke").trigger("click");
    await at(wrapper, "assistant-share-revoke-confirm-revoke").trigger("click");
    await flushPromises();
    expect(wrapper.emitted("revoked")).toBeUndefined();
    expect(String(toast.mock.calls[0][0].message)).toBe("Couldn't revoke the link");
  });

  it("offers no public option when public links are off, and says so", () => {
    const wrapper = mountSettings({ share: null, publicLinks: false });
    expect(at(wrapper, "assistant-share-visibility-public").exists()).toBe(false);
    expect(at(wrapper, "assistant-share-public-off").text()).toBe(
      "Public links are turned off for this deployment.",
    );
  });

  it("says why visibility is fixed on an existing link", () => {
    const wrapper = mountSettings();
    expect(at(wrapper, "assistant-share-visibility-fixed").text()).toBe(
      "To change who can open it, create a new link.",
    );
    expect(
      mountSettings({ share: null })
        .find('[data-test="assistant-share-visibility-fixed"]')
        .exists(),
    ).toBe(false);
  });

  it("shows a changed expiry as its own date and never as Never", () => {
    const createdAt = 1_700_000_000_000_000;
    const wrapper = mountSettings({
      share: share({ created_at: createdAt, expires_at: createdAt + 5 * 3_600 * 1_000_000 }),
    });
    expect(at(wrapper, "assistant-share-expiry").text()).toMatch(/Expires \w{3} \d+, \d{4}/);
    expect(at(wrapper, "assistant-share-expiry").text()).not.toContain("Never");
  });

  it("marks the blocked public option disabled for assistive tech too", () => {
    const wrapper = mountSettings({ share: null, hasAttachments: true });
    const option = at(wrapper, "assistant-share-visibility-public").element.closest(
      "[aria-disabled]",
    );
    expect(option?.getAttribute("aria-disabled")).toBe("true");
  });

  it("shows and sends the new link's own expiry after the last link's expiry was changed", async () => {
    const wrapper = mountSettings();
    const select = () => wrapper.findComponent(OSelect);
    select().vm.$emit("update:modelValue", 7 * 86_400);
    await flushPromises();
    expect(api.update).toHaveBeenCalledWith("default", "s1", { expires_in_secs: 7 * 86_400 });
    expect(select().props("modelValue")).toBe(7 * 86_400);
    await wrapper.setProps({ share: null, cancelable: true });
    await flushPromises();
    expect(select().props("modelValue")).toBe(90 * 86_400);
    await at(wrapper, "assistant-share-create").trigger("click");
    await flushPromises();
    expect(api.create.mock.calls[0][2]).toMatchObject({ expires_in_secs: 90 * 86_400 });
  });

  it("creates another link live while an answer runs, never a snapshot", async () => {
    const wrapper = mountSettings({ running: true });
    await wrapper.setProps({ share: null, cancelable: true });
    await flushPromises();
    expect(at(wrapper, "assistant-share-create").text()).toBe("Create live link and copy");
    await at(wrapper, "assistant-share-create").trigger("click");
    await flushPromises();
    expect(api.create.mock.calls[0][2]).toMatchObject({ mode: "live" });
  });

  it("flips Share to the G3 state when Manage link's create is refused", async () => {
    api.create.mockRejectedValue({ response: { status: 403, data: {} } });
    const wrapper = mountSettings({ share: null });
    await at(wrapper, "assistant-share-create").trigger("click");
    await flushPromises();
    expect(isShareDenied("default")).toBe(true);
    expect(String(toast.mock.calls[0][0].message)).toBe(
      "You don't have permission to share chats.",
    );
  });
});
