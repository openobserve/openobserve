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
import { beforeEach, describe, expect, it, vi } from "vitest";

import OnCallPolicyEditor from "@/components/oncall/OnCallPolicyEditor.vue";
import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import type { OnCallPolicy } from "@/ts/interfaces/oncall";

vi.mock("@/services/oncall", () => ({ default: { setPolicy: vi.fn() } }));

const service = vi.mocked(oncallService);

const stubs = {
  OCard: { name: "OCard", template: "<div><slot /></div>" },
  OCardSection: { name: "OCardSection", template: "<div><slot /></div>" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OButton: {
    name: "OButton",
    props: ["disabled"],
    template: `<button :disabled="disabled"><slot /></button>`,
  },
  OSelect: { name: "OSelect", template: "<select />" },
  OCheckbox: {
    name: "OCheckbox",
    props: ["modelValue", "label"],
    template: `<label><input type="checkbox" :checked="modelValue" />{{ label }}</label>`,
  },
};

const policy: OnCallPolicy = {
  id: "pol_1",
  org_id: "default",
  team_id: "team_1",
  rungs: [
    { priority: 1, steps: [{ level: "primary", after_micros: 0 }], channels: ["email"] },
    { priority: 4, steps: [], channels: [] },
  ],
};

function render() {
  return mount(OnCallPolicyEditor, {
    props: { teamId: "team_1", policy },
    global: { plugins: [i18n, store], stubs },
  });
}

describe("OnCallPolicyEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.setPolicy.mockResolvedValue({ data: {} } as any);
  });

  // A checkbox for a channel nothing can send lets somebody tick SMS and
  // receive nothing, with no error — the worst failure a pager can have.
  it("offers only channels that can actually be delivered", async () => {
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-policy-channel-1-email"]').exists()).toBe(true);
    for (const unimplemented of ["sms", "voice", "chat", "push", "in_app"]) {
      expect(
        wrapper.find(`[data-test="oncall-policy-channel-1-${unimplemented}"]`).exists(),
        `${unimplemented} has no Notifier and must not be offered`,
      ).toBe(false);
    }
  });

  // The short list should read as deliberate, not as something missing.
  it("says why the other channels are absent", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain("not implemented yet");
  });

  it("shows a non-paging priority as paging nobody", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain("Pages nobody");
  });
});
