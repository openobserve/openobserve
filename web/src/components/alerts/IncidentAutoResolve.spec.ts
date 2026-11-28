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
import i18n from "@/locales";
import router from "@/test/unit/helpers/router";
import store from "@/test/unit/helpers/store";
import { axiosReply } from "@/test/unit/helpers/mockService";
import { queryClient } from "@/composables/query/queryClient";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = (await importOriginal<{ default: Record<string, unknown> }>()).default;
  return { default: { ...actual, isEnterprise: "true" } };
});

vi.mock("@/services/autoresolve", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { getIncident: vi.fn(), runSaved: vi.fn(), startRun: vi.fn(), getSummary: vi.fn() },
  });
});

vi.mock("@/services/ai_toolsets", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { list: vi.fn() } });
});

import autoresolve from "@/services/autoresolve";
import aiToolsets from "@/services/ai_toolsets";
import IncidentAutoResolve from "./IncidentAutoResolve.vue";

const service = vi.mocked(autoresolve);
const t = i18n.global.t;

const LIVE_RUN = {
  run_id: "run-1",
  state: "investigating",
  live: true,
  autoresolve_id: "af-1",
  name: "Roll back checkout",
  goal: "Find why checkout fails",
  trigger: { kind: "alert", label: "Started by the alert Checkout 5xx" },
  created_at_us: 1,
  ended_at_us: null,
};
const RELATED = [
  {
    id: "af-1",
    name: "Roll back checkout",
    goal: "Roll back the last deploy",
    trigger_kind: "incident",
    alert_id: "a1",
    alert_name: "Checkout 5xx",
    connections: [{ id: "c1", name: "GitHub" }],
  },
  {
    id: "af-2",
    name: "Restart payments",
    goal: "Restart the payment pods",
    trigger_kind: "alert",
    alert_id: "a2",
    alert_name: "Payments down",
    connections: [],
  },
];

const incident = (overrides: Record<string, unknown> = {}) =>
  axiosReply({
    incident_id: "inc-1",
    run: null,
    related: RELATED,
    suggested_goal: null,
    ...overrides,
  });

const sel = (id: string) => `[data-test="incident-autoresolve-${id}"]`;

let wrapper: VueWrapper | undefined;
let push: ReturnType<typeof vi.spyOn>;

const mountSection = async () => {
  wrapper = mount(IncidentAutoResolve, {
    props: { orgId: "default", incidentId: "inc-1" },
    global: { plugins: [i18n, store, router], provide: { store } },
  });
  await flushPromises();
  return wrapper;
};

const runPage = (id: string) => ({
  name: "autoresolveRun",
  params: { id },
  query: { org_identifier: "default" },
});

beforeEach(() => {
  store.state.zoConfig.autoresolve_enabled = true;
  push = vi.spyOn(router, "push").mockResolvedValue(undefined);
});

