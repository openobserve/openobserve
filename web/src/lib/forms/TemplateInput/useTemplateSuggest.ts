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

import { computed, onBeforeUnmount, ref } from "vue";
import { raw } from "@/types/i18n";
import type {
  OpenToken,
  TemplateSuggestion,
  UseTemplateSuggestOptions,
  UseTemplateSuggestReturn,
} from "./OTemplateInput.types";

/** A closed `{{name}}` token; inner spaces allowed, the name must start with a letter or `_`. */
export const CLOSED_TOKEN_RE = /\{\{\s*([A-Za-z_]\w*)\s*\}\}/g;

/** An open `{{` with no closing braces yet, anchored to the caret so a later `{{` wins. */
export const OPEN_TOKEN_RE = /\{\{\s*([A-Za-z0-9_]*)$/;

// Long enough that passing through a token on the way elsewhere does not flash the peek.
const PEEK_DELAY_MS = 300;

type NativeField = HTMLInputElement | HTMLTextAreaElement;

/** The name of the closed token the caret sits inside (either edge counts), or `null`. */
export function tokenAtCaret(text: string, caret: number): string | null {
  for (const found of text.matchAll(CLOSED_TOKEN_RE)) {
    const start = found.index;
    const end = start + found[0].length;
    if (caret >= start && caret <= end) return found[1];
  }
  return null;
}

/** Finds the open token that ends at `caret`, or `null` when the list must close. */
export function openTokenAt(text: string, caret: number): OpenToken | null {
  const found = OPEN_TOKEN_RE.exec(text.slice(0, caret));
  if (!found) return null;
  return { query: found[1], start: caret - found[0].length };
}

/** The `{{name}}` text the list and the peek both render. */
export function tokenFor(name: string) {
  return raw(`{{${name}}}`);
}

function isNativeField(target: EventTarget | null): target is NativeField {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

export function useTemplateSuggest<T extends TemplateSuggestion>(
  options: UseTemplateSuggestOptions<T>,
): UseTemplateSuggestReturn<T> {
  const element = ref<NativeField | null>(null);
  const open = ref<OpenToken | null>(null);
  const highlightedIndex = ref(0);
  const peekName = ref<string | null>(null);
  let peekTimer: ReturnType<typeof setTimeout> | null = null;

  const matches = computed<T[]>(() => {
    const token = open.value;
    if (!token) return [];
    const query = token.query.toLowerCase();
    return (options.suggestions() ?? []).filter((s) => s.name.toLowerCase().startsWith(query));
  });

  const listOpen = computed(() => open.value !== null && matches.value.length > 0);

  const peekValue = computed(() => {
    const values = options.values();
    const name = peekName.value;
    if (!values || name === null || !(name in values)) return null;
    return raw(values[name] || "—");
  });

  function close() {
    open.value = null;
    highlightedIndex.value = 0;
  }

  function highlight(index: number) {
    highlightedIndex.value = index;
  }

  function clearPeekTimer() {
    if (!peekTimer) return;
    clearTimeout(peekTimer);
    peekTimer = null;
  }

  // Hides at once, shows only after the delay; a caret still inside the same token keeps it.
  function updatePeek() {
    const el = element.value;
    if (!el || !options.values()) return;
    const name = tokenAtCaret(el.value, el.selectionStart ?? 0);
    clearPeekTimer();
    if (peekName.value === name) return;
    peekName.value = null;
    if (!name) return;
    peekTimer = setTimeout(() => {
      peekName.value = name;
      peekTimer = null;
    }, PEEK_DELAY_MS);
  }

  function checkOpenToken(text: string, caret: number) {
    const token = openTokenAt(text, caret);
    if (!token) return close();
    open.value = token;
    highlightedIndex.value = 0;
  }

  function onInput(text: string) {
    const caret = element.value?.selectionStart ?? text.length;
    updatePeek();
    checkOpenToken(text, caret);
  }

  // A caret moved by click or arrow key past the `{{` must not leave a stale start behind.
  function onCaretMove() {
    const el = element.value;
    if (!el) return;
    updatePeek();
    if (open.value) checkOpenToken(el.value, el.selectionStart ?? el.value.length);
  }

  function detach() {
    const el = element.value;
    if (!el) return;
    el.removeEventListener("click", onCaretMove);
    el.removeEventListener("keyup", onCaretMove);
    element.value = null;
  }

  // Neither field exposes its native element, so the first `focus` hands it over.
  function onFocus(event: FocusEvent) {
    const target = event.target;
    if (!isNativeField(target)) return;
    if (element.value !== target) {
      detach();
      target.addEventListener("click", onCaretMove);
      target.addEventListener("keyup", onCaretMove);
      element.value = target;
    }
    updatePeek();
  }

  function onBlur() {
    close();
    clearPeekTimer();
    peekName.value = null;
  }

  // The element, not the prop: the prop only catches up once the parent flushes the keystroke.
  function accept(name: string) {
    const token = open.value;
    const el = element.value;
    if (!token || !el) return;
    const text = el.value;
    const caret = el.selectionStart ?? text.length;
    const inserted = `{{${name}}}`;
    options.emit("update:modelValue", text.slice(0, token.start) + inserted + text.slice(caret));
    options.emit("select", name);
    close();
    const next = token.start + inserted.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next, next);
    });
  }

  function onKeydown(event: KeyboardEvent) {
    if (!listOpen.value) return;
    const count = matches.value.length;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      highlightedIndex.value = (highlightedIndex.value + 1) % count;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      highlightedIndex.value = (highlightedIndex.value - 1 + count) % count;
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      accept(matches.value[highlightedIndex.value].name);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  onBeforeUnmount(() => {
    clearPeekTimer();
    detach();
  });

  return {
    element,
    open,
    highlightedIndex,
    matches,
    listOpen,
    peekName,
    peekValue,
    onFocus,
    onInput,
    onCaretMove,
    onKeydown,
    onBlur,
    accept,
    close,
    highlight,
  };
}
