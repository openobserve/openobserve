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
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import { queryClient } from "@/composables/query/queryClient";

const service = vi.hoisted(() => ({
  listMine: vi.fn(),
  listAll: vi.fn(),
  update: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("@/services/ai_chat_share", () => ({ default: service }));
const users = vi.hoisted(() => ({ orgUsers: vi.fn() }));
vi.mock("@/services/users", () => ({ default: users }));

import AiChatSharedByMe from "./AiChatSharedByMe.vue";

const share = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  token: `tok-${id}`,
  url_path: `/web/ai/shared/tok-${id}?org_identifier=org1`,
  mode: "snapshot",
  visibility: "org",
  snapshot_seq: 1,
  expires_at: null,
  created_at: 1,
  updated_at: 1,
  access_count: 0,
  last_accessed_at: null,
  session_id: "s",
  title: `Chat ${id}`,
  redact_tools: false,
  ...extra,
});

function mountDrawer(isOrgAdmin?: boolean, loginRole = "") {
  const store = createStore({
    state: {
      selectedOrganization: { identifier: "org1" },
      userInfo: { email: "me@example.com", role: loginRole },
      zoConfig: isOrgAdmin === undefined ? {} : { is_org_admin: isOrgAdmin },
      theme: "light",
    },
  });
  return mount(AiChatSharedByMe, {
    props: { open: true },
    global: { plugins: [store] },
    attachTo: document.body,
  });
}

const q = (sel: string) => document.body.querySelector(`[data-test="${sel}"]`);

describe("AiChatSharedByMe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    document.body.innerHTML = "";
    service.listMine.mockResolvedValue({ data: { shares: [share("mine")] } });
    service.listAll.mockResolvedValue({
      data: {
        shares: [
          share("mine"),
          share("other", { owner_name: "Ada", token: undefined, url_path: undefined }),
        ],
      },
    });
    users.orgUsers.mockResolvedValue({ data: { data: [] } });
  });

  it("hides the org-wide scope from non-admins", async () => {
    const wrapper = mountDrawer(false);
    await flushPromises();
    expect(service.listMine).toHaveBeenCalledWith("org1");
    expect(q("ai-chat-shared-by-me-scope")).toBeNull();
    expect(users.orgUsers).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("falls back to the member list when the server sends no admin flag", async () => {
    users.orgUsers.mockResolvedValue({
      data: { data: [{ email: "ME@example.com", role: "Admin" }] },
    });
    const wrapper = mountDrawer();
    await flushPromises();
    expect(users.orgUsers).toHaveBeenCalledWith("org1");
    expect(q("ai-chat-shared-by-me-scope")).not.toBeNull();
    wrapper.unmount();
  });

  it("lets an admin list every share in the org, read-only apart from revoke", async () => {
    const wrapper = mountDrawer(true);
    await flushPromises();
    expect(q("ai-chat-shared-by-me-scope")).not.toBeNull();
    (q("ai-chat-shared-by-me-scope-all") as HTMLElement).click();
    await flushPromises();
    expect(service.listAll).toHaveBeenCalledWith("org1");
    expect(q("ai-chat-share-row-other")).not.toBeNull();
    expect(q("ai-chat-share-row-owner")?.textContent).toContain("Ada");
    expect(q("ai-chat-share-row-switch-mode")).toBeNull();
    const other = q("ai-chat-share-row-other") as HTMLElement;
    expect(other.querySelector('[data-test="ai-chat-share-row-copy"]')).toBeNull();
    wrapper.unmount();
  });

  it("shows a forbidden state when the server refuses the org-wide list", async () => {
    service.listAll.mockRejectedValue({ response: { status: 403 } });
    const wrapper = mountDrawer(undefined, "root");
    await flushPromises();
    (q("ai-chat-shared-by-me-scope-all") as HTMLElement).click();
    await flushPromises();
    expect(q("ai-chat-shared-by-me-forbidden")).not.toBeNull();
    wrapper.unmount();
  });
});
