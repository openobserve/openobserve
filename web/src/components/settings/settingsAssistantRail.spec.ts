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

import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "vue-i18n";
import { createStore } from "vuex";

import config from "@/aws-exports";
import enLocale from "@/locales/languages/en-US.json";

import SettingsIndex from "./index.vue";

const { route } = vi.hoisted(() => ({
  route: { value: { name: "general", path: "/settings", query: {} } },
}));

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "false", isCloud: "false" } }));
vi.mock("@/composables/useIsMetaOrg", () => ({ default: () => ({ isMetaOrg: { value: false } }) }));
vi.mock("@/utils/zincutils", () => ({ getImageURL: vi.fn((url: string) => url) }));
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), currentRoute: route }),
  useRoute: () => route.value,
}));

function mountIndex(routeName = "general", features?: Record<string, string>) {
  route.value = { name: routeName, path: "/settings", query: {} };
  const store = createStore({
    state: {
      selectedOrganization: { identifier: "acme", name: "Acme" },
      theme: "light",
      zoConfig: { service_streams_enabled: true, features },
      organizationData: { organizationSettings: { org_storage_enabled: false } },
    },
  });
  return mount(SettingsIndex, {
    global: {
      plugins: [createI18n({ locale: "en", messages: { en: enLocale } })],
      provide: { store },
      stubs: {
        "router-view": true,
        OPageLayout: { template: '<div><slot name="sidebar" /><slot /></div>' },
        SectionRail: true,
        OPageHeader: true,
        ConstrainedPage: { template: "<div><slot /></div>" },
      },
    },
  });
}

const assistantItem = (w: ReturnType<typeof mountIndex>) =>
  (w.vm as any).sectionGroups.flatMap((g: any) => g.items).find((i: any) => i.key === "assistant");

afterEach(() => {
  config.isEnterprise = "false";
});

describe("Settings rail: Assistant", () => {
  it("adds the Assistant group before Data with one item", () => {
    config.isEnterprise = "true";
    const w = mountIndex();
    const labels = (w.vm as any).sectionGroups.map((g: any) => g.label);
    expect(labels.indexOf("Assistant")).toBeGreaterThan(-1);
    expect(labels.indexOf("Assistant")).toBeLessThan(labels.indexOf("Data"));
    const item = assistantItem(w);
    expect(item).toMatchObject({
      label: "Assistant",
      description: "Status, access, data, history, usage, toolsets, permissions and activity",
      icon: "auto-awesome",
      dataTest: "settings-assistant-tab",
      locked: false,
    });
    expect(item.to).toMatchObject({ name: "assistantSettings", params: { tab: "status" } });
  });

  it("selects the Assistant item on every assistant settings route", () => {
    const w = mountIndex("assistantSettings");
    expect((w.vm as any).activeSection).toBe("assistant");
  });

  it("locks the item with the pitch on an OSS build", () => {
    const w = mountIndex();
    const item = assistantItem(w);
    expect(item.locked).toBe(true);
    expect(item.lockedMessage).toBe(enLocale.enterpriseFeature.pitch.aiAssistant);
  });

  it("hides the item when the license map hides ai_assistant, and shows the license lock when locked", () => {
    config.isEnterprise = "true";
    expect(assistantItem(mountIndex("general", { ai_assistant: "hidden" })).visible).toBe(false);
    const locked = assistantItem(mountIndex("general", { ai_assistant: "locked" }));
    expect(locked.visible).toBe(true);
    expect(locked.licenseLocked).toBe(true);
    const enabled = assistantItem(mountIndex("general", { ai_assistant: "enabled" }));
    expect(enabled.visible).toBe(true);
    expect(enabled.licenseLocked).toBe(false);
  });
});
