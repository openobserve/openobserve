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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import SampleLivePreview from "./SampleLivePreview.vue";

const lineTexts = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('[data-test="sample-live-preview-lines"] > span').map((line) => line.text());

describe("SampleLivePreview", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders the bar strip and five log lines", () => {
    const wrapper = mount(SampleLivePreview);
    expect(wrapper.findAll('[data-test="sample-live-preview-bars"] > span')).toHaveLength(32);
    expect(lineTexts(wrapper)).toHaveLength(5);
  });

  it("streams a new line on every tick", async () => {
    const wrapper = mount(SampleLivePreview);
    const before = lineTexts(wrapper);
    await vi.advanceTimersByTimeAsync(1200);
    expect(lineTexts(wrapper)).toHaveLength(5);
    expect(lineTexts(wrapper)).not.toEqual(before);
  });

  it("starts no timer while paused", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const wrapper = mount(SampleLivePreview, { props: { paused: true } });
    const before = lineTexts(wrapper);
    await vi.advanceTimersByTimeAsync(5000);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(lineTexts(wrapper)).toEqual(before);
  });

  it("leaves the bars alone on a tick when the chart is off", async () => {
    const wrapper = mount(SampleLivePreview, { props: { chart: false } });
    const before = (wrapper.vm as unknown as { bars: unknown }).bars;
    await vi.advanceTimersByTimeAsync(1200);
    expect((wrapper.vm as unknown as { bars: unknown }).bars).toBe(before);
  });
});
