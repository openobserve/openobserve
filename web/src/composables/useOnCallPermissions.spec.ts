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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";

import store from "@/test/unit/helpers/store";
import usersService from "@/services/users";

import { resetOnCallPermissions, useOnCallPermissions } from "./useOnCallPermissions";
import type { OnCallPermissions } from "./useOnCallPermissions";

vi.mock("@/services/users", () => ({ default: { orgUsers: vi.fn() } }));

const users = vi.mocked(usersService);

/// The composable calls `useStore()`, so it has to run inside a component.
function host(): { perms: OnCallPermissions; unmount: () => void } {
  let perms!: OnCallPermissions;
  const Host = defineComponent({
    setup() {
      perms = useOnCallPermissions();
      return () => h("div");
    },
  });
  const wrapper = mount(Host, { global: { plugins: [store] } });
  return { perms, unmount: () => wrapper.unmount() };
}

function withRole(role: string | undefined) {
  users.orgUsers.mockResolvedValue({
    data: { data: [{ email: "example@gmail.com", role }] },
  } as any);
}

describe("useOnCallPermissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOnCallPermissions();
    store.state.userInfo = { email: "example@gmail.com" } as any;
    users.orgUsers.mockResolvedValue({ data: { data: [] } } as any);
  });

  /// The split RBAC exists so that being woken at 3am and not being allowed to
  /// say "I have it" is impossible. Working a page is never gated.
  it("lets every org member work a page, whatever their role", async () => {
    withRole("viewer");
    const { perms, unmount } = host();
    await flushPromises();

    expect(perms.canRespond.value).toBe(true);
    expect(perms.canConfigure.value).toBe(false);
    unmount();
  });

  it.each(["root", "admin", "editor", "Admin"])(
    "lets %s change configuration",
    async (role) => {
      withRole(role);
      const { perms, unmount } = host();
      await flushPromises();

      expect(perms.canConfigure.value).toBe(true);
      unmount();
    },
  );

  it.each(["viewer", "member", "user", "service_account"])(
    "does not offer configuration to %s",
    async (role) => {
      withRole(role);
      const { perms, unmount } = host();
      await flushPromises();

      expect(perms.canConfigure.value).toBe(false);
      unmount();
    },
  );

  /// A control that is briefly present and then 403s is recoverable; one that
  /// is missing on every load for an admin is not. The server is the real gate.
  it("stays optimistic until the probe answers", () => {
    users.orgUsers.mockReturnValue(new Promise(() => {}) as any);
    const { perms, unmount } = host();

    expect(perms.canConfigure.value).toBe(true);
    expect(perms.permissionsResolved.value).toBe(false);
    unmount();
  });

  it("stays optimistic when the member list itself is unreadable", async () => {
    users.orgUsers.mockRejectedValue({ response: { status: 403 } });
    const { perms, unmount } = host();
    await flushPromises();

    // A 403 on `/users` is not a 403 on on-call.
    expect(perms.canConfigure.value).toBe(true);
    unmount();
  });

  /// The only authoritative answer the frontend ever gets.
  it("latches closed after a configuration write is denied", async () => {
    const { perms, unmount } = host();
    await flushPromises();
    expect(perms.canConfigure.value).toBe(true);

    perms.noteConfigurationDenied({ response: { status: 403 } });
    expect(perms.canConfigure.value).toBe(false);
    unmount();
  });

  it("ignores a non-permission failure", async () => {
    const { perms, unmount } = host();
    await flushPromises();

    perms.noteConfigurationDenied({ response: { status: 500 } });
    expect(perms.canConfigure.value).toBe(true);
    unmount();
  });

  /// Four on-call screens in one session must not ask the same question four
  /// times.
  it("probes the org once and shares the answer", async () => {
    withRole("admin");
    const a = host();
    await flushPromises();
    const b = host();
    await flushPromises();

    expect(users.orgUsers).toHaveBeenCalledTimes(1);
    expect(b.perms.canConfigure.value).toBe(true);
    a.unmount();
    b.unmount();
  });
});
