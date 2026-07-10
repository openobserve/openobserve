// Copyright 2026 OpenObserve Inc.

import { toast } from "@/lib/feedback/Toast/useToast";

export interface CopyToClipboardOptions {
  successMessage?: string;
  errorMessage?: string;
  timeout?: number;
  silent?: boolean;
}

/**
 * Fallback copy using execCommand for non-secure contexts (HTTP).
 *
 * Key fix: the textarea is appended to the currently focused element's
 * closest dialog/drawer container (if any) instead of document.body.
 * This prevents focus-trap components (e.g., reka-ui ODrawer) from
 * stealing focus away and clearing the selection before execCommand runs.
 *
 * Additionally, we verify the selection length after .select() to avoid
 * reporting success when the copy actually failed silently.
 */
function execCommandCopy(text: string): void {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "-9999px";
  textarea.style.opacity = "0";

  // Append inside the active dialog/drawer container to avoid focus-trap conflicts
  const activeEl = document.activeElement;
  const container =
    activeEl?.closest("[role='dialog']") ||
    activeEl?.closest("[data-radix-focus-guard]")?.parentElement ||
    document.body;

  container.appendChild(textarea);
  textarea.focus();
  textarea.select();

  // Verify the selection is actually set (focus-trap may have cleared it)
  const selection = document.getSelection();
  const selectedText = selection?.toString() || "";
  if (selectedText.length === 0 && text.length > 0) {
    container.removeChild(textarea);
    throw new Error(
      "execCommand copy failed: selection was cleared (likely by a focus trap)",
    );
  }

  const success = document.execCommand("copy");
  container.removeChild(textarea);

  if (!success) {
    throw new Error("execCommand copy failed");
  }
}

/**
 * Write text to clipboard.
 *
 * Strategy:
 * 1. If secure context → use navigator.clipboard.writeText (modern API)
 * 2. Otherwise → fall back to execCommand("copy")
 * 3. If clipboard API exists but throws (e.g., permission denied in HTTP
 *    context on some browsers) → also fall back to execCommand
 */
async function writeClipboard(text: string): Promise<void> {
  // Only attempt clipboard API in secure contexts where it's reliable
  if (
    window.isSecureContext &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Clipboard API failed (e.g., document not focused, permission denied)
      // Fall through to execCommand fallback
    }
  }

  // Fallback: execCommand approach (works in HTTP contexts)
  execCommandCopy(text);
}

export async function copyToClipboard(
  text: string,
  options: CopyToClipboardOptions = {},
): Promise<boolean> {
  const { successMessage, errorMessage, timeout = 2000, silent = false } =
    options;

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
