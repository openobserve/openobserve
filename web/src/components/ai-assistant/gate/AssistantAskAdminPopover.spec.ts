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
import { afterEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "@/composables/query/queryClient";
import { userKeys } from "@/services/users.querykeys";

import { fakeRouter } from "../__tests__/fakeAssistant";
import AssistantAskAdminPopover, {
  adminEmails,
  mailtoHref,
  promptLine,
  type AssistantAskAdminPopoverProps,
} from "./AssistantAskAdminPopover.vue";

const { copyToClipboard, toast, phone } = vi.hoisted(() => ({
  phone: { value: false },
  copyToClipboard: vi.fn(async () => true),
  toast: vi.fn(),
}));

vi.mock("@/utils/clipboard", () => ({ copyToClipboard }));
vi.mock("@/composables/useBreakpoint", async () => {
  const { computed } = await import("vue");
  return {
    default: () => ({
      lgUp: computed(() => !phone.value),
      mdUp: computed(() => !phone.value),
      isMobile: computed(() => phone.value),
      isTablet: computed(() => false),
      isDesktop: computed(() => !phone.value),
    }),
  };
});
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast,
}));

async function openPopover(props: Partial<AssistantAskAdminPopoverProps> = {}) {
  const wrapper = mount(AssistantAskAdminPopover, {
    props: { kind: "access", org: "acme", ...props },
    slots: { trigger: '<button data-test="trigger">Ask an admin</button>' },
    global: { plugins: [fakeRouter([{ path: "/billings/plans", name: "plans", component: {} }])] },
    attachTo: document.body,
  });
  await wrapper.get('[data-test="trigger"]').trigger("click");
  await flushPromises();
  return wrapper;
}

const message = () =>
  (
    document.body.querySelector(
      '[data-test="assistant-ask-admin-message"] textarea',
    ) as HTMLTextAreaElement
  )?.value ?? "";

afterEach(() => {
  phone.value = false;
  document.body.innerHTML = "";
  queryClient.clear();
  copyToClipboard.mockClear();
  toast.mockClear();
});

describe("AssistantAskAdminPopover helpers", () => {
  it("lists admins from a member list and ignores other roles", () => {
    expect(
      adminEmails([
        { email: "ada@x.io", role: "admin" },
        { email: "bob@x.io", role: "viewer" },
        { email: "root@x.io", role: "Root" },
      ]),
    ).toEqual(["ada@x.io", "root@x.io"]);
    expect(adminEmails(undefined)).toEqual([]);
  });

  it("URL-encodes the subject and the body of the mailto", () => {
    const href = mailtoHref(["a@x.io"], "Access for acme & co", "Line one\nLine two?");
    expect(href).toBe(
      "mailto:a%40x.io?subject=Access%20for%20acme%20%26%20co&body=Line%20one%0ALine%20two%3F",
    );
  });

  it("takes only the first line of the prompt, cut at 80 characters", () => {
    expect(promptLine(`${"x".repeat(100)}\nsecond`)).toHaveLength(80);
    expect(promptLine("why 502?\nmore")).toBe("why 502?");
    expect(promptLine(undefined)).toBe("");
  });
});

describe("AssistantAskAdminPopover", () => {
  it.each([
    [
      "access",
      "Hi, could you grant me O2 Assistant access in OpenObserve (IAM › Roles › Assistant, Chat) for the acme organization?",
    ],
    [
      "share_read",
      "Could you grant me chat sharing access (IAM › Roles › Assistant, Chat sharing) in acme?",
    ],
    ["tool_policy", "The assistant wasn't allowed to run o2_delete in acme."],
    ["credits", "Could you enable paid AI usage for acme? Billing › Paid usage: http"],
    ["settings", "Could you change the O2 Assistant settings for acme in Settings › Assistant?"],
  ] as const)("prefills the %s request", async (kind, expected) => {
    await openPopover({ kind, tool: "o2_delete" });
    expect(message()).toContain(expected);
    expect(document.body.textContent).toContain("Ask an admin");
  });

  it("names the org's admins when the members list is cached, else an admin of the org", async () => {
    await openPopover();
    expect(
      document.body.querySelector('[data-test="assistant-ask-admin-unknown"]')?.textContent,
    ).toContain("An admin of acme");
    expect(document.body.querySelector('[data-test="assistant-ask-admin-email"]')).toBeNull();
    document.body.innerHTML = "";
    queryClient.setQueryData(userKeys.users("acme"), [{ email: "ada@x.io", role: "admin" }]);
    await openPopover();
    expect(document.body.textContent).toContain("Admins of acme");
    const email = document.body.querySelector('[data-test="assistant-ask-admin-email"]');
    expect(email?.getAttribute("href")).toMatch(
      /^mailto:ada%40x\.io\?subject=O2%20Assistant%20access%20for%20acme/,
    );
  });

  it("includes the first line of the prompt only when ticked, and only for credits and consent", async () => {
    await openPopover({ kind: "access", promptPreview: "why did checkout fail?" });
    expect(
      document.body.querySelector('[data-test="assistant-ask-admin-include-prompt"]'),
    ).toBeNull();
    document.body.innerHTML = "";
    await openPopover({ kind: "consent", promptPreview: `${"y".repeat(90)}\nsecond line` });
    expect(message()).not.toContain("yyy");
    (
      document.body.querySelector(
        '[data-test="assistant-ask-admin-include-prompt"] button, [data-test="assistant-ask-admin-include-prompt"] [role="checkbox"]',
      ) as HTMLElement
    ).click();
    await flushPromises();
    expect(message()).toContain(`"${"y".repeat(80)}"`);
    expect(message()).not.toContain("second line");
  });

  it("copies the message and confirms with a toast", async () => {
    const wrapper = await openPopover();
    (document.body.querySelector('[data-test="assistant-ask-admin-copy"]') as HTMLElement).click();
    await flushPromises();
    expect(copyToClipboard).toHaveBeenCalledWith(message(), expect.any(Function), { silent: true });
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Message copied. Paste it to your admin." }),
    );
    expect(wrapper.emitted("copied")).toHaveLength(1);
  });

  it("falls back to a selectable message when the clipboard refuses", async () => {
    copyToClipboard.mockResolvedValueOnce(false);
    const wrapper = await openPopover();
    (document.body.querySelector('[data-test="assistant-ask-admin-copy"]') as HTMLElement).click();
    await flushPromises();
    expect(
      document.body.querySelector('[data-test="assistant-ask-admin-copy-manually"]')?.textContent,
    ).toContain("Couldn't copy. Select the text and copy it.");
    expect(wrapper.emitted("copied")).toBeUndefined();
  });

  it("is a closable sheet below md that hands focus back to its trigger", async () => {
    phone.value = true;
    await openPopover();
    expect(document.body.querySelector('[data-test="assistant-ask-admin-sheet"]')).not.toBeNull();
    (document.body.querySelector('[data-test="assistant-ask-admin-close"]') as HTMLElement).click();
    await flushPromises();
    expect(document.body.querySelector('[data-test="assistant-ask-admin-sheet"]')).toBeNull();
    expect(document.activeElement?.getAttribute("data-test")).toBe("trigger");
  });

  it("expands the sheet to full from its Expand button", async () => {
    phone.value = true;
    await openPopover();
    (
      document.body.querySelector('[data-test="assistant-ask-admin-sheet-expand"]') as HTMLElement
    ).click();
    await flushPromises();
    expect(
      document.body.querySelector('[data-test="assistant-ask-admin-sheet-expand"]'),
    ).toBeNull();
  });
});
