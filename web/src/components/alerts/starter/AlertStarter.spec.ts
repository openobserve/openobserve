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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { createStore } from "vuex";

const edition = vi.hoisted(() => ({ isEnterprise: "true", isCloud: "false" }));
const aiReset = vi.hoisted(() => vi.fn());

vi.mock("@/aws-exports", () => ({ default: edition }));
vi.mock("./libraryPaneData", () => ({
  useLibraryReadiness: () => ({ count: ref(44), load: vi.fn() }),
}));
vi.mock("@/components/alerts/starter/AlertLibraryPane.vue", () => ({
  default: {
    name: "AlertLibraryPane",
    template: "<div data-test='library-pane-stub' />",
    methods: { entriesById: (ids: string[]) => ids.map((id) => ({ id })) },
  },
}));
vi.mock("@/components/alerts/starter/AlertAiPane.vue", () => ({
  default: { name: "AlertAiPane", template: "<div data-test='ai-pane-stub' />" },
}));
vi.mock("@/components/alerts/starter/AlertAiActions.vue", () => ({
  default: { name: "AlertAiActions", template: "<div />" },
}));
vi.mock("./useAlertAiDraft", () => ({
  useAlertAiDraft: () => ({ ai: { reset: aiReset }, folderId: () => "ops" }),
}));
vi.mock("@/components/alerts/starter/BulkAddReview.vue", () => ({
  default: { name: "BulkAddReview", template: "<div />" },
}));

import AlertStarter from "./AlertStarter.vue";
import { justAddedAlerts, takeJustAdded } from "@/utils/alerts/justAddedAlerts";

const q = (sel: string) => document.body.querySelector<HTMLElement>(`[data-test="${sel}"]`);
const visible = (sel: string) => {
  const el = q(sel);
  return !!el && el.closest<HTMLElement>("[style*='display: none']") === null;
};

const openStarter = async (zoConfig: Record<string, unknown> = { ai_enabled: true }) => {
  const store = createStore({
    state: { selectedOrganization: { identifier: "org1" }, zoConfig },
  });
  const w = mount(AlertStarter, { attachTo: document.body, global: { plugins: [store] } });
  await w.find("[data-test=alert-list-add-alert-btn]").trigger("click");
  await flushPromises();
  return w;
};

const pick = async (sel: string) => {
  q(sel)!.click();
  await flushPromises();
};

describe("AlertStarter", () => {
  beforeEach(() => {
    edition.isEnterprise = "true";
    aiReset.mockClear();
    document.body.innerHTML = "";
    takeJustAdded();
  });

  it.each([
    { name: "on", enterprise: "true", zo: { ai_enabled: true }, ai: "on" },
    {
      name: "locked by the licence",
      enterprise: "true",
      zo: { ai_enabled: true, features: { ai_assistant: "locked" } },
      ai: "locked",
    },
    { name: "locked by the edition", enterprise: "false", zo: {}, ai: "locked" },
    { name: "off in the org", enterprise: "true", zo: { ai_enabled: false }, ai: "hidden" },
  ])("opens a menu of ways to start, nothing picked, with Create with AI $name", async (c) => {
    edition.isEnterprise = c.enterprise;
    const w = await openStarter(c.zo);
    const rows = [...document.body.querySelectorAll("[data-test=create-starter-choices] > *")];
    const aiRow = q("create-starter-pane-ai");
    expect({
      rows: rows.map((el) => el.getAttribute("data-test")),
      ai: !aiRow ? "hidden" : aiRow.getAttribute("aria-disabled") ? "locked" : "on",
      focusedRow: rows.some((el) => el === document.activeElement),
      body: document.body.querySelector("[data-test^=create-starter-body-]"),
      count: q("create-starter-pane-library")?.textContent?.includes("44 match your data"),
    }).toEqual({
      rows: [
        "create-starter-pane-library",
        ...(c.ai === "hidden" ? [] : ["create-starter-pane-ai"]),
        "create-starter-use-form",
      ],
      ai: c.ai,
      focusedRow: false,
      body: null,
      count: true,
    });
    if (c.ai === "locked") {
      aiRow!.click();
      await flushPromises();
      expect(q("create-starter-body-ai")).toBeNull();
    }
    w.unmount();
  });

  it.each([
    { choice: "create-starter-pane-library", opens: "library-pane-stub", other: "ai-pane-stub" },
    { choice: "create-starter-pane-ai", opens: "ai-pane-stub", other: "library-pane-stub" },
  ])("$choice opens its pane in the side panel, whose switch keeps both panes", async (c) => {
    const w = await openStarter();
    await pick(c.choice);
    expect([visible(c.opens), q("create-starter-choices")]).toEqual([true, null]);
    await pick("create-starter-switch");
    expect([visible(c.opens), visible(c.other), !!q(c.opens)]).toEqual([false, true, true]);
    w.unmount();
  });

  it("The form closes the menu and asks the host for the form", async () => {
    const w = await openStarter();
    await pick("create-starter-use-form");
    expect([w.emitted("open-form")?.length, q("create-starter-menu")]).toEqual([1, null]);
    w.unmount();
  });

  it("Ctrl . moves Library, then AI, then Library", async () => {
    const w = await openStarter();
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ".", ctrlKey: true }));
      await flushPromises();
      seen.push(visible("library-pane-stub") ? "library" : visible("ai-pane-stub") ? "ai" : "");
    }
    expect(seen).toEqual(["library", "ai", "library"]);
    w.unmount();
  });

  it("Escape closes the panel and declines a waiting AI proposal", async () => {
    const w = await openStarter();
    await pick("create-starter-pane-ai");
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushPromises();
    expect([q("create-starter"), aiReset.mock.calls.length]).toEqual([null, 1]);
    w.unmount();
  });

  it.each([
    {
      name: "a Library add",
      finish: async (w: ReturnType<typeof mount>) => {
        await pick("create-starter-pane-library");
        w.findComponent({ name: "AlertLibraryPane" }).vm.$emit("update:selected", ["k8s/a"]);
        await flushPromises();
        await pick("alert-starter-add-selected");
        w.findComponent({ name: "BulkAddReview" }).vm.$emit("done", {
          folderId: "ops",
          names: ["a", "b"],
        });
      },
      added: { folderId: "ops", names: ["a", "b"] },
    },
    {
      name: "an AI create",
      finish: async (w: ReturnType<typeof mount>) => {
        await pick("create-starter-pane-ai");
        w.findComponent({ name: "AlertAiActions" }).vm.$emit("created", "cpu high");
      },
      added: { folderId: "ops", names: ["cpu high"] },
    },
  ])("$name closes the panel and hands the new alerts to the list", async (c) => {
    const w = await openStarter();
    await c.finish(w);
    await flushPromises();
    expect([q("create-starter"), justAddedAlerts.value, w.emitted("created")?.length]).toEqual([
      null,
      c.added,
      1,
    ]);
    w.unmount();
  });
});
