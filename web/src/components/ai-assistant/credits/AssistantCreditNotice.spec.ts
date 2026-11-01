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

import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import { runEscapeLadder } from "@/composables/assistant";

import { fakeRouter } from "../__tests__/fakeAssistant";
import AssistantCreditNotice, {
  type AssistantCreditNoticeProps,
} from "./AssistantCreditNotice.vue";

const routes = [{ path: "/billings/plans", name: "plans", component: {} }];

function mountNotice(props: Partial<AssistantCreditNoticeProps> = {}) {
  return mount(AssistantCreditNotice, {
    props: { threshold: 70, canManage: true, org: "acme-prod", ...props },
    global: { plugins: [fakeRouter(routes)] },
    attachTo: document.body,
  });
}

const banner = (wrapper: ReturnType<typeof mountNotice>) =>
  wrapper.get('[data-test="assistant-credit-notice"]');

describe("AssistantCreditNotice", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("says what happens next and is polite at 70 %", () => {
    const wrapper = mountNotice();
    expect(banner(wrapper).text()).toContain("70% of included AI credits used · they don't renew");
    expect(banner(wrapper).attributes("role")).toBe("status");
    wrapper.unmount();
  });

  it("interrupts at 90 % and names the reset date when the server sends one", () => {
    const wrapper = mountNotice({ threshold: 90, resetsAt: Date.UTC(2026, 10, 1, 12) });
    expect(banner(wrapper).attributes("role")).toBe("alert");
    expect(banner(wrapper).text()).toMatch(
      /90% of included AI credits used · they reset (1 Nov|Nov 1)/,
    );
    wrapper.unmount();
  });

  it("gives an admin Manage in a new tab and a member Ask an admin", () => {
    const admin = mountNotice();
    const manage = admin.get('[data-test="assistant-credit-notice-manage"]');
    expect(manage.attributes("target")).toBe("_blank");
    expect(admin.find('[data-test="assistant-credit-notice-ask-admin"]').exists()).toBe(false);
    admin.unmount();
    const member = mountNotice({ canManage: false });
    expect(member.find('[data-test="assistant-credit-notice-manage"]').exists()).toBe(false);
    member.unmount();
  });

  it("closes on Dismiss and on Escape from inside it, and not on Escape elsewhere", async () => {
    const wrapper = mountNotice();
    await wrapper.get('[data-test="assistant-credit-notice-dismiss"]').trigger("click");
    expect(wrapper.emitted("dismiss")).toHaveLength(1);
    const outside = new KeyboardEvent("keydown", { key: "Escape" });
    Object.defineProperty(outside, "target", { value: document.body });
    expect(runEscapeLadder(outside)).toBe(false);
    const inside = new KeyboardEvent("keydown", { key: "Escape" });
    Object.defineProperty(inside, "target", {
      value: wrapper.get('[data-test="assistant-credit-notice-dismiss"]').element,
    });
    expect(runEscapeLadder(inside)).toBe(true);
    expect(wrapper.emitted("dismiss")).toHaveLength(2);
    const composing = new KeyboardEvent("keydown", { key: "Escape", isComposing: true });
    expect(runEscapeLadder(composing)).toBe(false);
    wrapper.unmount();
  });
});
