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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import type { Router } from "vue-router";
import store from "@/test/unit/helpers/store";
import alertsService from "@/services/alerts";
import streamService from "@/services/stream";
import { invalidateSiemDetections } from "@/composables/security/useSiemDetections";
import {
  RULE_ACCESS_KEY,
  RULE_STOP_LOGGING,
  alertListResponse,
  authorOnly,
  grantAll,
  makeSecurityRouter,
  schemaStreamsResponse,
  triageOnly,
} from "./__fixtures__/securityFixtures";

vi.mock("@/services/securitySigma", async () =>
  (await import("@/views/Security/__fixtures__/sigmaFixtures")).mockSigmaService(),
);
vi.mock("@/services/securitySources.queries", async () =>
  (await import("./__fixtures__/securityFixtures")).sourceQueriesModule(),
);
vi.mock("@/services/alerts", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/alerts")>());
});
vi.mock("@/services/stream", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/stream")>());
});
vi.mock("@/composables/security/useSecurityAccess", async (importOriginal) => {
  const f = await import("./__fixtures__/securityFixtures");
  return {
    ...(await importOriginal<typeof import("@/composables/security/useSecurityAccess")>()),
    useSecurityAccess: f.mockSecurityAccess,
    loadSecurityAccess: async () => ({ read: true, ...f.accessGrants }),
    isSecurityGated: () => false,
  };
});
vi.mock("@/lib/overlay/Drawer/ODrawer.vue", async () => {
  const f = await import("./__fixtures__/securityFixtures");
  return f.drawerStubModule;
});

import SecurityContent from "./SecurityContent.vue";

let wrapper: VueWrapper | null = null;
let router: Router;

const mountView = async (start = "/security/content") => {
  router = await makeSecurityRouter(start);
  wrapper = mount(SecurityContent, { global: { provide: { store }, plugins: [store, router] } });
  await flushPromises();
  return wrapper;
};

const search = async (w: VueWrapper, text: string) => {
  await w.find('[data-test="security-content-search-rules"] input').setValue(text);
  await flushPromises();
};

const ruleRow = (w: VueWrapper, title: string) =>
  w
    .findAll('[data-test="security-content-rules-table"] tr')
    .find((tr) => tr.text().includes(title));

