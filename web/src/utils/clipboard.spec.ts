// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "@/utils/clipboard";
import { raw } from "@/types/i18n";

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const t = ((key: string) => raw(key)) as Parameters<typeof copyToClipboard>[1];

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
