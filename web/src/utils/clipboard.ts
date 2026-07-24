// Copyright 2026 OpenObserve Inc.

import { toast } from "@/lib/feedback/Toast/useToast";

export interface CopyToClipboardOptions {
  successMessage?: string;
  errorMessage?: string;
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

export async function copyToClipboard(
  text: string,
  options: CopyToClipboardOptions = {},
): Promise<boolean> {
  const { successMessage, errorMessage, timeout = 2000, silent = false } = options;

  try {
    await writeClipboard(text);
    if (!silent) {
      toast({
        variant: "success",
        message: successMessage || "Copied to clipboard!",
        timeout,
      });
    }
    return true;
  } catch {
    if (!silent) {
      toast({
        variant: "error",
        message: errorMessage || "Failed to copy to clipboard",
        timeout,
      });
    }
    return false;
  }
}
