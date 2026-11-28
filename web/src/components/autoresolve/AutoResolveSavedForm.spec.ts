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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import { gt } from "@/types/i18n";
import { mcpCount } from "@/utils/autoresolve/autoresolveText";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { axiosReply } from "@/test/unit/helpers/mockService";
import { queryClient } from "@/composables/query/queryClient";
import OSelect from "@/lib/forms/Select/OSelect.vue";

vi.mock("@/services/autoresolve", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { createSaved: vi.fn() } });
});
vi.mock("@/services/ai_toolsets", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { list: vi.fn() } });
});
vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { listByFolderId: vi.fn() } });
});

import autoresolve, {
  type AutoResolveConnectionRef,
  type AutoResolveRun,
  type AutoResolveSaved,
} from "@/services/autoresolve";
import alerts from "@/services/alerts";
import aiToolsets from "@/services/ai_toolsets";
import {
  autoresolveOption,
  autoresolveRun,
  autoresolveStep,
} from "@/test/unit/fixtures/autoresolveRun";
import AutoResolveSavedForm from "./AutoResolveSavedForm.vue";

const CONNECTIONS = [
  { id: "c-git", name: "Code host (infra repo)" },
  { id: "c-k8s", name: "Cluster" },
];
const REGION = '[data-test="autoresolve-saved-form-region-notice"]';
const REMOVED_LINE = '[data-test="autoresolve-saved-form-connections-removed"]';
const REMOVED_CHIP = '[data-test="autoresolve-removed-connection"]';
const CHECKOUT = { id: "c-old", name: "checkout-ops", removed: true };

let wrapper: VueWrapper | undefined;

const finishedRun = (
  overrides: Partial<AutoResolveRun> = {},
  extra: AutoResolveConnectionRef[] = [],
) =>
  autoresolveRun({
    state: "worked",
    plan: {
      fingerprint: "fp-1",
      options: [
        autoresolveOption(),
        autoresolveOption({
          id: "B",
          steps: [
            autoresolveStep({ id: "s-b", connection: { id: "c-k8s", name: "Cluster" } }),
            ...extra.map((connection, i) => autoresolveStep({ id: `s-x${i}`, connection })),
          ],
        }),
      ],
      omitted_count: 0,
      omitted_reason: null,
      missing_capability: null,
    },
    chosen_option_id: "B",
    ...overrides,
  });

const mountForm = async (
  props: Record<string, unknown>,
  mcps: unknown = CONNECTIONS,
  canCreate = false,
) => {
  vi.mocked(alerts.listByFolderId).mockResolvedValue(
    axiosReply({ list: [{ alert_id: "a-5xx", name: "Gateway 5xx" }] }),
  );
  const list = vi.mocked(aiToolsets.list);
  if (mcps instanceof Error) list.mockRejectedValue(mcps);
  else list.mockResolvedValue(axiosReply({ toolsets: mcps, can_create: canCreate }));
  wrapper = mount(AutoResolveSavedForm, {
    props: { triggersFireHere: true, ...props },
    attachTo: document.body,
    global: { plugins: [i18n, store, router], provide: { store } },
  });
  await flushPromises();
  return wrapper;
};

const selects = () => wrapper!.findAllComponents(OSelect);

afterEach(() => {
  wrapper?.unmount();
  queryClient.clear();
  vi.clearAllMocks();
});

const savedWith = (connections: AutoResolveConnectionRef[]): AutoResolveSaved => ({
  id: "sa-1",
  name: "Fix the gateway",
  goal: "Fix the gateway.",
  connections,
  trigger: {
    kind: "person",
    alert_id: null,
    alert_name: null,
    enabled: false,
    paused_for_reapproval: false,
    approved_by: null,
    approved_at_us: null,
  },
  created_by: "ana@example.com",
  created_at_us: 1,
  updated_at_us: 1,
  from_run_id: null,
  triggers_fire_here: true,
  approvers: [],
});

