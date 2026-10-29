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

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import type {
  TelephonyReason,
  TelephonyState,
  TelephonyStatus,
  TelephonyView,
} from "@/ts/interfaces/oncall";
import TelephonyAccountDialog from "./TelephonyAccountDialog.vue";
import TelephonySettings from "./TelephonySettings.vue";

vi.mock("@/services/oncall", () => ({
  default: {
    getTelephony: vi.fn(),
    getTelephonyStatus: vi.fn(),
    putTelephony: vi.fn(),
    deleteTelephony: vi.fn(),
  },
}));

const service = vi.mocked(oncallService);
const SID = "ACtestaccountsid000000000001";
const READ_ONLY = "Only org admins can change this.";

function view(over: Partial<TelephonyView> = {}): TelephonyView {
  return {
    deployment_account_present: false,
    deployment_from_number: null,
    press4_available: true,
    org: null,
    ...over,
  };
}

const CONNECTED = view({
  org: { provider: "twilio", account_sid: SID, from_number: "+18335550100" },
});

function failure(status: number, data: Record<string, unknown> = {}) {
  return { response: { status, data } };
}

function status(state: TelephonyState, over: Partial<TelephonyStatus> = {}): TelephonyStatus {
  const ok = state === "ok";
  return { state, trial: false, can_text: ok, can_call: ok, ...over };
}

