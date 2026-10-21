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
import { afterEach, describe, expect, it } from "vitest";

import { buildNavigationRoute } from "@/composables/assistant/pure";

import { fakeEvidence } from "../__tests__/fakeEvidence";
import { fakeRouter } from "../__tests__/fakeAssistant";
import AssistantLinkCard from "./AssistantLinkCard.vue";

const routes = [
  { path: "/dashboards/view", name: "viewDashboard", component: { render: () => null } },
];

const logs = buildNavigationRoute(
  {
    resource_type: "logs",
    action: "load_query",
    target: {
      stream: "default",
      query: 'SELECT * FROM "default"',
      from: 1_760_000_000_000_000,
      to: 1_760_000_900_000_000,
    },
  },
  "default",
);

const dashboard = buildNavigationRoute(
  {
    resource_type: "dashboard",
    action: "navigate_direct",
    target: { dashboard_id: "d1", name: "Checkout", path: "/web/logout" },
  },
  "default",
);

describe("AssistantLinkCard", () => {
  afterEach(() => (document.body.innerHTML = ""));

  const mountCard = (
    props: Record<string, unknown>,
    live = true,
    newTabFirst = false,
    currentOrg = "default",
  ) => {
    const evidence = fakeEvidence();
    evidence.host.prefersNewTab.mockReturnValue(newTabFirst);
    evidence.host.currentOrg.mockReturnValue(currentOrg);
    const wrapper = mount(AssistantLinkCard, {
      props: { source: "navigation", blockId: "b1", sid: live ? evidence.sid : null, ...props },
      attachTo: document.body,
      global: { plugins: [fakeRouter(routes)], provide: live ? evidence.provide : {} },
    });
    return { wrapper, ...evidence };
  };

  it("titles an explorer card by its explorer and opens through navigate on a click only", async () => {
    const { wrapper, host } = mountCard({ link: logs });
    expect(wrapper.get('[data-test="assistant-link-card-title"]').text()).toBe("Open in Logs");
    expect(wrapper.get('[data-test="assistant-link-card-details"]').text()).toContain("default");
    expect(host.dispatch).not.toHaveBeenCalled();
    await wrapper.get('[data-test="assistant-link-card-open"]').trigger("click");
    await flushPromises();
    expect(host.dispatch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ kind: "navigate", newTab: false, target: logs!.route }),
    );
    expect(wrapper.get('[data-test="assistant-link-card-outcome"]').text()).toMatch(/^Opened · /);
  });

  it("titles an object from the template with its name as data, never the agent's label", () => {
    const { wrapper } = mountCard({ link: dashboard });
    expect(wrapper.get('[data-test="assistant-link-card-title"]').text()).toBe(
      "Open dashboard “Checkout”",
    );
    expect(wrapper.get('[data-test="assistant-link-card"]').attributes("aria-label")).toBe(
      "Open dashboard “Checkout”",
    );
  });

  it("names Open by its target without the query, and shows the id beside a model-given name", () => {
    const explorer = mountCard({ link: logs });
    const open = explorer.wrapper.get('[data-test="assistant-link-card-open"]');
    expect(open.attributes("aria-label")).toMatch(/^Open in Logs, default, .+–.+$/);
    expect(explorer.wrapper.get('[data-test="assistant-link-card"]').attributes("aria-label")).toBe(
      open.attributes("aria-label"),
    );
    expect(open.attributes("aria-label")).not.toContain("SELECT");
    const named = mountCard({ link: dashboard });
    expect(named.wrapper.get('[data-test="assistant-link-card-id"]').text()).toBe("ID d1");
  });

  it("puts the new tab on Open itself from a docked or dirty container", async () => {
    const { wrapper, host } = mountCard({ link: logs }, true, true);
    expect(wrapper.find('[data-test="assistant-link-card-new-tab"]').exists()).toBe(false);
    const open = wrapper.get('[data-test="assistant-link-card-open"]');
    expect(open.attributes("aria-label")).toMatch(/\(opens in a new tab\)$/);
    await open.trigger("click");
    expect(host.dispatch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ kind: "navigate" }),
    );
  });

  it("says why a session of another org refused to open", async () => {
    const { wrapper, host } = mountCard({ link: dashboard });
    host.dispatch.mockResolvedValueOnce({ ok: false, reason: "other_org" } as never);
    await wrapper.get('[data-test="assistant-link-card-open"]').trigger("click");
    await flushPromises();
    expect(host.announce).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/^This query belongs to .+\. Switch organization to run it\.$/),
    );
    expect(wrapper.find('[data-test="assistant-link-card-outcome"]').exists()).toBe(false);
  });

  it("disables Open with the reason and offers Copy query for an unroutable target", () => {
    const { wrapper } = mountCard({ link: null, copyText: "SELECT 1" });
    expect(wrapper.get('[data-test="assistant-link-card-title"]').text()).toBe(
      "Can't open this here",
    );
    expect(wrapper.get('[data-test="assistant-link-card-open"]').attributes("aria-disabled")).toBe(
      "true",
    );
    expect(wrapper.find('[data-test="assistant-link-card-copy"]').exists()).toBe(true);
  });

  it("opens only in a new tab on a shared page", () => {
    const { wrapper } = mountCard({ link: dashboard, readonly: true }, false);
    expect(wrapper.find('[data-test="assistant-link-card-open"]').exists()).toBe(false);
    const tab = wrapper.get('[data-test="assistant-link-card-new-tab"]');
    expect(tab.attributes("target")).toBe("_blank");
    expect(tab.attributes("rel")).toContain("noopener");
  });

  it("offers no Open for a chat of another org, nor on a readonly page without an explorer", () => {
    const other = mountCard({ link: dashboard }, true, false, "acme");
    expect(other.wrapper.find('[data-test="assistant-link-card-open"]').exists()).toBe(false);
    expect(other.wrapper.find('[data-test="assistant-link-card-new-tab"]').exists()).toBe(false);
    const closed = mountCard({ link: dashboard, readonly: true, openable: false }, false);
    expect(closed.wrapper.find('[data-test^="assistant-link-card-"][href]').exists()).toBe(false);
  });

  it("captions a Markdown link so it never looks like a tool navigation", () => {
    const { wrapper } = mountCard({ link: dashboard, source: "markdown" });
    expect(wrapper.get('[data-test="assistant-link-card-caption"]').text()).toBe(
      "Link in the answer",
    );
  });
});
