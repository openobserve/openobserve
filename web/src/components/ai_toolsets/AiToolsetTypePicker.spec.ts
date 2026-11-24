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

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import AiToolsetTypePicker from "@/components/ai_toolsets/AiToolsetTypePicker.vue";
import type { Preset } from "@/components/ai_toolsets/presets";

const preset = (id: string, kind: "mcp", label: string, description?: string): Preset => ({
  id,
  kind,
  label,
  revision: 1,
  description,
});

function createWrapper() {
  return mount(AiToolsetTypePicker, {
    props: {
      mcpPresets: [
        preset("datadog", "mcp", "Datadog", "Datadog: query metrics"),
        preset("grafana", "mcp", "Grafana"),
      ],
    },
    global: {
      plugins: [i18n],
      stubs: {
        EmptyStateActionCard: {
          template: `<div class="card-stub" :data-icon="icon" :data-label="label" :data-sublabel="sublabel" />`,
          props: ["icon", "label", "sublabel"],
        },
      },
    },
  });
}

describe("AiToolsetTypePicker.vue", () => {
  it("renders MCP presets, custom MCP, then skill, each with a description", () => {
    const cards = createWrapper().findAll(".card-stub");
    expect(cards.map((c) => [c.attributes("data-label"), c.attributes("data-sublabel")])).toEqual([
      ["Datadog", "Query metrics"],
      ["Grafana", "Connect the Grafana MCP server"],
      ["Custom MCP", "Connect any MCP server by URL"],
      ["Custom Skill", "Write Markdown instructions the AI follows"],
    ]);
  });

  it("groups cards under headings", () => {
    const w = createWrapper();
    const sections = w.findAll("[data-test^='ai-toolsets-section-']");
    expect(sections.map((x) => x.find("h3").text())).toEqual([
      "MCP servers",
      "Skills",
    ]);
    expect(sections[0].findAll(".card-stub")).toHaveLength(3);
  });

  it("uses brand logos for known presets, and the MCP logo as fallback", () => {
    const icons = createWrapper()
      .findAll(".card-stub")
      .map((c) => c.attributes("data-icon") ?? "");
    expect(icons.map((i) => i.match(/([\w-]+)\.svg$/)?.[1] ?? i)).toEqual([
      "datadog",
      "grafana",
      "model-context-protocol",
      "menu-book",
    ]);
    expect(icons[0].startsWith("img:")).toBe(true);
  });

  it.each([
    ["datadog", { preset: "datadog" }],
    ["custom-mcp", {}],
    ["skill", { kind: "skill" }],
  ])("emits select with the old handler's params for %s", async (key, from) => {
    const w = createWrapper();
    await w.find(`[data-test='ai-toolsets-add-${key}']`).trigger("click");
    expect(w.emitted("select")).toEqual([[from]]);
  });
});
