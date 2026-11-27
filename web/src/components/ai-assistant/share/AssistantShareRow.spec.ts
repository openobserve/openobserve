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

import type { ShareView } from "@/services/ai_chat_share";

import AssistantShareRow from "./AssistantShareRow.vue";

const { api, copy, toast, breakpoint } = vi.hoisted(() => ({
  api: { update: vi.fn(), revoke: vi.fn() },
  copy: vi.fn(),
  toast: vi.fn(),
  breakpoint: { mdUp: true },
}));

vi.mock("@/services/ai_chat_share", () => ({ default: api }));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: copy }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast }));
vi.mock("@/services/assistantAnalytics", () => ({ trackAssistant: vi.fn() }));
vi.mock("@/composables/useBreakpoint", async () => {
  const { ref } = await import("vue");
  return { default: () => ({ mdUp: ref(breakpoint.mdUp) }) };
});

const share = (over: Partial<ShareView> = {}): ShareView => ({
  id: "s1",
  token: "tok",
  url_path: "/web/ai/public/tok",
  mode: "snapshot",
  visibility: "public",
  snapshot_seq: 3,
  expires_at: 1_900_000_000_000_000,
  created_at: 1,
  updated_at: 1,
  access_count: 2,
  last_accessed_at: null,
  session_id: "c1",
  title: "Checkout 5xx",
  redact_tools: true,
  ...over,
});

const row = (over: Partial<ShareView> = {}, props: Record<string, unknown> = {}) =>
  mount(AssistantShareRow, {
    props: { org: "default", share: share(over), publicMaxExpiryDays: 30, ...props },
    attachTo: document.body,
  });

const at = (wrapper: ReturnType<typeof row>, id: string) =>
  wrapper.find(`[data-test="assistant-share-manager-row-${id}"]`);

enableAutoUnmount(afterEach);

beforeEach(() => {
  breakpoint.mdUp = true;
  api.update.mockResolvedValue({ data: share() });
  api.revoke.mockResolvedValue({ data: { revoked: true } });
  copy.mockResolvedValue(true);
});

afterEach(() => vi.clearAllMocks());

describe("AssistantShareRow", () => {
  it("names every action for its chat and shows views", () => {
    const wrapper = row();
    expect(at(wrapper, "copy").attributes("aria-label")).toBe("Copy link for Checkout 5xx");
    expect(at(wrapper, "views").text()).toBe("2 views");
    expect(at(wrapper, "refresh").exists()).toBe(true);
  });

  it("offers only Revoke on another owner's link, which carries no token", () => {
    const wrapper = row({ token: undefined, url_path: undefined, owner_name: "Priya" });
    expect(at(wrapper, "copy").exists()).toBe(false);
    expect(at(wrapper, "revoke").exists()).toBe(true);
    expect(wrapper.text()).toContain("Shared by Priya");
    expect(wrapper.html()).not.toContain("tok");
  });

  it("asks before showing tool data to anyone with a public link", async () => {
    const wrapper = row();
    await at(wrapper, "tools").trigger("click");
    expect(api.update).not.toHaveBeenCalled();
    expect(at(wrapper, "confirm").text()).toContain(
      "Show tool inputs and outputs to anyone with this link?",
    );
    await at(wrapper, "confirm-yes").trigger("click");
    await flushPromises();
    expect(api.update).toHaveBeenCalledWith("default", "s1", { redact_tools: false });
  });

  it("hides tool data again without a confirm", async () => {
    const wrapper = row({ redact_tools: false });
    await at(wrapper, "tools").trigger("click");
    await flushPromises();
    expect(api.update).toHaveBeenCalledWith("default", "s1", { redact_tools: true });
  });

  it("blocks Update snapshot while the chat answers", () => {
    const wrapper = row({}, { running: true });
    expect(at(wrapper, "refresh").attributes("aria-disabled")).toBe("true");
    expect(at(wrapper, "refresh").text()).toContain("Wait for the answer to finish");
  });

  it("revokes after the inline confirm and announces it; failure keeps the row with Retry", async () => {
    const wrapper = row();
    await at(wrapper, "revoke").trigger("click");
    await at(wrapper, "confirm-yes").trigger("click");
    await flushPromises();
    expect(api.revoke).toHaveBeenCalledWith("default", "s1");
    expect(wrapper.emitted("announce")?.[0]).toEqual(["assistant.share.revoked"]);

    api.revoke.mockRejectedValue(new Error("down"));
    const failing = row();
    await at(failing, "revoke").trigger("click");
    await at(failing, "confirm-yes").trigger("click");
    await flushPromises();
    expect(String(toast.mock.calls[0][0].message)).toBe("Couldn't revoke the link");
    expect(toast.mock.calls[0][0].action).toBeDefined();
  });

  it("cancels an inline confirm on Escape", async () => {
    const wrapper = row();
    await at(wrapper, "revoke").trigger("click");
    await wrapper.find("li").trigger("keydown", { key: "Escape" });
    expect(at(wrapper, "confirm").exists()).toBe(false);
  });

  it("collapses the actions into a named kebab below md", () => {
    breakpoint.mdUp = false;
    const wrapper = row();
    expect(wrapper.find('[data-test="assistant-share-manager-row-menu"]').exists()).toBe(true);
    expect(at(wrapper, "actions").exists()).toBe(false);
  });
});
