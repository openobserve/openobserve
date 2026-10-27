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

import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import type { TranslateFn } from "@/types/i18n";
import OCard from "@/lib/core/Card/OCard.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { buildChoices } from "@/components/onboarding/onboardingChoices";
import NoDataIntro, { type NoDataSignal } from "./NoDataIntro.vue";

const awsConfig = vi.hoisted(() => ({ isEnterprise: "false", isCloud: "false" }));
vi.mock("@/aws-exports", () => ({ default: awsConfig }));
const push = vi.hoisted(() => vi.fn());
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => ({ push }),
}));
// whether the org holds any user data; the intro shows on pages for an org without any
const orgData = vi.hoisted(() => ({ has: false as boolean | undefined }));
vi.mock("@/composables/useOrgHasUserData", async () => {
  const { ref } = await import("vue");
  return {
    useOrgHasUserData: () => ({ hasUserData: ref(orgData.has), isFetching: ref(false) }),
  };
});

const SIGNALS: NoDataSignal[] = ["logs", "metrics", "traces", "llm", "rum"];
const CHOICES: Record<NoDataSignal, string> = {
  logs: "logs",
  metrics: "infrastructure",
  traces: "backend",
  llm: "llm",
  rum: "frontend",
};
// the routes each page's empty state linked to before the intro
const ROUTES: Record<NoDataSignal, string> = {
  logs: "curl",
  metrics: "ingestMetrics",
  traces: "tracesOTLP",
  llm: "ai-integrations",
  rum: "frontendMonitoring",
};
// each Logs way in: its onboarding row (cloud) and its ingestion page (elsewhere)
const SOURCES = [
  { id: "shipper", row: "from-a-log-shipper-you-run", route: "fluentbit" },
  { id: "curl", row: "over-http-with-curl", route: "curl" },
  { id: "otel", row: "from-opentelemetry", route: "ingestLogsFromOtel" },
  { id: "other", row: "something-else", route: "recommended" },
];
const ORG = store.state.selectedOrganization.identifier;

let wrapper: VueWrapper;
const mountIntro = (signal: NoDataSignal, { slots = {}, hideSetup = false } = {}) =>
  (wrapper = mount(NoDataIntro, {
    props: { signal, hideSetup },
    slots,
    global: { plugins: [i18n, store] },
  }));
const find = (id: string) => wrapper.find(`[data-test="${id}"]`);
const card = (id: string) => find(`logs-no-data-intro-${id}-card`);
const featureIds = () =>
  wrapper
    .findAll('[data-test^="no-data-intro-feature-"]')
    .map((w) => w.attributes("data-test")!.replace("no-data-intro-feature-", ""));

afterEach(() => {
  wrapper?.unmount();
  awsConfig.isCloud = "false";
  awsConfig.isEnterprise = "false";
  orgData.has = false;
  push.mockReset();
});