beforeEach(() => {
  grantAll();
  invalidateSiemDetections();
  vi.mocked(alertsService.listByFolderId).mockResolvedValue(alertListResponse() as never);
  vi.mocked(streamService.nameList).mockResolvedValue(schemaStreamsResponse() as never);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("SecurityContent", () => {
  it("marks the two seed detections installed and the CloudTrail rules as matching our data", async () => {
    const w = await mountView();
    expect(streamService.nameList).toHaveBeenCalledWith("default", "logs", true);
    expect(w.find('[data-test="security-content-stat-installed"]').text()).toContain("2");
    await search(w, "CloudTrail Logging");
    const row = ruleRow(w, RULE_STOP_LOGGING.title);
    expect(row?.text()).toContain("Installed");
    expect(row?.text()).toContain("T1562.008");
    expect(row?.text()).toContain("1 stream");
  });

  it("offers a not-yet-installed CloudTrail rule as ready to install", async () => {
    const w = await mountView();
    await search(w, "Root Account");
    const row = ruleRow(w, "AWS Root Account Activity");
    expect(row?.text()).toContain("Ready to install");
    expect(ruleRow(w, RULE_ACCESS_KEY.title)).toBeUndefined();
  });

  it("opens a rule and routes Install to Detections on the one stream it runs on", async () => {
    const w = await mountView();
    await search(w, "Root Account");
    await ruleRow(w, "AWS Root Account Activity")!.trigger("click");
    await flushPromises();
    expect(w.find('[data-test="security-content-rule-drawer"]').text()).toContain(
      "AWS Root Account Activity",
    );
    const push = vi.spyOn(router, "push");
    await w.find('[data-test="security-content-rule-install"]').trigger("click");
    expect(push).toHaveBeenCalledWith({
      path: "/security/detections",
      query: {
        org_identifier: "default",
        sigma_id: "2b1a2a3d-6b41-4e58-91f0-31b7e4b8b7a1",
        stream: "aws_cloudtrail",
        source: "aws_cloudtrail",
      },
    });
  });

  it("lists data source types with the streams classified into them", async () => {
    const w = await mountView("/security/content?tab=sources");
    const table = w.find('[data-test="security-content-sources-table"]');
    expect(table.exists()).toBe(true);
    const cloudtrail = table.findAll("tr").find((tr) => tr.text().includes("AWS CloudTrail"));
    expect(cloudtrail?.text()).toContain("Amazon Web Services");
  });
});

describe("SecurityContent authoring access", () => {
  const openRootRule = async () => {
    const w = await mountView();
    await search(w, "Root Account");
    await ruleRow(w, "AWS Root Account Activity")!.trigger("click");
    await flushPromises();
    await w
      .find('[data-test="security-content-rule-drawer-tab-streams"]')
      .trigger("mousedown", { button: 0 });
    await flushPromises();
    return w;
  };

  it("lets a triage-only analyst browse a rule and open it in Events but not install it", async () => {
    triageOnly();
    const w = await openRootRule();
    const install = w.find('[data-test="security-content-rule-install"]');
    expect(install.attributes("disabled")).toBeDefined();
    expect(
      w.find('[data-test="security-content-rule-stream-install-aws_cloudtrail"]').exists(),
    ).toBe(false);
    expect(
      w.find('[data-test="security-content-rule-stream-events-aws_cloudtrail"]').exists(),
    ).toBe(true);
    const push = vi.spyOn(router, "push");
    await install.trigger("click");
    expect(push).not.toHaveBeenCalled();
  });

  it("lets an author install a rule", async () => {
    authorOnly();
    const w = await openRootRule();
    expect(
      w.find('[data-test="security-content-rule-install"]').attributes("disabled"),
    ).toBeUndefined();
    expect(
      w.find('[data-test="security-content-rule-stream-install-aws_cloudtrail"]').exists(),
    ).toBe(true);
  });
});

describe("SecurityContent rules not runnable yet", () => {
  const SEEN_KEY = "oo_sec_runnable_seen_default";

  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  /** The compile answer with the root rule refused on CloudTrail for a missing column. */
  const refuseRootRule = async () => {
    const sigma = (await import("@/services/securitySigma")).default;
    const { compileFixture, rootRule } =
      await import("@/views/Security/__fixtures__/sigmaFixtures");
    vi.spyOn(sigma, "compile").mockImplementation(async (_org, body) => {
      const res = compileFixture(body);
      res.applicable = res.applicable.map((a) =>
        a.key === rootRule.key
          ? {
              key: a.key,
              compiled: {
                ...a.compiled,
                runnable: false,
                where: "",
                reason: "No column userIdentity",
              },
            }
          : a,
      );
      return { data: res } as never;
    });
    return rootRule;
  };

  it("selects every runnable rule and offers one bulk install for them", async () => {
    const w = await mountView();
    const ready = w.find('[data-test="security-content-stat-ready"]').text().match(/\d+/)?.[0];
    expect(Number(ready)).toBeGreaterThan(0);
    await w.find('[data-test="security-content-select-runnable"]').trigger("click");
    await flushPromises();
    await w.find('[data-test="security-content-install-selected"]').trigger("click");
    await flushPromises();
    const targets = document.querySelectorAll('[data-test="security-content-bulk-targets"] li');
    expect(targets.length).toBe(Number(ready));
    expect(document.body.textContent).toContain(`Install ${ready} detection`);
  });

  it("offers no bulk selection to a triage-only analyst", async () => {
    triageOnly();
    const w = await mountView();
    expect(w.find('[data-test="security-content-select-runnable"]').exists()).toBe(false);
  });

  it("shows a rule that applies but cannot run yet, with the server's reason", async () => {
    const rootRule = await refuseRootRule();
    const w = await mountView();
    await search(w, "Root Account");
    const mark = w.find(`[data-test="security-content-not-runnable-${rootRule.key}"]`);
    expect(mark.text()).toContain("Not runnable yet");
    expect(mark.findComponent({ name: "OTooltip" }).props("content")).toBe(
      "No column userIdentity",
    );
    expect(ruleRow(w, "AWS Root Account Activity")?.text()).not.toContain("Ready to install");
  });

  it("records what each stream can run on a first visit without announcing anything new", async () => {
    const w = await mountView();
    expect(w.find('[data-test="security-content-new-rules-aws_cloudtrail"]').exists()).toBe(false);
    const seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
    expect(seen.aws_cloudtrail).toContain("2b1a2a3d-6b41-4e58-91f0-31b7e4b8b7a1");
  });

  it("counts rules that became runnable on a stream since the last visit and lists them on review", async () => {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ aws_cloudtrail: [] }));
    const w = await mountView();
    const notice = w.find('[data-test="security-content-new-rules-aws_cloudtrail"]');
    // The two seed CloudTrail rules are already installed, so only the root rule is new.
    expect(notice.text()).toContain("1 new rule can now run on aws_cloudtrail");
    await w.find('[data-test="security-content-new-rules-aws_cloudtrail-action"]').trigger("click");
    await flushPromises();
    expect(ruleRow(w, "AWS Root Account Activity")).toBeDefined();
    expect(ruleRow(w, RULE_STOP_LOGGING.title)).toBeUndefined();
    expect(w.find('[data-test="security-content-reviewing-new"]').text()).toContain(
      "Showing 1 rule that can now run on aws_cloudtrail",
    );
    expect(w.find('[data-test="security-content-new-rules-aws_cloudtrail"]').exists()).toBe(false);
    expect(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}").aws_cloudtrail).toContain(
      "2b1a2a3d-6b41-4e58-91f0-31b7e4b8b7a1",
    );
  });

  it("does not count a rule that still cannot run", async () => {
    await refuseRootRule();
    localStorage.setItem(SEEN_KEY, JSON.stringify({ aws_cloudtrail: [] }));
    const w = await mountView();
    expect(w.find('[data-test="security-content-new-rules-aws_cloudtrail"]').exists()).toBe(false);
  });
  it("locks the lists when the stream list is refused, instead of a raw 403 bar", async () => {
    vi.mocked(streamService.nameList).mockRejectedValue({
      response: { status: 403, data: { code: 403, message: "Unauthorized Access" } },
      message: "Request failed with status code 403",
      config: { method: "get", url: "/api/default/streams" },
    } as never);
    const w = await mountView();
    const lock = w.find('[data-test="security-content-access-lock"]');
    expect(lock.exists()).toBe(true);
    expect(lock.text()).toContain("You can't view streams");
    expect(w.find('[data-test="security-content-streams-error"]').exists()).toBe(false);
    expect(w.text()).not.toContain("Request failed with status code 403");
    expect(w.find('[data-test="security-content-rules-table"]').exists()).toBe(false);
  });

  it("locks the lists when the detection list is refused, since every row would read as not installed", async () => {
    invalidateSiemDetections();
    vi.mocked(alertsService.listByFolderId).mockRejectedValue({
      response: { status: 403, data: { code: 403, message: "Unauthorized Access" } },
      config: { method: "get", url: "/api/v2/default/alerts" },
    } as never);
    const w = await mountView();
    expect(w.find('[data-test="security-content-access-lock"]').text()).toContain("alerts");
  });
});
