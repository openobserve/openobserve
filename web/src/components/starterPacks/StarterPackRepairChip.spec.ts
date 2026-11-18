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

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { ref, shallowRef } from "vue";

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const fake = vi.hoisted(() => ({ issue: null as any }));
vi.mock("@/constants/starterPacks", () => ({ STARTER_PACKS_ENABLED: true }));
vi.mock("@/composables/starterPacks/useStarterPackFlow", () => ({
  canManageInstall: () => true,
}));
vi.mock("@/composables/starterPacks/useRepairLater", () => ({
  useRepairLater: () => ({
    issue: shallowRef(fake.issue),
    undoable: shallowRef(null),
    busy: ref(false),
    failed: ref(false),
    check: vi.fn(),
    apply: vi.fn(),
    undo: vi.fn(),
  }),
}));

import StarterPackRepairChip from "./StarterPackRepairChip.vue";

describe("StarterPackRepairChip", () => {
  it("words the chip around alerts when no panel would move", async () => {
    fake.issue = { record: {}, from: "a", to: "b", lastUs: 1, startedUs: 2, panels: 0, alerts: 2 };
    const wrapper = mount(StarterPackRepairChip, {
      props: { org: "org", scope: {} },
      global: { plugins: [i18n, store], stubs: { ODrawer: true } },
    });
    await flushPromises();
    const chip = wrapper.find('[data-test="starter-pack-repair-chip"]').text();
    expect(chip).toContain("2 alerts have no data");
    expect(chip).not.toContain("panel");
  });
});