describe("NoDataIntro", () => {
  it.each(SIGNALS)("resolves every %s string from the locale file", (signal) => {
    mountIntro(signal);
    const text = wrapper.text();

    expect(text).not.toMatch(/noDataIntro\.|menu\.|emptyState\./);
    expect(find("no-data-intro").attributes("data-signal")).toBe(signal);
    expect(find("no-data-intro-module").text()).not.toBe("");
    expect(find("no-data-intro-setup-btn").text()).toMatch(/^Set up /);
    expect(featureIds()).toHaveLength(3);
  });

  it("shows the module name above the headline, outside the heading", () => {
    mountIntro("logs");

    expect(find("no-data-intro-module").text()).toBe("Logs");
    expect(wrapper.find("h2").text()).toBe("Search every log line in seconds, from any source");
  });

  // logs offers four ways in, and the estimate held only for curl
  it("drops the time estimate on Logs and shows it elsewhere as plain text, not a tag", () => {
    mountIntro("logs");
    expect(find("no-data-intro-time").exists()).toBe(false);
    wrapper.unmount();

    mountIntro("traces");
    expect(find("no-data-intro-time").text()).toBe("About 10 minutes");
    expect(wrapper.findComponent(OTag).exists()).toBe(false);
  });

  it("lists what setup unlocks as one line of check marks, not cards", () => {
    mountIntro("logs");

    expect(wrapper.findComponent(OCard).exists()).toBe(false);
    const items = wrapper.findAll('[data-test^="no-data-intro-feature-"]');
    expect(items.map((li) => li.element.tagName)).toEqual(["LI", "LI", "LI"]);
    expect(items[0].text()).toBe("Search with SQL or full text");
  });

  it("offers four ways to send logs, worded as the onboarding Logs rows", () => {
    mountIntro("logs");
    const rows = buildChoices(i18n.global.t as unknown as TranslateFn).find(
      (c) => c.id === "logs",
    )!.rows;

    expect(rows.map((r) => r.id)).toEqual(SOURCES.map((s) => s.row));
    for (const [i, s] of SOURCES.entries()) {
      expect(card(s.id).element.tagName).toBe("BUTTON");
      expect(card(s.id).text()).toBe(`${rows[i].name}${rows[i].description}`);
    }
  });

  it("keeps the copy the RUM empty state already had", () => {
    mountIntro("rum");

    expect(wrapper.find("h2").text()).toBe("Monitor your users with Real User Monitoring");
  });

  describe("on cloud, for an org with no data", () => {
    it.each(SIGNALS)("sends %s setup to its onboarding choice", async (signal) => {
      awsConfig.isCloud = "true";
      mountIntro(signal);
      await find("no-data-intro-setup-btn").trigger("click");

      expect(push).toHaveBeenCalledWith({
        name: "onboarding",
        params: { path: [CHOICES[signal]] },
        query: { org_identifier: ORG },
      });
    });

    it.each(SOURCES)("opens the $row onboarding guide from the $id card", async ({ id, row }) => {
      awsConfig.isCloud = "true";
      mountIntro("logs");
      await card(id).trigger("click");

      expect(push).toHaveBeenCalledWith({
        name: "onboarding",
        params: { path: ["logs", row] },
        query: { org_identifier: ORG },
      });
    });

    it("offers the coding agent page", async () => {
      awsConfig.isCloud = "true";
      mountIntro("traces");
      await find("no-data-intro-agent-btn").trigger("click");

      expect(push).toHaveBeenCalledWith({
        name: "onboarding",
        params: { path: ["agent"] },
        query: { org_identifier: ORG },
      });
    });
  });

  // onboarding sends an org with data back to Home, so RUM for an org with logs keeps its old page
  it.each([true, undefined])(
    "on cloud, keeps the setup route and drops the agent button when the data check is %s",
    async (has) => {
      awsConfig.isCloud = "true";
      orgData.has = has;
      mountIntro("rum");
      await find("no-data-intro-setup-btn").trigger("click");

      expect(push).toHaveBeenCalledWith({
        name: "frontendMonitoring",
        query: { org_identifier: ORG },
      });
      expect(find("no-data-intro-agent-btn").exists()).toBe(false);
    },
  );

  describe("off cloud", () => {
    it.each(SIGNALS)("sends %s setup to the page's existing setup route", async (signal) => {
      mountIntro(signal);
      await find("no-data-intro-setup-btn").trigger("click");

      expect(push).toHaveBeenCalledWith({
        name: ROUTES[signal],
        query: { org_identifier: ORG },
      });
    });

    it.each(SOURCES)("opens the $route ingestion page from the $id card", async ({ id, route }) => {
      mountIntro("logs");
      await card(id).trigger("click");

      expect(push).toHaveBeenCalledWith({ name: route, query: { org_identifier: ORG } });
    });

    it("has no coding agent button, since that page exists only on cloud", () => {
      mountIntro("logs");

      expect(find("no-data-intro-agent-btn").exists()).toBe(false);
    });
  });

  it("drops the time and setup buttons while FirstDataPanel's command card asks instead", () => {
    awsConfig.isCloud = "true";
    mountIntro("logs", { hideSetup: true });

    expect(find("no-data-intro-time").exists()).toBe(false);
    expect(find("no-data-intro-setup-btn").exists()).toBe(false);
    expect(find("no-data-intro-agent-btn").exists()).toBe(false);
    expect(featureIds()).toHaveLength(3);
    expect(card("curl").exists()).toBe(true);
  });

  it("promises log patterns only on builds that have them", () => {
    mountIntro("logs");
    expect(featureIds()).toEqual(["search", "dashboards", "alerts"]);
    wrapper.unmount();

    awsConfig.isEnterprise = "true";
    mountIntro("logs");
    expect(featureIds()).toEqual(["search", "patterns", "alerts"]);
  });

  it("renders the status and extra slots", () => {
    mountIntro("rum", {
      slots: {
        status: '<div data-test="status-slot" />',
        extra: '<div data-test="extra-slot" />',
      },
    });

    expect(find("status-slot").exists()).toBe(true);
    expect(find("extra-slot").exists()).toBe(true);
  });
});
