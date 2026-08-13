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

import { describe, it, expect, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import DependencyChainPopover from "./DependencyChainPopover.vue";
import i18n from "@/locales";

const OPopoverStub = {
  name: "OPopover",
  props: ["open"],
  emits: ["update:open"],
  // Render BOTH the trigger and the content so we can drive open state.
  template: `<div class="opopover-stub"><slot name="trigger" /><slot /></div>`,
};
const PanelStub = {
  name: "DependencyChainPanel",
  props: { focus: { type: Object, default: null } },
  emits: ["deleted", "close"],
  template: `<div class="panel-stub" :data-focus="focus ? focus.name : ''" />`,
};

function mountPopover(focus: Record<string, unknown>): VueWrapper {
  return mount(DependencyChainPopover, {
    props: { focus },
    global: {
      plugins: [i18n],
      stubs: {
        OPopover: OPopoverStub,
        DependencyChainPanel: PanelStub,
        OButton: { template: `<button v-bind="$attrs"><slot /></button>` },
        OIcon: { template: "<i />" },
        OTooltip: { template: "<span />" },
      },
    },
  });
}

describe("DependencyChainPopover", () => {
  let wrapper: VueWrapper;
  afterEach(() => wrapper?.unmount());

  it("renders a trigger icon and mounts the focused panel only when open", async () => {
    wrapper = mountPopover({ kind: "destination", name: "slack" });
    expect(wrapper.find('[data-test="view-dependencies-slack"]').exists()).toBe(true);
    // Closed by default -> panel not mounted (no eager fetch).
    expect(wrapper.findComponent(PanelStub).exists()).toBe(false);

    (wrapper.vm as any).open = true;
    await nextTick();
    const panel = wrapper.findComponent(PanelStub);
    expect(panel.exists()).toBe(true);
    expect(panel.props("focus")).toMatchObject({ kind: "destination", name: "slack" });
  });

  it("forwards the panel's 'deleted' and closes on 'close'", async () => {
    wrapper = mountPopover({ kind: "template", name: "tpl-x" });
    (wrapper.vm as any).open = true;
    await nextTick();
    const panel = wrapper.findComponent(PanelStub);

    await panel.vm.$emit("deleted");
    expect(wrapper.emitted("deleted")).toBeTruthy();

    await panel.vm.$emit("close");
    await nextTick();
    expect((wrapper.vm as any).open).toBe(false);
  });
});
