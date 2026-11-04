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

import { getCurrentScope, onScopeDispose, ref } from "vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { copyToClipboard } from "@/utils/clipboard";
import { useI18nTyped } from "@/types/i18n";

export const COPY_FEEDBACK_MS = 2000;

const DEFAULT_KEY = "default";
const ANNOUNCER_ID = "o2-copy-feedback-announcer";

export interface UseCopyFeedbackReturn {
  /** True while the control registered under `key` should read "Copied". */
  isCopied: (key?: string) => boolean;
  /** Copies `text`; on success flags `key` as copied, on failure shows an error toast. */
  copy: (text: string, key?: string) => Promise<boolean>;
}

function announcer(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  let el = document.getElementById(ANNOUNCER_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = ANNOUNCER_ID;
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.className = "sr-only";
    document.body.appendChild(el);
  }
  return el;
}

function announce(message: string) {
  const el = announcer();
  if (!el) return;
  // Screen readers skip a live region whose text did not change, so clear it first.
  el.textContent = "";
  setTimeout(() => {
    el.textContent = message;
  }, 50);
}

/** In-place copy confirmation: the clicked control reads "Copied" for a moment instead of a toast. */
export function useCopyFeedback(): UseCopyFeedbackReturn {
  const { t } = useI18nTyped();
  const copiedKey = ref<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const isCopied = (key: string = DEFAULT_KEY) => copiedKey.value === key;

  const copy = async (text: string, key: string = DEFAULT_KEY) => {
    const ok = await copyToClipboard(text, t, { silent: true });
    if (!ok) {
      toast({ variant: "error", message: t("common.copyError") });
      return false;
    }
    clearTimer();
    copiedKey.value = key;
    announce(t("common.copied"));
    timer = setTimeout(() => {
      copiedKey.value = null;
      timer = null;
    }, COPY_FEEDBACK_MS);
    return true;
  };

  if (getCurrentScope()) onScopeDispose(clearTimer);

  return { isCopied, copy };
}
