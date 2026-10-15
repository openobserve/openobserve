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
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import slack from "@/services/slack";
import SlackLinkingSection from "./SlackLinkingSection.vue";
import {
  axiosError,
  installationView,
  linkingView,
  makeSlackStore,
  ok,
} from "@/test/unit/helpers/slack";
import type { LinkingView } from "@/types/slack";

vi.mock("@/services/slack", () => ({
  default: { getLinking: vi.fn(), updateLinking: vi.fn(), linkAll: vi.fn() },
}));

const PeopleStub = {
  name: "SlackLinkedPeople",
  props: ["open", "installationId"],
  template: '<div data-test-stub="people" :data-open="open" />',
};

const mountSection = async (linking: LinkingView) => {
  vi.mocked(slack.getLinking).mockReturnValue(ok(linking) as any);
  const w = mount(SlackLinkingSection, {
    props: { installation: installationView() },
    attachTo: document.body,
    global: { plugins: [i18n, makeSlackStore()], stubs: { SlackLinkedPeople: PeopleStub } },
  });
  await flushPromises();
  return w;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(slack.updateLinking).mockReturnValue(ok(linkingView()) as any);
  vi.mocked(slack.linkAll).mockReturnValue(ok({ linked: 4, complete: true }) as any);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SlackLinkingSection (row 11)", () => {
  it("AC-12.1 mapped: the domains come from the mapping and are read-only", async () => {
    const w = await mountSection(linkingView({ source: "mapping", domains: ["acme.example"] }));
    expect(w.find('[data-test="slack-linking-summary"]').text()).toBe(
      "Automatic for acme.example · from your organization's domain mapping",
    );
    expect(w.text()).toContain("Domains are read-only here");
    expect(w.find('[data-test="slack-linking-edit"]').exists()).toBe(false);
  });

  it("mapped: turning linking off sends only enabled", async () => {
    const w = await mountSection(linkingView({ source: "mapping" }));
    await w.find('[data-test="slack-linking-switch"] button').trigger("click");
    await flushPromises();
    expect(slack.updateLinking).toHaveBeenCalledWith("acme", "inst-1", { enabled: false });
  });

  it("AC-12.1 manual: edits domains and refuses a public email domain", async () => {
    const w = await mountSection(linkingView({ source: "manual", domains: ["acme.example"] }));
    expect(w.find('[data-test="slack-linking-summary"]').text()).toBe("Automatic for acme.example");
    await w.find('[data-test="slack-linking-edit"]').trigger("click");
    const input = w.find('[data-test="slack-linking-domains"] [data-test="tag-input-field"]');
    await input.setValue("gmail.com");
    await input.trigger("keydown", { key: "Enter" });
    await w.find('[data-test="slack-linking-form"]').trigger("submit");
    await vi.waitFor(() =>
      expect(w.text()).toContain("gmail.com is a public email domain; use your company's domain"),
    );
    expect(slack.updateLinking).not.toHaveBeenCalled();
  });

  it("manual: saves the edited domains", async () => {
    const w = await mountSection(linkingView({ source: "manual", domains: ["acme.example"] }));
    await w.find('[data-test="slack-linking-edit"]').trigger("click");
    const input = w.find('[data-test="slack-linking-domains"] [data-test="tag-input-field"]');
    await input.setValue("acme.dev");
    await input.trigger("keydown", { key: "Enter" });
    await w.find('[data-test="slack-linking-form"]').trigger("submit");
    await vi.waitFor(() =>
      expect(slack.updateLinking).toHaveBeenCalledWith("acme", "inst-1", {
        enabled: true,
        domains: ["acme.example", "acme.dev"],
      }),
    );
  });

  it("shows the link counts and runs Link all for the matches", async () => {
    const w = await mountSection(linkingView());
    expect(w.find('[data-test="slack-linking-counts"]').text()).toBe(
      "31 linked automatically, 7 with Link your account",
    );
    const matches = w.find('[data-test="slack-linking-matches"]');
    expect(matches.text()).toContain("4 Slack members match OpenObserve users");
    expect(matches.find("button").text()).toBe("Link all matches (4)");
    await matches.find("button").trigger("click");
    await flushPromises();
    expect(slack.linkAll).toHaveBeenCalledWith("acme", "inst-1");
  });

  it("NIT-7 a refused Link all leaves no unhandled error", async () => {
    vi.mocked(slack.linkAll).mockReturnValue(Promise.reject(axiosError(409, "running")) as any);
    const errorHandler = vi.fn();
    vi.mocked(slack.getLinking).mockReturnValue(ok(linkingView()) as any);
    const w = mount(SlackLinkingSection, {
      props: { installation: installationView() },
      attachTo: document.body,
      global: {
        plugins: [i18n, makeSlackStore()],
        stubs: { SlackLinkedPeople: PeopleStub },
        config: { errorHandler },
      },
    });
    await flushPromises();
    await w.find('[data-test="slack-linking-matches"] button').trigger("click");
    await flushPromises();
    expect(errorHandler).not.toHaveBeenCalled();
  });

  it("hides Link all when no member is waiting", async () => {
    const w = await mountSection(
      linkingView({
        counts: { email: 1, oidc: 0, admin_bulk: 0, matches_not_linked: 0, skipped_domain: 0 },
      }),
    );
    expect(w.find('[data-test="slack-linking-matches"]').exists()).toBe(false);
  });

  it("opens the linked people list from Manage", async () => {
    const w = await mountSection(linkingView());
    await w.find('[data-test="slack-linking-manage"]').trigger("click");
    expect(w.find('[data-test-stub="people"]').attributes("data-open")).toBe("true");
  });

  it("W-S6 a failed load shows a retryable error instead of nothing", async () => {
    vi.mocked(slack.getLinking).mockReturnValue(Promise.reject(axiosError(500)) as any);
    const w = mount(SlackLinkingSection, {
      props: { installation: installationView() },
      attachTo: document.body,
      global: { plugins: [i18n, makeSlackStore()], stubs: { SlackLinkedPeople: PeopleStub } },
    });
    await flushPromises();
    const error = w.find('[data-test="slack-linking-error"]');
    expect(error.exists()).toBe(true);

    vi.mocked(slack.getLinking).mockReturnValue(ok(linkingView()) as any);
    await error.find("button").trigger("click");
    await flushPromises();
    expect(slack.getLinking).toHaveBeenCalledTimes(2);
    expect(w.find('[data-test="slack-linking-summary"]').exists()).toBe(true);
  });
});
