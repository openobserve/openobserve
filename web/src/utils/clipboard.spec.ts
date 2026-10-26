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
import { copyPendingText, copyToClipboard } from "./clipboard";

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const t = ((key: string) => key) as unknown as Parameters<typeof copyToClipboard>[1];

class FakeClipboardItem {
  constructor(public items: Record<string, Promise<Blob>>) {}
}

// The test setup defines navigator.clipboard writable but not configurable.
const setupClipboard = navigator.clipboard;
const setClipboard = (clipboard: Partial<Clipboard> | undefined) =>
  Object.assign(navigator, { clipboard });

describe("clipboard", () => {
  let execCommand: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
  });

  afterEach(() => {
    setClipboard(setupClipboard);
    vi.unstubAllGlobals();
  });

  it("the DOM fallback textarea is masked from session replay", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    let privacy: string | null = null;
    execCommand.mockImplementation(() => {
      privacy = document.activeElement?.getAttribute("data-o2-privacy") ?? null;
      return true;
    });

    await expect(copyToClipboard("o2wh_SECRET", t, { silent: true })).resolves.toBe(true);

    expect(privacy).toBe("mask");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("copyPendingText writes a ClipboardItem before the value resolves", async () => {
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const write = vi.fn(async (items: FakeClipboardItem[]) => {
      await items[0].items["text/plain"];
    });
    setClipboard({ write: write as unknown as Clipboard["write"], writeText: vi.fn() });
    let resolve!: (v: string) => void;
    const value = new Promise<string>((r) => (resolve = r));

    const copying = copyPendingText(value);

    expect(write).toHaveBeenCalledTimes(1);
    resolve("o2wh_SECRET");
    await expect(copying).resolves.toBe(true);
    const blob = await write.mock.calls[0][0][0].items["text/plain"];
    expect(blob.type).toBe("text/plain");
    const text = await new Promise((resolveText) => {
      const reader = new FileReader();
      reader.onload = () => resolveText(reader.result);
      reader.readAsText(blob);
    });
    expect(text).toBe("o2wh_SECRET");
  });

  it("copyPendingText falls back to writeText when ClipboardItem is refused or missing", async () => {
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ write: vi.fn().mockRejectedValue(new Error("NotAllowed")), writeText });
    await expect(copyPendingText(Promise.resolve("a"))).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("a");

    vi.unstubAllGlobals();
    await expect(copyPendingText(Promise.resolve("b"))).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("b");
  });

  it("copyPendingText rethrows the value's failure and returns false when no copy works", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    await expect(copyPendingText(Promise.reject(new Error("fetch failed")))).rejects.toThrow(
      "fetch failed",
    );

    execCommand.mockReturnValue(false);
    await expect(copyPendingText(Promise.resolve("x"))).resolves.toBe(false);
  });
});
