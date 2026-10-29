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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createStore } from "vuex";
import organizationService from "@/services/organizations";
import { invalidateLoginData } from "@/utils/zincutils";
import { expireSession } from "@/utils/sessionServices";
import MainLayoutCloudMixin from "./mainLayout.mixin";

vi.mock("@/services/organizations", () => ({ default: { list: vi.fn() } }));
vi.mock("@/utils/sessionServices", () => ({ expireSession: vi.fn() }));
vi.mock("@/utils/zincutils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/zincutils")>()),
  invalidateLoginData: vi.fn(),
}));
const awsExports = vi.hoisted(() => ({ isEnterprise: "true", isCloud: "false" }));
vi.mock("@/aws-exports", () => ({ default: awsExports }));

describe("MainLayoutCloudMixin", () => {
  afterEach(() => {
    awsExports.isEnterprise = "true";
    vi.mocked(invalidateLoginData).mockClear();
  });

  it.each(["true", "false"])(
    "ends a session whose organizations are refused as an expired one, so the drafts stay, and clears the auth cookie (enterprise %s)",
    async (isEnterprise) => {
      awsExports.isEnterprise = isEnterprise;
      vi.mocked(organizationService.list).mockRejectedValueOnce({ status: 403 });
      const store = createStore({ state: { userInfo: { email: "me@x.io" } } });
      const dispatch = vi.spyOn(store, "dispatch");
      let getDefaultOrganization!: (store: unknown) => Promise<void>;
      mount(
        defineComponent({
          setup() {
            getDefaultOrganization = MainLayoutCloudMixin.setup().getDefaultOrganization;
            return () => h("div");
          },
        }),
        { global: { plugins: [store] } },
      );

      await getDefaultOrganization(store);
      await flushPromises();

      expect(invalidateLoginData).toHaveBeenCalledTimes(1);
      expect(expireSession).toHaveBeenCalledWith(store);
      expect(dispatch).not.toHaveBeenCalledWith("logout", expect.anything());
    },
  );
});
