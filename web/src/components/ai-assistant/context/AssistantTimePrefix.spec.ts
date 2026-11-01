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

import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import type { TimeWindow } from "@/composables/assistant";

import AssistantTimePrefix from "./AssistantTimePrefix.vue";

const DEFAULT: TimeWindow = { from: 0, to: 900_000, period: "15m", source: "default" };
const PAGE: TimeWindow = { from: 0, to: 3_600_000, period: "1h", source: "page" };

async function open(props: { window: TimeWindow; pageWindow?: TimeWindow | null }) {
  const wrapper = mount(AssistantTimePrefix, { props, attachTo: document.body });
  await wrapper.get('[data-test="assistant-context-chip-time"]').trigger("click");
  await flushPromises();
  const row = (id: string) =>
    document.body.querySelector<HTMLElement>(`[data-test="assistant-context-time-${id}"]`);
  return { wrapper, row };
}

enableAutoUnmount(afterEach);

describe("AssistantTimePrefix", () => {
  it("names the range and where it comes from", () => {
    const wrapper = mount(AssistantTimePrefix, { props: { window: DEFAULT } });
    const button = wrapper.get('[data-test="assistant-context-chip-time"]');
    expect(button.text()).toBe("Last 15 min");
    expect(button.attributes("aria-label")).toBe("Time range, Last 15 min, default");
  });

  it("marks the default on a page with no range, and offers no Page time", async () => {
    const { row } = await open({ window: DEFAULT });
    expect(row("page")).toBeNull();
    expect(row("15m")?.textContent).toContain("default");
    expect(row("15m")?.getAttribute("aria-checked")).toBe("true");
  });

  it("offers Page time on a page with a range, and goes back to it with null", async () => {
    const { wrapper, row } = await open({
      window: { ...PAGE, source: "custom", period: "7d" },
      pageWindow: PAGE,
    });
    expect(row("page")?.textContent).toContain("Page time");
    expect(row("7d")?.getAttribute("aria-checked")).toBe("true");
    row("page")!.click();
    await flushPromises();
    expect(wrapper.emitted("change")).toEqual([[null]]);
  });

  it("applies a preset at once as an override", async () => {
    const { wrapper, row } = await open({ window: DEFAULT });
    row("24h")!.click();
    await flushPromises();
    expect(wrapper.emitted("change")?.[0]?.[0]).toMatchObject({ period: "24h" });
  });
});