async function render(
  read: TelephonyView | ReturnType<typeof failure>,
  ok = true,
  live: TelephonyStatus = status("ok"),
) {
  if (ok) service.getTelephony.mockResolvedValue({ data: read } as any);
  else service.getTelephony.mockRejectedValue(read);
  service.getTelephonyStatus.mockResolvedValue({ data: live } as any);
  const wrapper = mount(TelephonySettings, {
    global: { plugins: [i18n, store, withQueryClient()] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

const q = (id: string) =>
  document.querySelector<HTMLElement>(`[data-test="telephony-settings-${id}"]`);
const text = (id: string) => q(id)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const card = (id: string) =>
  document.querySelector<HTMLElement>(`[data-test="telephony-card-${id}"]`);
const cardText = (id: string) => card(id)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const PRESS4 = "Call keys (4 acknowledge, 6 resolve, 8 escalate)";
const NOTE = "Set by the operator, so there is nothing to configure here.";
const dialog = (id: string) =>
  document.querySelector<HTMLInputElement>(`[data-test="telephony-account-dialog-${id}-field"]`);

async function click(id: string) {
  q(id)!.click();
  await flushPromises();
}

async function type(id: string, value: string) {
  const input = dialog(id)!;
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await flushPromises();
}

// jsdom does not submit a form from a button outside it, so the dialog's own form is submitted.
async function submitDialog(wrapper: VueWrapper) {
  void (wrapper.findComponent(TelephonyAccountDialog).vm as any).form.handleSubmit();
  await vi.waitFor(() => expect(service.putTelephony).toHaveBeenCalled());
  await flushPromises();
}

describe("TelephonySettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  describe("page states", () => {
    it("5a: no org and no deployment account shows the hero", async () => {
      await render(view());
      expect(text("hero")).toContain("No phone provider connected");
      expect(text("hero")).toContain("Connect Twilio");
      expect(q("connected")).toBeNull();
      expect(q("deployment")).toBeNull();
    });

    it("5d: the org's account shows provider, short SID, From and press 4", async () => {
      await render(CONNECTED);
      const body = text("connected");
      expect(body).toContain("Twilio");
      expect(cardText("meta")).toBe("From +18335550100 · Account ACte…0001");
      expect(body).not.toContain(SID);
      expect(text("press4")).toBe(PRESS4);
      expect(q("press4")?.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
        "Available",
      );
      expect(q("update")).not.toBeNull();
      expect(q("disconnect")).not.toBeNull();
      expect(q("hero")).toBeNull();
    });

    it("5d: without a callback URL press 4 reads not available, with the link fallback", async () => {
      await render({ ...CONNECTED, press4_available: false });
      expect(text("press4")).toContain(PRESS4);
      expect(q("press4")?.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
        "Not available",
      );
      expect(text("press4")).toContain(
        "Calls ask people to acknowledge from the link in their text.",
      );
    });

    it("5f: a deployment account alone shows its card and never its SID", async () => {
      await render(
        view({ deployment_account_present: true, deployment_from_number: "+18335550199" }),
      );
      const body = text("deployment");
      expect(body).toContain("This deployment's Twilio account");
      expect(cardText("status")).toBe("Connected");
      expect(cardText("meta")).toBe("From +18335550199");
      expect(body).toContain(NOTE);
      expect(text("press4")).toBe(PRESS4);
      expect(q("hero")).toBeNull();

      await click("use-own");
      expect(document.body.textContent).toContain("Connect Twilio");
      expect(dialog("token")?.type).toBe("password");
    });
  });

  describe("the card's live check", () => {
    it("says it is checking until Twilio answers", async () => {
      service.getTelephony.mockResolvedValue({ data: CONNECTED } as any);
      service.getTelephonyStatus.mockReturnValue(new Promise(() => {}) as any);
      mount(TelephonySettings, {
        global: { plugins: [i18n, store, withQueryClient()] },
        attachTo: document.body,
      });
      await flushPromises();
      expect(cardText("status")).toBe("Checking…");
      expect(card("problem")).toBeNull();
    });

    it("ok shows Connected and no warnings", async () => {
      await render(CONNECTED);
      expect(cardText("status")).toBe("Connected");
      for (const id of ["problem", "unchecked", "trial", "cant-text", "cant-call"]) {
        expect(card(id), id).toBeNull();
      }
    });

    it.each<[TelephonyState, string]>([
      [
        "account_rejected",
        "Twilio did not accept this account. Check the Account SID and auth token, and that the account is active.",
      ],
      [
        "from_not_on_account",
        "This number is not on this Twilio account. Use one from Phone Numbers → Active numbers in Twilio.",
      ],
      ["unreadable", "This organisation's phone provider account could not be read."],
    ])("%s reads Not working, says why, and offers Update", async (state, why) => {
      await render(CONNECTED, true, status(state));
      expect(cardText("status")).toBe("Not working");
      expect(cardText("problem")).toContain(why);
      card("problem-update")!.click();
      await flushPromises();
      expect(dialog("sid")?.value).toBe(SID);
    });

    it("a broken deployment account offers no Update, which only its operator can do", async () => {
      await render(
        view({ deployment_account_present: true, deployment_from_number: "+18335550199" }),
        true,
        status("account_rejected"),
      );
      expect(cardText("status")).toBe("Not working");
      expect(card("problem")).not.toBeNull();
      expect(card("problem-update")).toBeNull();
      expect(q("press4")).toBeNull();
      expect(text("deployment")).toContain(NOTE);
      expect(text("deployment")).not.toContain("already work");
    });

    it("an unreachable Twilio reads Couldn't check, not Not working", async () => {
      await render(CONNECTED, true, status("unavailable"));
      expect(cardText("status")).toBe("Couldn't check");
      expect(cardText("unchecked")).toBe("Twilio could not be reached just now.");
      expect(card("problem")).toBeNull();
    });

    it("a failed status read reads Couldn't check", async () => {
      service.getTelephony.mockResolvedValue({ data: CONNECTED } as any);
      service.getTelephonyStatus.mockRejectedValue(failure(500));
      mount(TelephonySettings, {
        global: { plugins: [i18n, store, withQueryClient()] },
        attachTo: document.body,
      });
      await vi.waitFor(() => expect(cardText("status")).toBe("Couldn't check"));
      expect(card("unchecked")).toBeNull();
    });

    it("a trial account says who it can reach", async () => {
      await render(CONNECTED, true, status("ok", { trial: true }));
      expect(cardText("trial")).toBe(
        "Trial account: texts and calls only reach numbers verified in Twilio.",
      );
    });

    it.each<[string, Partial<TelephonyStatus>, string[]]>([
      ["cannot text", { can_text: false }, ["cant-text"]],
      ["cannot call", { can_call: false }, ["cant-call"]],
      ["can do neither", { can_text: false, can_call: false }, ["cant-text", "cant-call"]],
    ])("a number that %s is saved and warned about", async (_, over, shown) => {
      await render(CONNECTED, true, status("ok", over));
      expect(cardText("status")).toBe("Connected");
      expect(["cant-text", "cant-call"].filter((id) => card(id))).toEqual(shown);
      expect(q("press4") !== null).toBe(!shown.includes("cant-call"));
      expect(cardText("cant-text") + cardText("cant-call")).toBe(
        shown
          .map((id) =>
            id === "cant-text" ? "This number can't send texts" : "This number can't make calls",
          )
          .join(""),
      );
    });
  });

  describe("the dialog", () => {
    it("update pre-fills the SID and From number, never the token", async () => {
      await render(CONNECTED);
      await click("update");
      expect(dialog("sid")?.value).toBe(SID);
      expect(dialog("from")?.value).toBe("+18335550100");
      expect(dialog("token")?.value).toBe("");
      expect(document.body.textContent).toContain("Leave blank to keep the current token");
    });

    it("an update with a blank token sends no token, and says it is checking while it saves", async () => {
      let settle: (v: unknown) => void = () => {};
      service.putTelephony.mockReturnValue(new Promise((r) => (settle = r)) as any);
      const wrapper = await render(CONNECTED);
      await click("update");
      await submitDialog(wrapper);
      expect(document.body.textContent).toContain("Checking with Twilio…");
      expect(service.putTelephony).toHaveBeenCalledWith({
        org_identifier: store.state.selectedOrganization.identifier,
        data: { provider: "twilio", account_sid: SID, from_number: "+18335550100" },
      });
      settle({ data: CONNECTED.org });
      await flushPromises();
      expect(dialog("sid")).toBeNull();
    });

    it("connect sends the token it was given", async () => {
      service.putTelephony.mockResolvedValue({ data: CONNECTED.org } as any);
      const wrapper = await render(view());
      q("hero")!.querySelector("button")!.click();
      await flushPromises();
      await type("sid", SID);
      await type("token", "secret");
      await type("from", "+18335550100");
      await submitDialog(wrapper);
      expect(service.putTelephony.mock.calls[0][0].data).toEqual({
        provider: "twilio",
        account_sid: SID,
        auth_token: "secret",
        from_number: "+18335550100",
      });
    });

    it("5c: a rejected account shows the mockup banner and keeps the dialog open", async () => {
      service.putTelephony.mockRejectedValue(
        failure(400, { message: "English", reason: "account_rejected" }),
      );
      const wrapper = await render(CONNECTED);
      await click("update");
      await submitDialog(wrapper);
      expect(
        document.querySelector('[data-test="telephony-account-dialog-refusal"]')?.textContent,
      ).toContain(
        "Twilio did not accept this account. Check the Account SID and auth token, and that the account is active.",
      );
      expect(dialog("sid")).not.toBeNull();
    });

    it("a From number not on the account is pinned on the field, not the banner", async () => {
      service.putTelephony.mockRejectedValue(
        failure(400, { message: "English", reason: "from_not_on_account" }),
      );
      const wrapper = await render(CONNECTED);
      await click("update");
      await submitDialog(wrapper);
      expect(
        document.querySelector('[data-test="telephony-account-dialog-from-error"]')?.textContent,
      ).toContain(
        "This number is not on this Twilio account. Use one from Phone Numbers → Active numbers in Twilio.",
      );
      expect(document.querySelector('[data-test="telephony-account-dialog-refusal"]')).toBeNull();

      await type("sid", "ACanotheraccount0000000002");
      expect(
        document.querySelector('[data-test="telephony-account-dialog-from-error"]'),
      ).toBeNull();
    });

    it("an unreachable Twilio says so in the banner", async () => {
      service.putTelephony.mockRejectedValue(
        failure(400, { message: "English", reason: "unavailable" }),
      );
      const wrapper = await render(CONNECTED);
      await click("update");
      await submitDialog(wrapper);
      expect(
        document.querySelector('[data-test="telephony-account-dialog-refusal"]')?.textContent,
      ).toContain("Twilio could not be reached. Try again.");
    });

    it("a changed Account SID makes the token required and says why", async () => {
      await render(CONNECTED);
      await click("update");
      const token = () =>
        document.querySelector('[data-test="telephony-account-dialog-token"]')?.textContent ?? "";
      expect(token()).toContain("Leave blank to keep the current token");
      expect(token()).not.toContain("Auth token*");
      await type("sid", "ACanotheraccount0000000002");
      expect(token()).toContain("A different account needs its own auth token");
      expect(token()).toContain("Auth token*");
    });

    it.each<[TelephonyReason, string]>([
      ["no_master_key", "Ask your operator to set O2_MASTER_ENCRYPTION_KEY."],
      ["token_required", "An auth token is required to connect."],
    ])("%s is worded inside the dialog", async (reason, expected) => {
      service.putTelephony.mockRejectedValue(failure(400, { message: "English", reason }));
      const wrapper = await render(CONNECTED);
      await click("update");
      await submitDialog(wrapper);
      expect(
        document.querySelector('[data-test="telephony-account-dialog-refusal"]')?.textContent,
      ).toContain(expected);
    });
  });

  describe("disconnect", () => {
    it.each([
      [true, "From the next page step, texts and calls use this deployment's provider."],
      [false, "From the next page step, pages go by email only."],
    ])("with a deployment account %s, says what takes over", async (present, expected) => {
      await render({ ...CONNECTED, deployment_account_present: present });
      await click("disconnect");
      expect(document.body.textContent).toContain("Disconnect Twilio?");
      expect(document.body.textContent).toContain(expected);
    });

    it("names the account in bold and uses a red Disconnect button", async () => {
      await render(CONNECTED);
      await click("disconnect");
      const name = document.querySelector('[data-test="confirm-dialog-name"]');
      expect(name?.textContent).toBe("ACte…0001");
      expect(document.body.textContent).toContain("This disconnects the ACte…0001 account.");
      const ok = document.querySelector('[data-test="o-dialog-primary-btn"]');
      expect(ok?.className).toContain("bg-button-destructive");
    });
  });

  describe("A10: the server is the only gate", () => {
    it("a 403 on save latches the page read-only", async () => {
      service.putTelephony.mockRejectedValue(failure(403));
      const wrapper = await render(CONNECTED);
      expect(q("read-only")).toBeNull();
      await click("update");
      await submitDialog(wrapper);
      expect(text("read-only")).toBe(READ_ONLY);
      expect(q("update")?.hasAttribute("disabled")).toBe(true);
      expect(q("disconnect")?.hasAttribute("disabled")).toBe(true);
    });

    it("a 403 on disconnect latches the page read-only", async () => {
      service.deleteTelephony.mockRejectedValue(failure(403));
      await render(CONNECTED);
      await click("disconnect");
      document.querySelector<HTMLButtonElement>('[data-test="o-dialog-primary-btn"]')!.click();
      await flushPromises();
      expect(service.deleteTelephony).toHaveBeenCalled();
      expect(text("read-only")).toBe(READ_ONLY);
    });

    it("a 403 on the read shows the sentence instead of the hero", async () => {
      await render(failure(403), false);
      expect(text("forbidden")).toBe(READ_ONLY);
      expect(q("hero")).toBeNull();
    });
  });
});
