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

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import CapabilityCards from "./CapabilityCards.vue";

const push = vi.fn();
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => ({ push }),
}));

describe("CapabilityCards", () => {
  it("opens the alert form from the alert card and asks the assistant from the others", async () => {
    const wrapper = mount(CapabilityCards, { global: { plugins: [i18n, store] } });
    await wrapper.get('[data-test="ai-welcome-capability-alert"]').trigger("click");
    expect(push).toHaveBeenCalledWith({
      name: "addAlert",
      query: { org_identifier: store.state.selectedOrganization.identifier },
    });
    expect(wrapper.emitted("select")).toBeUndefined();

    await wrapper.get('[data-test="ai-welcome-capability-query"]').trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual([
      i18n.global.t("aiAssistant.capabilities.query.prompt"),
    ]);
  });
});