afterEach(() => {
  wrapper?.unmount();
  delete store.state.zoConfig.autoresolve_enabled;
  queryClient.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("IncidentAutoResolve", () => {
  it("shows the incident's live run and locks every start, naming that run", async () => {
    service.getIncident.mockResolvedValue(incident({ run: LIVE_RUN }));
    const w = await mountSection();

    expect(service.getIncident).toHaveBeenCalledWith("default", "inc-1");
    const run = w.find(sel("run"));
    expect(run.text()).toContain(t("autoresolve.state.investigating"));
    expect(run.text()).toContain("Roll back checkout");
    expect(run.text()).toContain("Find why checkout fails");
    expect(w.find(sel("live")).text()).toBe(t("autoresolve.incident.liveRun"));

    expect(w.find(sel("run-af-1")).attributes("disabled")).toBeDefined();
    expect(w.find(sel("run-af-2")).attributes("disabled")).toBeDefined();
    expect(w.find(sel("new-run")).attributes("disabled")).toBeDefined();
    const locked = t("autoresolve.incident.runLocked", { run: "Roll back checkout" });
    const tooltips = w.findAllComponents(OTooltip).filter((c) => c.props("content") === locked);
    expect(tooltips).toHaveLength(3);
    expect(tooltips.every((c) => c.props("disabled") === false)).toBe(true);

    await w.find(sel("open-run")).trigger("click");
    expect(push).toHaveBeenCalledWith(runPage("run-1"));
  });

  it("Run starts the saved AutoResolve for this incident and opens its run", async () => {
    service.getIncident.mockResolvedValue(incident());
    service.runSaved.mockResolvedValue(axiosReply({ run_id: "run-9" }));
    const w = await mountSection();

    const kinds = w.findAll(sel("related-kind")).map((k) => k.text());
    expect(kinds).toEqual([
      t("autoresolve.incident.suggestedFor", { alert: "Checkout 5xx" }),
      t("autoresolve.incident.startsOn", { alert: "Payments down" }),
    ]);
    expect(w.find(sel("run-af-2")).attributes("disabled")).toBeUndefined();

    await w.find(sel("run-af-2")).trigger("click");
    await flushPromises();
    expect(service.runSaved).toHaveBeenCalledWith("default", "af-2", "inc-1");
    expect(push).toHaveBeenCalledWith(runPage("run-9"));
  });

  it("a 409 says the server's sentence and reads the incident again", async () => {
    const message = "This incident already has a live run: Roll back checkout.";
    service.getIncident
      .mockResolvedValueOnce(incident())
      .mockResolvedValue(incident({ run: LIVE_RUN }));
    service.runSaved.mockRejectedValue({ response: { status: 409, data: { code: 409, message } } });
    const w = await mountSection();

    await w.find(sel("run-af-2")).trigger("click");
    await flushPromises();

    expect(w.find(sel("error")).text()).toBe(message);
    expect(service.getIncident).toHaveBeenCalledTimes(2);
    expect(w.find(sel("live")).exists()).toBe(true);
    expect(w.find(sel("run-af-2")).attributes("disabled")).toBeDefined();
    expect(push).not.toHaveBeenCalled();
  });

  it("New run opens the goal box with the RCA's probable cause and starts the incident's run", async () => {
    const suggested = "The 10:02 deploy of checkout broke its database pool";
    service.getIncident.mockResolvedValue(incident({ suggested_goal: suggested }));
    service.getSummary.mockResolvedValue(
      axiosReply({
        connections: [],
        region: "local",
        triggers_fire_here: true,
        slack_approval_available: true,
        max_connections: 20,
      }),
    );
    vi.mocked(aiToolsets.list).mockResolvedValue(
      axiosReply({ toolsets: [{ id: "c1", name: "GitHub" }] }),
    );
    service.startRun.mockResolvedValue(axiosReply({ run_id: "run-7" }));
    const w = await mountSection();
    expect(aiToolsets.list).not.toHaveBeenCalled();

    await w.find(sel("new-run")).trigger("click");
    await flushPromises();
    const input = w.find('[data-test="autoresolve-goal-box-input"] textarea');
    expect((input.element as HTMLTextAreaElement).value).toBe(suggested);

    await w.find('[data-test="autoresolve-goal-box-start"]').trigger("click");
    await flushPromises();
    expect(service.startRun).toHaveBeenCalledWith("default", {
      goal: suggested,
      connection_ids: ["c1"],
      incident_id: "inc-1",
    });
    expect(push).toHaveBeenCalledWith(runPage("run-7"));
  });

  it("with no run and nothing saved for its alerts, says so and offers a new run", async () => {
    service.getIncident.mockResolvedValue(incident({ related: [] }));
    const w = await mountSection();

    expect(w.find(sel("empty")).text()).toBe(t("autoresolve.incident.empty"));
    expect(w.find(sel("run")).exists()).toBe(false);
    expect(w.find(sel("related")).exists()).toBe(false);
    expect(w.find(sel("new-run")).attributes("disabled")).toBeUndefined();
  });
});
