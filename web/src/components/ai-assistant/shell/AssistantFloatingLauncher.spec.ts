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

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

import * as clearance from "@/lib/core/Table/composables/useFloatingClearance";

import AssistantFloatingLauncher, {
  type AssistantFloatingLauncherProps,
} from "./AssistantFloatingLauncher.vue";
import type { ThreadPill } from "./threadsBar";

const pill = (n: number, signal: ThreadPill["signal"] = "idle"): ThreadPill => ({
  sid: `s${n}`,
  title: `Chat number ${n}`,
  signal,
});

const mountTray = (props: Partial<AssistantFloatingLauncherProps> = {}) =>
  mount(AssistantFloatingLauncher, {
    props: {
      minimised: [],
      othersCount: 0,
      othersSignal: null,
      othersShown: true,
      expanded: false,
      ...props,
    },
    global: { plugins: [i18n, store] },
    attachTo: document.body,
  });

describe("AssistantFloatingLauncher", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("draws one chip per minimised chat, oldest first, with its title and no logo", () => {
    const wrapper = mountTray({ minimised: [pill(1), pill(2), pill(3)] });
    const chips = wrapper.findAll('[data-test="assistant-tray-chip"]');
    expect(chips.map((chip) => chip.attributes("data-sid"))).toEqual(["s1", "s2", "s3"]);
    expect(chips[0].text()).toContain("Chat number 1");
    expect(wrapper.find("img").exists()).toBe(false);
  });

  it("marks a running chat with the working ring and a waiting one with the needs-you dot", () => {
    const wrapper = mountTray({ minimised: [pill(1, "running"), pill(2, "approval"), pill(3)] });
    const states = wrapper
      .findAll('[data-test="assistant-tray-chip"]')
      .slice(0, 2)
      .map((chip) => chip.get('[data-test="assistant-status-dot"]').attributes("data-state"));
    expect(states).toEqual(["working", "attention"]);
    const quiet = wrapper.findAll('[data-test="assistant-tray-chip"]')[2];
    expect(quiet.find('[data-test="assistant-status-dot"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-test="assistant-tray-chip-restore"]')[1].text()).toContain(
      "Needs you",
    );
  });

  it("restores a chat from its chip and closes it from its own close button", async () => {
    const wrapper = mountTray({ minimised: [pill(1), pill(2)] });
    await wrapper.findAll('[data-test="assistant-tray-chip-restore"]')[1].trigger("click");
    await wrapper.findAll('[data-test="assistant-tray-chip-close"]')[0].trigger("click");
    expect(wrapper.emitted("restore")).toEqual([["s2"]]);
    expect(wrapper.emitted("close")).toEqual([["s1"]]);
    expect(
      wrapper.findAll('[data-test="assistant-tray-chip-close"]')[0].attributes("aria-label"),
    ).toBe("Close Chat number 1");
  });

  it("shows the Threads chip only with chats off screen, and toggles the list from it", async () => {
    expect(mountTray().find('[data-test="assistant-launcher-toggle"]').exists()).toBe(false);
    const hidden = mountTray({ othersCount: 2, othersShown: false });
    expect(hidden.find('[data-test="assistant-launcher-toggle"]').exists()).toBe(false);
    const wrapper = mountTray({ othersCount: 2, othersSignal: "working", expanded: true });
    const toggle = wrapper.get('[data-test="assistant-launcher-toggle"]');
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(toggle.get('[data-test="assistant-launcher-count"]').text()).toBe("2");
    await toggle.trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(1);
  });

  it("publishes its rect scoped to the page, and withdraws it on unmount", () => {
    const main = document.createElement("main");
    main.dataset.test = "main-content";
    document.body.append(main);
    const box = { left: 1368, right: 1416, top: 800, bottom: 848, width: 48 } as DOMRect;
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(box);
    const publish = vi.spyOn(clearance, "publishFloatingObstacle");
    const wrapper = mountTray({ minimised: [pill(1)] });
    expect(publish).toHaveBeenLastCalledWith({ rect: box, scope: main });
    wrapper.unmount();
    expect(publish).toHaveBeenLastCalledWith(null);
    rect.mockRestore();
    publish.mockRestore();
    main.remove();
  });

  it("publishes nothing while it has no size", () => {
    const main = document.createElement("main");
    main.dataset.test = "main-content";
    document.body.append(main);
    const publish = vi.spyOn(clearance, "publishFloatingObstacle");
    mountTray({ minimised: [pill(1)] }).unmount();
    expect(publish.mock.calls.every(([next]) => next === null)).toBe(true);
    publish.mockRestore();
    main.remove();
  });
});
