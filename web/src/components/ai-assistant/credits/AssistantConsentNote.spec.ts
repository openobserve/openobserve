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
import { describe, expect, it, vi } from "vitest";

import { assistantApprovalsHostKey } from "../approvals/approvals.types";
import { fakeRouter } from "../__tests__/fakeAssistant";
import AssistantConsentNote from "./AssistantConsentNote.vue";

const routes = [{ path: "/billings/plans", name: "plans", component: {} }];
const consent = { org: "acme-prod", by: "ada@example.com", at: 1_760_000_000_000 };

function mountNote(readonly = false) {
  const host = {
    pendingId: () => null,
    currentUser: () => "ada@example.com",
    sendAgain: vi.fn(),
    askAgain: vi.fn(),
    stop: vi.fn(),
    undo: vi.fn(),
  };
  return mount(AssistantConsentNote, {
    props: { block: { type: "consent_note", consentNote: consent }, readonly },
    global: {
      plugins: [fakeRouter(routes)],
      provide: { [assistantApprovalsHostKey as symbol]: host },
    },
  });
}

describe("AssistantConsentNote", () => {
  it("names the org, the user who enabled it and when, with Manage in a new tab", () => {
    const wrapper = mountNote();
    expect(wrapper.text()).toMatch(/^Paid AI usage enabled for acme-prod by you · /);
    const manage = wrapper.get('[data-test="assistant-consent-note-manage"]');
    expect(manage.attributes("target")).toBe("_blank");
    expect(manage.attributes("aria-label")).toBe("Manage paid usage (opens in a new tab)");
  });

  it("never names the user on a shared page", () => {
    const wrapper = mountNote(true);
    expect(wrapper.text()).toContain("by a member");
    expect(wrapper.find('[data-test="assistant-consent-note-manage"]').exists()).toBe(false);
  });
});
