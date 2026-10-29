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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OnCallPhoneCard from "@/components/oncall/OnCallPhoneCard.vue";
import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import type { Contact, RefusalReason, VerificationRefusalBody } from "@/ts/interfaces/oncall";
import type { TranslateFn } from "@/types/i18n";
import {
  formatCountdown,
  isInternationalPhone,
  phoneCardState,
  phoneRefusalText,
  refusalOf,
  samePhone,
} from "@/utils/oncall";

vi.mock("@/services/oncall", () => ({
  default: {
    getContact: vi.fn(),
    setContact: vi.fn(),
    sendContactCode: vi.fn(),
    confirmContactCode: vi.fn(),
  },
}));

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const service = vi.mocked(oncallService);
const t = i18n.global.t as unknown as TranslateFn;
const ORG = store.state.selectedOrganization.identifier;
const EMAIL = store.state.userInfo.email;
const PHONE = "+14155550134";

const stubs = {
  OText: { name: "OText", template: "<span><slot /></span>" },
  OIcon: { name: "OIcon", template: "<i />" },
  OTag: { name: "OTag", props: ["variant"], template: "<span><slot /></span>" },
  OBanner: { name: "OBanner", props: ["variant"], template: "<div><slot /></div>" },
  OButton: {
    name: "OButton",
    props: ["disabled", "loading", "variant"],
    emits: ["click"],
    template: `<button :disabled="disabled" @click="$emit('click', $event)"><slot /></button>`,
  },
  OInput: {
    name: "OInput",
    props: ["modelValue", "disabled", "errorMessage", "error"],
    emits: ["update:modelValue", "blur"],
    template: `<input :value="modelValue" :disabled="disabled" @input="$emit('update:modelValue', $event.target.value)" @blur="$emit('blur', $event)" />`,
  },
  ConfirmDialog: {
    name: "ConfirmDialog",
    props: ["modelValue", "title", "message", "okLabel", "okVariant"],
    emits: ["update:ok", "update:cancel"],
    template: "<div v-if='modelValue' data-test='confirm'>{{ title }} {{ message }}</div>",
  },
};

function contact(over: Partial<Contact> = {}): Contact {
  return {
    unverified: [],
    phone_is_pageable: false,
    phone_provider_available: true,
    press4_available: true,
    ...over,
  };
}

const VERIFIED = contact({ phone: PHONE, phone_verified_at: 1, phone_is_pageable: true });
const UNVERIFIED = contact({ phone: PHONE, unverified: ["phone"] });

function refusal(body: Partial<VerificationRefusalBody> & { reason: RefusalReason }, status = 400) {
  return { response: { status, data: { message: "English API text", ...body } } };
}

async function render(read: Contact) {
  service.getContact.mockResolvedValue({ data: read } as any);
  const wrapper = mount(OnCallPhoneCard, { global: { plugins: [i18n, store], stubs } });
  await flushPromises();
  return wrapper;
}

const find = (w: Awaited<ReturnType<typeof render>>, id: string) =>
  w.find(`[data-test="oncall-phone-${id}"]`);

describe("phoneRefusalText", () => {
  const rows: [VerificationRefusalBody["reason"], Partial<VerificationRefusalBody>, string][] = [
    ["wrong_code", { tries_left: 3 }, "That code is not right. 3 tries left."],
    ["wrong_code", { tries_left: 1 }, "That code is not right. 1 try left."],
    ["expired", {}, "That code has expired. Send a new code."],
    ["too_many_tries", {}, "Too many tries. Send a new code."],
    ["no_code", {}, "No code is waiting for this number. Send a new code."],
    ["too_soon", { retry_after_secs: 42 }, "You just asked for a code. Try again in 1 min."],
    [
      "user_daily_limit",
      { retry_after_secs: 59 * 60 },
      "You have asked for too many codes. Try again in 59 min.",
    ],
    [
      "number_daily_limit",
      { retry_after_secs: 30 * 60 + 1 },
      "This number has had too many codes. Try again in 31 min.",
    ],
    ["no_provider", {}, "This organisation has no phone provider yet."],
    ["no_phone", {}, "Save a phone number first."],
    ["number_rejected", {}, "This number cannot receive texts. Check it and try again."],
    [
      "number_not_allowed",
      {},
      "This organisation's phone account cannot reach this number yet. Ask an admin to check the phone provider.",
    ],
    ["provider_unavailable", {}, "The code could not be sent right now. Try again in a minute."],
  ];

  it.each(rows)("%s %o reads as the mockup words it", (reason, extra, expected) => {
    expect(String(phoneRefusalText(t, { message: "English API text", reason, ...extra }))).toBe(
      expected,
    );
  });

  it("falls back to the API message for a limit with no wait", () => {
    expect(String(phoneRefusalText(t, { message: "English API text", reason: "too_soon" }))).toBe(
      "English API text",
    );
  });
});

