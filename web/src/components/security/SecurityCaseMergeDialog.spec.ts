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

vi.mock("@/lib/overlay/Dialog/ODialog.vue", () => ({
  default: {
    name: "ODialog",
    props: ["open", "title"],
    template: `<div v-if="open" class="o-dialog-stub"><h2>{{ title }}</h2><slot /></div>`,
  },
}));

import SecurityCaseMergeDialog from "./SecurityCaseMergeDialog.vue";

let wrapper: VueWrapper | null = null;

const CASES = [
  { id: "inc-a", title: "Spray against carol" },
  { id: "inc-b", title: "Spray against dave" },
  { id: "inc-c" },
];

const mountDialog = (merge = vi.fn().mockResolvedValue(true)) => {
  wrapper = mount(SecurityCaseMergeDialog, { props: { open: true, cases: CASES, merge } });
  return { w: wrapper, merge };
};

const submit = async (w: VueWrapper) => {
  await w.find("form").trigger("submit");
  await flushPromises();
};

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("SecurityCaseMergeDialog", () => {
  it("names the count and keeps the first selected case by default", async () => {
    const { w, merge } = mountDialog();
    expect(w.text()).toContain("Merge 3 cases");
    await w.find('[data-test="security-case-merge-reason-field"]').setValue("  same spray  ");
    await submit(w);
    await vi.waitFor(() => expect(merge).toHaveBeenCalled());
    expect(merge).toHaveBeenCalledWith("inc-a", ["inc-b", "inc-c"], "same spray");
    expect(w.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("folds every other case into the target the analyst picks", async () => {
    const { w, merge } = mountDialog();
    w.findComponent({ name: "OSelect" }).vm.$emit("update:modelValue", "inc-c");
    await flushPromises();
    await submit(w);
    await vi.waitFor(() => expect(merge).toHaveBeenCalled());
    expect(merge).toHaveBeenCalledWith("inc-c", ["inc-a", "inc-b"], "");
  });

  it("tells same-titled cases apart by priority, entity, id and created time", () => {
    wrapper = mount(SecurityCaseMergeDialog, {
      props: {
        open: true,
        merge: vi.fn(),
        cases: [
          {
            id: "k1",
            title: "Kerberos RC4",
            entity: "luke.allen",
            priority: "P2",
            createdAt: 1,
            alertCount: 1,
          },
          {
            id: "k2",
            title: "Kerberos RC4",
            entity: "chloe.fischer",
            priority: "P1",
            createdAt: 1,
            alertCount: 3,
          },
        ],
      },
    });
    const options = wrapper.findComponent({ name: "OSelect" }).props("options") as any[];
    expect(options.map((o) => o.label)).toEqual([
      "P2 · luke.allen · Kerberos RC4 · k1",
      "P1 · chloe.fischer · Kerberos RC4 · k2",
    ]);
    expect(options[1].subLabel).toMatch(/^k2 · created .+ · 3 alerts$/);
  });

  it("stays open when the server refuses the merge", async () => {
    const { w, merge } = mountDialog(vi.fn().mockResolvedValue(false));
    await submit(w);
    await vi.waitFor(() => expect(merge).toHaveBeenCalled());
    expect(w.emitted("update:open")).toBeUndefined();
  });
});
