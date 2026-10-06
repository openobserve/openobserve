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
import { defineComponent, h, nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import type { ShareView } from "@/services/ai_chat_share";
import { useChatShareDialog } from "./useChatShareDialog";

const service = vi.hoisted(() => ({
  create: vi.fn(),
  listForChat: vi.fn(),
  listMine: vi.fn(),
  update: vi.fn(),
  revoke: vi.fn(),
  getShared: vi.fn(),
  fork: vi.fn(),
  getPublic: vi.fn(),
}));
vi.mock("@/services/ai_chat_share", () => ({ default: service }));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast }));

const copyToClipboard = vi.hoisted(() => vi.fn());
vi.mock("@/utils/clipboard", () => ({ copyToClipboard }));

const t = ((key: string) => key) as any;

const share = (extra: Partial<ShareView> = {}): ShareView => ({
  id: "sh1",
  token: "tok1",
  url_path: "/web/ai/shared/tok1?org_identifier=org1",
  mode: "snapshot",
  visibility: "org",
  snapshot_seq: 4,
  expires_at: null,
  created_at: 1,
  updated_at: 1,
  access_count: 0,
  last_accessed_at: null,
  session_id: "sess-1",
  title: "Chat",
  ...extra,
});

function setup(opts: { publicEnabled?: boolean; open?: boolean } = {}) {
  const open = ref(opts.open ?? true);
  const publicEnabled = ref(opts.publicEnabled ?? false);
  let api!: ReturnType<typeof useChatShareDialog>;
  const Host = defineComponent({
    setup() {
      api = useChatShareDialog({
        orgId: ref("org1"),
        sessionId: ref("sess-1"),
        open,
        publicEnabled,
        t,
      });
      return () => h("div");
    },
  });
  const wrapper = mount(Host);
  return { wrapper, open, publicEnabled, api: () => api };
}

describe("useChatShareDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.listForChat.mockResolvedValue({ data: { shares: [share()] } });
  });

  it("loads the chat's active shares while open", async () => {
    const { api } = setup();
    await flushPromises();
    expect(service.listForChat).toHaveBeenCalledWith("org1", "sess-1");
    expect(api().shares.value.map((s) => s.id)).toEqual(["sh1"]);
  });

  it("does not fetch shares while closed", async () => {
    setup({ open: false });
    await flushPromises();
    expect(service.listForChat).not.toHaveBeenCalled();
  });

  it("creates with the form's request and exposes the resulting link", async () => {
    const created = share({ id: "sh2", visibility: "org", mode: "live" });
    service.create.mockResolvedValue({ data: created });
    const { api } = setup();
    api().form.mode = "live";
    api().form.expiresInSecs = 86400;
    await api().create();
    expect(service.create).toHaveBeenCalledWith("org1", "sess-1", {
      mode: "live",
      visibility: "org",
      expires_in_secs: 86400,
    });
    expect(api().createdShare.value?.id).toBe("sh2");
    expect(api().createdLink.value).toContain("ai/shared/tok1?org_identifier=org1");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
  });

  it("downgrades a public choice to org when public links turn off", async () => {
    const { api, publicEnabled } = setup({ publicEnabled: true });
    expect(api().visibilityOptions.value).toEqual(["org", "public"]);
    api().form.visibility = "public";
    publicEnabled.value = false;
    await nextTick();
    expect(api().form.visibility).toBe("org");
    expect(api().visibilityOptions.value).toEqual(["org"]);
  });

  it("shows the server's message when creation fails", async () => {
    service.create.mockRejectedValue({
      response: { status: 400, data: { message: "chat has no committed events" } },
    });
    const { api } = setup();
    expect(await api().create()).toBeNull();
    expect(toast).toHaveBeenCalledWith({
      variant: "error",
      message: "chat has no committed events",
    });
    expect(api().createdShare.value).toBeNull();
  });

  it("resets the form each time the dialog opens", async () => {
    service.create.mockResolvedValue({ data: share() });
    const { api, open } = setup();
    api().form.mode = "live";
    await api().create();
    open.value = false;
    await nextTick();
    open.value = true;
    await nextTick();
    expect(api().form.mode).toBe("snapshot");
    expect(api().createdShare.value).toBeNull();
  });

  it("refreshes a snapshot, switches mode and revokes by share id", async () => {
    service.update.mockResolvedValue({ data: share({ mode: "live" }) });
    service.revoke.mockResolvedValue({ data: { revoked: true } });
    const { api } = setup();
    await api().refreshSnapshot(share());
    expect(service.update).toHaveBeenLastCalledWith("org1", "sh1", { refresh_snapshot: true });
    await api().switchMode(share({ mode: "snapshot" }));
    expect(service.update).toHaveBeenLastCalledWith("org1", "sh1", { mode: "live" });
    await api().revoke(share());
    expect(service.revoke).toHaveBeenCalledWith("org1", "sh1");
    expect(api().pendingShareId.value).toBeNull();
  });

  it("clears the created link when that share is revoked", async () => {
    service.create.mockResolvedValue({ data: share() });
    service.revoke.mockResolvedValue({ data: { revoked: true } });
    const { api } = setup();
    await api().create();
    await api().revoke(share());
    expect(api().createdShare.value).toBeNull();
  });

  it("copies the absolute link", async () => {
    const { api } = setup();
    await api().copyLink(share({ url_path: "/web/ai/public/abc" }));
    expect(copyToClipboard).toHaveBeenCalledWith(expect.stringMatching(/ai\/public\/abc$/), t);
  });
});
