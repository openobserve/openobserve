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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import slack from "@/services/slack";
import SlackCredentialsDialog from "./SlackCredentialsDialog.vue";
import {
  FAKE_APP_TOKEN,
  FAKE_CONFIG_REFRESH_TOKEN,
  installationView,
  makeSlackStore,
  ok,
} from "@/test/unit/helpers/slack";
import type { InstallationView } from "@/types/slack";
import { toast } from "@/lib/feedback/Toast/useToast";

vi.mock("@/services/slack", () => ({ default: { updateCredentials: vi.fn() } }));
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast: vi.fn(),
}));

const body = () => new DOMWrapper(document.body);

const mountDialog = (installation: InstallationView = installationView()) =>
  mount(SlackCredentialsDialog, {
    props: { open: true, installation },
    attachTo: document.body,
    global: { plugins: [i18n, makeSlackStore()] },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(slack.updateCredentials).mockReturnValue(ok(installationView()) as any);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SlackCredentialsDialog (row 8)", () => {
  it("AC-7.9 asks for the Socket Mode app token and app secrets, never a bot token", async () => {
    mountDialog();
    await flushPromises();
    const text = body().text();
    expect(body().find('[data-test="slack-credentials-app_token"]').exists()).toBe(true);
    expect(body().find('[data-test="slack-credentials-signing_secret"]').exists()).toBe(false);
    expect(body().find('[data-test="slack-credentials-client_id"]').exists()).toBe(true);
    expect(body().find('[data-test="slack-credentials-config_refresh_token"]').exists()).toBe(true);
    expect(text).not.toMatch(/Bot token \(xoxb/);
    expect(text).toContain("A new bot token comes from Reinstall, never a paste.");
  });

  it("asks HTTP mode for the signing secret instead of an app token", async () => {
    mountDialog(installationView({ mode: "http" }));
    await flushPromises();
    expect(body().find('[data-test="slack-credentials-signing_secret"]').exists()).toBe(true);
    expect(body().find('[data-test="slack-credentials-app_token"]').exists()).toBe(false);
  });

  it("AC-12.1 explains unreadable credentials", async () => {
    mountDialog(installationView({ credentials_readable: false }));
    await flushPromises();
    expect(body().find('[data-test="slack-credentials-unreadable-note"]').text()).toContain(
      "could not be decrypted",
    );
  });

  it("sends only the fields that changed, then closes", async () => {
    const w = mountDialog();
    await flushPromises();
    await body()
      .find('[data-test="slack-credentials-app_token"] input')
      .setValue("xapp-1-A0SAMPLE01-1-new");
    await body().find("form").trigger("submit");
    await vi.waitFor(() =>
      expect(slack.updateCredentials).toHaveBeenCalledWith("acme", "inst-1", {
        app_token: "xapp-1-A0SAMPLE01-1-new",
      }),
    );
    await flushPromises();
    expect(w.emitted("update:open")?.at(-1)).toEqual([false]);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "success", message: "Credentials updated" }),
    );
  });

  it("refuses a token pasted into the other token's field before Slack is called", async () => {
    mountDialog();
    await flushPromises();
    await body()
      .find('[data-test="slack-credentials-app_token"] input')
      .setValue(FAKE_CONFIG_REFRESH_TOKEN);
    await body()
      .find('[data-test="slack-credentials-config_refresh_token"] input')
      .setValue(FAKE_APP_TOKEN);
    await body().find("form").trigger("submit");
    await vi.waitFor(() => expect(body().text()).toContain("This is not an app-level token"));
    expect(body().text()).toContain("This is not a configuration refresh token");
    expect(slack.updateCredentials).not.toHaveBeenCalled();
  });

  it("says O2 never uses the installer's user token from a reinstall in Slack and how to end it", async () => {
    mountDialog();
    await flushPromises();
    const note = body().find('[data-test="slack-credentials-installer-token-note"]').text();
    expect(note).toContain("openid, email, profile");
    expect(note).toContain("OpenObserve never sees or uses");
    expect(note).toContain("auth.revoke");
    expect(note).toContain("Deleting the app ends it");
  });

  it("refuses an empty update", async () => {
    mountDialog();
    await flushPromises();
    await body().find("form").trigger("submit");
    await vi.waitFor(() => expect(body().text()).toContain("Enter at least one credential"));
    expect(slack.updateCredentials).not.toHaveBeenCalled();
  });
});
