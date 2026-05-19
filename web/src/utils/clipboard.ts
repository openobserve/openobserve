// Copyright 2026 OpenObserve Inc.

import { toast } from "@/lib/feedback/Toast/useToast";

export interface CopyToClipboardOptions {
  successMessage?: string;
  errorMessage?: string;
  timeout?: number;
  silent?: boolean;
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    await navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (!success) {
      throw new Error("execCommand copy failed");
    }
  }
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
