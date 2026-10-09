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

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import type { ShareView } from "@/services/ai_chat_share";
import AiChatShareRow from "./AiChatShareRow.vue";

const share = (extra: Partial<ShareView> = {}): ShareView => ({
  id: "sh1",
  token: "tok1",
  url_path: "/web/ai/shared/tok1?org_identifier=org1",
  mode: "snapshot",
  visibility: "public",
  snapshot_seq: 4,
  expires_at: 1_800_000_000_000_000,
  created_at: 1,
  updated_at: 1,
  access_count: 2,
  last_accessed_at: null,
  session_id: "sess-1",
  title: "Chat",
  redact_tools: true,
  ...extra,
});

const find = (wrapper: ReturnType<typeof mount>, id: string) =>
  wrapper.find(`[data-test="ai-chat-share-row-${id}"]`);

describe("AiChatShareRow", () => {
  it("asks inline before revoking, and emits revoke only on confirm", async () => {
    const wrapper = mount(AiChatShareRow, { props: { share: share() } });
    await find(wrapper, "revoke").trigger("click");
    expect(wrapper.emitted("revoke")).toBeUndefined();
    expect(find(wrapper, "revoke-confirm").exists()).toBe(true);

    await find(wrapper, "revoke-cancel").trigger("click");
    expect(find(wrapper, "revoke-confirm").exists()).toBe(false);
    expect(wrapper.emitted("revoke")).toBeUndefined();

    await find(wrapper, "revoke").trigger("click");
    await find(wrapper, "revoke-confirm-btn").trigger("click");
    expect(wrapper.emitted("revoke")).toHaveLength(1);
    expect(find(wrapper, "revoke-confirm").exists()).toBe(false);
  });

  it("confirms before showing tool data on a public link", async () => {
    const wrapper = mount(AiChatShareRow, { props: { share: share() } });
    expect(find(wrapper, "redacted").exists()).toBe(true);
    await find(wrapper, "toggle-redaction").trigger("click");
    expect(wrapper.emitted("toggle-redaction")).toBeUndefined();
    expect(find(wrapper, "show-tools-confirm").exists()).toBe(true);
    await find(wrapper, "show-tools-confirm-btn").trigger("click");
    expect(wrapper.emitted("toggle-redaction")).toHaveLength(1);

    const shown = mount(AiChatShareRow, { props: { share: share({ redact_tools: false }) } });
    expect(find(shown, "redacted").exists()).toBe(false);
    expect(find(shown, "tools-visible").exists()).toBe(true);
  });

  it("toggles redaction at once on an org link, and hiding tools never asks", async () => {
    const org = mount(AiChatShareRow, { props: { share: share({ visibility: "org" }) } });
    await find(org, "toggle-redaction").trigger("click");
    expect(org.emitted("toggle-redaction")).toHaveLength(1);
    expect(find(org, "tools-visible").exists()).toBe(false);

    const shown = mount(AiChatShareRow, { props: { share: share({ redact_tools: false }) } });
    await find(shown, "toggle-redaction").trigger("click");
    expect(shown.emitted("toggle-redaction")).toHaveLength(1);
  });

  it("offers only copy and revoke, with the owner, on the admin list", () => {
    const wrapper = mount(AiChatShareRow, {
      props: { share: share({ owner_name: "Ada" }), showOwner: true, readOnlySettings: true },
    });
    expect(find(wrapper, "owner").text()).toContain("Ada");
    expect(find(wrapper, "copy").exists()).toBe(true);
    expect(find(wrapper, "revoke").exists()).toBe(true);
    expect(find(wrapper, "refresh").exists()).toBe(false);
    expect(find(wrapper, "switch-mode").exists()).toBe(false);
    expect(find(wrapper, "toggle-redaction").exists()).toBe(false);
  });
});
