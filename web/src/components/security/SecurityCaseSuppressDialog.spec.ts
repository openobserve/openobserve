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

import SecurityCaseSuppressDialog from "./SecurityCaseSuppressDialog.vue";

let wrapper: VueWrapper | null = null;

const mountDialog = (suppress = vi.fn().mockResolvedValue(true)) => {
  wrapper = mount(SecurityCaseSuppressDialog, { props: { open: true, suppress } });
  return { w: wrapper, suppress };
};

const submit = async (w: VueWrapper) => {
  await w.find("form").trigger("submit");
  await flushPromises();
};

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("SecurityCaseSuppressDialog", () => {
  it("requires a reason before suppressing", async () => {
    const { w, suppress } = mountDialog();
    await submit(w);
    await vi.waitFor(() => expect(w.text()).toContain("Give a reason"));
    expect(suppress).not.toHaveBeenCalled();
  });

  it("suppresses for 24 hours by default and leaves the case open", async () => {
    const { w, suppress } = mountDialog();
    await w.find('[data-test="security-case-suppress-reason-field"]').setValue("Nightly scanner");
    await submit(w);
    await vi.waitFor(() => expect(suppress).toHaveBeenCalled());
    expect(suppress).toHaveBeenCalledWith({
      duration: 1440,
      reason: "Nightly scanner",
      closeCase: false,
    });
    expect(w.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("offers 30 days only to a Security writer", () => {
    const { w } = mountDialog();
    const values = (w.findComponent({ name: "OSelect" }).props("options") as any[]).map(
      (o) => o.value,
    );
    expect(values).toEqual([60, 1440, 10080]);
    wrapper?.unmount();
    wrapper = mount(SecurityCaseSuppressDialog, {
      props: { open: true, suppress: vi.fn(), allowLong: true },
    });
    const all = (wrapper.findComponent({ name: "OSelect" }).props("options") as any[]).map(
      (o) => o.value,
    );
    expect(all).toContain(43200);
  });

  it("sends the picked duration and the close-as-benign choice", async () => {
    const { w, suppress } = mountDialog();
    w.findComponent({ name: "OSelect" }).vm.$emit("update:modelValue", 10080);
    await w.find('[data-test="security-case-suppress-reason-field"]').setValue("Pen test window");
    await w.find('button[role="checkbox"]').trigger("click");
    await submit(w);
    await vi.waitFor(() => expect(suppress).toHaveBeenCalled());
    expect(suppress).toHaveBeenCalledWith({
      duration: 10080,
      reason: "Pen test window",
      closeCase: true,
    });
  });
});
