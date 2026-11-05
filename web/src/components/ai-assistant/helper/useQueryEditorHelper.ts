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

import { computed, markRaw, nextTick, ref, watch, type ComputedRef, type Ref } from "vue";

import {
  assistantFocusCard,
  focusDockComposer,
  isDockOpen,
  useAssistantCapability,
  useEditorProposal,
} from "@/composables/assistant";
import type {
  AiLabelState,
  EditorProposal,
  EntryKind,
  InlineHostAdapter,
  PendingProposal,
  QueryEditorAssistant,
} from "@/composables/assistant/pure";
import { trackAssistant } from "@/services/assistantAnalytics";
import { gt, raw, type I18nText } from "@/types/i18n";

import type { HelperLanguage } from "./helperText";

/** What the helper needs from the Monaco wrapper. */
export interface QueryEditorHandle {
  getValue(): string | undefined;
  replaceValue(text: string): void;
  focus(): void;
}

export interface QueryEditorHelperOptions {
  assistant: () => QueryEditorAssistant | null | undefined;
  /** False while the host wants no helper here (builder mode, read-only); the door and row leave reactively. */
  enabled?: () => boolean;
  /** The editor's reactive text, so reads of the Monaco buffer re-run when it changes. */
  query?: () => string | undefined;
  language: () => HelperLanguage;
  editor: () => QueryEditorHandle | null;
  area: () => HTMLElement | null;
  /** The host's model update; the editor itself is written through `replaceValue`. */
  write(text: string): void;
  /** The helper row's `focusPrompt`, once mounted. */
  focusPrompt: () => void;
}

export interface QueryEditorHelper {
  /** The door renders: the build is entitled and configured. */
  visible: ComputedRef<boolean>;
  /** The chord, hint and row may act: the user can chat here. */
  usable: ComputedRef<boolean>;
  host: InlineHostAdapter;
  /** Present only when the editor owns its proposal; a docked host renders its own diff and label. */
  proposal: EditorProposal | null;
  pending: ComputedRef<PendingProposal | null>;
  label: ComputedRef<AiLabelState | null>;
  open: Ref<boolean>;
  entryKind: Ref<EntryKind>;
  prefill: Ref<{ text: string; mode: "edit" | "replace" } | undefined>;
  blocked: ComputedRef<I18nText | null>;
  dockOpen: ComputedRef<boolean>;
  status: Ref<I18nText>;
  editTick: Ref<number>;
  focused: Ref<boolean>;
  openFrom(entryKind: EntryKind, prefill?: { text: string; mode: "edit" | "replace" }): void;
  /** False when the door does not render here, so the editor keeps the key. */
  onChord(): boolean;
  onUserEdit(): void;
}

const VISIBLE_GATES: ReadonlySet<string> = new Set([
  "available",
  "unhealthy",
  "no_permission",
  "off_for_org",
]);

const USABLE_GATES: ReadonlySet<string> = new Set(["available", "unhealthy"]);

/** One editor's door, chord, hint and helper row; built only on the v2 path. */
export function useQueryEditorHelper(opts: QueryEditorHelperOptions): QueryEditorHelper {
  const capability = useAssistantCapability();
  const initial = opts.assistant();
  const hostId = () => opts.assistant()?.id ?? initial?.id ?? "logs";
  const open = ref(false);
  const entryKind = ref<EntryKind>("editor_button");
  const prefill = ref<{ text: string; mode: "edit" | "replace" } | undefined>(undefined);
  const status = ref<I18nText>(raw(""));
  const editTick = ref(0);
  const focused = ref(false);

  // Monaco's value is not reactive; reading the query prop first makes every reader re-run on an edit.
  const getBuffer = () => {
    const tracked = opts.query?.();
    return opts.editor()?.getValue() ?? tracked ?? "";
  };
  const own: Partial<InlineHostAdapter> = {
    getBuffer,
    previewInsert: (text, mode) => {
      if (!proposal) return Promise.resolve({ accept() {}, reject() {} });
      return proposal.propose(text, { mode, provenance: { prompt: "" }, canRun: !!host.run });
    },
    focusEditor: () => opts.editor()?.focus(),
  };
  // Every other field is read from the host's adapter at use time, so a swapped adapter is followed.
  const host = new Proxy(own, {
    get(target, key: string) {
      if (key === "id") return hostId();
      if (key === "language") return opts.language();
      if (key in target) return target[key as keyof InlineHostAdapter];
      return opts.assistant()?.[key as keyof QueryEditorAssistant];
    },
  }) as InlineHostAdapter;

  const proposal: EditorProposal | null =
    initial && !initial.proposal
      ? useEditorProposal(
          {
            id: initial.id,
            get language() {
              return opts.language();
            },
            getBuffer: host.getBuffer,
            focusEditor: host.focusEditor,
            get run() {
              return opts.assistant()?.run;
            },
          },
          {
            write(text) {
              opts.editor()?.replaceValue(text);
              opts.write(text);
            },
            area: opts.area,
          },
        )
      : null;

  const owned = () => opts.assistant()?.proposal ?? proposal;
  const present = () => !!opts.assistant() && (opts.enabled?.() ?? true);
  const visible = computed(() => present() && VISIBLE_GATES.has(capability.gate.value));
  const usable = computed(() => present() && USABLE_GATES.has(capability.gate.value));
  const blocked = computed<I18nText | null>(() =>
    opts.assistant()?.stream === "" ? gt("assistant.helper.noStream") : null,
  );
  const dockOpen = computed(() => isDockOpen(hostId()));

  const openFrom = (kind: EntryKind, text?: { text: string; mode: "edit" | "replace" }) => {
    if (!usable.value || blocked.value) return;
    entryKind.value = kind;
    if (text) prefill.value = { ...text };
    trackAssistant("ai_entry_clicked", {
      entry_kind: kind,
      entry_verb: "generate_query",
      object_kind: "query",
      sends: false,
      gate: capability.gate.value,
      queued: false,
    });
    if (open.value) return opts.focusPrompt();
    open.value = true;
    void nextTick(opts.focusPrompt);
  };

  // A pending card wins, then this editor's open dock, then the helper row.
  const onChord = (): boolean => {
    if (!visible.value) return false;
    if (assistantFocusCard() || focusDockComposer(hostId())) return true;
    if (!usable.value) return true;
    if (blocked.value) {
      status.value = blocked.value;
      return true;
    }
    openFrom("shortcut");
    return true;
  };

  // Leaving custom mode or turning read-only closes the row and drops a diff the editor can no longer take.
  watch(visible, (shown) => {
    if (shown) return;
    open.value = false;
    proposal?.discard();
  });

  return {
    visible,
    usable,
    // Raw so a reactive wrapper in the template never unwraps their own refs.
    host: markRaw(host),
    proposal: proposal ? markRaw(proposal) : null,
    pending: computed(() =>
      opts.assistant()?.proposal ? null : (proposal?.pending.value ?? null),
    ),
    label: computed(() => (opts.assistant()?.proposal ? null : (owned()?.label.value ?? null))),
    open,
    entryKind,
    prefill,
    blocked,
    dockOpen,
    status,
    editTick,
    focused,
    openFrom,
    onChord,
    onUserEdit: () => {
      editTick.value += 1;
    },
  };
}
