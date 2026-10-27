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

import type { AssistantError } from "@/composables/assistant/pure";

import AssistantErrorDetails, { ASSISTANT_SETUP_DOCS_URL } from "./AssistantErrorDetails.vue";

const { copy, toast } = vi.hoisted(() => ({ copy: vi.fn(), toast: vi.fn() }));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: (...args: unknown[]) => copy(...args) }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...args: unknown[]) => toast(...args) }));

const ERROR: AssistantError = {
  code: "provider_error",
  phase: "post_admission",
  retryable: true,
  action: "retry",
  httpStatus: 503,
  turnId: "turn-1",
  sessionId: "chat-1",
  traceId: "trace-1",
  serverMessage: "<img src=x onerror=alert(1)> overloaded",
};

function mountDetails(over: Partial<{ error: AssistantError; isAdmin: boolean }> = {}) {
  return mount(AssistantErrorDetails, {
    props: { error: ERROR, at: Date.UTC(2026, 9, 18, 8, 30), isAdmin: false, ...over },
    attachTo: document.body,
  });
}

async function openDetails(wrapper: ReturnType<typeof mountDetails>) {
  await wrapper.get("button").trigger("click");
  await flushPromises();
}

describe("AssistantErrorDetails", () => {
  beforeEach(() => {
    copy.mockReset();
    toast.mockReset();
    document.body.innerHTML = "";
  });

  it("is a collapsed Details disclosure holding the rows of `80` §1.4", async () => {
    const wrapper = mountDetails();
    expect(wrapper.text()).toContain("Details");
    await openDetails(wrapper);
    const rows = wrapper.get('[data-test="assistant-error-details-rows"]');
    expect(rows.findAll("dt").map((dt) => dt.text())).toEqual([
      "Code",
      "HTTP status",
      "Turn",
      "Chat",
      "Trace",
      "When",
      "Server message",
    ]);
    expect(wrapper.get('[data-test="assistant-error-details-code"]').text()).toBe("provider_error");
    expect(wrapper.get('[data-test="assistant-error-details-trace"]').text()).toBe("trace-1");
    expect(wrapper.get('[data-test="assistant-error-details-server"]').text()).toContain("<img");
    expect(wrapper.element.querySelector("img")).toBeNull();
  });

  it("dashes a missing value", async () => {
    const wrapper = mountDetails({
      error: { code: "offline", phase: "pre_admission", retryable: true, action: "retry" },
    });
    await openDetails(wrapper);
    expect(wrapper.get('[data-test="assistant-error-details-http"]').text()).toBe("—");
  });

  it("copies the same rows as text, never a prompt, chip or context, and toasts (HT-02 AC 10, SEC-06)", async () => {
    copy.mockResolvedValue(true);
    const wrapper = mountDetails();
    await openDetails(wrapper);
    await wrapper.get('[data-test="assistant-error-details-copy"]').trigger("click");
    await flushPromises();
    const text = copy.mock.calls[0][0] as string;
    expect(text.split("\n").map((line) => line.split(":")[0])).toEqual([
      "Code",
      "HTTP status",
      "Turn",
      "Chat",
      "Trace",
      "When",
      "Server message",
    ]);
    expect(text).toContain("Code: provider_error");
    expect(text).toContain("Trace: trace-1");
    expect(toast).toHaveBeenCalledWith({ variant: "success", message: "Details copied" });
    expect(wrapper.emitted("copied")).toHaveLength(1);
  });

  it("falls back to a selected read-only field when the clipboard is denied (ERR-13, `80` §1.7)", async () => {
    copy.mockResolvedValue(false);
    const wrapper = mountDetails();
    await openDetails(wrapper);
    await wrapper.get('[data-test="assistant-error-details-copy"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Couldn't copy. Select the text and copy it.");
    const field = wrapper.get('[data-test="assistant-error-details-manual"] textarea');
    expect((field.element as HTMLTextAreaElement).value).toContain("Code: provider_error");
    expect(field.attributes("readonly")).toBeDefined();
  });

  it("links admins to the setup guide, marked as a new tab, for a service failure only", async () => {
    const admin = mountDetails({ isAdmin: true });
    await openDetails(admin);
    const link = admin.get('[data-test="assistant-error-details-status"]');
    expect(link.attributes()).toMatchObject({ href: ASSISTANT_SETUP_DOCS_URL, target: "_blank" });
    expect(link.text()).toBe("Read the setup guide (opens in a new tab)");
    const member = mountDetails();
    await openDetails(member);
    expect(member.find('[data-test="assistant-error-details-status"]').exists()).toBe(false);
    const refusal = mountDetails({ isAdmin: true, error: { ...ERROR, code: "turn_limit" } });
    await openDetails(refusal);
    expect(refusal.find('[data-test="assistant-error-details-status"]').exists()).toBe(false);
  });
});
