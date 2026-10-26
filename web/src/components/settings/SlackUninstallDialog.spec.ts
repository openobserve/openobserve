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
import destinationService from "@/services/alert_destination";
import SlackUninstallDialog from "./SlackUninstallDialog.vue";
import { axiosError, installationView, makeSlackStore, ok } from "@/test/unit/helpers/slack";

vi.mock("@/services/slack", () => ({
  default: { disconnectInstallation: vi.fn(), uninstallInstallation: vi.fn() },
}));
vi.mock("@/services/alert_destination", () => ({ default: { bulkDelete: vi.fn() } }));

const body = () => new DOMWrapper(document.body);
const primary = () =>
  body()
    .findAll("button")
    .find((b) => b.attributes("data-test") === "o-dialog-primary-btn");

const errorHandler = vi.fn();

const mountDialog = (mode: "disconnect" | "uninstall") =>
  mount(SlackUninstallDialog, {
    props: { open: true, mode, installation: installationView() },
    attachTo: document.body,
    global: { plugins: [i18n, makeSlackStore()], config: { errorHandler } },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(slack.disconnectInstallation).mockReturnValue(
    ok({ stopped_destinations: [{ id: "d1", name: "sre-prod-slack", org_id: "acme" }] }) as any,
  );
  vi.mocked(slack.uninstallInstallation).mockReturnValue(
    ok({
      revoked: true,
      affected: {
        orgs: 3,
        destinations: [
          { id: "d1", name: "sre-prod-slack", org_id: "acme" },
          { id: "d2", name: "payments-slack", org_id: "acme" },
        ],
        links_revoked: 14,
      },
      delete_app_url: "https://api.slack.com/apps/A0SAMPLE01/general",
    }) as any,
  );
  vi.mocked(destinationService.bulkDelete).mockReturnValue(
    ok({ successful: ["sre-prod-slack", "payments-slack"], unsuccessful: [] }) as any,
  );
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SlackUninstallDialog: Disconnect this org (row 17)", () => {
  it("AC-12.2 says nobody relinks, counts this org's destinations, then lists the ones that stopped", async () => {
    mountDialog("disconnect");
    await flushPromises();
    expect(body().text()).toContain("Disconnect this org from Acme Corp?");
    expect(body().text()).toContain("nobody relinks");
    expect(body().text()).toContain("4 alert destinations in this org stop posting.");

    await primary()!.trigger("click");
    await flushPromises();
    expect(slack.disconnectInstallation).toHaveBeenCalledWith("acme", "inst-1");
    const result = body().find('[data-test="slack-dialog-result"]');
    expect(body().text()).toContain("Disconnected from Acme Corp");
    expect(result.text()).toContain("sre-prod-slack");
  });
});

describe("SlackUninstallDialog: Uninstall from workspace (row 19)", () => {
  it("AC-12.2 warns everyone must relink and counts other orgs without naming them", async () => {
    mountDialog("uninstall");
    await flushPromises();
    expect(body().text()).toContain("Uninstall from Acme Corp?");
    expect(body().text()).toContain("Everyone must relink");
    expect(body().text()).toContain("1 other org is connected too.");
  });

  it("AC-12.1 AC-12.2 shows the result: other orgs as a count, links, this org's destinations and the Delete App link", async () => {
    mountDialog("uninstall");
    await flushPromises();
    await primary()!.trigger("click");
    await flushPromises();
    expect(slack.uninstallInstallation).toHaveBeenCalledWith("acme", "inst-1");
    const result = body().find('[data-test="slack-dialog-result"]');
    expect(body().text()).toContain("Uninstalled from Acme Corp");
    expect(result.text()).toContain("2 other orgs also lost Slack.");
    expect(result.text()).toContain("14 links were revoked.");
    expect(result.text()).toContain("sre-prod-slack");
    expect(result.text()).toContain("payments-slack");
    expect(result.find('[data-test="slack-delete-app"]').attributes("href")).toBe(
      "https://api.slack.com/apps/A0SAMPLE01/general",
    );
  });

  it.each([
    "javascript:alert(document.domain)",
    "https://evil.example/apps/A0SAMPLE01/general",
    "https://slack.com/apps/A0SAMPLE01/general",
  ])("never links the Delete App button to %s", async (url) => {
    vi.mocked(slack.uninstallInstallation).mockReturnValue(
      ok({
        revoked: true,
        affected: { orgs: 1, destinations: [], links_revoked: 0 },
        delete_app_url: url,
      }) as any,
    );
    mountDialog("uninstall");
    await flushPromises();
    await primary()!.trigger("click");
    await flushPromises();
    expect(body().find('[data-test="slack-dialog-result"]').exists()).toBe(true);
    expect(body().find('[data-test="slack-delete-app"]').exists()).toBe(false);
  });

  it("NIT-7 a refused uninstall keeps the confirm step without an unhandled error", async () => {
    vi.mocked(slack.uninstallInstallation).mockReturnValue(
      Promise.reject(axiosError(409, "2 alert destinations in other organizations")) as any,
    );
    mountDialog("uninstall");
    await flushPromises();
    await primary()!.trigger("click");
    await flushPromises();
    expect(body().find('[data-test="slack-dialog-confirm"]').exists()).toBe(true);
    expect(errorHandler).not.toHaveBeenCalled();
  });

  it("AC-12.2 removes the selected affected destinations in bulk", async () => {
    mountDialog("uninstall");
    await flushPromises();
    await primary()!.trigger("click");
    await flushPromises();
    expect(body().find('[data-test="slack-remove-destinations"]').exists()).toBe(false);
    await body().find('[data-test="o2-table-select-0"] button').trigger("click");
    await flushPromises();
    await body().find('[data-test="o2-table-select-1"] button').trigger("click");
    await flushPromises();
    expect(body().find('[data-test="slack-remove-destinations"]').exists()).toBe(true);
    expect(body().find('[data-test="slack-selected-count"]').text()).toBe("2 of 2 selected");
    await body().find('[data-test="slack-remove-destinations"]').trigger("click");
    await flushPromises();
    expect(destinationService.bulkDelete).toHaveBeenCalledWith("acme", {
      ids: ["sre-prod-slack", "payments-slack"],
    });
    expect(body().find('[data-test="slack-dialog-result"]').text()).not.toContain("payments-slack");
  });
});

