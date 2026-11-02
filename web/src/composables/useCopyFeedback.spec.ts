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
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { COPY_FEEDBACK_MS, useCopyFeedback, type UseCopyFeedbackReturn } from "./useCopyFeedback";

const toastMock = vi.hoisted(() => vi.fn());
const copyMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: copyMock }));

function setup(): { api: UseCopyFeedbackReturn; unmount: () => void } {
  let api!: UseCopyFeedbackReturn;
  const Host = defineComponent({
    setup() {
      api = useCopyFeedback();
      return () => h("div");
    },
  });
  const wrapper = mount(Host);
  return { api, unmount: () => wrapper.unmount() };
}

const announcerText = () =>
  document.getElementById("o2-copy-feedback-announcer")?.textContent ?? null;

describe("useCopyFeedback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toastMock.mockClear();
    copyMock.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.getElementById("o2-copy-feedback-announcer")?.remove();
  });

  it("copies the text and marks only the clicked key as copied, with no toast", async () => {
    const { api } = setup();
    expect(await api.copy("hello", "row-1")).toBe(true);

    expect(copyMock).toHaveBeenCalledWith("hello", expect.any(Function), { silent: true });
    expect(api.isCopied("row-1")).toBe(true);
    expect(api.isCopied("row-2")).toBe(false);
    expect(api.isCopied()).toBe(false);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("uses a default key when none is given", async () => {
    const { api } = setup();
    await api.copy("x");
    expect(api.isCopied()).toBe(true);
  });

  it("clears the copied state after the feedback window", async () => {
    const { api } = setup();
    await api.copy("x", "a");
    vi.advanceTimersByTime(COPY_FEEDBACK_MS - 1);
    expect(api.isCopied("a")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(api.isCopied("a")).toBe(false);
  });

  it("restarts the window and moves the state when another key copies", async () => {
    const { api } = setup();
    await api.copy("x", "a");
    vi.advanceTimersByTime(COPY_FEEDBACK_MS - 100);
    await api.copy("y", "b");
    expect(api.isCopied("a")).toBe(false);
    expect(api.isCopied("b")).toBe(true);
    vi.advanceTimersByTime(COPY_FEEDBACK_MS - 1);
    expect(api.isCopied("b")).toBe(true);
  });

  it("announces the confirmation through a polite live region", async () => {
    const { api } = setup();
    await api.copy("x");
    const region = document.getElementById("o2-copy-feedback-announcer");
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(region?.getAttribute("role")).toBe("status");
    vi.advanceTimersByTime(60);
    expect(announcerText()).toBeTruthy();

    // A second copy re-announces even though the text is the same.
    await api.copy("x");
    expect(announcerText()).toBe("");
    vi.advanceTimersByTime(60);
    expect(announcerText()).toBeTruthy();
    expect(document.querySelectorAll("#o2-copy-feedback-announcer")).toHaveLength(1);
  });

  it("shows an error toast and no copied state when the clipboard refuses", async () => {
    copyMock.mockResolvedValue(false);
    const { api } = setup();

    expect(await api.copy("x", "a")).toBe(false);
    expect(api.isCopied("a")).toBe(false);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0]).toMatchObject({ variant: "error" });
  });

  it("stops its timer when the owner unmounts", async () => {
    const { api, unmount } = setup();
    await api.copy("x", "a");
    unmount();
    vi.advanceTimersByTime(COPY_FEEDBACK_MS);
    expect(api.isCopied("a")).toBe(true);
  });
});
