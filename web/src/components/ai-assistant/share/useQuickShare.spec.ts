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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createStore } from "vuex";

import { isShareDenied, resetShareDenials, useQuickShare, type QuickShare } from "./useQuickShare";

const { api, copy, toast, track } = vi.hoisted(() => ({
  api: { create: vi.fn() },
  copy: vi.fn(),
  toast: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@/services/ai_chat_share", () => ({ default: api }));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: copy }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast }));
vi.mock("@/services/assistantAnalytics", () => ({ trackAssistant: track }));

const created = {
  id: "s1",
  token: "tok",
  url_path: "/web/ai/shared/tok?org_identifier=default",
  mode: "snapshot",
  visibility: "org",
  snapshot_seq: 3,
  expires_at: null,
  created_at: 1,
  updated_at: 1,
  access_count: 0,
  last_accessed_at: null,
  session_id: "c1",
  title: "Checkout",
  redact_tools: true,
};

function setup(zoConfig: Record<string, unknown> = {}): QuickShare {
  let share: QuickShare | null = null;
  const store = createStore({
    state: { selectedOrganization: { identifier: "default", name: "Acme" }, zoConfig },
  });
  mount(
    defineComponent({
      setup() {
        share = useQuickShare();
        return () => h("div");
      },
    }),
    { global: { plugins: [store] } },
  );
  return share as unknown as QuickShare;
}

beforeEach(() => {
  api.create.mockResolvedValue({ data: created });
  copy.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
  resetShareDenials();
});

describe("useQuickShare", () => {
  it("creates an org snapshot with tool data hidden for 90 days and no hide_attachments", async () => {
    const result = await setup().create("default", "c1", { onSettings: vi.fn() });
    expect(api.create).toHaveBeenCalledWith("default", "c1", {
      mode: "snapshot",
      visibility: "org",
      redact_tools: true,
      expires_in_secs: 90 * 86_400,
    });
    expect(result).toMatchObject({ ok: true, copied: true });
    expect(track).toHaveBeenCalledWith("ai_share", {
      action: "create",
      visibility: "org",
      mode: "snapshot",
    });
    const shown = toast.mock.calls[0][0];
    expect(String(shown.message)).toBe(
      "Link copied. People in Acme with shared-chat access can open it.",
    );
    expect(shown.action.dataTest).toBe("assistant-share-toast-settings");
  });

  it("sends hide_attachments only when the server advertises it", async () => {
    await setup({ ai_share_redact_attachments: true }).create("default", "c1");
    expect(api.create.mock.calls[0][2]).toMatchObject({ hide_attachments: true });
  });

  it("keeps the link when the clipboard refuses and never says it was copied", async () => {
    copy.mockResolvedValue(false);
    const result = await setup().create("default", "c1", { onSettings: vi.fn() });
    expect(result).toMatchObject({ ok: true, copied: false });
    expect(result.ok && result.link).toContain("/ai/shared/tok");
    const message = String(toast.mock.calls[0][0].message);
    expect(message).toBe(
      "Link created. Copying was blocked, so the link is shown for you to copy.",
    );
    expect(message).not.toContain("copied");
  });

  it("points a surface without settings to Manage links when the clipboard refuses", async () => {
    copy.mockResolvedValue(false);
    await setup().create("default", "c1");
    const shown = toast.mock.calls[0][0];
    expect(String(shown.message)).toBe(
      "Link created, but copying was blocked. Open Manage links to copy it.",
    );
    expect(shown.action).toBeUndefined();
  });

  it("posts to the chat's own org and names it only when it is the selected one", async () => {
    await setup().create("other", "c1");
    expect(api.create.mock.calls[0][0]).toBe("other");
    expect(String(toast.mock.calls[0][0].message)).toContain("People in other");
  });

  it("posts one link however often Share or Retry fires while a create is in flight", async () => {
    let finish: (value: unknown) => void = () => undefined;
    api.create.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const share = setup();
    const first = share.create("default", "c1");
    const second = await share.create("default", "c1");
    expect(second.ok).toBe(false);
    finish({ data: created });
    await first;
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  it("flips the org to denied on a 403 and never shows the server's text", async () => {
    api.create.mockRejectedValue({
      response: { status: 403, data: { message: "raw server words" } },
    });
    const result = await setup().create("default", "c1");
    await flushPromises();
    expect(result.ok).toBe(false);
    expect(isShareDenied("default")).toBe(true);
    expect(String(toast.mock.calls[0][0].message)).toBe(
      "You don't have permission to share chats.",
    );
    expect(JSON.stringify(toast.mock.calls)).not.toContain("raw server words");
  });

  it("offers Retry on any other failure, once, and leaves the org shareable", async () => {
    api.create.mockRejectedValue({ response: { status: 500, data: {} } });
    await setup().create("default", "c1");
    expect(isShareDenied("default")).toBe(false);
    const retry = toast.mock.calls[0][0].action.handler;
    retry();
    retry();
    await flushPromises();
    expect(api.create).toHaveBeenCalledTimes(2);
  });
});
