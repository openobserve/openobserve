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
import router from "@/test/unit/helpers/router";
import store from "@/test/unit/helpers/store";
import { axiosReply } from "@/test/unit/helpers/mockService";
import { queryClient } from "@/composables/query/queryClient";
import OSelect from "@/lib/forms/Select/OSelect.vue";

vi.mock("@/services/autoresolve", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { getSummary: vi.fn(), startRun: vi.fn() },
  });
});

vi.mock("@/services/ai_toolsets", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { list: vi.fn() } });
});

import autoresolve from "@/services/autoresolve";
import aiToolsets from "@/services/ai_toolsets";
import AutoResolveHome from "@/views/AutoResolve/AutoResolveHome.vue";
import AutoResolveGoalBox from "./AutoResolveGoalBox.vue";

const START = '[data-test="autoresolve-goal-box-start"]';
const INPUT = '[data-test="autoresolve-goal-box-input"] textarea';
const REASON = '[data-test="autoresolve-goal-box-reason"]';
const ERROR = '[data-test="autoresolve-goal-box-error"]';
const BELOW = '[data-test="autoresolve-goal-box-below"]';
const ASKS_FIRST = '[data-test="autoresolve-goal-box-asks-first"]';
const CHIPS = '[data-test="autoresolve-goal-box-connection-chips"]';
const ONE = [{ id: "c1", name: "Code host" }];
const THREE = [...ONE, { id: "c2", name: "Cluster" }, { id: "c3", name: "Deploys" }];

let wrapper: VueWrapper | undefined;

const mountBox = (props: Record<string, unknown>) => {
  wrapper = mount(AutoResolveGoalBox, {
    props: {
      modelValue: "",
      starting: false,
      connections: ONE,
      connectionIds: ["c1"],
      maxConnections: 20,
      ...props,
    },
    global: { plugins: [i18n, router] },
  });
  return wrapper;
};

afterEach(() => {
  wrapper?.unmount();
  queryClient.clear();
  vi.restoreAllMocks();
});

const summary = () =>
  axiosReply({
    connections: [],
    region: "local",
    triggers_fire_here: true,
    slack_approval_available: true,
    max_connections: 20,
  });

describe("AutoResolveGoalBox", () => {
  it("Start is disabled for an empty goal and emits start with the goal and connections", async () => {
    const w = mountBox({ modelValue: "   " });
    expect(w.find(START).attributes("disabled")).toBeDefined();
    await w.find(START).trigger("click");
    await w.find(INPUT).trigger("keydown", { key: "Enter", ctrlKey: true });
    expect(w.emitted("start")).toBeUndefined();

    await w.setProps({ modelValue: "  Find why checkout fails  " });
    expect(w.find(START).attributes("disabled")).toBeUndefined();
    await w.find(START).trigger("click");
    await w.find(INPUT).trigger("keydown", { key: "Enter", metaKey: true });
    const run = { goal: "Find why checkout fails", connectionIds: ["c1"] };
    expect(w.emitted("start")).toEqual([[run], [run]]);
  });

  it.each([
    ["one toolset is chosen for the person", ONE, [], 20, ["c1"], null, false],
    ["a few toolsets wait for a choice", THREE, [], 20, undefined, "chooseOne", true],
    ["a choice within the cap can start", THREE, ["c2"], 20, undefined, null, false],
    ["at the cap no more can be chosen", THREE, ["c1", "c2"], 2, undefined, "upTo", false],
  ])("%s", async (_case, connections, ids, cap, preselected, reason, disabled) => {
    const w = mountBox({
      modelValue: "Fix it",
      connections,
      connectionIds: ids,
      maxConnections: cap,
    });
    const emitted = w.emitted("update:connectionIds")?.[0]?.[0] as string[] | undefined;
    expect(emitted).toEqual(preselected);
    if (emitted) await w.setProps({ connectionIds: emitted });
    const expected = reason
      ? i18n.global.t(`autoresolve.connectionPicker.${reason}`, { mcps: mcpCount(cap, gt) })
      : "";
    expect(w.find(REASON).text()).toBe(expected);
    expect(w.find(START).attributes("disabled") !== undefined).toBe(disabled);
    const options = w.findComponent(OSelect).props("options") as {
      value: string;
      disabled: boolean;
    }[];
    expect(options.filter((o) => o.disabled).map((o) => o.value)).toEqual(
      reason === "upTo" ? ["c3"] : [],
    );
  });

  it.each([
    ["a person who may create MCPs is offered to add one", true, true],
    ["anyone else is told to ask an admin", false, false],
  ])("with no MCPs, %s", async (_case, canCreate, offered) => {
    const push = vi.spyOn(router, "push").mockResolvedValue(undefined);
    vi.mocked(autoresolve).getSummary.mockResolvedValue(summary());
    vi.mocked(aiToolsets.list).mockResolvedValue(
      axiosReply({ toolsets: [], can_create: canCreate }),
    );
    wrapper = mount(AutoResolveHome, {
      global: {
        plugins: [i18n, store, router],
        provide: { store },
        stubs: { AutoResolveRunsTable: true },
      },
    });
    await flushPromises();

    expect(wrapper.find(INPUT).exists()).toBe(false);
    const said = offered
      ? "emptyState.noAutoResolveConnections.description"
      : "emptyState.noUsable.askAdmin";
    expect(wrapper.text()).toContain(i18n.global.t(said));
    const add = wrapper.find('[data-test="o2-empty-state-action-add-connection"]');
    expect(add.exists()).toBe(offered);
    if (!offered) return;
    await add.trigger("click");
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: "aiToolsets" }));
  });

  it("keeps a start refusal while the reread MCP list drops the refused connection, until the person edits", async () => {
    const gone = "A chosen MCP no longer exists. Choose your MCPs again.";
    const service = vi.mocked(autoresolve);
    service.getSummary.mockResolvedValue(summary());
    vi.mocked(aiToolsets.list)
      .mockResolvedValueOnce(axiosReply({ toolsets: THREE }))
      .mockResolvedValue(axiosReply({ toolsets: THREE.filter((c) => c.id !== "c2") }));
    service.startRun.mockRejectedValue({
      response: { status: 400, data: { code: 400, message: gone } },
    });
    wrapper = mount(AutoResolveHome, {
      global: {
        plugins: [i18n, store, router],
        provide: { store },
        stubs: { AutoResolveRunsTable: true },
      },
    });
    await flushPromises();
    // Starting a run needs only read access, so the default list is asked for.
    expect(vi.mocked(aiToolsets.list).mock.calls[0][1]).toEqual({ kind: "mcp", limit: 100000 });
    await wrapper.find(INPUT).setValue("Fix it");
    wrapper.findComponent(OSelect).vm.$emit("update:modelValue", ["c2"]);
    await flushPromises();
    expect(wrapper.find(CHIPS).text()).toContain("Cluster");
    await wrapper.find(START).trigger("click");

    await vi.waitFor(() => expect(wrapper!.find(CHIPS).exists()).toBe(false));
    await flushPromises();
    expect(wrapper.find(`${BELOW} ${ERROR}`).text()).toBe(gone);
    expect(wrapper.find(ASKS_FIRST).exists()).toBe(false);
    expect(wrapper.find(REASON).text()).toBe(
      i18n.global.t("autoresolve.connectionPicker.chooseOne"),
    );

    await wrapper.find(INPUT).setValue("Fix it now");
    expect(wrapper.find(ERROR).exists()).toBe(false);
    expect(wrapper.find(`${BELOW} ${ASKS_FIRST}`).exists()).toBe(true);
  });
});
