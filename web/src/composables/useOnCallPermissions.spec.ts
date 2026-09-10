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
import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";

import store from "@/test/unit/helpers/store";

import { resetOnCallPermissions, useOnCallPermissions } from "./useOnCallPermissions";
import type { OnCallPermissions } from "./useOnCallPermissions";

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

describe("useOnCallPermissions", () => {
  beforeEach(() => {
    resetOnCallPermissions();
    store.state.userInfo = { email: "example@gmail.com" } as any;
  });

  it("renders configuration controls optimistically, with no role check", () => {
    const { perms, unmount } = host();

    expect(perms.canConfigure.value).toBe(true);
    unmount();
  });

  /// The only authoritative answer the frontend ever gets.
  it("latches closed after a configuration write is denied", async () => {
    const { perms, unmount } = host();
    expect(perms.canConfigure.value).toBe(true);

    perms.noteConfigurationDenied({ response: { status: 403 } });
    await flushPromises();

    expect(perms.canConfigure.value).toBe(false);
    unmount();
  });

  it("ignores a non-permission failure", () => {
    const { perms, unmount } = host();

    perms.noteConfigurationDenied({ response: { status: 500 } });

    expect(perms.canConfigure.value).toBe(true);
    unmount();
  });

  it("shares the denial across screens mounted in the same org", () => {
    const a = host();
    a.perms.noteConfigurationDenied({ response: { status: 403 } });

    const b = host();

    expect(b.perms.canConfigure.value).toBe(false);
    a.unmount();
    b.unmount();
  });
});
