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
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import { SOURCE_TYPE_BY_ID } from "@/views/Security/__fixtures__/securitySourceTypes";
import { normalizeEvent } from "@/utils/security/normalize";
import type { RuleHit } from "@/composables/security/useSigmaRules";
import { ATTACKER_IP, cloudtrailEvent, okResponse } from "./__fixtures__/securityFixtures";

const search = vi.hoisted(() => vi.fn());
const promoteEvent = vi.hoisted(() => vi.fn());
const listCases = vi.hoisted(() => vi.fn());
const access = vi.hoisted(() => ({ triage: true }));

vi.mock("@/services/search", () => ({ default: { search } }));
vi.mock("@/composables/security/useSecurityStreamPlans", async (importOriginal) => {
  const f = await import("./__fixtures__/securityFixtures");
  return {
    ...(await importOriginal<typeof import("@/composables/security/useSecurityStreamPlans")>()),
    runSql: f.runSqlVia(search),
  };
});
vi.mock("@/services/securityCases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/securityCases")>();
  return { ...actual, default: { ...actual.default, promoteEvent } };
});
vi.mock("@/services/incidents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/incidents")>();
  return { ...actual, default: { ...actual.default, list: listCases } };
});
vi.mock("@/composables/security/useSecurityAccess", async () => {
  const { computed } = await import("vue");
  return { useSecurityAccess: () => ({ canTriage: computed(() => access.triage) }) };
});
vi.mock("@/lib/overlay/Drawer/ODrawer.vue", async () => {
  const f = await import("./__fixtures__/securityFixtures");
  return f.drawerStubModule;
});

import SecurityEventDrawer from "./SecurityEventDrawer.vue";

const event = cloudtrailEvent({
  eventname: "StopLogging",
  eventsource: "cloudtrail.amazonaws.com",
});
const detected = {
  source: SOURCE_TYPE_BY_ID.get("aws_cloudtrail")!,
  confidence: 0.85,
  matchedRequired: ["eventname", "eventsource"],
  matchedSignals: ["awsregion", "sourceipaddress", "useridentity_type"],
  isSecurity: true,
};
const normalized = normalizeEvent(event, detected.source);

const rule = (id: string, title: string, techniques: string[], tactics: string[]): RuleHit =>
  ({
    rule: {
      key: id,
      id,
      title,
      description: `${title} from an unfamiliar IP`,
      level: "high",
      logsource: { product: "aws", service: "cloudtrail" },
      techniques,
      tactics,
    },
    compiled: {
      where: `"eventname" = '${title}'`,
      runnable: true,
      unsupported: [],
      assumedAbsent: [],
      fields: ["eventname"],
    },
    count: null,
  }) as unknown as RuleHit;

const rules: RuleHit[] = [
  rule(
    "cloudtrail-stop-logging",
    "AWS CloudTrail Logging Stopped",
    ["T1562.008"],
    ["defense_evasion"],
  ),
  rule("cloudtrail-create-key", "AWS IAM Access Key Created", ["T1098.001"], ["persistence"]),
];

let wrapper: VueWrapper | null = null;

const mountDrawer = async (props: Record<string, unknown> = {}) => {
  wrapper = mount(SecurityEventDrawer, {
    props: {
      open: true,
      event,
      normalized,
      detected,
      stream: "aws_cloudtrail",
      orgId: "default",
      rules,
      index: 2,
      total: 10,
      ...props,
    },
    global: {
      provide: { store },
      plugins: [store, [VueQueryPlugin, { queryClient: new QueryClient() }]],
    },
  });
  await flushPromises();
  return wrapper;
};

beforeEach(() => {
  access.triage = true;
  search.mockResolvedValue(okResponse({ hits: [{ r0: 1, r1: 0 }] }));
  listCases.mockResolvedValue(okResponse({ incidents: [], total: 0 }));
  promoteEvent.mockResolvedValue(okResponse({ id: "case-1", title: "Event from aws_cloudtrail" }));
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("SecurityEventDrawer", () => {
  it("classifies a CloudTrail row and shows its entities and matched-rule count", async () => {
    expect(detected?.source.id).toBe("aws_cloudtrail");
    const w = await mountDrawer();
    expect(w.text()).toContain("aws_cloudtrail");
    expect(w.text()).toContain("AWS CloudTrail");
    expect(w.find('[data-test="security-event-drawer-entity-actor"]').text()).toContain(
      "svc-deploy",
    );
    expect(w.find('[data-test="security-event-drawer-entity-srcIp"]').text()).toContain(
      ATTACKER_IP,
    );
    expect(w.text()).toContain("1 detection matched");
  });

  it("evaluates the runnable rules against exactly this row", async () => {
    await mountDrawer();
    expect(search).toHaveBeenCalledTimes(1);
    const [body, source] = search.mock.calls[0];
    expect(source).toBe("ui");
    expect(body.org_identifier).toBe("default");
    expect(body.query.query.sql).toContain('FROM "aws_cloudtrail"');
    expect(body.query.query.sql).toContain("AS r0");
    expect(body.query.query.sql).toContain("AS r1");
    expect(body.query.query.start_time).toBe(event._timestamp - 1_000_000);
  });

  it("lists only the matched rule and its technique on the detections tab", async () => {
    const w = await mountDrawer();
    await w
      .find('[data-test="security-event-drawer-tab-detections"]')
      .trigger("mousedown", { button: 0 });
    await flushPromises();
    expect(
      w.find('[data-test="security-event-drawer-match-cloudtrail-stop-logging"]').text(),
    ).toContain("AWS CloudTrail Logging Stopped");
    expect(w.find('[data-test="security-event-drawer-match-cloudtrail-create-key"]').exists()).toBe(
      false,
    );
    expect(w.find('[data-test="security-event-drawer-technique-T1562.008"]').exists()).toBe(true);
  });

  it("emits an include filter with the raw source column when an entity is pivoted", async () => {
    const w = await mountDrawer();
    await w.find('[data-test="security-event-drawer-entity-srcIp-include"]').trigger("click");
    expect(w.emitted("add-filter")?.[0]).toEqual(["sourceipaddress", ATTACKER_IP, "="]);
  });

  it("opens a case from the event it shows", async () => {
    const w = await mountDrawer();
    await w.find('[data-test="security-event-drawer-open-case"]').trigger("click");
    await flushPromises();
    expect(promoteEvent).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({
        stream: "aws_cloudtrail",
        timestamp: Number(event._timestamp),
        fields: event,
      }),
      undefined,
    );
  });

  it("offers no case actions without triage access", async () => {
    access.triage = false;
    const w = await mountDrawer();
    expect(w.find('[data-test="security-event-drawer-open-case"]').exists()).toBe(false);
    expect(w.find('[data-test="security-event-drawer-add-to-case"]').exists()).toBe(false);
  });
});
