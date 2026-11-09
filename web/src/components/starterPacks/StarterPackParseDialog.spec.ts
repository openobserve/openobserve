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
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/locales";

import StarterPackParseDialog from "./StarterPackParseDialog.vue";

const notice = { stream: "edge", column: "message" };
const preview = {
  format: "combined" as const,
  rows: [
    {
      line: '203.0.113.10 - - [09/Nov/2026:10:00:02 +0000] "GET / HTTP/1.1" 200 1',
      added: { status: 200 },
    },
    { line: "odd line", added: {} },
  ],
};

const render = async (load: any, apply: any = vi.fn(async () => {})) => {
  const wrapper = mount(StarterPackParseDialog, {
    props: { notice, load, apply, open: true },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
};
const find = (test: string) => document.querySelector(`[data-test="${test}"]`);
const confirmButton = () => find("starter-pack-parse-confirm-btn") as HTMLButtonElement;

describe("StarterPackParseDialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows before and after for each previewed record, the readers, and what Undo keeps", async () => {
    await render(async () => [preview, [{ kind: "dashboard", name: "Edge" }]]);
    const rows = document.querySelectorAll('[data-test="starter-pack-parse-preview-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("GET / HTTP/1.1");
    expect(rows[0].textContent).toContain("Adds status=200");
    expect(rows[1].textContent).toContain("Adds nothing");
    expect(find("starter-pack-parse-readers")?.textContent).toContain("Dashboard Edge");
    const text = find("starter-pack-parse-dialog")?.textContent ?? "";
    expect(text).toContain("Applies to new data only");
    expect(text).toContain("keep their added fields");
    expect(confirmButton().disabled).toBe(false);
  });

  it("says when nothing reads the stream", async () => {
    await render(async () => [preview, []]);
    expect(find("starter-pack-parse-no-readers")).not.toBeNull();
  });

  it("blocks confirm when a realtime pipeline already sources the stream", async () => {
    await render(async () => [preview, [{ kind: "pipeline", name: "p", realtimeSource: true }]]);
    expect(find("starter-pack-parse-blocked")).not.toBeNull();
    expect(confirmButton().disabled).toBe(true);
  });

  it("offers nothing to confirm for records that do not parse", async () => {
    await render(async () => [null, []]);
    expect(find("starter-pack-parse-unparsed")).not.toBeNull();
    expect(confirmButton().disabled).toBe(true);
  });

  it("closes after a failed apply, so the Library banner's Undo is reachable", async () => {
    const apply = vi.fn(async () => {
      throw new Error("down");
    });
    const wrapper = await render(async () => [preview, []], apply);
    confirmButton().click();
    await flushPromises();
    expect(apply).toHaveBeenCalledWith(notice, preview);
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("drops a preview from a superseded load", async () => {
    let first: (value: unknown) => void = () => {};
    const load = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (first = resolve)))
      .mockResolvedValueOnce([null, []]);
    const wrapper = await render(load);
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();
    first([preview, []]);
    await flushPromises();
    expect(find("starter-pack-parse-unparsed")).not.toBeNull();
    expect(document.querySelectorAll('[data-test="starter-pack-parse-preview-row"]')).toHaveLength(
      0,
    );
  });
});