describe("SlackUninstallDialog: instance workspace uninstalled from _meta (R-79)", () => {
  const mixed = [
    { id: "d1", name: "sre-prod-slack", org_id: "acme" },
    { id: "d2", name: "sre-prod-slack", org_id: "globex" },
    { id: "d3", name: "payments-slack", org_id: "acme" },
    { id: "d4", name: "billing-slack", org_id: "initech" },
  ];

  const uninstallMixed = async () => {
    vi.mocked(slack.uninstallInstallation).mockReturnValue(
      ok({
        revoked: true,
        affected: { orgs: 3, destinations: mixed, links_revoked: 2 },
        delete_app_url: null,
      }) as any,
    );
    mountDialog("uninstall");
    await flushPromises();
    await primary()!.trigger("click");
    await flushPromises();
  };

  const checkbox = (row: number) => body().find(`[data-test="o2-table-select-${row}"] button`);

  it("lists every org's destinations with their org and says where to remove the others", async () => {
    await uninstallMixed();
    const result = body().find('[data-test="slack-dialog-result"]');
    for (const org of ["acme", "globex", "initech"]) expect(result.text()).toContain(org);
    expect(result.text()).toContain("billing-slack");
    expect(result.find('[data-test="slack-other-org-note"]').text()).toContain(
      "alert destinations",
    );
  });

  it("disables selection of the other orgs' rows", async () => {
    await uninstallMixed();
    expect(checkbox(0).attributes("disabled")).toBeUndefined();
    expect(checkbox(1).attributes("disabled")).toBeDefined();
    expect(checkbox(2).attributes("disabled")).toBeUndefined();
    expect(checkbox(3).attributes("disabled")).toBeDefined();
    await checkbox(1).trigger("click");
    await flushPromises();
    expect(body().find('[data-test="slack-remove-destinations"]').exists()).toBe(false);
  });

  it("removes only this org's destinations, even when another org has one of the same name", async () => {
    await uninstallMixed();
    await body().find('[data-test="o2-table-select-all"] button').trigger("click");
    await flushPromises();
    expect(body().find('[data-test="slack-selected-count"]').text()).toBe("2 of 2 selected");
    await body().find('[data-test="slack-remove-destinations"]').trigger("click");
    await flushPromises();
    expect(destinationService.bulkDelete).toHaveBeenCalledTimes(1);
    expect(destinationService.bulkDelete).toHaveBeenCalledWith("acme", {
      ids: ["sre-prod-slack", "payments-slack"],
    });
    const result = body().find('[data-test="slack-dialog-result"]');
    expect(result.text()).toContain("globex");
    expect(result.text()).toContain("sre-prod-slack");
    expect(result.text()).toContain("billing-slack");
    expect(result.text()).not.toContain("payments-slack");
  });
});
