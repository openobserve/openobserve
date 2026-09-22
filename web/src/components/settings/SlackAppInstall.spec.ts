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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import SlackAppInstall from "./SlackAppInstall.vue";

const mockI18n = createI18n({
  locale: "en",
  messages: {
    en: {
      settings: {
        slackAppPage: {
          intro: "Install the {product} app in your Slack workspace.",
          permissionsTitle: "This app asks Slack for permission to:",
          permissionHistory: "Read messages in the public channels it is added to",
          permissionWrite: "Post messages as the app",
          permissionCommands: "Add shortcuts and slash commands",
        },
      },
    },
  },
});

const mountComponent = () => mount(SlackAppInstall, { global: { plugins: [mockI18n] } });

describe("SlackAppInstall", () => {
  it("renders the install link", () => {
    const wrapper = mountComponent();
    expect(wrapper.find('[data-test="settings-slack-app-install-button"]').exists()).toBe(true);
  });

  it("points the link at Slack's authorize endpoint with the bot scopes", () => {
    const wrapper = mountComponent();
    const href = wrapper.find('[data-test="settings-slack-app-install-button"]').attributes("href");
    const url = new URL(String(href));
    expect(url.origin + url.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(url.searchParams.get("scope")).toBe("channels:history,chat:write,commands");
  });

  it("opens Slack in a new tab without leaking the opener", () => {
    const wrapper = mountComponent();
    const link = wrapper.find('[data-test="settings-slack-app-install-button"]');
    expect(link.attributes("target")).toBe("_blank");
    expect(link.attributes("rel")).toBe("noopener noreferrer");
  });

  it("renders Slack's button artwork with a 2x source", () => {
    const wrapper = mountComponent();
    const img = wrapper.find('[data-test="settings-slack-app-install-button"] img');
    expect(img.attributes("src")).toContain("add_to_slack.png");
    expect(img.attributes("srcset")).toContain("add_to_slack@2x.png 2x");
  });

  it("lists the three permissions the app requests", () => {
    const wrapper = mountComponent();
    const items = wrapper.findAll('[data-test="settings-slack-app-install-permissions"] li');
    expect(items).toHaveLength(3);
  });
});