describe("AutoResolveSavedForm", () => {
  it("prefills goal, connections and alert from the run it was saved from", async () => {
    const run = finishedRun({
      trigger: {
        kind: "alert",
        label: "Started by the alert Gateway 5xx",
        by: "the alert Gateway 5xx",
        alert_id: "a-5xx",
      },
    });
    const w = await mountForm({ fromRun: run });

    const goal = w.find('[data-test="autoresolve-saved-form-goal"] textarea');
    expect((goal.element as HTMLTextAreaElement).value).toBe(run.goal);
    expect(selects()[0].props("modelValue")).toEqual(["c-k8s"]);
    expect(selects()[1].props("modelValue")).toBe("alert");
    expect(selects()[2].props("modelValue")).toBe("a-5xx");
    // Saving needs Update on each MCP, so the form lists only those.
    expect(aiToolsets.list).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ kind: "mcp", permission: "update" }),
    );
  });

  // Never an id on screen: a removed connection shows by its last known name, or is left out.
  const DB = { id: "c-db", name: "Database" };
  it.each<[string, Record<string, unknown>, string[], string | null, string | null, string?]>([
    [
      "a run's removed connection is not prefilled",
      { fromRun: finishedRun({}, [CHECKOUT]) },
      ["c-k8s"],
      null,
      "checkout-ops",
    ],
    [
      "a run's own connections are prefilled, except the removed one",
      { fromRun: finishedRun({ connections: [CONNECTIONS[0], CHECKOUT] }) },
      ["c-git"],
      null,
      "checkout-ops",
    ],
    [
      "a run's MCP the person cannot update stays chosen, for the save refusal to name",
      { fromRun: finishedRun({}, [DB]) },
      ["c-k8s", "c-db"],
      null,
      null,
      "Database",
    ],
    [
      "a saved AutoResolve keeps an MCP the person cannot update as a chosen chip",
      { saved: savedWith([CONNECTIONS[0], DB]) },
      ["c-git", "c-db"],
      null,
      null,
      "Database",
    ],
    [
      "a saved AutoResolve marks its removed connection and lets it be taken out",
      { saved: savedWith([CONNECTIONS[0], CHECKOUT]) },
      ["c-git", "c-old"],
      "checkout-ops",
      null,
    ],
  ])("%s", async (_case, props, ids, removed, notFilled, kept) => {
    const w = await mountForm(props);

    expect(selects()[0].props("modelValue")).toEqual(ids);
    const chips = w.find('[data-test="autoresolve-saved-form-connection-chips"]').text();
    expect(chips).not.toMatch(/c-(old|gone|db)/);
    if (kept) expect(chips).toContain(kept);
    const help = w.find('[data-test="autoresolve-saved-form-connections-help"]').text();
    if (notFilled) expect(help).toContain(notFilled);
    expect(w.findAll(REMOVED_LINE)).toHaveLength(removed ? 1 : 0);
    if (!removed) return;
    expect(w.find(REMOVED_LINE).attributes("data-variant")).toBe("error");
    expect(w.find(REMOVED_LINE).text()).toContain(removed);
    expect(w.find(REMOVED_CHIP).text()).toContain(removed);

    await w.find(`${REMOVED_CHIP} button`).trigger("click");
    expect(selects()[0].props("modelValue")).toEqual(["c-git"]);
    expect(w.find(REMOVED_LINE).exists()).toBe(false);
  });

  it.each([
    ["a removed connection turns red", { removed: true }, 1],
    ["a connection that is not MCP stays as it is", {}, 0],
  ])("on a 400 naming a connection, %s", async (_case, flag, removedChips) => {
    vi.mocked(autoresolve).createSaved.mockRejectedValue({
      response: {
        status: 400,
        data: { code: 400, message: "Refused.", connection: { ...CONNECTIONS[1], ...flag } },
      },
    });
    const w = await mountForm({ fromRun: finishedRun() });

    await w.find("form").trigger("submit");
    await vi.waitFor(() =>
      expect(w.find('[data-test="autoresolve-saved-form-refusal"]').exists()).toBe(true),
    );
    expect(w.findAll(REMOVED_CHIP)).toHaveLength(removedChips);
  });

  it.each([
    ["no MCP the person can update", [], false, "autoresolve.connectionPicker.noneYouCanUse"],
    ["none, to a person who may create MCPs", [], true, "autoresolve.connectionPicker.noneYet"],
    ["the MCP list failing", new Error("down"), false, "autoresolve.saved.form.connectionsFailed"],
  ])("says so under the picker for %s", async (_case, mcps, canCreate, key) => {
    const w = await mountForm({ fromRun: finishedRun() }, mcps, canCreate);

    expect(w.find('[data-test="autoresolve-saved-form-connections-help"]').text()).toBe(
      i18n.global.t(key),
    );
  });

  it.each([
    ["a new AutoResolve takes the one MCP on offer", {}, [CONNECTIONS[0]], ["c-git"]],
    ["a new AutoResolve waits for a choice among a few", {}, CONNECTIONS, []],
    [
      "Save as keeps the run's own choice",
      { fromRun: finishedRun({ connections: [CHECKOUT] }) },
      [CONNECTIONS[0]],
      [],
    ],
  ])("%s", async (_case, props, mcps, ids) => {
    await mountForm(props, mcps);

    expect(selects()[0].props("modelValue")).toEqual(ids);
  });

  it("at the cap says so under the connections and disables the other options", async () => {
    const w = await mountForm({ saved: savedWith(CONNECTIONS), maxConnections: 2 }, [
      ...CONNECTIONS,
      { id: "c-db", name: "Database" },
    ]);

    const options = selects()[0].props("options") as { value: string; disabled: boolean }[];
    expect(options.filter((o) => o.disabled).map((o) => o.value)).toEqual(["c-db"]);
    expect(w.find('[data-test="autoresolve-saved-form-connections-help"]').text()).toBe(
      i18n.global.t("autoresolve.connectionPicker.upTo", { mcps: mcpCount(2, gt) }),
    );
  });

  it.each(["alert", "incident"])(
    "requires an alert when Runs when is an %s, and names the connection a 403 refuses",
    async (kind) => {
      const service = vi.mocked(autoresolve);
      service.createSaved.mockRejectedValue({
        response: {
          status: 403,
          data: {
            code: 403,
            message: "Refused.",
            connection: { id: "c-k8s", name: "Cluster" },
            approvers: [{ kind: "role", name: "sre" }],
          },
        },
      });
      const w = await mountForm({
        fromRun: finishedRun({
          trigger: { kind, label: "Started by an alert", by: "an alert", alert_id: null },
        }),
      });

      await w.find("form").trigger("submit");
      await vi.waitFor(() =>
        expect(w.find('[data-test="autoresolve-saved-form-alert"]').text()).toContain(
          i18n.global.t("autoresolve.saved.form.alertRequired"),
        ),
      );
      expect(service.createSaved).not.toHaveBeenCalled();

      selects()[2].vm.$emit("update:modelValue", "a-5xx");
      await w.find("form").trigger("submit");
      await vi.waitFor(() =>
        expect(w.find('[data-test="autoresolve-saved-form-refusal"]').exists()).toBe(true),
      );
      expect(service.createSaved).toHaveBeenCalledWith(
        "default",
        expect.objectContaining({
          trigger_kind: kind,
          trigger_alert_id: "a-5xx",
          connection_ids: ["c-k8s"],
          from_run_id: "run-1",
        }),
      );
      const refusal = w.find('[data-test="autoresolve-saved-form-refusal"]').text();
      expect(refusal).toContain("Cluster");
      expect(refusal).toContain("Role sre");
    },
  );

  it.each([
    { kind: "alert", fires: false, slack: true, shown: true, kindAfter: "alert" },
    { kind: "incident", fires: true, slack: true, shown: false, kindAfter: "incident" },
    { kind: "person", fires: false, slack: true, shown: false, kindAfter: "person" },
    // Without Slack approval a trigger cannot be turned on, so one neutral line says why.
    { kind: "alert", fires: false, slack: false, shown: false, kindAfter: "person" },
  ])(
    "shows the neutral deployment notice ($kind, fires $fires, Slack $slack)",
    async ({ kind, fires, slack, shown, kindAfter }) => {
      const w = await mountForm({
        fromRun: finishedRun({ trigger: { kind, label: "", by: "", alert_id: null } }),
        triggersFireHere: fires,
        slackApprovalAvailable: slack,
      });
      expect(w.find(REGION).exists()).toBe(shown);
      const runsWhen = selects()[1];
      expect(runsWhen.props("modelValue")).toBe(kindAfter);
      const off = runsWhen.props("options").filter((o: { disabled?: boolean }) => o.disabled);
      expect(off.map((o: { value: string }) => o.value)).toEqual(
        slack ? [] : ["alert", "incident"],
      );
      expect(w.text().includes(i18n.global.t("autoresolve.saved.slackUnavailable"))).toBe(!slack);
    },
  );
});
