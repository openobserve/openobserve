// Copyright 2026 OpenObserve Inc.

import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, type TranslateFn, type I18nText } from "@/types/i18n";

export interface CopyToClipboardOptions {
  successMessage?: I18nText;
  errorMessage?: I18nText;
  timeout?: number;
  silent?: boolean;
}

async function writeClipboard(text: string): Promise<void> {
  // Try the modern Clipboard API first (requires secure context / permission).
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Permission denied or non-secure context — fall through to execCommand.
    }
  }

  // execCommand fallback for HTTP (non-secure) contexts.
  //
  // Append the textarea inside the active element's nearest dialog/drawer so that
  // reka-ui's FocusScope trap does not steal focus away before execCommand fires.
  // Appending to document.body (outside the trap's subtree) lets the trap pull
  // focus back and clear the selection, causing Chrome to return true for an
  // empty-selection copy and the success toast to be shown incorrectly.
  const activeEl = document.activeElement as HTMLElement | null;
  const container: HTMLElement = activeEl?.closest<HTMLElement>('[role="dialog"]') ?? document.body;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none;";
  textarea.setAttribute("readonly", "");
  // Callers copy tokens and secrets; session replay records any unmasked DOM insert.
  textarea.setAttribute("data-o2-privacy", "mask");
  container.appendChild(textarea);
  textarea.focus();
  textarea.select();

  // Guard against focus-trap reclaim: if the active element is no longer our
  // textarea the selection was cleared and the copy would silently no-op.
  const focused = document.activeElement === textarea;
  const copied = focused && document.execCommand("copy");
  container.removeChild(textarea);

  if (!copied) {
    throw new Error("execCommand copy failed");
  }
}

/** Copies text that is still loading: the ClipboardItem write starts inside the click, before any await; false when no copy path works, a rejection of `text` rethrows. */
export async function copyPendingText(text: Promise<string>): Promise<boolean> {
  if (typeof ClipboardItem !== "undefined" && typeof navigator.clipboard?.write === "function") {
    try {
      const blob = text.then((value) => new Blob([value], { type: "text/plain" }));
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      return true;
    } catch {
      // Refused or unsupported item: fall back to writing the resolved text.
    }
  }
  const value = await text;
  try {
    await writeClipboard(value);
    return true;
  } catch {
    return false;
  }
}

export async function copyToClipboard(
  text: string,
  t: TranslateFn,
  options: CopyToClipboardOptions = {},
): Promise<boolean> {
  const { successMessage, errorMessage, timeout = 2000, silent = false } = options;

  try {
    await writeClipboard(text);
    if (!silent) {
      toast({
        variant: "success",
        message: raw(successMessage || t("common.copySuccess")),
        timeout,
      });
    }
    return true;
  } catch {
    if (!silent) {
      toast({
        variant: "error",
        message: raw(errorMessage || t("common.copyError")),
        timeout,
      });
    }
    return false;
  }
}
