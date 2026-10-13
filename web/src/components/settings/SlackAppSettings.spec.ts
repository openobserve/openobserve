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

import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import type { SlackManifestUrls } from "@/ts/interfaces/oncall";
import { buildOncallSlackManifest, DEFAULT_ONCALL_SLACK_APP_NAME } from "@/utils/slackManifest";
import SlackAppSettings from "./SlackAppSettings.vue";

vi.mock("@/services/oncall", () => ({
  default: { getSlackManifestUrls: vi.fn() },
}));

const copyMock = vi.fn();
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: (...args: unknown[]) => copyMock(...args),
}));

const service = vi.mocked(oncallService);
const URLS: SlackManifestUrls = {
  command_url: "https://o2.example.com/api/v2/oncall/chat/slack/command",
  interact_url: "https://o2.example.com/api/v2/oncall/chat/slack/interact",
  redirect_url: "https://o2.example.com/web/slack/oauth/callback",
};

const q = (id: string) =>
  document.querySelector<HTMLElement>(`[data-test="slack-app-settings-${id}"]`);
const text = (id: string) => q(id)?.textContent?.replace(/\s+/g, " ").trim() ?? "";

function render() {
  return mount(SlackAppSettings, {
    global: { plugins: [i18n, store, withQueryClient()] },
    attachTo: document.body,
  });
}

describe("SlackAppSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    copyMock.mockResolvedValue(true);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  // IN-3, IN-4: the page reads this deployment's URLs and fills the manifest with them.
  it("fetches the manifest URLs for the admin org and shows them in the manifest", async () => {
    service.getSlackManifestUrls.mockResolvedValue({ data: URLS } as any);
    render();
    await flushPromises();

    expect(service.getSlackManifestUrls).toHaveBeenCalledWith({
      org_identifier: store.state.selectedOrganization.identifier,
    });
    const manifest = text("manifest");
    for (const url of Object.values(URLS)) expect(manifest).toContain(url);
  });

  it("copies the exact manifest and links Slack's new-app page to it", async () => {
    service.getSlackManifestUrls.mockResolvedValue({ data: URLS } as any);
    render();
    await flushPromises();

    const manifest = buildOncallSlackManifest(DEFAULT_ONCALL_SLACK_APP_NAME, URLS);
    q("manifest-copy-btn")!.click();
    await flushPromises();
    expect(copyMock).toHaveBeenCalledWith(
      JSON.stringify(manifest, null, 2),
      expect.anything(),
      expect.anything(),
    );
    const href = new URL(q("open-slack")!.getAttribute("href")!);
    expect(`${href.origin}${href.pathname}`).toBe("https://api.slack.com/apps");
    expect(JSON.parse(href.searchParams.get("manifest_json") ?? "")).toEqual(manifest);
  });

  it("names Activate Public Distribution and the three env vars", async () => {
    service.getSlackManifestUrls.mockResolvedValue({ data: URLS } as any);
    render();
    await flushPromises();

    expect(text("distribute")).toContain(
      "In the app's Manage Distribution page, click Activate Public Distribution.",
    );
    expect(text("env")).toContain("O2_ONCALL_SLACK_CLIENT_ID");
    expect(text("env")).toContain("O2_ONCALL_SLACK_CLIENT_SECRET");
    expect(text("env")).toContain("O2_ONCALL_SLACK_SIGNING_SECRET");
  });

  it("a failed read shows the load-failed banner and no manifest", async () => {
    service.getSlackManifestUrls.mockRejectedValue({ response: { status: 500 } });
    render();
    await vi.waitFor(() => expect(q("failed")).not.toBeNull());
    expect(text("failed")).toBe("The Slack app manifest could not be loaded.");
    expect(q("manifest")).toBeNull();
  });
});
