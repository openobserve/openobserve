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

vi.mock("@/aws-exports", () => ({ default: edition }));
vi.mock("./libraryPaneData", () => ({
  useLibraryReadiness: () => ({ count: ref(44), load: vi.fn() }),
}));
vi.mock("@/components/alerts/starter/AlertLibraryPane.vue", () => ({
  default: { name: "AlertLibraryPane", template: "<div data-test='library-pane-stub' />" },
}));
vi.mock("@/components/alerts/starter/AlertAiPane.vue", () => ({
  default: { name: "AlertAiPane", template: "<div data-test='ai-pane-stub' />" },
}));
vi.mock("@/components/alerts/starter/BulkAddReview.vue", () => ({
  default: { name: "BulkAddReview", template: "<div />" },
}));

import AlertStarter from "./AlertStarter.vue";

const q = (sel: string) => document.body.querySelector<HTMLElement>(`[data-test="${sel}"]`);

const openStarter = async (zoConfig: Record<string, unknown> = { ai_enabled: true }) => {
  const store = createStore({
    state: { selectedOrganization: { identifier: "org1" }, zoConfig },
  });
  const w = mount(AlertStarter, { attachTo: document.body, global: { plugins: [store] } });
  await w.find("[data-test=alert-list-add-alert-btn]").trigger("click");
  await flushPromises();
  return w;
};

describe("AlertStarter", () => {
  beforeEach(() => {
    edition.isEnterprise = "true";
    document.body.innerHTML = "";
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
  ])("opens on the row alone, nothing picked, with Create with AI $name", async (c) => {
    edition.isEnterprise = c.enterprise;
    const w = await openStarter(c.zo);
    const items = [...document.body.querySelectorAll("[data-test^=create-starter-pane-]")]
      .map((el) => el.getAttribute("data-test"))
      .filter((id) => !id?.endsWith("-count"));
    const aiItem = q("create-starter-pane-ai");
    expect({
      items,
      ai: !aiItem ? "hidden" : aiItem.hasAttribute("data-disabled") ? "locked" : "on",
      picked: document.body.querySelector("[data-test^=create-starter-pane-][data-state=on]"),
      body: document.body.querySelector("[data-test^=create-starter-body-]"),
      count: q("create-starter-pane-library-count")?.textContent,
    }).toEqual({
      items:
        c.ai === "hidden"
          ? ["create-starter-pane-library"]
          : ["create-starter-pane-library", "create-starter-pane-ai"],
      ai: c.ai,
      picked: null,
      body: null,
      count: "44 match your data",
    });
    w.unmount();
  });

  it.each([
    { choice: "create-starter-pane-library", opens: "library-pane-stub" },
    { choice: "create-starter-pane-ai", opens: "ai-pane-stub" },
  ])("$choice opens its pane, and picking it again keeps it", async ({ choice, opens }) => {
    const w = await openStarter();
    for (let i = 0; i < 2; i++) {
      q(choice)!.click();
      await flushPromises();
      expect(q(opens)).not.toBeNull();
    }
    w.unmount();
  });

  it("Use the form opens the form", async () => {
    const w = await openStarter();
    q("create-starter-use-form")!.click();
    await flushPromises();
    expect(w.emitted("open-form")).toHaveLength(1);
    w.unmount();
  });

  it("Ctrl . moves Library, then AI, then Library", async () => {
    const w = await openStarter();
    const seen: Array<string | null> = [];
    for (let i = 0; i < 3; i++) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ".", ctrlKey: true }));
      await flushPromises();
      seen.push(
        document.body
          .querySelector("[data-test^=create-starter-body-]")
          ?.getAttribute("data-test") ?? null,
      );
    }
    expect(seen).toEqual([
      "create-starter-body-library",
      "create-starter-body-ai",
      "create-starter-body-library",
    ]);
    w.unmount();
  });
});