describe("refusalOf", () => {
  it("reads a refusal body, and nothing that lacks a known reason", () => {
    expect(refusalOf(refusal({ reason: "expired" }))?.reason).toBe("expired");
    expect(refusalOf(refusal({ reason: "mystery" as RefusalReason }))).toBeNull();
    expect(refusalOf({ response: { status: 400, data: { message: "bad number" } } })).toBeNull();
    expect(refusalOf(new Error("network"))).toBeNull();
  });
});

describe("formatCountdown", () => {
  it.each([
    [60, "1:00"],
    [42, "0:42"],
    [5, "0:05"],
    [0, "0:00"],
    [3600, "1:00:00"],
    [6 * 3600 - 1, "5:59:59"],
  ])("%i s reads %s", (secs, expected) => {
    expect(formatCountdown(secs)).toBe(expected);
  });
});

describe("samePhone", () => {
  it.each([
    ["+14155550134", "+14155550134", true],
    ["+1 (415) 555-0134", "+14155550134", true],
    ["  +1.415.555.0134 ", "+14155550134", true],
    ["+14155550199", "+14155550134", false],
    ["", "", false],
  ])("%j vs %j is %s", (a, b, expected) => {
    expect(samePhone(a, b)).toBe(expected);
  });
});

// S10: the server's to_e164 rule, checked before the round trip.
describe("isInternationalPhone", () => {
  it.each([
    ["+91 98765 43210", true],
    ["+1 (415) 555-0134", true],
    ["  +1.415.555.0134 ", true],
    ["+1234567", true],
    ["+123456789012345", true],
    ["98765 43210", false],
    ["+0123456789", false],
    ["+123456", false],
    ["+1234567890123456", false],
    ["+91 98a65 43210", false],
    ["", false],
  ])("%j is %s", (typed, expected) => {
    expect(isInternationalPhone(typed)).toBe(expected);
  });
});

describe("phoneCardState", () => {
  it.each([
    [
      "no provider wins over everything",
      contact({ phone_provider_available: false }),
      true,
      false,
      "noProvider",
    ],
    ["no phone saved", contact(), false, false, "empty"],
    ["Change reopens the form", VERIFIED, false, true, "empty"],
    ["a code is out", UNVERIFIED, true, false, "codeSent"],
    ["verified", VERIFIED, false, false, "verified"],
    ["verified wins over a code still marked sent", VERIFIED, true, false, "verified"],
    ["saved but unverified", UNVERIFIED, false, false, "changed"],
  ] as const)("%s", (_, read, codeSent, editing, expected) => {
    expect(phoneCardState(read, codeSent, editing)).toBe(expected);
  });
});

