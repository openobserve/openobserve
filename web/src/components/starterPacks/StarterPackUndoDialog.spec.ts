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
import { ref } from "vue";

import i18n from "@/locales";

import StarterPackUndoDialog from "./StarterPackUndoDialog.vue";
import { fakeFlow } from "./starterPackTestFlow";

const t = i18n.global.t as (...args: unknown[]) => string;
const made = [
  { kind: "dashboard", itemId: "d1", status: "created" },
  { kind: "alert", itemId: "a1", status: "created" },
  { kind: "alert", itemId: "a2", status: "created" },
];

const render = (flow = fakeFlow({ made: ref(made), alertsOn: ref(2) })) =>
  mount(StarterPackUndoDialog, {
    props: { open: true, flow, mode: "remove" },
    global: {
      plugins: [i18n],
      stubs: {
        ODialog: {
          props: ["open", "primaryButtonLoading"],
          emits: ["click:primary"],
          template:
            "<div v-if='open'><slot /><span data-test='loading'>{{ !!primaryButtonLoading }}</span><button data-test='confirm' @click=\"$emit('click:primary')\" /></div>",
        },
      },
    },
  });

describe("StarterPackUndoDialog", () => {
  it("leads with the alerts that lose cover, then counts what goes by kind", () => {
    const wrapper = render();
    const body = wrapper.text();
    const cover = t("starterPacks.undo.loseCover", { count: 2 }, 2);
    expect(body.indexOf(cover)).toBe(0);
    expect(
      wrapper.findAll('[data-test="starter-pack-undo-kinds"] li').map((li) => li.text()),
    ).toEqual([
      `${t("starterPacks.installDialog.kindDashboards")}1`,
      `${t("starterPacks.installDialog.kindAlerts")}2`,
    ]);
    expect(body).toContain(t("starterPacks.undo.keeps"));
  });

  it("removes the pack and reports done", async () => {
    const flow = fakeFlow({ made: ref(made) });
    const wrapper = render(flow);
    await wrapper.get('[data-test="confirm"]').trigger("click");
    await flushPromises();
    expect(flow.remove).toHaveBeenCalled();
    expect(wrapper.emitted("done")).toHaveLength(1);
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("stays open and busy while removing, then shows the failure, stays open and still reports done", async () => {
    let finish: (ok: boolean) => void = () => {};
    const busy = ref(false);
    const remove = vi.fn(() => {
      busy.value = true;
      return new Promise<boolean>((resolve) => {
        finish = (ok) => {
          busy.value = false;
          resolve(ok);
        };
      });
    });
    const wrapper = render(fakeFlow({ made: ref(made), busy, remove }));
    await wrapper.get('[data-test="confirm"]').trigger("click");
    expect(wrapper.emitted("update:open")).toBeUndefined();
    expect(wrapper.get('[data-test="loading"]').text()).toBe("true");
    await wrapper.get('[data-test="confirm"]').trigger("click");
    expect(remove).toHaveBeenCalledTimes(1);
    finish(false);
    await flushPromises();
    expect(wrapper.emitted("update:open")).toBeUndefined();
    expect(wrapper.emitted("done")).toHaveLength(1);
    expect(wrapper.get('[data-test="starter-pack-confirm-failed"]').text()).toBe(
      t("starterPacks.undo.failed"),
    );
  });
});
