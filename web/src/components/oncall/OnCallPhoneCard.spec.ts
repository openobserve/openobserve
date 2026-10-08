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
import { formatCountdown, phoneCardState, phoneRefusalText, refusalOf } from "@/utils/oncall";

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
    props: ["modelValue", "disabled"],
    emits: ["update:modelValue"],
    template: `<input :value="modelValue" :disabled="disabled" @input="$emit('update:modelValue', $event.target.value)" />`,
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
      { retry_after_secs: 6 * 3600 },
      "You have asked for too many codes today. Try again in 6 h.",
    ],
    [
      "number_daily_limit",
      { retry_after_secs: 2 * 3600 + 1 },
      "This number has had too many codes today. Try again in 3 h.",
    ],
    [
      "user_daily_limit",
      { retry_after_secs: 59 * 60 },
      "You have asked for too many codes today. Try again in 59 min.",
    ],
    ["no_provider", {}, "This organisation has no phone provider yet."],
    ["no_phone", {}, "Save a phone number first."],
    ["number_rejected", {}, "This number cannot receive texts. Check it and try again."],
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
    expect(find(w, "send").attributes("disabled")).toBeUndefined();
    expect(w.text()).toContain("We text a 6-digit code to confirm it is yours.");
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
      refusal({ reason: "number_daily_limit", retry_after_secs: 3 * 3600 }, 429),
    );

    await find(w, "send").trigger("click");
    await flushPromises();

    expect(find(w, "error").attributes("role")).toBe("alert");
    const error = find(w, "error").text();
    expect(error).toBe("This number has had too many codes today. Try again in 3 h.");
    expect(error).not.toContain(PHONE);
  });

  it("a number the server cannot parse shows its message", async () => {
    const w = await render(contact());
    service.setContact.mockRejectedValue({
      response: { status: 400, data: { message: "Not a dialable number" } },
    });

    await find(w, "input").setValue("12");
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
    expect(w.text()).toContain("Press 4 during a call to acknowledge.");
  });

  it("verified without press-4: acknowledge from the text's link", async () => {
    const w = await render({ ...VERIFIED, press4_available: false });
    expect(w.text()).toContain("Acknowledge from the link in the text.");
    expect(w.text()).not.toContain("Press 4");
  });

  it("verified: Change reopens the number box, and there is no Remove", async () => {
    const w = await render(VERIFIED);
    expect(find(w, "remove").exists()).toBe(false);
    await find(w, "change").trigger("click");
    expect((find(w, "input").element as HTMLInputElement).value).toBe(PHONE);
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
