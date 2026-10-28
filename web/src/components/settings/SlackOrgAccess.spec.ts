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
import { queryClient } from "@/composables/query/queryClient";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import SlackOrgAccess from "./SlackOrgAccess.vue";
import {
  OTableStub,
  axiosError,
  instanceView,
  makeSlackStore,
  ok,
  orgAccessView,
} from "@/test/unit/helpers/slack";
import type { SlackOrgAccessView } from "@/types/slack";

vi.mock("@/services/slack", () => ({
  default: { getOrgAccess: vi.fn(), putOrgAccess: vi.fn(), previewOrgAccess: vi.fn() },
}));

const body = () => new DOMWrapper(document.body);
const dialogButton = (testId: string) =>
  body()
    .findAll("button")
    .find((b) => b.attributes("data-test") === testId);

const installation = instanceView({ id: "inst-acme", team_name: "Acme Corp" });

const mountAccess = (view: SlackOrgAccessView = orgAccessView()) => {
  queryClient.clear();
  vi.mocked(slack.getOrgAccess).mockReturnValue(ok(view) as any);
  const store = makeSlackStore({ slack_enabled: true, meta_org: "_meta" });
  store.state.selectedOrganization = { identifier: "_meta", name: "_meta" };
  return mount(SlackOrgAccess, {
    props: { installation },
    attachTo: document.body,
    global: { plugins: [i18n, store], stubs: { OTable: OTableStub } },
  });
};

const pick = async (w: ReturnType<typeof mountAccess>, orgs: string[]) => {
  w.findComponent(OSelect).vm.$emit("update:modelValue", orgs);
  await flushPromises();
};

const chooseMode = async (w: ReturnType<typeof mountAccess>, mode: "all" | "listed") => {
  w.findComponent(OToggleGroup).vm.$emit("update:modelValue", mode);
  await flushPromises();
};

const save = async (w: ReturnType<typeof mountAccess>) => {
  await w.find('[data-test="slack-org-access-save"]').trigger("click");
  await flushPromises();
};

const rowOf = (w: ReturnType<typeof mountAccess>, org: string) =>
  w.findAll('[data-test-stub="otable-row"]').find((r) => r.find('[data-col="org"]').text() === org);