describe("OnCallPhoneCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  });
  afterEach(() => vi.useRealTimers());

  it("reads the caller's own contact", async () => {
    await render(contact());
    expect(service.getContact).toHaveBeenCalledWith({ org_identifier: ORG, user_email: EMAIL });
  });

  it("empty: offers a number box and Send code", async () => {
    const w = await render(contact());
    expect(find(w, "input").exists()).toBe(true);
    await find(w, "input").setValue(PHONE);
    expect(find(w, "send").attributes("disabled")).toBeUndefined();
    expect(w.text()).toContain("We text a 6-digit code to confirm it is yours.");
  });

  it("an empty box cannot be sent, so Send code never clears a number", async () => {
    const w = await render(VERIFIED);
    await find(w, "change").trigger("click");

    for (const blank of ["", "   "]) {
      await find(w, "input").setValue(blank);
      expect(find(w, "send").attributes("disabled"), JSON.stringify(blank)).toBeDefined();
      await find(w, "send").trigger("click");
      await flushPromises();
    }

    expect(service.setContact).not.toHaveBeenCalled();
  });

  it("Cancel ends a change without saving and keeps the number", async () => {
    const w = await render(VERIFIED);
    await find(w, "change").trigger("click");
    await find(w, "input").setValue("+14155550199");

    await find(w, "cancel").trigger("click");
    await flushPromises();

    expect(service.setContact).not.toHaveBeenCalled();
    expect(find(w, "input").exists()).toBe(false);
    expect(find(w, "number").text()).toBe(PHONE);
    await find(w, "change").trigger("click");
    expect((find(w, "input").element as HTMLInputElement).value).toBe(PHONE);
  });

  it("Send code saves the number, then texts a code, then shows the code box", async () => {
    const w = await render(contact());
    service.setContact.mockResolvedValue({ data: UNVERIFIED } as any);
    service.sendContactCode.mockResolvedValue({ data: undefined } as any);
    service.getContact.mockResolvedValue({ data: UNVERIFIED } as any);

    await find(w, "input").setValue(PHONE);
    await find(w, "send").trigger("click");
    await flushPromises();

    expect(service.setContact).toHaveBeenCalledWith({
      org_identifier: ORG,
      user_email: EMAIL,
      data: { phone: PHONE },
    });
    expect(service.setContact.mock.invocationCallOrder[0]).toBeLessThan(
      service.sendContactCode.mock.invocationCallOrder[0],
    );
    expect(find(w, "code").exists()).toBe(true);
    expect(find(w, "resend").text()).toBe("Resend in 1:00");
    expect(find(w, "resend").attributes("disabled")).toBeDefined();
    expect(w.text()).toContain(`Code sent to ${PHONE}. It works for 10 minutes.`);

    await vi.advanceTimersByTimeAsync(18_000);
    expect(find(w, "resend").text()).toBe("Resend in 0:42");
  });

  it("after a send, Send code waits out the countdown for that number only", async () => {
    const w = await render(contact());
    service.setContact.mockResolvedValue({ data: UNVERIFIED } as any);
    service.sendContactCode.mockResolvedValue({ data: undefined } as any);
    service.getContact.mockResolvedValue({ data: UNVERIFIED } as any);
    await find(w, "input").setValue(PHONE);
    await find(w, "send").trigger("click");
    await flushPromises();

    await find(w, "change").trigger("click");
    await find(w, "input").setValue("+1 415 555 0134");
    expect(find(w, "send").attributes("disabled")).toBeDefined();
    expect(find(w, "send").text()).toBe("Resend in 1:00");

    await find(w, "input").setValue("+14155550199");
    expect(find(w, "send").attributes("disabled")).toBeUndefined();
    expect(find(w, "send").text()).toBe("Send code");

    await find(w, "input").setValue(PHONE);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(find(w, "send").attributes("disabled")).toBeUndefined();
  });

  it.each([
    ["number_rejected", "This number cannot receive texts. Check it and try again."],
    [
      "number_not_allowed",
      "This organisation's phone account cannot reach this number yet. Ask an admin to check the phone provider.",
    ],
    ["provider_unavailable", "The code could not be sent right now. Try again in a minute."],
  ] as const)(
    "a resend failing with %s drops the code box, since the old code no longer matches",
    async (reason, message) => {
      const w = await render(contact());
      service.setContact.mockResolvedValue({ data: UNVERIFIED } as any);
      service.sendContactCode.mockResolvedValue({ data: undefined } as any);
      service.getContact.mockResolvedValue({ data: UNVERIFIED } as any);
      await find(w, "input").setValue(PHONE);
      await find(w, "send").trigger("click");
      await flushPromises();

      await vi.advanceTimersByTimeAsync(60_000);
      service.sendContactCode.mockRejectedValue(refusal({ reason }));
      await find(w, "resend").trigger("click");
      await flushPromises();

      expect(find(w, "error").text()).toBe(message);
      expect(find(w, "code").exists()).toBe(false);
      expect(w.text()).not.toContain("Code sent to");
      // The undelivered code still starts the server's gap, so a send now would read as too_soon.
      expect(find(w, "send").attributes("disabled")).toBeDefined();
      expect(find(w, "send").text()).toBe("Resend in 1:00");
    },
  );

  it("a resend refused by a daily limit keeps the box, since nothing replaced the code", async () => {
    const w = await render(contact());
    service.setContact.mockResolvedValue({ data: UNVERIFIED } as any);
    service.sendContactCode.mockResolvedValue({ data: undefined } as any);
    service.getContact.mockResolvedValue({ data: UNVERIFIED } as any);
    await find(w, "input").setValue(PHONE);
    await find(w, "send").trigger("click");
    await flushPromises();

    await vi.advanceTimersByTimeAsync(60_000);
    service.sendContactCode.mockRejectedValue(
      refusal({ reason: "user_daily_limit", retry_after_secs: 3600 }, 429),
    );
    await find(w, "resend").trigger("click");
    await flushPromises();

    expect(find(w, "error").exists()).toBe(true);
    expect(find(w, "code").exists()).toBe(true);
  });

  it("a number proved in another org needs no code", async () => {
    const w = await render(contact());
    service.setContact.mockResolvedValue({ data: VERIFIED } as any);
    service.getContact.mockResolvedValue({ data: VERIFIED } as any);

    await find(w, "input").setValue(PHONE);
    await find(w, "send").trigger("click");
    await flushPromises();

    expect(service.sendContactCode).not.toHaveBeenCalled();
    expect(find(w, "state").text()).toBe("Verified");
  });

  it("too_soon opens the code box with the server's countdown", async () => {
    const w = await render(UNVERIFIED);
    service.setContact.mockResolvedValue({ data: UNVERIFIED } as any);
    service.sendContactCode.mockRejectedValue(
      refusal({ reason: "too_soon", retry_after_secs: 42 }, 429),
    );

    await find(w, "send").trigger("click");
    await flushPromises();

    expect(find(w, "code").exists()).toBe(true);
    expect(find(w, "resend").text()).toBe("Resend in 0:42");
  });

  it("a daily limit says how long, never the number", async () => {
    const w = await render(UNVERIFIED);
    service.setContact.mockResolvedValue({ data: UNVERIFIED } as any);
    service.sendContactCode.mockRejectedValue(
      refusal({ reason: "number_daily_limit", retry_after_secs: 40 * 60 }, 429),
    );

    await find(w, "send").trigger("click");
    await flushPromises();

    expect(find(w, "error").attributes("role")).toBe("alert");
    const error = find(w, "error").text();
    expect(error).toBe("This number has had too many codes. Try again in 40 min.");
    expect(error).not.toContain(PHONE);
  });

  it("a number the server cannot parse shows its message", async () => {
    const w = await render(contact());
    service.setContact.mockRejectedValue({
      response: { status: 400, data: { message: "Not a dialable number" } },
    });

    await find(w, "input").setValue("+999 1234567");
    await find(w, "send").trigger("click");
    await flushPromises();

    expect(service.sendContactCode).not.toHaveBeenCalled();
    expect(find(w, "error").text()).toBe("Not a dialable number");
  });

  it("a wrong code says how many tries are left", async () => {
    const w = await render(contact());
    service.setContact.mockResolvedValue({ data: UNVERIFIED } as any);
    service.sendContactCode.mockResolvedValue({ data: undefined } as any);
    service.getContact.mockResolvedValue({ data: UNVERIFIED } as any);
    await find(w, "input").setValue(PHONE);
    await find(w, "send").trigger("click");
    await flushPromises();

    service.confirmContactCode.mockRejectedValue(refusal({ reason: "wrong_code", tries_left: 3 }));
    await find(w, "code").setValue("482913");
    await find(w, "confirm").trigger("click");
    await flushPromises();

    expect(service.confirmContactCode).toHaveBeenCalledWith({
      org_identifier: ORG,
      user_email: EMAIL,
      code: "482913",
    });
    expect(find(w, "error").text()).toBe("That code is not right. 3 tries left.");
  });

  it("verified with press-4: the call can be acknowledged by key", async () => {
    const w = await render(VERIFIED);
    expect(find(w, "state").text()).toBe("Verified");
    expect(find(w, "number").text()).toBe(PHONE);
    expect(find(w, "change").exists()).toBe(true);
    expect(w.text()).toContain(
      "During a call, press 4 to acknowledge, 6 to resolve, or 8 to escalate.",
    );
  });

  it("verified without press-4: acknowledge from the text's link", async () => {
    const w = await render({ ...VERIFIED, press4_available: false });
    expect(w.text()).toContain("Acknowledge from the link in the text.");
    expect(w.text()).not.toContain("Press 4");
  });

  it("verified: Change reopens the number box", async () => {
    const w = await render(VERIFIED);
    await find(w, "change").trigger("click");
    expect((find(w, "input").element as HTMLInputElement).value).toBe(PHONE);
  });

  // Review finding 4: Remove is offered whenever a number is saved, whatever its verification or the provider.
  describe("which states offer Remove", () => {
    it.each([
      ["verified", VERIFIED, true],
      ["a saved unverified number after a reload", UNVERIFIED, true],
      [
        "a saved number with no provider",
        contact({ phone: PHONE, phone_provider_available: false }),
        true,
      ],
      ["no number", contact(), false],
    ] as const)("%s", async (_case, read, shown) => {
      const w = await render(read);
      expect(find(w, "remove").exists()).toBe(shown);
    });

    it("a code sent", async () => {
      const w = await render(contact());
      service.setContact.mockResolvedValue({ data: UNVERIFIED } as any);
      service.sendContactCode.mockResolvedValue({ data: undefined } as any);
      service.getContact.mockResolvedValue({ data: UNVERIFIED } as any);
      await find(w, "input").setValue(PHONE);
      await find(w, "send").trigger("click");
      await flushPromises();

      expect(find(w, "code").exists()).toBe(true);
      expect(find(w, "remove").exists()).toBe(true);
    });

    it("clears an unverified number through its own confirm, showing it is busy meanwhile", async () => {
      const w = await render(UNVERIFIED);
      let finish: (v: unknown) => void = () => {};
      service.setContact.mockReturnValue(new Promise((resolve) => (finish = resolve)) as any);

      await find(w, "remove").trigger("click");
      expect(w.find('[data-test="confirm"]').text()).toBe(
        "Remove your phone? Pages will reach you by email only.",
      );
      w.findComponent({ name: "ConfirmDialog" }).vm.$emit("update:ok");
      await flushPromises();
      expect(w.findComponent('[data-test="oncall-phone-remove"]').props("loading")).toBe(true);

      service.getContact.mockResolvedValue({ data: contact() } as any);
      finish({ data: contact() });
      await flushPromises();
      expect(service.setContact).toHaveBeenCalledWith({
        org_identifier: ORG,
        user_email: EMAIL,
        data: { phone: "" },
      });
    });
  });

  // S10: a phone can be taken off, after one line saying what that means.
  it("verified: Remove clears the number after a confirm", async () => {
    const w = await render(VERIFIED);
    service.setContact.mockResolvedValue({ data: contact() } as any);
    service.getContact.mockResolvedValue({ data: contact() } as any);

    await find(w, "remove").trigger("click");
    expect(w.find('[data-test="confirm"]').text()).toBe(
      "Remove your phone? Pages will reach you by email only.",
    );
    expect(service.setContact).not.toHaveBeenCalled();

    w.findComponent({ name: "ConfirmDialog" }).vm.$emit("update:ok");
    await flushPromises();
    expect(service.setContact).toHaveBeenCalledWith({
      org_identifier: ORG,
      user_email: EMAIL,
      data: { phone: "" },
    });
    expect(find(w, "input").exists()).toBe(true);
  });

  // S10: the server's format rule is said before Send, not after the round trip.
  it("says how to write the number on blur and refuses to send it", async () => {
    const w = await render(contact());
    const box = () => w.findComponent({ name: "OInput" });

    await find(w, "input").setValue("98765 43210");
    await find(w, "input").trigger("blur");
    expect(box().props("errorMessage")).toBe(
      "Start with + and your country code, e.g. +91 98765 43210",
    );
    // OInput draws the message only while `error` is set.
    expect(box().props("error")).toBe(true);

    await find(w, "send").trigger("click");
    await flushPromises();
    expect(service.setContact).not.toHaveBeenCalled();

    await find(w, "input").setValue("+91 98765 43210");
    expect(box().props("errorMessage")).toBeFalsy();
  });

  // Pressing Send code with a bad number shows the hint, never a silent no-op.
  it("shows the hint when Send code is pressed on a badly written number", async () => {
    const w = await render(contact());
    const box = () => w.findComponent({ name: "OInput" });

    await find(w, "input").setValue("98765 43210");
    await find(w, "send").trigger("click");
    await flushPromises();

    expect(service.setContact).not.toHaveBeenCalled();
    expect(box().props("error")).toBe(true);
    expect(box().props("errorMessage")).toBe(
      "Start with + and your country code, e.g. +91 98765 43210",
    );
  });

  it("no provider: disabled, and the admin hint links to Telephony settings", async () => {
    const w = await render(contact({ phone: PHONE, phone_provider_available: false }));
    expect(find(w, "input").attributes("disabled")).toBeDefined();
    expect(find(w, "send").attributes("disabled")).toBeDefined();
    expect(w.text()).toContain(
      "This organisation has no phone provider yet, so pages reach you by email.",
    );
    await find(w, "telephony-link").trigger("click");
    expect(push).toHaveBeenCalledWith({
      name: "telephonySettings",
      query: { org_identifier: ORG },
    });
  });

  it("changed: an unverified saved number is amber, not red", async () => {
    const w = await render(UNVERIFIED);
    expect(find(w, "state").text()).toBe("Not verified");
    expect(w.findComponent({ name: "OTag" }).props("variant")).toBe("amber-soft");
    expect(w.text()).toContain("Pages will not text or call this number until you confirm it.");
  });
});
