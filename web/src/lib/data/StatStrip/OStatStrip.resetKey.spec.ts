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

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import OStatStrip from "./OStatStrip.vue";
import { raw } from "@/types/i18n";

const items = [
  { key: "a", label: raw("All"), value: 128 },
  { key: "b", label: raw("Errors"), value: 0 },
];
const skeletons = '[data-test="o-stat-card-value-skeleton"]';

async function settle(wrapper: ReturnType<typeof mount>) {
  await wrapper.setProps({ loading: true });
  await wrapper.setProps({ loading: false });
}

describe("OStatStrip resetKey", () => {
  it("keeps the previous numbers on a refetch when no resetKey is given", async () => {
    const wrapper = mount(OStatStrip, { props: { items, loading: false } });
    await settle(wrapper);
    await wrapper.setProps({ loading: true });
    expect(wrapper.findAll(skeletons)).toHaveLength(0);
    expect(wrapper.text()).toContain("128");
  });

  it("shows the skeleton again on the next load after the key changes", async () => {
    const wrapper = mount(OStatStrip, { props: { items, loading: false, resetKey: "spans" } });
    await settle(wrapper);
    await wrapper.setProps({ loading: true });
    expect(wrapper.findAll(skeletons)).toHaveLength(0);
    await wrapper.setProps({ loading: false });
    await wrapper.setProps({ resetKey: "traces" });
    expect(wrapper.findAll(skeletons)).toHaveLength(0);
    await wrapper.setProps({ loading: true });
    expect(wrapper.findAll(skeletons)).toHaveLength(2);
    await wrapper.setProps({ loading: false });
    expect(wrapper.findAll(skeletons)).toHaveLength(0);
    await wrapper.setProps({ loading: true });
    expect(wrapper.findAll(skeletons)).toHaveLength(0);
  });

  it("blanks the old numbers at once when the key changes mid-load", async () => {
    const wrapper = mount(OStatStrip, { props: { items, loading: false, resetKey: 1 } });
    await settle(wrapper);
    await wrapper.setProps({ loading: true });
    expect(wrapper.findAll(skeletons)).toHaveLength(0);
    await wrapper.setProps({ resetKey: 2 });
    expect(wrapper.findAll(skeletons)).toHaveLength(2);
  });

  it("leaves the latch alone while the key stays the same", async () => {
    const wrapper = mount(OStatStrip, { props: { items, loading: false, resetKey: "same" } });
    await settle(wrapper);
    await wrapper.setProps({ resetKey: "same", loading: true });
    expect(wrapper.findAll(skeletons)).toHaveLength(0);
  });
});
