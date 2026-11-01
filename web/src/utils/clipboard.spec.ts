// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "@/utils/clipboard";
import { raw } from "@/types/i18n";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  COPY_CONFIRM_MS,
  copyConfirm,
  dismissCopyConfirm,
  trackActivations,
} from "@/lib/feedback/Toast/copyConfirm";

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const t = ((key: string) => raw(key)) as Parameters<typeof copyToClipboard>[1];

it("adds no document listeners on import", async () => {
  vi.resetModules();
  const add = vi.spyOn(document, "addEventListener");
  await import("@/utils/clipboard");
  expect(add).not.toHaveBeenCalled();
  add.mockRestore();
});

describe("copyToClipboard execCommand fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("hands focus back to the element that triggered the copy", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    dialog.appendChild(button);
    document.body.appendChild(dialog);
    button.focus();

    const copied = await copyToClipboard("payload", t, { silent: true });

    expect(copied).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.activeElement).toBe(button);
    expect(dialog.querySelector("textarea")).toBeNull();
  });
});

describe("copyToClipboard in-place confirmation", () => {
  const press = (el: Element, type = "pointerdown", key?: string) =>
    el.dispatchEvent(
      type === "keydown"
        ? new KeyboardEvent("keydown", { key, bubbles: true })
        : new MouseEvent(type, { bubbles: true }),
    );
  const addButton = (parent: HTMLElement = document.body) => {
    const button = document.createElement("button");
    button.innerHTML = "<span>icon</span>";
    button.getClientRects = () => [{}] as unknown as DOMRectList;
    parent.appendChild(button);
    return button;
  };
  const linkCopied = { successMessage: raw("Link copied") };
  let stopTracking = () => {};

  beforeEach(() => {
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    vi.mocked(toast).mockClear();
    dismissCopyConfirm();
    stopTracking = trackActivations();
  });

  afterEach(() => {
    stopTracking();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("confirms on the clicked control instead of a toast", async () => {
    const button = addButton();
    press(button.querySelector("span")!);

    expect(await copyToClipboard("x", t, linkCopied)).toBe(true);
    expect(copyConfirm.open).toBe(true);
    expect(copyConfirm.anchor).toBe(button);
    expect(copyConfirm.message).toBe("Link copied");
    expect(toast).not.toHaveBeenCalled();
  });

  it("confirms on the control that started the copy, not one clicked while it was writing", async () => {
    let finishWrite!: () => void;
    vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(
      new Promise<void>((resolve) => (finishWrite = resolve)),
    );
    const first = addButton();
    const second = addButton();
    press(first);
    const copying = copyToClipboard("a", t, linkCopied);
    press(second);
    finishWrite();

    expect(await copying).toBe(true);
    expect(copyConfirm.anchor).toBe(first);
  });

  it("toasts when the control that started the copy is gone once it finishes", async () => {
    let finishWrite!: () => void;
    vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(
      new Promise<void>((resolve) => (finishWrite = resolve)),
    );
    const button = addButton();
    press(button);
    const copying = copyToClipboard("a", t, linkCopied);
    button.remove();
    finishWrite();

    expect(await copying).toBe(true);
    expect(copyConfirm.open).toBe(false);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("toasts when the copy's dialog closes and takes the control along before the bubble is seen", async () => {
    vi.useFakeTimers();
    const dialog = document.createElement("div");
    document.body.appendChild(dialog);
    const button = addButton(dialog);
    press(button);
    expect(await copyToClipboard("key", t, linkCopied)).toBe(true);
    expect(copyConfirm.open).toBe(true);

    dialog.remove();
    vi.advanceTimersByTime(250);
    expect(copyConfirm.open).toBe(false);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("does not toast when the control leaves after the bubble was seen", async () => {
    vi.useFakeTimers();
    const button = addButton();
    press(button);
    await copyToClipboard("key", t, linkCopied);

    vi.advanceTimersByTime(1500);
    button.remove();
    vi.advanceTimersByTime(250);
    expect(copyConfirm.open).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });

  it("says Copied on the control when the caller has no message", async () => {
    press(addButton(), "keydown", "Enter");
    await copyToClipboard("x", t);
    expect(copyConfirm.message).toBe("common.copied");
    expect(toast).not.toHaveBeenCalled();
  });

  it("toasts when no OToastProvider is mounted to draw the bubble", async () => {
    stopTracking();
    const anchor = addButton();
    press(anchor);
    await copyToClipboard("x", t, { ...linkCopied, anchor });
    expect(copyConfirm.open).toBe(false);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("falls back to the toast when no control was activated", async () => {
    await copyToClipboard("x", t, linkCopied);
    expect(copyConfirm.open).toBe(false);
    expect(toast).toHaveBeenCalledWith({
      variant: "success",
      message: "Link copied",
      timeout: 2000,
    });
  });

  it("toasts a copy made by a keyboard shortcut instead of guessing a control", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    press(document.body);
    const focused = addButton();
    focused.focus();
    now.mockReturnValue(20_000);
    press(focused, "keydown", "c");
    await copyToClipboard("x", t, linkCopied);
    expect(copyConfirm.open).toBe(false);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("uses the focused button once the activation is stale", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    press(addButton());
    const focused = addButton();
    focused.focus();
    now.mockReturnValue(12_000);
    await copyToClipboard("x", t, linkCopied);
    expect(copyConfirm.anchor).toBe(focused);
  });

  it("prefers an explicit anchor", async () => {
    press(addButton());
    const anchor = addButton();
    await copyToClipboard("x", t, { ...linkCopied, anchor });
    expect(copyConfirm.anchor).toBe(anchor);
  });

  it("toasts when the control sits in a closing menu", async () => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.appendChild(menu);
    press(addButton(menu));
    await copyToClipboard("x", t, linkCopied);

    expect(copyConfirm.open).toBe(false);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("keeps the error toast and shows no confirmation when the copy fails", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    Object.defineProperty(document, "execCommand", { value: () => false, configurable: true });
    press(addButton());

    expect(await copyToClipboard("x", t, { errorMessage: raw("Link not copied") })).toBe(false);
    expect(copyConfirm.open).toBe(false);
    expect(toast).toHaveBeenCalledWith({
      variant: "error",
      message: "Link not copied",
      timeout: 2000,
    });
  });

  it("leaves silent callers alone", async () => {
    press(addButton());
    expect(await copyToClipboard("x", t, { silent: true })).toBe(true);
    expect(copyConfirm.open).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });

  it("closes the confirmation after its window but keeps the anchor for the exit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const button = addButton();
    press(button);
    await copyToClipboard("x", t, linkCopied);
    vi.advanceTimersByTime(COPY_CONFIRM_MS - 1);
    expect(copyConfirm.open).toBe(true);
    vi.advanceTimersByTime(1);
    expect(copyConfirm.open).toBe(false);
    expect(copyConfirm.anchor).toBe(button);
    expect(toast).not.toHaveBeenCalled();
  });

  describe("when the page moves the control under the confirmation", () => {
    const moveControlAfter = async (ms: number) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      const button = addButton();
      let top = 500;
      button.getBoundingClientRect = () => new DOMRect(10, top, 20, 20);
      press(button);
      await copyToClipboard("x", t, linkCopied);
      vi.advanceTimersByTime(ms);
      top = 42;
      button.dispatchEvent(new Event("scroll"));
      expect(copyConfirm.open).toBe(false);
    };

    it("toasts the confirmation instead when the bubble was barely seen", async () => {
      await moveControlAfter(200);
      expect(toast).toHaveBeenCalledWith({
        variant: "success",
        message: "Link copied",
        timeout: 2000,
      });
    });

    it("does not toast once the bubble has been up a while", async () => {
      await moveControlAfter(1500);
      expect(toast).not.toHaveBeenCalled();
    });
  });
});