const stagingRemoved = orgAccessView({
  removed: [
    {
      org_id: "staging",
      org_name: "staging",
      channels: ["staging-alerts"],
      links_moving: 9,
      links_unlinked: 3,
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(slack.putOrgAccess).mockImplementation(((_o: string, _i: string, req: any) =>
    ok(orgAccessView({ all: !!req.all }))) as any);
  vi.mocked(slack.previewOrgAccess).mockReturnValue(ok(stagingRemoved) as any);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SlackOrgAccess (row 24, mockup M1)", () => {
  it("shows the only-_meta banner after install", async () => {
    const meta = orgAccessView().orgs[0];
    const w = mountAccess(orgAccessView({ orgs: [meta], other_apps_in_team: [] }));
    await flushPromises();
    expect(slack.getOrgAccess).toHaveBeenCalledWith("_meta", "inst-acme");
    const banner = w.find('[data-test="slack-org-access-only-meta"]');
    expect(banner.text()).toContain("Only _meta can use Acme Corp so far.");
    expect(banner.text()).toContain("Choose the organizations that can.");
    expect(w.find('[data-test="slack-org-access-count"]').text()).toBe("1 of 8 organizations");

    const served = mountAccess();
    await flushPromises();
    expect(served.find('[data-test="slack-org-access-only-meta"]').exists()).toBe(false);
    expect(served.find('[data-test="slack-org-access-count"]').text()).toBe("4 of 8 organizations");
  });

  it("the picker shows each org's member count", async () => {
    const view = orgAccessView();
    view.organizations.push({ org_id: "solo", org_name: "Solo team", members: 1 });
    const w = mountAccess(view);
    await flushPromises();
    const options = w.findComponent(OSelect).props("options") as any[];
    const byValue = Object.fromEntries(options.map((o) => [o.value, o]));
    expect(byValue.dev.label).toBe("dev");
    expect(byValue.dev.subLabel).toBe("18 members");
    expect(byValue["dev-sandbox"].subLabel).toBe("3 members");
    expect(byValue.solo.label).toBe("Solo team");
    expect(byValue.solo.subLabel).toBe("1 member");
    expect(byValue._meta.disabled).toBe(true);
    expect(byValue.prod.disabled).toBeFalsy();
  });

  it("All organizations hides the picker and saves all true", async () => {
    const w = mountAccess();
    await flushPromises();
    expect(w.find('[data-test="slack-org-access-picker"]').exists()).toBe(true);

    await chooseMode(w, "all");
    expect(w.find('[data-test="slack-org-access-picker"]').exists()).toBe(false);
    expect(w.text()).toContain(
      "All 8 organizations can use Acme Corp, and every organization created later.",
    );
    expect(w.find('[data-test="slack-org-access-count"]').text()).toBe("8 of 8 organizations");

    await save(w);
    expect(slack.putOrgAccess).toHaveBeenCalledWith("_meta", "inst-acme", { all: true });
    expect(slack.previewOrgAccess).not.toHaveBeenCalled();
  });

  it("Selected organizations saves the picked orgs with _meta locked in", async () => {
    const w = mountAccess();
    await flushPromises();
    expect(rowOf(w, "_meta")!.text()).toContain("at install");
    expect(rowOf(w, "prod")!.text()).toContain("by ashish@acme.example");
    expect(rowOf(w, "payments")!.text()).toContain("Joined itself before take-over");

    await pick(w, ["prod", "staging", "payments", "devops"]);
    expect(w.findComponent(OSelect).props("modelValue")).toEqual([
      "_meta",
      "prod",
      "staging",
      "payments",
      "devops",
    ]);
    expect(rowOf(w, "devops")!.text()).toContain("Not saved");
    expect(w.find('[data-test="slack-org-access-count"]').text()).toBe("5 of 8 organizations");

    await save(w);
    expect(slack.previewOrgAccess).not.toHaveBeenCalled();
    expect(slack.putOrgAccess).toHaveBeenCalledWith("_meta", "inst-acme", {
      orgs: ["_meta", "prod", "staging", "payments", "devops"],
    });
  });

  it("removing an org asks to confirm with its channel defaults and links", async () => {
    const w = mountAccess();
    await flushPromises();
    await pick(w, ["_meta", "prod", "payments"]);
    await save(w);

    const confirm = body().find('[data-test="slack-org-access-confirm"]');
    expect(confirm.text()).toContain("Remove staging from Acme Corp?");
    expect(confirm.text()).toContain("People in staging stop getting answers from Acme Corp.");
    expect(
      confirm.find('[data-test="slack-org-access-removal-lead"] span.font-semibold').text(),
    ).toBe("staging");
    expect(dialogButton("o-dialog-primary-btn")!.classes()).toContain("bg-button-destructive");
    expect(confirm.text()).toContain("1 channel default is removed (#staging-alerts)");
    expect(confirm.text()).toContain(
      "12 linked people: 9 move to another org they belong to, 3 are unlinked",
    );
    expect(confirm.text()).toContain("Open threads in staging get no more answers");
    expect(confirm.text()).toContain("Alert destinations in staging are not changed.");
    expect(slack.putOrgAccess).not.toHaveBeenCalled();

    await dialogButton("o-dialog-secondary-btn")!.trigger("click");
    await flushPromises();
    expect(slack.putOrgAccess).not.toHaveBeenCalled();
    expect(w.findComponent(OSelect).props("modelValue")).toEqual(["_meta", "prod", "payments"]);
  });

  it("Save that removes an org asks the server preview first and confirms with its channels and the moving and unlinked counts", async () => {
    vi.mocked(slack.previewOrgAccess).mockReturnValue(
      ok(
        orgAccessView({
          removed: [
            {
              org_id: "staging",
              org_name: "staging",
              channels: ["staging-alerts", "staging-deploys"],
              links_moving: 4,
              links_unlinked: 1,
            },
          ],
        }),
      ) as any,
    );
    const w = mountAccess();
    await flushPromises();
    await pick(w, ["_meta", "prod", "payments"]);
    await save(w);

    const body_ = { orgs: ["_meta", "prod", "payments"] };
    expect(slack.previewOrgAccess).toHaveBeenCalledWith("_meta", "inst-acme", body_);
    expect(slack.putOrgAccess).not.toHaveBeenCalled();
    const confirm = body().find('[data-test="slack-org-access-confirm"]');
    expect(confirm.text()).toContain(
      "2 channel defaults are removed (#staging-alerts, #staging-deploys)",
    );
    expect(confirm.text()).toContain(
      "5 linked people: 4 move to another org they belong to, 1 are unlinked",
    );

    await dialogButton("o-dialog-primary-btn")!.trigger("click");
    await flushPromises();
    expect(slack.putOrgAccess).toHaveBeenCalledWith("_meta", "inst-acme", body_);
    expect(body().find('[data-test="slack-org-access-confirm"]').exists()).toBe(false);
  });

  it("switching to All saves without a confirm", async () => {
    const w = mountAccess();
    await flushPromises();
    await pick(w, ["_meta", "prod"]);
    await chooseMode(w, "all");
    await save(w);
    expect(slack.previewOrgAccess).not.toHaveBeenCalled();
    expect(body().find('[data-test="slack-org-access-confirm"]').exists()).toBe(false);
    expect(slack.putOrgAccess).toHaveBeenCalledWith("_meta", "inst-acme", { all: true });
  });

  it("lists other apps in the team", async () => {
    const w = mountAccess(
      orgAccessView({
        other_apps_in_team: [
          { installation_id: "inst-labs", org_ids: ["labs"] },
          { installation_id: "inst-qa", org_ids: ["qa", "qa-eu"] },
        ],
      }),
    );
    await flushPromises();
    const banners = w.findAll('[data-test="slack-org-access-other-app"]');
    expect(banners).toHaveLength(2);
    expect(banners[0].text()).toContain("Another OpenObserve app is installed in Acme Corp");
    expect(banners[0].text()).toContain("org labs installed it before");
    expect(banners[1].text()).toContain("org qa, qa-eu installed it before");

    const none = mountAccess(orgAccessView({ other_apps_in_team: [] }));
    await flushPromises();
    expect(none.find('[data-test="slack-org-access-other-app"]').exists()).toBe(false);
  });

  it("a failed save keeps the selection and shows the server message", async () => {
    vi.mocked(slack.putOrgAccess).mockRejectedValue(axiosError(409, "_meta is always included"));
    const w = mountAccess();
    await flushPromises();
    await pick(w, ["_meta", "prod", "staging", "payments", "devops"]);
    await save(w);

    expect(w.find('[data-test="slack-org-access-error"]').text()).toContain(
      "_meta is always included",
    );
    expect(w.findComponent(OSelect).props("modelValue")).toEqual([
      "_meta",
      "prod",
      "staging",
      "payments",
      "devops",
    ]);
    expect(rowOf(w, "devops")!.text()).toContain("Not saved");

    vi.mocked(slack.previewOrgAccess).mockRejectedValue(axiosError(409, "preview refused"));
    await pick(w, ["_meta", "prod"]);
    await save(w);
    expect(w.find('[data-test="slack-org-access-error"]').text()).toContain("preview refused");
    expect(body().find('[data-test="slack-org-access-confirm"]').exists()).toBe(false);
    expect(w.findComponent(OSelect).props("modelValue")).toEqual(["_meta", "prod"]);
  });
});
