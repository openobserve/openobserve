<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="relative flex h-full w-full flex-col" dir="ltr" v-bind="$attrs">
    <div
      data-test="query-editor"
      class="logs-query-editor bg-card-glass-bg focus-within:ring-focus-ring-accent min-h-0 flex-1 focus-within:ring-2 focus-within:ring-inset"
      :class="{
        'promql-mode': language === 'promql',
        [queryEditorClass]: language === 'sql' || language === 'promql',
      }"
      ref="editorRef"
      :id="editorId"
    />
    <div
      class="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-test="query-editor-suggest-status"
    >
      {{ suggestAnnouncement }}
    </div>
    <!-- AI Icon Button -->
    <OButton
      v-if="showAiIcon && !disableAi"
      variant="sidebar-toggle"
      size="icon-toolbar"
      class="bg-card-glass-bg border-card-glass-border hover:bg-button-outline-hover-bg hover:border-accent absolute! top-2 right-2 z-10 border transition-all duration-200"
      :class="nlpMode ? 'bg-surface-accent-active border-accent' : ''"
      @click="toggleNlpMode"
      data-test="query-editor-ai-icon-btn"
    >
      <!-- name="" satisfies the required prop; empty name renders only the slot -->
      <OIcon name="" size="md">
        <img :src="aiIcon" :alt="t('search.aiIconAlt')" class="h-4.5 w-4.5" />
      </OIcon>
      <OTooltip side="top" align="center">
        <template #content>{{
          disableAiReason || t(nlpMode ? "search.nlpModeEnabled" : "search.nlpModeLabel")
        }}</template>
      </OTooltip>
    </OButton>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  onMounted,
  nextTick,
  onDeactivated,
  onUnmounted,
  onActivated,
  watch,
  computed,
  getCurrentInstance,
  type PropType,
} from "vue";

import type * as MonacoEditor from "monaco-editor/esm/vs/editor/editor.api";

// Lazy load Monaco Editor - only loaded when this component is rendered
// This reduces initial bundle size by ~3.1MB
let monaco: any = null;
let monacoLoading: Promise<any> | null = null;
const importMonaco = async () => {
  // editor.api must be imported first — it bootstraps StandaloneServices (the
  // Monaco DI container). Importing editor.all.js before api causes feature
  // contributions (ICodeLensCache, ISuggestMemories, actionWidgetService, etc.)
  // to register against an uninitialised container, producing "[createInstance]
  // X depends on UNKNOWN service" errors that silently degrade intellisense.
  const api = await import("monaco-editor/esm/vs/editor/editor.api");
  await import("monaco-editor/esm/vs/editor/editor.all.js");
  // Monaco caches glyph widths once; a webfont swapping in later leaves carets drawn at stale offsets.
  document.fonts?.addEventListener?.("loadingdone", () => monaco?.editor?.remeasureFonts?.());
  monaco = api;
  return api;
};
// One promise for every editor: the first Monaco service call freezes its singletons, so none may run before editor.all.js.
const loadMonaco = (): Promise<any> => {
  monacoLoading ??= importMonaco().catch((error) => {
    monacoLoading = null;
    throw error;
  });
  return monacoLoading;
};

import { vrlLanguageDefinition } from "@/utils/query/vrlLanguageDefinition";
import { recentCompletionItems } from "@/utils/queryHistory/recentCompletions";

/**
 * Per-editor configuration, keyed by model URI.
 *
 * Monaco aggregates every provider registered for a language, so registering
 * one per component meant N providers answering each keystroke and N-1 of them
 * returning an empty list for a model that did not ask. One provider set per
 * language now, looking its editor up by model.
 */
interface EditorConfig {
  enabled: () => boolean;
  keywords: () => any[];
  suggestions: () => any[];
  resolveFieldValues: () => FieldValueResolver | null;
  editor: () => any;
  /** Esc presses so far, so a value answer that lands after one is dropped. */
  escapeCount: () => number;
  mode: () => EditorSuggestMode;
  /** The Logs filter is a bare WHERE fragment, so a field with nothing before it starts a predicate. */
  filterMode: () => boolean;
  tracker: SuggestTracker;
  /** When the chain last typed its space, so the menu that space opens is known to be chained. */
  chain: ChainState;
  announce: (rows: number) => void;
  /** Text after the caret that is never a menu row; null clears it. */
  showHint: (text: string | null) => void;
  /** Set when the value lookup searches a caller's own time range instead of the default lookback. */
  valuesTimeRange: () => { startTime: number; endTime: number } | null;
  /** The user's recent queries, offered as clock rows that replace the editor text. */
  recents: () => string[];
}

interface ChainState {
  pendingSince: number;
  /** Set between the accept and the space the chain types, so that space can be told from a typed one. */
  typingSpace: boolean;
  /** Where the chain's space ended, while the next key could still be a space typed out of habit. */
  spaceEnd: { lineNumber: number; column: number } | null;
}

// Monaco's theme API takes hex only; a 1px canvas resolves any token value (oklch, color-mix) to it.
const tokenHex = (name: string): string | undefined => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!value || !context) return undefined;
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const pixel = context.getImageData(0, 0, 1, 1)?.data;
  if (!pixel) return undefined;
  const [r, g, b, a] = pixel;
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}${a < 255 ? hex(a) : ""}`;
};

const SYMBOL_ICON_KEYS = (
  "array boolean class color constant constructor enumerator enumeratorMember event field file folder " +
  "function interface key keyword method module namespace null number object operator package property " +
  "reference snippet string struct text typeParameter unit variable"
).split(" ");

/** Suggest-widget colours from the app tokens: only the autocomplete takes the app's menu style. */
const suggestThemeColors = (dark: boolean): Record<string, string> => {
  const entries: [string, string][] = [
    ...SYMBOL_ICON_KEYS.map((key): [string, string] => [
      `symbolIcon.${key}Foreground`,
      "--color-text-secondary",
    ]),
    ["editorSuggestWidget.background", "--color-select-content-bg"],
    ["editorSuggestWidget.border", "--color-dropdown-border"],
    ["editorSuggestWidget.foreground", "--color-select-item-text"],
    ["editorSuggestWidget.selectedBackground", "--color-select-item-selected-bg"],
    ["editorSuggestWidget.selectedForeground", "--color-select-item-text"],
    ["editorSuggestWidget.selectedIconForeground", "--color-select-item-selected-text"],
    ["editorSuggestWidget.highlightForeground", "--color-accent"],
    ["editorSuggestWidget.focusHighlightForeground", "--color-select-item-selected-text"],
    ["editorSuggestWidgetStatus.foreground", "--color-text-secondary"],
    [
      "list.hoverBackground",
      dark ? "--color-select-item-hover-bg" : "--color-select-item-selected-bg",
    ],
    ["symbolIcon.fieldForeground", "--color-accent"],
    ["symbolIcon.enumeratorForeground", "--color-status-warning-text"],
    ["symbolIcon.enumeratorMemberForeground", "--color-status-warning-text"],
    ["symbolIcon.functionForeground", "--color-sql-accent"],
    ["symbolIcon.methodForeground", "--color-sql-accent"],
  ];
  const colors: Record<string, string> = { "list.focusOutline": "#00000000" };
  for (const [key, token] of entries) {
    const hex = tokenHex(token);
    if (hex) colors[key] = hex;
  }
  return colors;
};

// The theme is global and its colours come from the page's dark class, so it is applied once per change of that class.
let appliedTheme: boolean | null = null;
let themeClassObserver: MutationObserver | null = null;

/** Redefine before setTheme: the token values differ between the light and dark sheets. */
const applyEditorTheme = (monaco: any): void => {
  const dark = document.documentElement.classList.contains("dark");
  if (appliedTheme === dark) return;
  appliedTheme = dark;
  defineEditorThemes(monaco);
  monaco.editor.setTheme(dark ? "myCustomDarkTheme" : "myCustomTheme");
};

// A dark class that flips after the store's theme changes would otherwise leave the previous colours in place.
const followThemeClass = (monaco: any): void => {
  if (themeClassObserver || typeof MutationObserver === "undefined") return;
  themeClassObserver = new MutationObserver(() => applyEditorTheme(monaco));
  themeClassObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
};

const defineEditorThemes = (monaco: any): void => {
  const dark = document.documentElement.classList.contains("dark");
  const suggest = suggestThemeColors(dark);
  monaco.editor.defineTheme("myCustomTheme", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", background: "FFFFFF" },
      // PromQL: no rules on purpose — built-in "vs" colours via inherit.
    ],
    colors: {
      "editor.foreground": "#000000",
      "editor.background": "#fafafa",
      "editorCursor.foreground": "#000000",
      "editor.lineHighlightBackground": "#FFFFFF",
      "editorLineNumber.foreground": "#000000",
      "editor.border": "#000000",
      ...(dark ? {} : suggest),
    },
  });
  monaco.editor.defineTheme("myCustomDarkTheme", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "string", foreground: "CE9178" },
      { token: "string.sql", foreground: "CE9178" },
      { token: "string.vrl", foreground: "CE9178" },
      // PromQL: no rules on purpose — built-in "vs-dark" colours via inherit.
    ],
    colors: dark ? suggest : {},
  });
};

// Per editor: the latest value request, and the lookup that already refilled a still-loading menu.
const valueRefills = new WeakMap<object, { seq: number; refilled: string | null }>();

// Per-editor: true while the caret sits in an unclosed value quote, so Enter can close it.
const VALUE_QUOTE_CONTEXT_KEY = "o2InValueQuote";

const WRAP_DESCRIPTIONS: Record<string, string> = {
  str_match: "sqlEditor.completion.wrapStrMatch",
  re_match: "sqlEditor.completion.wrapReMatch",
  re_not_match: "sqlEditor.completion.wrapReNotMatch",
};

type FieldValueResolver = (field: string, options?: ValueLookupOptions) => Promise<string[]>;
const editorConfigs = new Map<string, EditorConfig>();
const registeredLanguages = new Set<string>();
const modelKey = (model: any): string => model?.uri?.toString?.() ?? "";

// Stops at the first non-blank line, so an edit never copies the whole document.
const modelIsBlank = (model: any): boolean => {
  const lines: number = model?.getLineCount?.() ?? 0;
  for (let line = 1; line <= lines; line++) {
    if (model.getLineContent(line).trim()) return false;
  }
  return true;
};

// Global commands report here; the model says which editor accepted.
const onSuggestAccepted = (editor: any, lane: SuggestLane | "", chained: boolean) => {
  const config = editorConfigs.get(modelKey(editor?.getModel?.()));
  if (!config) return;
  config.tracker.accepted(lane);
  forgetMenu();
  if (!chained) return;
  config.chain.pendingSince = Date.now();
  config.chain.typingSpace = true;
};
import {
  resolveKeywords,
  resolveSuggestions,
  buildCompletionItems,
  SORT_LANE,
} from "@/utils/query/sqlCompletion";
import {
  parseCallContext,
  parseValueContext,
  buildValueEntries,
  buildValueStatusEntry,
  orderValues,
  valueStatusText,
  VALUES_SHOWN_CAP,
  type ValueStatus,
  buildSignatureHelp,
  buildHoverContents,
  buildOperatorLane,
  fieldEntriesOf,
  findCatalogEntry,
  findFunctionEntry,
  isCaretInComment,
  isPredicatePosition,
  groupEntries,
  isValueFunction,
  parseLogicalLeadContext,
  logicalLeadNames,
  buildLogicalLead,
  CHAINING_KEYWORDS,
  chainedKeyword,
  isValueAnswerStale,
  literalStateAtEnd,
  parseOperatorContext,
  takeValueGuardSnapshot,
  wantsNumericColumn,
  rankNumericFieldsFirst,
  VALUE_WAIT_BUDGET_MS,
  type ValueContext,
} from "@/utils/query/editorProviders";
import {
  buildPromqlValueEntries,
  parsePromqlValueContext,
  resolvePromqlLabelValues,
  type PromqlValueContext,
} from "@/composables/usePromqlSuggestions";
import {
  FIELD_VALUES_LOOKBACK_MINUTES,
  isNoValueLookup,
  type ValueLookupOptions,
} from "@/composables/fieldValueStore";
import { findDoubleQuoteIssues } from "@/utils/query/doubleQuoteWarnings";
import {
  acceptCommand,
  CHAINED_MENU_WINDOW_MS,
  chainsInMode,
  isQueryLanguage,
  NAV_SKIP_CONTEXT_KEY,
  QUERY_EDITOR_CLASS,
  WRAP_FIELD_COMMAND,
  forgetMenu,
  noteMenuItems,
  noteResolvedItem,
  registerAcceptCommands,
  setTabPicksFirst,
  SQL_VALUE_TRIGGERS,
  suggestKeyOptions,
  triggerCharactersFor,
  type SuggestLane,
} from "@/utils/query/editorKeyContract";
import {
  createSuggestTracker,
  flushEditorSuggestSummary,
  type SuggestTracker,
} from "@/utils/query/editorSuggestStats";
import { useEditorSuggestMode, type EditorSuggestMode } from "@/composables/useEditorSuggestMode";
import { loadPromqlLanguage } from "@/utils/query/promqlLanguageDefinition";

import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import { debounce } from "lodash-es";
import searchState from "@/composables/useLogs/searchState";
import { useNLQuery } from "@/composables/useNLQuery";
import { type I18nText, useI18nTyped, raw } from "@/types/i18n";
import useNotifications from "@/composables/useNotifications";
import { getImageURL } from "@/utils/zincutils";
import { isAuthError } from "@/utils/authErrors";
import { getFontMono } from "@/utils/fonts";
import { escapeEditor } from "@/utils/focusNextControl";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
export default defineComponent({
  inheritAttrs: false,
  components: { OButton, OIcon, OTooltip },
  props: {
    editorId: {
      type: String,
      default: "editor",
    },
    query: {
      type: String,
      default: "",
    },
    showAutoComplete: {
      type: Boolean,
      default: true,
    },
    keywords: {
      type: Array,
      default: () => [],
    },
    suggestions: {
      type: Array,
      default: null,
    },
    recentQueries: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
    debounceTime: {
      type: Number,
      default: 500,
    },
    readOnly: {
      type: Boolean,
      default: false,
    },
    showLineNumbers: {
      type: Boolean,
      default: true,
    },
    stickyScroll: {
      type: Boolean,
      default: true,
    },
    // When true (the app-wide default), the editor releases the mouse wheel to
    // the page once its own content has nothing left to scroll — Monaco
    // otherwise always consumes the wheel, trapping page scroll on hover. It
    // still scrolls internally when its content overflows. Set to false for a
    // full-page editor that should own the wheel even when not overflowing.
    releaseWheelToPage: {
      type: Boolean,
      default: true,
    },
    language: {
      type: String,
      default: "sql",
    },
    functions: {
      type: Array,
      default: () => [],
    },
    fields: {
      type: Array,
      default: () => [],
    },
    nlpMode: {
      type: Boolean,
      default: false,
    },
    showAiIcon: {
      type: Boolean,
      default: false,
    },
    disableAi: {
      type: Boolean,
      default: false,
    },
    disableAiReason: {
      type: String as unknown as PropType<I18nText>,
      default: raw(""),
    },
    /**
     * Resolves the values of one field, awaited by the completion provider.
     * Absent on surfaces that have none — pass `undefined`, not `null`, so the
     * declared default applies.
     */
    fieldValueResolver: {
      type: Function as PropType<FieldValueResolver>,
      default: null,
    },
    filterMode: {
      type: Boolean,
      default: false,
    },
    /** The range the field-value resolver searches, in microseconds; null means the default lookback. */
    valuesTimeRange: {
      type: Object as PropType<{ startTime: number; endTime: number } | null>,
      default: null,
    },
    freeTextDecorations: {
      type: Object as PropType<{
        ranges: { start: number; end: number }[];
        hover: I18nText;
      } | null>,
      default: null,
    },
  },
  emits: [
    "update-query",
    "user-edit",
    "run-query",
    "update:query",
    "focus",
    "blur",
    "nlpModeDetected",
    "generation-start",
    "generation-end",
    "generation-success",
    "toggle-nlp-mode",
  ],
  setup(props, { emit }) {
    const store = useStore();
    const { isDark } = useTheme();
    const { t } = useI18nTyped();
    const { showErrorNotification } = useNotifications();
    const { mode: suggestMode } = useEditorSuggestMode();
    // Read once here: at unmount the route is already the destination. The editor id can carry trace ids and SQL.
    const surface = String((getCurrentInstance()?.proxy as any)?.$route?.name ?? "unknown");
    const suggestTracker = createSuggestTracker(
      surface,
      () => props.language,
      () => suggestMode.value,
    );
    const chainState: ChainState = { pendingSince: 0, typingSpace: false, spaceEnd: null };
    let navSkipKey: { set: (value: boolean) => void } | null = null;
    const groupsHeaders = (mode: EditorSuggestMode) => props.language === "sql" && mode !== "off";
    const suggestAnnouncement = ref("");
    const announceMenu = (rows: number) => {
      // Cleared first so the same sentence twice in a row is still announced.
      suggestAnnouncement.value = "";
      nextTick(() => {
        suggestAnnouncement.value = t(
          "sqlEditor.completion.chainedMenuAnnouncement",
          { count: rows },
          rows,
        );
      });
    };
    const editorRef: any = ref();
    let editorObj: any = null;
    let escapeCount = 0;
    let programmatic = false;
    const asProgrammatic = (edit: () => void) => {
      const previous = programmatic;
      programmatic = true;
      try {
        edit();
      } finally {
        programmatic = previous;
      }
    };
    // Emits the editor's content immediately instead of waiting out the change
    // debounce. Assigned when the editor is created; see `commitModelChange`.
    let commitPendingChange: (() => void) | null = null;
    const { searchObj } = searchState();
    const {
      detectNaturalLanguage,
      generateSQL,
      transformToSQL,
      isGenerating,
      streamingResponse,
      refusalNotice,
    } = useNLQuery(t);

    const currentEditorText = ref("");

    watch(
      () => isDark.value,
      async () => {
        if (!monaco) return;
        // The suggest colours are read from the app's tokens, which follow the theme class.
        await nextTick();
        applyEditorTheme(monaco);
      },
    );

    // Both fall back to the shared catalog so every surface (Logs, Traces,
    // Dashboards, Alerts, Pipelines) is served identical content. Traces passes
    // no `suggestions` prop and used to get a 7-entry local list with no
    // aggregate functions at all.
    const keywords = computed(() => resolveKeywords(props.language, props.keywords as any[]));
    const suggestions = computed(() =>
      resolveSuggestions(props.language, props.suggestions as any[] | null),
    );

    /**
     * Debounced function to detect natural language and auto-toggle NLP mode
     * Waits 500ms after user stops typing before checking
     *
     * CRITICAL BEHAVIOR:
     * - If NOT in NLP mode: Auto-detect and emit event to turn ON NLP mode for natural language
     * - If ALREADY in NLP mode: Do NOT emit events (keep NLP mode ON regardless of what user types)
     * - NLP mode only turns OFF when AI successfully generates SQL query
     */
    const checkForNaturalLanguage = debounce((text: string) => {
      currentEditorText.value = text;
      const isNL = detectNaturalLanguage(text, props.language);

      // ONLY emit events if NOT already in NLP mode (auto-detection feature)
      // If already in NLP mode (user toggled it), don't change anything
      // Only emit when not already in NLP mode; if already set, do nothing.
      if (!props.nlpMode) {
        if (isNL) {
          emit("nlpModeDetected", true);
        } else {
          emit("nlpModeDetected", false);
        }
      }
    }, 500);

    /**
     * Handles Generate SQL button click
     * Calls AI to generate query based on current language (SQL, PromQL, VRL, JavaScript)
     * @param customText - Optional custom text to use instead of editor content
     */
    const handleGenerateSQL = async (
      customText?: string,
      abortSignal?: AbortSignal,
      sessionId?: string,
    ) => {
      const currentText = customText || currentEditorText.value;
      if (!currentText.trim()) return;

      const currentLanguage = props.language?.toLowerCase() || "sql";

      try {
        const orgId = store.state.selectedOrganization?.identifier || "default";

        // Create language-appropriate prompt
        let promptPrefix = "";
        switch (currentLanguage) {
          case "promql":
            promptPrefix = "Generate PromQL query";
            break;
          case "vrl":
            promptPrefix = "Generate VRL function";
            break;
          case "javascript":
            promptPrefix = "Generate JavaScript function";
            break;
          case "sql":
          default:
            promptPrefix = "Generate SQL query";
            break;
        }

        const prompt = `${promptPrefix} : ${currentText}`;

        // Generate query from natural language
        const generatedSQL = await generateSQL(prompt, orgId, abortSignal, sessionId);

        if (!generatedSQL || generatedSQL.trim() === "") {
          // A refused request already says why and what to do; the generic error would hide it.
          if (refusalNotice.value) {
            showErrorNotification(raw(refusalNotice.value));
            return;
          }
          // Show error notification - use streaming error message if available (e.g. Unauthorized Access)
          const errorMsg = isAuthError(streamingResponse.value)
            ? streamingResponse.value
            : t("search.nlQueryGenerationFailed");
          showErrorNotification(raw(errorMsg));
          if (isAuthError(streamingResponse.value)) {
            return; // Auth error already handled, don't trigger catch block
          }
          throw new Error("Query generation failed");
        }

        // Check if this is a special action completion (dashboard/alert)
        if (generatedSQL.startsWith("✓ DASHBOARD_CREATED:")) {
          const responseText = generatedSQL.replace("✓ DASHBOARD_CREATED:", "").trim();
          emit("generation-success", {
            type: "dashboard",
            message: responseText,
          });
          // Don't emit nlpModeDetected - keep user in current mode
          return; // Success without SQL
        }

        if (generatedSQL.startsWith("✓ ALERT_CREATED:")) {
          const responseText = generatedSQL.replace("✓ ALERT_CREATED:", "").trim();
          emit("generation-success", { type: "alert", message: responseText });
          // Don't emit nlpModeDetected - keep user in current mode
          return; // Success without SQL
        }

        if (generatedSQL.startsWith("✓ ACTION_COMPLETED:")) {
          const responseText = generatedSQL.replace("✓ ACTION_COMPLETED:", "").trim();
          emit("generation-success", { type: "action", message: responseText });
          // Don't emit nlpModeDetected - keep user in current mode
          return; // Success without SQL
        }

        // Normal query generation - transform and update editor with language-specific comments
        const transformedText = transformToSQL(currentText, generatedSQL, props.language);

        // Update editor value
        setValue(transformedText);

        // Emit update events
        emit("update-query", transformedText);
        emit("update:query", transformedText);

        // Turn off NLP mode after generating SQL (we're now in SQL mode)
        emit("nlpModeDetected", false);

        // Emit SQL generation success
        emit("generation-success", { type: "sql", message: generatedSQL });
      } catch (error) {
        console.error("[NL2Q-UI] Exception during SQL generation:", error);
        showErrorNotification(t("search.nlQueryGenerationFailed"));
        throw error; // Re-throw so SearchBar can handle it
      }
    };

    let hintDecorations: any = null;
    const showHint = (text: string | null) => {
      if (!editorObj || !monaco) return;
      hintDecorations ??= editorObj.createDecorationsCollection();
      const caret = editorObj.getPosition();
      if (!text || !caret) {
        hintDecorations.clear();
        return;
      }
      // After an auto-closed quote, so the hint does not read as part of the string.
      const closer = /^['"]/.test(
        editorObj
          .getModel()
          ?.getLineContent(caret.lineNumber)
          .slice(caret.column - 1) ?? "",
      );
      const column = caret.column + (closer ? 1 : 0);
      hintDecorations.set([
        {
          range: new monaco.Range(caret.lineNumber, column, caret.lineNumber, column),
          options: {
            after: { content: text, inlineClassName: "o2-suggest-inline-hint" },
            showIfCollapsed: true,
          },
        },
      ]);
    };

    const caretInValueQuote = (): boolean => {
      const model = editorObj?.getModel();
      const caret = editorObj?.getPosition();
      if (!model || !caret) return false;
      const before = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: caret.lineNumber,
        endColumn: caret.column,
      });
      return props.language === "sql"
        ? !!parseValueContext(before)?.hasOpenQuote
        : props.language === "promql" && !!parsePromqlValueContext(before)?.hasOpenQuote;
    };

    // A typed quote opens its menu unhighlighted; reopened as an auto Invoke it highlights the preselected first value, so Enter takes it.
    const reopenInQuote = (version: number | undefined, escapes: number) => {
      if (!editorObj || suggestMode.value === "off") return;
      // Esc or a blur since the quote dismissed the menu, and triggerSuggest would also steal focus back.
      if (escapes !== escapeCount || !editorObj.hasTextFocus?.()) return;
      // A key typed after the quote owns the menu now; reopening would highlight a menu it opened.
      if (editorObj.getModel()?.getVersionId?.() !== version) return;
      if (!caretInValueQuote()) return;
      editorObj.trigger("o2", "hideSuggestWidget", {});
      editorObj.trigger("o2", "editor.action.triggerSuggest", { auto: true });
    };

    let valueQuoteKey: any = null;
    const syncValueQuoteKey = () => {
      if (!valueQuoteKey) return;
      const selections = editorObj?.getSelections?.() ?? [];
      const single = selections.length <= 1 && (editorObj?.getSelection?.()?.isEmpty?.() ?? true);
      valueQuoteKey.set(
        isQueryLanguage(props.language) &&
          suggestMode.value !== "off" &&
          single &&
          caretInValueQuote(),
      );
    };

    // Enter with no row focused ends the value instead of breaking the string across lines.
    const closeValueQuote = () => {
      const model = editorObj?.getModel();
      const caret = editorObj?.getPosition();
      if (!model || !caret || !monaco) return;
      const quote = props.language === "promql" ? '"' : "'";
      editorObj.trigger("o2", "hideSuggestWidget", {});
      const after = model.getLineContent(caret.lineNumber).slice(caret.column - 1);
      const column = caret.column + 1;
      if (after.startsWith(quote)) {
        editorObj.setPosition({ lineNumber: caret.lineNumber, column });
        return;
      }
      editorObj.executeEdits(
        "o2",
        [
          {
            range: new monaco.Range(caret.lineNumber, caret.column, caret.lineNumber, caret.column),
            text: quote,
          },
        ],
        [new monaco.Selection(caret.lineNumber, column, caret.lineNumber, column)],
      );
      editorObj.pushUndoStop?.();
    };

    /** Point this editor's model at its live configuration. */
    let publishedKey: string | null = null;
    const publishEditorConfig = () => {
      const key = modelKey(editorObj?.getModel?.());
      if (!key) return;
      publishedKey = key;
      // Getters, not snapshots: keywords and suggestions are computeds that
      // change as the stream schema and server catalog arrive.
      editorConfigs.set(key, {
        enabled: () => props.showAutoComplete,
        keywords: () => keywords.value as any[],
        suggestions: () => suggestions.value as any[],
        resolveFieldValues: () => (props.fieldValueResolver as any) ?? null,
        editor: () => editorObj,
        escapeCount: () => escapeCount,
        mode: () => suggestMode.value,
        filterMode: () => props.filterMode,
        tracker: suggestTracker,
        chain: chainState,
        announce: announceMenu,
        showHint,
        valuesTimeRange: () => props.valuesTimeRange ?? null,
        recents: () => props.recentQueries,
      });
    };

    const setupEditor = async () => {
      // Lazy load Monaco Editor on first use
      const monacoModule = await loadMonaco();
      monaco = monacoModule;

      // Expose Monaco on window for e2e tests (read-only assertions against editor model).
      // Tests use: window.monaco.editor.getModels()[0].getValue()
      if (typeof window !== "undefined") {
        (window as any).monaco = monacoModule;
      }

      // Register custom languages after Monaco is loaded
      if (props.language === "promql") {
        monaco.languages.register({ id: "promql" });

        // The vendored PromQL grammar — without a tokenizer the
        // query renders monochrome (#9779, #9793).
        const promql = await loadPromqlLanguage();
        monaco.languages.setMonarchTokensProvider("promql", promql.language as any);
        monaco.languages.setLanguageConfiguration("promql", promql.languageConfiguration as any);
      }
      if (props.language === "vrl") {
        monaco.languages.register({ id: "vrl" });

        // Register a tokens provider for the language
        monaco.languages.setMonarchTokensProvider("vrl", vrlLanguageDefinition as any);
      }

      applyEditorTheme(monaco);
      followThemeClass(monaco);

      // One provider set per language, shared by every editor of that language.
      registerLanguageProviders(props.language);
      if (isQueryLanguage(props.language)) {
        setTabPicksFirst(monaco, suggestMode.value !== "off");
        registerAcceptCommands(monaco, onSuggestAccepted);
      }

      // Faces load lazily on first use, so without this the first measurement can hit the fallback font.
      await document.fonts?.load?.(`1rem ${getFontMono()}`).catch(() => {});

      let editorElement = document.getElementById(props.editorId);
      let retryCount = 0;
      const maxRetries = 5;

      // Retry mechanism to ensure the editor element is found
      while (!editorElement && retryCount < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 100)); // Wait for 100ms
        editorElement = document.getElementById(props.editorId);
        retryCount++;
      }

      if (!editorElement) {
        return;
      }

      // If editor already exists (hasChildNodes), update its value and options instead of returning
      if (editorElement && editorElement?.hasChildNodes()) {
        if (editorObj) {
          // Update editor value if different from current
          const currentValue = editorObj?.getValue();
          if (currentValue !== props.query?.trim()) {
            asProgrammatic(() => editorObj.setValue(props.query?.trim() || ""));
          }

          // Update readonly option if different
          const currentReadOnly = editorObj.getRawOptions().readOnly;
          if (currentReadOnly !== props.readOnly) {
            editorObj.updateOptions({ readOnly: props.readOnly });
          }
          return;
        } else {
          // editorObj is null but element has children - stale DOM
          // Don't recreate if new props are empty/readonly (likely a stale mount with default props)
          // The existing editor in the DOM is probably correct
          if (!props.query?.trim() && props.readOnly) {
            return;
          }

          // New props have actual data - safe to recreate
          editorElement.innerHTML = "";
          // Fall through to create new editor below
        }
      }
      editorObj = monaco.editor.create(editorElement as HTMLElement, {
        value: props.query?.trim(),
        language: props.language,
        ariaLabel: t("common.queryEditorAriaLabel"),
        // Monaco paints its own text and ignores the CSS cascade — without this it
        // falls back to its built-in Menlo/Monaco/Courier New stack, which differs
        // per OS and from the rest of the app.
        fontFamily: getFontMono(),
        // Pinned so the suggest rows do not change size between operating systems; the editor text keeps its default.
        suggestFontSize: 12,
        suggestLineHeight: 24,
        theme: isDark.value ? "myCustomDarkTheme" : "myCustomTheme",
        showFoldingControls: enableCodeFolding.value ? "always" : "never",
        folding: enableCodeFolding.value,
        wordWrap: "on",
        automaticLayout: true,
        lineNumbers: props.showLineNumbers ? "on" : "off",
        // Reserve a couple of gutter chars so the right-aligned line numbers get
        // left breathing room instead of sitting flush against the editor edge
        // (and so the gutter width doesn't visibly jump as digit count grows).
        lineNumbersMinChars: 2,
        overviewRulerLanes: 0,
        fixedOverflowWidgets: true,
        overviewRulerBorder: false,
        // Gap between the (right-aligned) line numbers and the code text. 3px was
        // too tight and made the digit visually collide with the first character.
        lineDecorationsWidth: 10,
        hideCursorInOverviewRuler: true,
        renderLineHighlight: "none",
        glyphMargin: false,
        scrollBeyondLastColumn: 0,
        scrollBeyondLastLine: false,
        // Small top/bottom breathing room so line 1 (and the cursor) doesn't
        // hug the top edge of the editor.
        padding: { top: 3, bottom: 3 },
        smoothScrolling: true,
        mouseWheelScrollSensitivity: 1,
        fastScrollSensitivity: 1,
        scrollbar: {
          horizontal: "auto",
          vertical: "visible",
          // Let the page scroll when this editor has nothing left to scroll.
          alwaysConsumeMouseWheel: !props.releaseWheelToPage,
        },
        find: {
          addExtraSpaceOnTop: false,
          autoFindInSelection: "never",
          seedSearchStringFromSelection: "never",
        },
        minimap: { enabled: false },
        readOnly: props.readOnly,
        renderValidationDecorations: "on",
        // Monaco defaults strings to 'off', which is why field-VALUE completion
        // used to need a forced hide/re-trigger to appear at all.
        quickSuggestions: { other: "on", comments: "off", strings: "on" },
        // Default is 'matchingDocuments'. Off for the QUERY languages only,
        // where every suggestion should come from the catalog and a word
        // scraped out of the query text is noise. VRL, JS, JSON and the rest
        // have no catalog, and there local word completion is the only
        // completion they have.
        wordBasedSuggestions:
          props.language === "sql" || props.language === "promql" ? "off" : "matchingDocuments",
        stickyScroll: {
          enabled: props.stickyScroll,
        },
        ...suggestKeyOptions(suggestMode.value, props.language),
      });

      publishEditorConfig();
      navSkipKey = editorObj.createContextKey(
        NAV_SKIP_CONTEXT_KEY,
        groupsHeaders(suggestMode.value),
      );
      valueQuoteKey = editorObj.createContextKey(VALUE_QUOTE_CONTEXT_KEY, false);
      editorObj.addAction?.({
        id: "o2.editor.escapeToNextControl",
        label: t("common.queryEditorEscapeAction"),
        keybindings: [monaco.KeyCode.Escape],
        precondition:
          "textInputFocus && !suggestWidgetVisible && !findWidgetVisible && !parameterHintsVisible && !editorHasSelection && !editorHasMultipleSelections && !inSnippetMode && !inlineSuggestionVisible && !renameInputVisible",
        run: () => escapeEditor(editorElement as HTMLElement),
      });
      editorObj.addAction?.({
        id: "o2.suggest.closeValueQuote",
        label: t("sqlEditor.completion.closeValueQuote"),
        keybindings: [monaco.KeyCode.Enter],
        precondition: `${VALUE_QUOTE_CONTEXT_KEY} && textInputFocus && !suggestWidgetHasFocusedSuggestion`,
        run: closeValueQuote,
      });

      // The editor's content only reaches the parent after `debounceTime`. Held
      // as a named handle so it can be flushed on the paths that consume the
      // query (blur, run) — otherwise they act on the previous query and the
      // parent re-renders the editor from that stale state, dropping the edit.

      // Programmatic writes emit here too; a consumer reading one as a user edit wipes state the user never touched.
      let pendingUserEdit = false;
      const commitModelChange = debounce((e: any) => {
        const newValue = editorObj?.getValue()?.trim();
        const origin = { fromUser: pendingUserEdit };
        pendingUserEdit = false;
        emit("update-query", newValue, e, origin);
        emit("update:query", newValue, e, origin);

        // Check for natural language after user stops typing (debounced)
        if (newValue) checkForNaturalLanguage(newValue);

        validateDoubleQuotes();
      }, props.debounceTime);

      // No-op when nothing is pending, so it is safe on any path that consumes
      // the query.
      commitPendingChange = () => commitModelChange.flush();

      editorObj.onDidChangeCursorPosition(() => {
        hintDecorations?.clear();
        syncValueQuoteKey();
      });
      // Programmatic writes update it too, so a restore followed by a clear reads as non-empty → empty.
      let isBlank = modelIsBlank(editorObj.getModel());
      editorObj.onDidChangeModelContent((e: any) => {
        const wasBlank = isBlank;
        isBlank = modelIsBlank(editorObj.getModel());
        const [change] = e?.changes ?? [];
        const chainSpace =
          chainState.typingSpace && e?.changes?.length === 1 && change.text === " ";
        chainState.typingSpace = false;
        chainState.spaceEnd = chainSpace
          ? { lineNumber: change.range.startLineNumber, column: change.range.startColumn + 1 }
          : null;
        if (!e?.isFlush && !programmatic) {
          pendingUserEdit = true;
          emit("user-edit", isBlank, wasBlank);
        } else {
          // The debounce emits the latest value, so a write landing on a typed one owns the origin.
          pendingUserEdit = false;
        }
        const quote = props.language === "promql" ? '"' : "'";
        if (e?.changes?.some((c: any) => c.text === quote || c.text === quote + quote)) {
          const version = editorObj.getModel()?.getVersionId?.();
          const escapes = escapeCount;
          setTimeout(() => reopenInQuote(version, escapes), 0);
        }
        commitModelChange(e);
      });

      // Fires on the text area's own blur. onDidBlurEditorWidget waits a timer tick, so a fast click on Run reads the previous query.
      editorObj.onDidBlurEditorText(() => {
        forgetMenu();
        commitModelChange.flush();
        suggestTracker.closed();
      });

      const runQuery = () => {
        commitModelChange.flush();
        emit("run-query");
      };

      // The chain already typed the space a user types after a field out of habit; IME composition is never touched.
      const swallowsHabitSpace = (e: any) => {
        const end = chainState.spaceEnd;
        chainState.spaceEnd = null;
        if (!end || e.keyCode !== monaco.KeyCode.Space || e.browserEvent?.isComposing) return false;
        if (e.ctrlKey || e.metaKey || e.altKey) return false;
        const caret = editorObj.getPosition();
        return caret?.lineNumber === end.lineNumber && caret?.column === end.column;
      };

      // Handled here rather than via addCommand: monaco's addCommand discards the
      // disposable it gets back, so its CommandsRegistry entry outlives the editor.
      editorObj.onKeyDown((e: any) => {
        if (e.keyCode === monaco.KeyCode.Escape) {
          escapeCount += 1;
          forgetMenu();
        }
        if (swallowsHabitSpace(e)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (isQueryLanguage(props.language)) {
          suggestTracker.keyDown({
            key: e.browserEvent?.key ?? "",
            ctrlOrMeta: !!(e.ctrlKey || e.metaKey),
          });
        }
        if (e.keyCode === monaco.KeyCode.Enter && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          e.stopPropagation();
          runQuery();
        }
      });
      editorObj.onDidFocusEditorWidget(() => {
        emit("focus");
      });

      editorObj.onDidBlurEditorWidget(() => {
        const model = editorObj?.getModel();
        const value = model?.getValue();
        const trimmedValue = value?.trim();

        // Trimming on blur exists so a query committed for execution doesn't
        // carry incidental leading/trailing whitespace — but for markdown
        // (the content-template body editor) trailing blank lines ARE
        // meaningful content, not incidental whitespace, so skip the trim
        // there. Without this guard, clicking a toolbar button (which blurs
        // the editor) silently deletes trailing blank lines out from under
        // the click before its handler reads the selection — see the
        // list/heading toolbar cursor-position bug report.
        if (props.language !== "markdown" && value !== trimmedValue) {
          const lastLine = model.getLineCount();
          const lastLineLength = model.getLineLength(lastLine);

          // Create an edit operation that replaces the entire content
          // This preserves undo history becuase it treats this as a single edit operation
          //and it will be in the undo stack as one operation
          asProgrammatic(() =>
            model.pushEditOperations(
              [],
              [
                {
                  range: new monaco.Range(1, 1, lastLine, lastLineLength + 1),
                  text: trimmedValue,
                },
              ],
              () => null,
            ),
          );
        }

        // Whatever was clicked (Apply, a query tab) is about to read the query.
        // Flush after the trim above so the committed value is the trimmed one.
        commitPendingChange?.();

        emit("blur");
      });

      const handleWindowClick = () => {
        editorObj?.layout();
      };

      const handleWindowResize = async () => {
        await nextTick();
        editorObj?.layout();
        // queryEditorRef.value.resetEditorLayout();
      };

      window.addEventListener("click", handleWindowClick);
      window.addEventListener("resize", handleWindowResize);

      // Store references for cleanup
      editorObj._windowClickHandler = handleWindowClick;
      editorObj._windowResizeHandler = handleWindowResize;

      // Validate the initial query value on mount
      validateDoubleQuotes();
    };

    // Monaco tokenizes a language only once its contribution has been imported,
    // and each is a separate chunk so a page pays for the one it uses. Factored
    // out of onMounted because a surface that switches language, such as the
    // export dialog's JSON and Terraform tabs, has to load the new one too.
    const loadLanguageContribution = async (language: string) => {
      if (language === "sql") {
        await import("monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js");
      }

      if (language === "json") {
        await import("monaco-editor/esm/vs/language/json/monaco.contribution.js");
      }

      if (language === "html") {
        await import("monaco-editor/esm/vs/language/html/monaco.contribution.js");
      }

      if (language === "markdown") {
        await import("monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js");
      }

      // Terraform / OpenTofu configuration, e.g. the alert and SLO exports.
      if (language === "hcl") {
        await import("monaco-editor/esm/vs/basic-languages/hcl/hcl.contribution.js");
      }

      if (language === "python") {
        await import("monaco-editor/esm/vs/basic-languages/python/python.contribution.js");
      }
      if (language === "javascript") {
        await import("monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js");
      }
      if (language === "yaml") {
        await import("monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js");
      }
      if (language === "shell") {
        await import("monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js");
      }
      if (language === "powershell") {
        await import("monaco-editor/esm/vs/basic-languages/powershell/powershell.contribution.js");
      }
    };

    // Retokenize in place rather than making the consumer remount: recreating the
    // editor to change language throws away the DOM, the scroll position and the
    // undo stack, which reads as a hitch on every toggle. Providers are left
    // alone deliberately; they register per language and re-registering here
    // would stack duplicates on a surface that toggles repeatedly.
    watch(
      () => props.language,
      async (language) => {
        if (!editorObj || !language) return;
        await loadLanguageContribution(language);
        const model = editorObj.getModel();
        if (model) monaco.editor.setModelLanguage(model, language);
      },
    );

    let freeTextDecorationIds: string[] = [];
    const escapeMarkdown = (text: string) => text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, "\\$&");
    const applyFreeTextDecorations = () => {
      const model = editorObj?.getModel?.();
      if (!model || !monaco) return;
      const decorations = props.freeTextDecorations;
      const length = model.getValueLength();
      const next = (decorations?.ranges ?? [])
        .filter((range) => range.end <= length)
        .map((range) => {
          const start = model.getPositionAt(range.start);
          const end = model.getPositionAt(range.end);
          return {
            range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
            options: {
              inlineClassName: "o2-free-text-term",
              hoverMessage: (decorations?.hover ?? "")
                .split("\n\n")
                .map((line) => ({ value: escapeMarkdown(line) })),
              stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
            },
          };
        });
      freeTextDecorationIds = editorObj.deltaDecorations(freeTextDecorationIds, next);
    };

    watch(() => props.freeTextDecorations, applyFreeTextDecorations, { deep: true });

    onMounted(async () => {
      await loadLanguageContribution(props.language);
      setupEditor();
      applyFreeTextDecorations();
    });

    onActivated(async () => {
      if (!editorObj) {
        setupEditor();
        editorObj?.layout();
      } else {
        registerLanguageProviders(props.language);
        publishEditorConfig();
      }
    });

    onDeactivated(() => {});

    onUnmounted(() => {
      // Clean up global event listeners
      if (editorObj) {
        if (editorObj._windowClickHandler) {
          window.removeEventListener("click", editorObj._windowClickHandler);
        }
        if (editorObj._windowResizeHandler) {
          window.removeEventListener("resize", editorObj._windowResizeHandler);
        }

        // Surfaces without a query run report on the way out.
        flushEditorSuggestSummary(surface);

        // Drop this editor's entry so the shared provider stops answering for
        // a model that no longer exists.
        if (publishedKey) editorConfigs.delete(publishedKey);
        publishedKey = null;

        // Dispose the editor
        editorObj.dispose();
        editorObj = null;
      }
    });

    const enableCodeFolding = computed(() => {
      return ["json", "html", "javascript"].includes(props.language);
    });

    // The editor can mount before the config that carries the mode, so a late mode is applied live.
    watch(suggestMode, (mode) => {
      if (!monaco || !isQueryLanguage(props.language)) return;
      navSkipKey?.set(groupsHeaders(mode));
      syncValueQuoteKey();
      setTabPicksFirst(monaco, mode !== "off");
      editorObj?.updateOptions(suggestKeyOptions(mode, props.language));
    });

    // update readonly when prop value changes
    watch(
      () => props.readOnly,
      () => {
        editorObj?.updateOptions({ readOnly: props.readOnly });
      },
    );

    // update lineNumbers when prop value changes
    watch(
      () => props.showLineNumbers,
      () => {
        editorObj?.updateOptions({
          lineNumbers: props.showLineNumbers ? "on" : "off",
        });
      },
    );

    // update readonly when prop value changes
    watch(
      () => props.query,
      () => {
        if (!editorObj) return;

        const currentValue = editorObj?.getValue();
        const newValue = props.query || "";
        const hasFocus = editorObj.hasWidgetFocus();

        // Only update if:
        // 1. Editor doesn't have focus (external update), OR
        // 2. It's readonly AND values are actually different
        // 3. Compare trimmed values to avoid cursor jumps from trailing spaces
        const shouldUpdate =
          (props.readOnly || !hasFocus) && currentValue?.trim() !== newValue?.trim();

        if (shouldUpdate) {
          asProgrammatic(() => editorObj.getModel()?.setValue(newValue));
        }
      },
    );

    const setValue = (value: string) => {
      if (editorObj?.setValue) {
        // Monaco's setValue throws "Illegal argument" for null/undefined —
        // coerce to a string so mode switches (e.g. PromQL → SQL) can't crash the editor
        asProgrammatic(() => editorObj.setValue(value ?? ""));
        editorObj?.layout();
      }
    };

    const replaceValue = (value: string) => {
      const model = editorObj?.getModel?.();
      if (!model) return setValue(value);
      if (model.getValue() === value) return;
      asProgrammatic(() => {
        editorObj.pushUndoStop();
        editorObj.executeEdits("replace-value", [
          { range: model.getFullModelRange(), text: value },
        ]);
        editorObj.pushUndoStop();
      });
    };

    /**
     * Register the provider set for a language exactly once.
     *
     * Each provider resolves the asking editor from the model, so three SQL
     * editors share one registration instead of stacking three.
     */
    const registerLanguageProviders = (language: string) => {
      if (!monaco || registeredLanguages.has(language)) return;
      registeredLanguages.add(language);
      const kinds = () => monaco.languages.CompletionItemKind;
      const rules = () => monaco.languages.CompletionItemInsertTextRule;

      const itemsFrom = (entries: any[], word: string, range: any) =>
        buildCompletionItems({
          keywords: entries,
          suggestions: [],
          word,
          range,
          kinds: kinds(),
          insertTextRules: rules(),
          tags: monaco.languages.CompletionItemTag,
        });

      const objectEntry = (entry: any) =>
        typeof entry === "string"
          ? { name: entry, label: entry, kind: "Field", insertText: entry }
          : entry;

      const laneOf = (entry: any): SuggestLane | "" => {
        // Kind first: a numeric field ranked first inside avg( also starts with the operator lane's prefix.
        if (entry?.kind === "Field") return "field";
        if (entry?.kind === "Value") return "value";
        if (entry?.lane !== undefined) return entry.lane;
        const sort = String(entry?.sortText ?? "");
        if (sort.startsWith(SORT_LANE.operator)) return "operator";
        if (sort.startsWith(SORT_LANE.predicate) || sort.startsWith(SORT_LANE.clause)) {
          return "clause";
        }
        return "";
      };

      // Every item counts its accept; a status row inserts nothing and counts nothing.
      const withAcceptCommands = (entries: any[]) =>
        entries.map((raw) => {
          const entry = objectEntry(raw);
          if (!entry || entry.command || entry.insertText === "" || entry.skipRow) return entry;
          return { ...entry, command: acceptCommand(laneOf(entry), false) };
        });

      const respond = (
        config: EditorConfig,
        context: any,
        chained: boolean,
        entries: any[] | null,
        word: string,
        itemRange: any,
      ) => {
        if (entries === null || !isQueryLanguage(language)) {
          return { suggestions: itemsFrom(entries ?? [], word, itemRange), incomplete: true };
        }
        const decorated = withAcceptCommands(entries);
        const suggestions = itemsFrom(decorated, word, itemRange);
        noteMenuItems(suggestions, config.editor());
        config.tracker.offered({
          triggerKind: context?.triggerKind ?? 0,
          chained,
          lanes: decorated.map(laneOf).filter((lane): lane is SuggestLane => !!lane),
          rows: suggestions.length,
        });
        if (chained && suggestions.length) config.announce(suggestions.length);
        // ALWAYS incomplete: `severity = ` turns the same catalog into a value list, and Monaco only asks again when told to.
        return { suggestions, incomplete: true };
      };

      // Monaco never asks again on its own, so a menu left on "Still loading" is refilled once its lookup lands.
      const refillWhenLoaded = (
        config: EditorConfig,
        snapshot: ReturnType<typeof takeValueGuardSnapshot>,
        fetched: Promise<unknown>,
      ) => {
        const editor = config.editor();
        if (!editor || !snapshot) return;
        const state = valueRefills.get(editor) ?? { seq: 0, refilled: null };
        const seq = state.seq;
        valueRefills.set(editor, state);
        const range = config.valuesTimeRange();
        void fetched.then(() => {
          const key = `${snapshot.line}:${snapshot.column}:${snapshot.prefix}:${range?.startTime}-${range?.endTime}`;
          if (state.seq !== seq || state.refilled === key || config.mode() === "off") return;
          if (isValueAnswerStale(snapshot, config.editor(), config.escapeCount())) return;
          state.refilled = key;
          // triggerSuggest is a no-op while the widget is visible, so the open menu is closed first.
          editor.trigger("o2", "hideSuggestWidget", {});
          editor.trigger("o2", "editor.action.triggerSuggest", { auto: true });
        });
      };

      // Null means the answer went stale while it was awaited and must not be shown.
      const awaitValues = async (
        config: EditorConfig,
        token: any,
        lookup: (options: ValueLookupOptions) => Promise<string[]>,
      ): Promise<string[] | "loading" | "failed" | "nolookup" | null> => {
        const snapshot = takeValueGuardSnapshot(config.editor(), config.escapeCount());
        let timer: ReturnType<typeof setTimeout> | undefined;
        const budget = new Promise<"loading">((resolve) => {
          timer = setTimeout(() => resolve("loading"), VALUE_WAIT_BUDGET_MS);
        });
        const fetched = lookup({ onFetched: (ms) => config.tracker.valueFetched(ms) }).catch(
          (error) => (isNoValueLookup(error) ? ("nolookup" as const) : ("failed" as const)),
        );
        const outcome = await Promise.race([fetched, budget]);
        clearTimeout(timer);
        // A newer answer supersedes any refill still waiting on an older lookup.
        const refills = valueRefills.get(config.editor() ?? {});
        if (refills) refills.seq++;
        if (outcome === "loading") refillWhenLoaded(config, snapshot, fetched);
        // An answered lookup ends the refill guard, since the next slow one may ask about another stream or range.
        else if (refills) refills.refilled = null;
        const stale =
          token?.isCancellationRequested ||
          isValueAnswerStale(snapshot, config.editor(), config.escapeCount());
        if (stale) return null;
        // A retry at the same caret keeps the old hint, since only a caret move clears it; withStatus sets it again if still due.
        config.showHint(null);
        if (outcome === "loading") config.tracker.budgetHit();
        return outcome;
      };

      const caretRange = (position: MonacoEditor.Position, typedLength: number) => ({
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: position.column - typedLength,
        endColumn: position.column,
      });

      // In a highlighted menu Enter takes row 1, so a row that inserts nothing is never row 1 there; alone, it becomes the inline hint.
      const withStatus = (
        config: EditorConfig,
        status: ValueStatus,
        field: string,
        position: MonacoEditor.Position,
        others: any[],
        { highlighted, inQuote }: { highlighted: boolean; inQuote: boolean },
      ) => {
        const asHint = (inQuote && status !== "loading") || (highlighted && !others.length);
        // PromQL label values always use the default lookback.
        const inRange = language === "sql" && status === "empty" && !!config.valuesTimeRange();
        const text = inRange
          ? t("sqlEditor.completion.valuesEmptyInRange", { field })
          : valueStatusText(t, status, field, { minutes: FIELD_VALUES_LOOKBACK_MINUTES });
        if (asHint) {
          config.showHint(text);
          return others;
        }
        const entry = buildValueStatusEntry(t, status, field, {
          minutes: FIELD_VALUES_LOOKBACK_MINUTES,
        });
        const row = {
          ...entry,
          label: inRange ? text : entry.label,
          range: caretRange(position, 0),
        };
        return highlighted ? [...others, { ...row, sortText: "\uffff" }] : [row, ...others];
      };

      const capRow = (field: string, count: number, position: MonacoEditor.Position) =>
        count >= VALUES_SHOWN_CAP
          ? [
              {
                ...buildValueStatusEntry(t, "cap", field, { count }),
                range: caretRange(position, 0),
              },
            ]
          : [];

      // `b.trace_id` in `ON a.trace_id = b.trace_id` is a column; `2.39.1` is a value.
      const isQualified = (typed: string) => /^[A-Za-z_][\w$]*\.[\w$]*$/.test(typed);

      const lineAfterCaret = (
        model: MonacoEditor.editor.ITextModel,
        position: MonacoEditor.Position,
      ) => (model.getLineContent?.(position.lineNumber) ?? "").slice(position.column - 1);

      const sqlValueEntries = async (
        model: MonacoEditor.editor.ITextModel,
        position: MonacoEditor.Position,
        token: any,
        config: EditorConfig,
        context: ValueContext,
        highlighted: boolean,
      ): Promise<any[] | null> => {
        const allFields = fieldEntriesOf(config.keywords(), config.suggestions());
        // `x IN (sel` may start a subquery, so SELECT stays offered after the values and fields.
        const startsSubquery =
          context.operator === "in" &&
          !context.chosen.length &&
          !!context.typed &&
          "select".startsWith(context.typed.toLowerCase());
        const subquery = startsSubquery
          ? config.keywords().filter((raw) => String(raw?.name ?? "").toLowerCase() === "select")
          : [];
        // A comparison operand can be an expression such as now() or CAST(…); `off` keeps today's flat list, where they would outrank values.
        const functions =
          groupsMenus(config) && (context.operator === "compare" || context.operator === "in")
            ? [...config.keywords(), ...config.suggestions()]
                .map(objectEntry)
                .filter(isValueFunction)
            : [];
        const fields = context.hasOpenQuote ? [] : [...allFields, ...subquery, ...functions];
        const named = (name: string) =>
          allFields.find((f) => (f.name ?? f.label).toLowerCase() === name.toLowerCase());
        const resolver = config.resolveFieldValues();
        const typedIsColumn =
          !context.hasOpenQuote && (isQualified(context.typed) || !!named(context.typed));
        // An empty field list means it has not loaded yet, not that the field is unknown.
        const unknownField = allFields.length > 0 && !named(context.field);
        if (!resolver || typedIsColumn || unknownField) return fields;

        const outcome = await awaitValues(config, token, (options) =>
          resolver(context.field, {
            ...options,
            prefix: context.hasOpenQuote ? context.typed : "",
          }),
        );
        if (outcome === null) return null;
        if (outcome === "nolookup") return fields;
        const shape = { highlighted, inQuote: context.hasOpenQuote };
        if (outcome === "loading") {
          return withStatus(config, "loading", context.field, position, [], shape);
        }
        if (outcome === "failed" || !outcome.length) {
          const status = outcome === "failed" ? "failed" : "empty";
          return withStatus(config, status, context.field, position, fields, shape);
        }
        // The stream can change during the lookup, so quoting follows the column type as it is now.
        const fieldType = fieldEntriesOf(config.keywords(), config.suggestions()).find(
          (f) => (f.name ?? f.label).toLowerCase() === context.field.toLowerCase(),
        )?.detail;
        const chosen = new Set(context.chosen);
        const offered = orderValues(outcome, fieldType).filter((value) => !chosen.has(value));
        // Every value is already in the IN list, so columns and functions are the only help left.
        if (!offered.length) return fields;
        const values = buildValueEntries(offered, {
          hasOpenQuote: context.hasOpenQuote,
          // Monaco auto-closes a typed quote, so the closer already sits after the caret.
          closingQuoteAhead: lineAfterCaret(model, position).startsWith("'"),
          range: caretRange(position, context.typed.length),
          fieldType,
          pattern: context.operator === "like",
        });
        return [...values, ...fields, ...capRow(context.field, outcome.length, position)];
      };

      const promqlValueEntries = async (
        model: MonacoEditor.editor.ITextModel,
        position: MonacoEditor.Position,
        token: any,
        config: EditorConfig,
        context: PromqlValueContext,
        highlighted: boolean,
      ): Promise<any[] | null> => {
        const org = store.state.selectedOrganization?.identifier;
        if (!org) return [];
        const outcome = await awaitValues(config, token, (options) =>
          resolvePromqlLabelValues(org, context.metric, context.label, options),
        );
        // Another organization's label values must never appear in this one's menu.
        if (outcome === null || store.state.selectedOrganization?.identifier !== org) return null;
        if (outcome === "nolookup") return [];
        if (outcome === "loading" || outcome === "failed" || !outcome.length) {
          const status = Array.isArray(outcome) ? "empty" : outcome;
          return withStatus(config, status, context.label, position, [], {
            highlighted,
            inQuote: context.hasOpenQuote,
          });
        }
        const values = buildPromqlValueEntries(orderValues(outcome), {
          hasOpenQuote: context.hasOpenQuote,
          closingQuoteAhead: lineAfterCaret(model, position).startsWith('"'),
          range: caretRange(position, context.typed.length),
        });
        return [...values, ...capRow(context.label, outcome.length, position)];
      };

      const operatorEntries = (
        config: EditorConfig,
        model: MonacoEditor.editor.ITextModel,
        position: MonacoEditor.Position,
        textUntilPosition: string,
        preselect: boolean,
      ): any[] | null => {
        const fields = fieldEntriesOf(config.keywords(), config.suggestions());
        const context = parseOperatorContext(
          textUntilPosition,
          fields.map((f) => f.name ?? f.label),
          config.filterMode(),
        );
        if (!context) return null;
        const field = fields.find(
          (f) => (f.name ?? f.label).toLowerCase() === context.field.toLowerCase(),
        );
        const lane = buildOperatorLane({
          context,
          fieldType: field?.detail,
          lineNumber: position.lineNumber,
          column: position.column,
          chainCommand: chainsHere(config, model, position)
            ? acceptCommand("operator", true)
            : undefined,
        });
        const inLane = new Set(lane.map((entry) => String(entry.name).toLowerCase()));
        // A partial with a space (`IS N`) can only finish an operator, so the catalog stays out of it.
        const multiWord = /\s/.test(context.partial);
        const catalog = [...config.keywords(), ...config.suggestions()].filter((raw) => {
          if (multiWord) return false;
          const entry = objectEntry(raw);
          return !entry || !inLane.has(String(entry.name ?? entry.label).toLowerCase());
        });
        if (!groupsMenus(config)) return [...lane, ...catalog];
        // Grouping rewrites sortText, which laneOf reads, so each row carries its lane through it.
        const withLane = (raw: any) => {
          const entry = objectEntry(raw);
          return entry && { ...entry, lane: laneOf(entry) };
        };
        return groupEntries(
          [
            {
              header: t("sqlEditor.completion.groupOperators"),
              name: t("sqlEditor.completion.groupOperators"),
              // Under its header a word operator such as IN or IS NULL reads as an operator, not a keyword.
              entries: lane
                .filter((entry) => !isWrapRow(entry))
                .map(withLane)
                .map((entry) =>
                  entry.kind === "Keyword" ? { ...entry, kind: "Operator" } : entry,
                ),
            },
            {
              header: t("sqlEditor.completion.groupFunctionsAndFields"),
              name: t("sqlEditor.completion.groupFunctionsAndFields"),
              entries: [
                ...lane.filter(isWrapRow).map((entry) => ({
                  ...withLane(entry),
                  description: t(WRAP_DESCRIPTIONS[String(entry.name)] ?? ""),
                })),
                ...catalog.map(withLane),
              ],
            },
          ],
          {
            typed: context.partial,
            range: caretRange(position, context.partial.length),
            preselect,
          },
        );
      };

      const isWrapRow = (entry: any) => entry?.command?.id === WRAP_FIELD_COMMAND;

      // Grouped menus lean on the full key contract, so `off` keeps today's flat menus.
      const groupsMenus = (config: EditorConfig) => language === "sql" && config.mode() !== "off";

      const groupValueMenu = (
        entries: any[],
        typed: string,
        range: any,
        preselect: boolean,
        inRange: boolean,
      ) => {
        const inValues = (raw: any) => {
          const entry = objectEntry(raw);
          return entry?.kind === "Value" || String(entry?.name ?? "").startsWith("\u0000");
        };
        const inFunctions = (raw: any) => isValueFunction(objectEntry(raw));
        return groupEntries(
          [
            {
              // Values from a caller's own range are not the recent ones.
              header: t(
                inRange
                  ? "sqlEditor.completion.groupValuesName"
                  : "sqlEditor.completion.groupValues",
              ),
              name: t("sqlEditor.completion.groupValuesName"),
              entries: entries.filter(inValues).map(objectEntry),
            },
            {
              header: t("sqlEditor.completion.groupFields"),
              name: t("sqlEditor.completion.groupFields"),
              entries: entries
                .filter((raw) => !inValues(raw) && !inFunctions(raw))
                .map(objectEntry),
            },
            {
              header: t("sqlEditor.completion.groupFunctions"),
              name: t("sqlEditor.completion.groupFunctions"),
              entries: entries.filter(inFunctions).map(objectEntry),
            },
          ],
          { typed, range, preselect },
        );
      };

      // Mid-line the typed space would double one that is already there and open a menu over existing text.
      const chainsHere = (
        config: EditorConfig,
        model: MonacoEditor.editor.ITextModel,
        position: MonacoEditor.Position,
      ) => {
        if (language !== "sql" || !chainsInMode(config.mode())) return false;
        const after = lineAfterCaret(model, position);
        return after.trim() === "" || after.startsWith(")");
      };

      const catalogEntries = (
        config: EditorConfig,
        model: MonacoEditor.editor.ITextModel,
        position: MonacoEditor.Position,
        textUntilPosition: string,
        word: string,
      ) => {
        // Inside avg( or approx_percentile_cont(, numeric columns lead; on a metrics stream every label would sort above `value`.
        const numericFirst = wantsNumericColumn(parseCallContext(textUntilPosition));
        const rank = (list: any[]) => (numericFirst ? rankNumericFieldsFirst(list) : list);
        const entries = [...rank(config.keywords()), ...rank(config.suggestions())];
        const textBeforeWord = textUntilPosition.slice(0, textUntilPosition.length - word.length);
        const canChain = chainsHere(config, model, position);
        const lead =
          language === "sql" ? parseLogicalLeadContext(textBeforeWord, config.filterMode()) : null;
        const ranked = lead
          ? buildLogicalLead(
              entries,
              logicalLeadNames(lead, config.filterMode()),
              canChain ? acceptCommand("operator", true) : undefined,
            )
          : entries;
        if (!canChain) return ranked;
        const fieldChain = isPredicatePosition(textBeforeWord, config.filterMode())
          ? acceptCommand("field", true)
          : null;
        return ranked.map((raw) => {
          const entry = objectEntry(raw);
          if (fieldChain && entry?.kind === "Field") return { ...entry, command: fieldChain };
          const name = String(entry?.name ?? "").toLowerCase();
          const keyword =
            entry?.kind === "Keyword" && !entry.command && CHAINING_KEYWORDS.has(name);
          return keyword ? chainedKeyword(entry, acceptCommand(laneOf(entry), true)) : raw;
        });
      };

      monaco.languages.registerCompletionItemProvider(language, {
        triggerCharacters: triggerCharactersFor(language),
        // A never-settling resolve for header and status rows is cancelled when focus leaves, so the next visit reports again.
        resolveCompletionItem: (item: any) => {
          noteResolvedItem(item);
          return item?.o2skip ? new Promise(() => {}) : item;
        },
        provideCompletionItems: async (
          model: MonacoEditor.editor.ITextModel,
          position: MonacoEditor.Position,
          context: any,
          token: any,
        ) => {
          const config = editorConfigs.get(modelKey(model));
          if (!config || !config.enabled()) return { suggestions: [] };

          const textUntilPosition = model.getValueInRange({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });
          // Monaco loads the SQL tokenizer lazily (sql.contribution.js), so until it lands the tokens know no comments.
          const inComment =
            isCaretInComment(model, position, textUntilPosition) ||
            (language === "sql" && literalStateAtEnd(textUntilPosition) === "comment");
          if (inComment) return { suggestions: [] };
          const offTrigger =
            language === "sql" &&
            config.mode() === "off" &&
            context?.triggerKind === 1 &&
            SQL_VALUE_TRIGGERS.includes(context.triggerCharacter);
          if (offTrigger) return { suggestions: [] };

          const chained =
            context?.triggerKind === 1 &&
            context?.triggerCharacter === " " &&
            Date.now() - config.chain.pendingSince <= CHAINED_MENU_WINDOW_MS;
          if (chained) config.chain.pendingSince = 0;

          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          const reply = (entries: any[] | null, itemRange: any = range) =>
            respond(config, context, chained, entries, word.word, itemRange);

          // Only a menu opened by a trigger character opens unhighlighted.
          const highlighted = config.mode() === "off" || context?.triggerKind !== 1;

          if (language === "sql") {
            const parsedValue = parseValueContext(textUntilPosition);
            // A literal typed across a line break has no one-line range to replace, so it gets no value menu.
            const valueContext = parsedValue?.typed.includes("\n") ? null : parsedValue;
            if (valueContext) {
              const entries = await sqlValueEntries(
                model,
                position,
                token,
                config,
                valueContext,
                highlighted,
              );
              const qualified = isQualified(valueContext.typed);
              const typedRange = qualified
                ? range
                : caretRange(position, valueContext.typed.length);
              if (!entries || !groupsMenus(config)) return reply(entries, typedRange);
              // `b.tr` names column `tr…` of table b, so only the part after the dot filters.
              const typed = qualified ? word.word : valueContext.typed;
              const inRange = !!config.valuesTimeRange();
              return reply(
                groupValueMenu(entries, typed, typedRange, highlighted, inRange),
                typedRange,
              );
            }
            if (literalStateAtEnd(textUntilPosition) === "string") return reply([]);
            const operators = operatorEntries(
              config,
              model,
              position,
              textUntilPosition,
              highlighted,
            );
            if (operators) return reply(operators);
          }

          const promqlValue =
            language === "promql" ? parsePromqlValueContext(textUntilPosition) : null;
          if (promqlValue?.typed.includes("\n")) return reply([]);
          if (promqlValue) {
            const entries = await promqlValueEntries(
              model,
              position,
              token,
              config,
              promqlValue,
              highlighted,
            );
            return reply(entries, caretRange(position, promqlValue.typed.length));
          }
          // `=` is a PromQL trigger only for label values; a comparison like `== 1` gets no menu.
          if (language === "promql" && context?.triggerCharacter === "=")
            return { suggestions: [] };

          const catalog = reply(
            catalogEntries(config, model, position, textUntilPosition, word.word),
          );
          const recents = recentCompletionItems(
            config.recents(),
            model,
            position,
            kinds().Reference,
            t("recentSearches.recentRow"),
          );
          return recents.length
            ? { ...catalog, suggestions: [...recents, ...catalog.suggestions] }
            : catalog;
        },
      });

      monaco.languages.registerSignatureHelpProvider(language, {
        signatureHelpTriggerCharacters: ["(", ","],
        signatureHelpRetriggerCharacters: [","],
        provideSignatureHelp: async (
          model: MonacoEditor.editor.ITextModel,
          position: MonacoEditor.Position,
        ) => {
          const config = editorConfigs.get(modelKey(model));
          if (!config || !config.enabled()) return null;

          const text = model.getValueInRange({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });
          const call = parseCallContext(text);
          if (!call) return null;

          // The parser reports any identifier before the paren; the catalog
          // decides whether it is a function.
          const entry = findFunctionEntry(call.name, config.keywords(), config.suggestions());
          const value = buildSignatureHelp(entry as any, call.activeParameter);
          if (!value) return null;
          // monaco reads `.value` off a SignatureHelpResult and disposes it.
          return { value, dispose: () => {} };
        },
      });

      monaco.languages.registerHoverProvider(language, {
        provideHover: async (
          model: MonacoEditor.editor.ITextModel,
          position: MonacoEditor.Position,
        ) => {
          const config = editorConfigs.get(modelKey(model));
          if (!config || !config.enabled()) return null;

          const word = model.getWordAtPosition(position);
          if (!word?.word) return null;
          const entry = findCatalogEntry(word.word, config.keywords(), config.suggestions());
          const contents = buildHoverContents(t, entry as any);
          if (!contents) return null;
          return {
            contents,
            range: {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endColumn: word.endColumn,
            },
          };
        },
      });
    };

    const resetEditorLayout = () => {
      editorObj?.layout();
    };

    const triggerAutoComplete = async (value: string) => {
      // Close any currently-open suggestion popup before retriggering.
      // Monaco's model.trigger() calls cancel() internally, but if a natural
      // popup is already in "Showing" state (e.g. opened by typing quote after
      // an operator, or from word-based suggest while typing NOT LIKE), the
      // widget may not refresh its item list. hideSuggestWidget transitions
      // state to Idle cleanly (no "user dismissed" flag) so the following
      // triggerSuggest always opens a fresh popup with the latest keywords.
      editorObj.trigger(value, "hideSuggestWidget", {});
      await nextTick();
      editorObj.trigger(value, "editor.action.triggerSuggest", {});
    };

    const disableSuggestionPopup = () => {
      // monaco's own command, which this file already uses elsewhere. The
      // synthetic Escape this replaced was a guess about monaco's internal key
      // handling that nothing verified, and it bubbled out of the editor to
      // anything else listening for Escape.
      editorObj?.trigger("disableSuggestionPopup", "hideSuggestWidget", {});
    };

    const formatDocument = async () => {
      // As Monaco editor does not support formatting in read-only mode, we need to temporarily disable it while formatting
      return new Promise((resolve) => {
        editorObj.updateOptions({ readOnly: false });
        editorObj
          .getAction("editor.action.formatDocument")
          .run()
          .then(() => {
            editorObj.updateOptions({ readOnly: props.readOnly });
            resolve(true);
          })
          .catch(() => {
            editorObj.updateOptions({ readOnly: props.readOnly });
            resolve(false);
          });
      });
    };

    const getCursorIndex = () => {
      const currentPosition = editorObj.getPosition();
      const cursorIndex = editorObj?.getModel().getOffsetAt(currentPosition) - 1;
      return cursorIndex || null;
    };

    const getModel = () => {
      return editorObj?.getModel();
    };

    const getValue = () => {
      return editorObj?.getValue();
    };

    const decorateRanges = (ranges: any[]) => {
      if (!monaco) return;
      // Highlight the ranges
      const decorations = ranges.map((range) => {
        return {
          range: new monaco.Range(range.startLine, 1, range.endLine, 1),
          options: {
            isWholeLine: true,
            className: "highlight-error", // Add this class to style the highlighted lines
            glyphMarginClassName: "error-glyph", // Optional: add a custom icon to the gutter
          },
        };
      });

      editorObj.deltaDecorations([], decorations);
    };

    function addErrorDiagnostics(ranges: any) {
      if (!monaco) return;
      // const markers = [
      //   {
      //     resource: {
      //       $mid: 1,
      //       external: "inmemory://model/4",
      //       path: "/4",
      //       scheme: "inmemory",
      //       authority: "model",
      //     },
      //     owner: "owner",
      //     code: "MY_ERROR_CODE",
      //     severity: monaco.MarkerSeverity.Error,
      //     message: "Error: Something went wrong",
      //     startLineNumber: 2,
      //     startColumn: 1,
      //     endLineNumber: 7,
      //     endColumn: 1,
      //   },
      //   {
      //     resource: {
      //       $mid: 1,
      //       external: "inmemory://model/4",
      //       path: "/4",
      //       scheme: "inmemory",
      //       authority: "model",
      //     },
      //     owner: "owner",
      //     code: "MY_ERROR_CODE",
      //     severity: monaco.MarkerSeverity.Error,
      //     message: "Error: Something went wrong",
      //     startLineNumber: 8,
      //     startColumn: 1,
      //     endLineNumber: 13,
      //     endColumn: 1,
      //   },
      // ];

      // Set markers to the model
      // monaco.editor.setModelMarkers(getModel(), "owner", markers);
      const model = getModel();
      const markers = ranges.map((range: any) => {
        const startLine = range.startLine;
        const endLine = range.endLine;
        const startCol = range.column ?? 1;
        // Prefer an explicit end column (wraps a single token — e.g. an unknown
        // field name). Otherwise highlight to end-of-line so a syntax-error
        // squiggle near the cursor stays visible.
        const lineContent = model?.getLineContent?.(endLine) ?? "";
        const endCol = range.endColumn ?? (lineContent.length + 1 || startCol + 1);
        return {
          severity: monaco.MarkerSeverity.Error,
          startLineNumber: startLine,
          startColumn: startCol,
          endLineNumber: endLine,
          endColumn: endCol,
          message: range.error,
          code: "",
        };
      });

      monaco.editor.setModelMarkers(getModel(), "owner", []);
      monaco.editor.setModelMarkers(getModel(), "owner", markers);
    }

    // Scan the current SQL query for double-quoted string values and mark them
    // with a warning squiggle + hover tooltip. Double quotes are only valid for
    // identifiers (table/column names) in SQL; string literals must use single
    // quotes. Operates independently of addErrorDiagnostics ("owner" markers) so
    // server-side error markers and these client-side warnings never interfere.
    const validateDoubleQuotes = () => {
      if (!editorObj || !monaco || props.language !== "sql") return;
      const model = editorObj.getModel();
      if (!model) return;

      // Deciding WHAT is wrong lives in utils/query/doubleQuoteWarnings.ts,
      // where it is comment- and string-aware and can be tested without an
      // editor. What is left here is the monaco half: offsets to positions,
      // positions to markers.
      const text = model.getValue();
      const markers = findDoubleQuoteIssues(t, text).map((issue) => {
        const startPos = model.getPositionAt(issue.startOffset);
        const endPos = model.getPositionAt(issue.endOffset);
        return {
          severity: monaco.MarkerSeverity.Warning,
          startLineNumber: startPos.lineNumber,
          startColumn: startPos.column,
          endLineNumber: endPos.lineNumber,
          endColumn: endPos.column,
          message: issue.message,
        };
      });

      monaco.editor.setModelMarkers(model, "dq-validation", markers);
    };

    // Watch isGenerating and emit events to parent
    watch(isGenerating, (newValue) => {
      if (newValue) {
        emit("generation-start");
      } else {
        emit("generation-end");
      }
    });

    // Computed property for AI icon based on theme
    const aiIcon = computed(() => {
      return isDark.value
        ? getImageURL("images/common/ai_icon_dark.svg")
        : getImageURL("images/common/ai_icon_gradient.svg");
    });

    // Toggle NLP mode
    const toggleNlpMode = () => {
      emit("toggle-nlp-mode");
    };

    return {
      editorRef,
      // `editorObj` is reassigned by a plain closure variable (monaco.editor.create
      // runs after mount), so exposing it directly here would freeze callers to
      // whatever it was at setup() return time (null, since the editor hasn't
      // mounted yet). Expose a getter instead so external callers (see
      // ContentTemplateForm.vue's toolbar actions) always read the live instance.
      get editorObj() {
        return editorObj;
      },
      setValue,
      replaceValue,
      resetEditorLayout,
      disableSuggestionPopup,
      triggerAutoComplete,
      getCursorIndex,
      searchObj,
      formatDocument,
      getModel,
      getValue,
      decorateRanges,
      addErrorDiagnostics,
      isGenerating,
      handleGenerateSQL,
      streamingResponse,
      // Read by the AI bar after a generation: set when the server refused it.
      refusalNotice,
      t,
      aiIcon,
      toggleNlpMode,
      suggestAnnouncement,
      queryEditorClass: QUERY_EDITOR_CLASS,
    };
  },
});
</script>

<style scoped>
/* keep(lib-override:monaco) — every rule below targets Monaco's own generated DOM
   (.monaco-editor, .suggest-widget, and decoration classes injected via the
   decorations API). These nodes are created by the library at runtime and never
   carry the scoped data-v attribute, so they are unreachable from utilities and
   must stay as :deep() CSS. */

.logs-query-editor :deep(.monaco-editor),
.logs-query-editor :deep(.monaco-editor .monaco-editor) {
  padding: 0 !important;
  --vscode-focusBorder: transparent !important;
}

/* Neutralise monaco's stray focus outline / focus-border on the mount, the real
   inner editor, the overflow guard and the hidden focus textarea. The last three
   are monaco-generated DOM. */
.logs-query-editor,
.logs-query-editor :deep(.monaco-editor),
.logs-query-editor :deep(.overflow-guard),
.logs-query-editor :deep(.inputarea) {
  outline: none !important;
  --vscode-focusBorder: transparent !important;
}

.logs-query-editor :deep(.monaco-editor .editor-widget .suggest-widget),
.logs-query-editor :deep(.monaco-editor .monaco-editor .editor-widget .suggest-widget) {
  z-index: 9999;
  display: flex !important;
  visibility: visible !important;
}

/* Monaco sizes the suggest documentation panel with
   `layout(width, type.clientHeight + docs.clientHeight)` and assigns that height
   to THIS element (suggestWidgetDetails.js:161) — arithmetic that assumes
   content-box. The app's global reset makes everything border-box, so the
   panel's own hairline top and bottom borders eat two pixels of the content it
   just measured, and the documentation scrolls by that sliver every time.
   Restoring content-box for this one node is less fragile than trying to
   out-compute the library. */
.logs-query-editor :deep(.suggest-details) {
  box-sizing: content-box;
}

/* Error decoration — class name is handed to monaco.deltaDecorations(), so the
   element only ever exists inside Monaco's view-lines. */
.logs-query-editor :deep(.highlight-error) {
  background-color: color-mix(in srgb, var(--color-status-negative) 10%, transparent);
  text-decoration: underline;
  text-decoration-color: var(--color-status-negative);
}

/* Only query editors' suggest widgets take the app's menu style (Monaco internals: .details-label, .signature-label, .qualifier-label, .monaco-icon-label, .frozen). */
.logs-query-editor.o2-query-editor :deep(.suggest-widget) {
  border-radius: var(--radius-default);
  box-shadow: var(--shadow-lg);
  font-family: var(--font-sans);
  overflow: hidden;
}
.logs-query-editor.o2-query-editor :deep(.suggest-widget .monaco-list .monaco-list-row) {
  padding-inline-start: 0.5rem;
}
.logs-query-editor.o2-query-editor :deep(.suggest-widget .monaco-list .monaco-list-row.focused) {
  background-image: linear-gradient(var(--color-accent), var(--color-accent));
  background-size: 0.125rem 100%;
  background-position: 0 0;
  background-repeat: no-repeat;
}
.logs-query-editor.o2-query-editor
  :deep(.suggest-widget:not(.frozen) .monaco-highlighted-label .highlight) {
  font-weight: var(--font-medium);
}
.logs-query-editor.o2-query-editor
  :deep(
    .suggest-widget .monaco-list .monaco-list-row > .contents > .main > .right > .details-label
  ) {
  opacity: 1;
  color: var(--color-text-secondary);
  font-family: var(--font-sans);
  font-size: var(--text-2xs);
}
.logs-query-editor.o2-query-editor
  :deep(
    .suggest-widget
      .monaco-list
      .monaco-list-row.focused
      > .contents
      > .main
      > .right
      > .details-label
  ) {
  color: var(--color-text-body);
}
.logs-query-editor.o2-query-editor
  :deep(
    .suggest-widget .monaco-list .monaco-list-row > .contents > .main > .left > .signature-label
  ) {
  opacity: 1;
  color: var(--color-text-secondary);
}

/* Tailwind's .contents utility (display: contents) collides with Monaco's row wrapper of the same name. */
.logs-query-editor.o2-query-editor
  :deep(.suggest-widget .monaco-list .monaco-list-row > .contents) {
  display: block;
}
.logs-query-editor.o2-query-editor
  :deep(.suggest-widget .monaco-list .monaco-list-row > .contents > .main > .left) {
  flex: 1 1 auto;
  min-width: 0;
}

/* Status rows insert nothing, so they never take a click or a highlight (Monaco internals: codicon-symbol-* classes, glyphs \eb19 / \ea74, codicon-spin). */
.logs-query-editor.o2-query-editor
  :deep(.suggest-widget .monaco-list-row:is(:has(.codicon-symbol-event), :has(.codicon-issues))) {
  pointer-events: none;
}
.logs-query-editor.o2-query-editor
  :deep(
    .suggest-widget .monaco-list-row.focused:is(:has(.codicon-symbol-event), :has(.codicon-issues))
  ) {
  background-color: transparent;
  background-image: none;
}
.logs-query-editor.o2-query-editor
  :deep(
    .suggest-widget
      .monaco-list-row:is(:has(.codicon-symbol-event), :has(.codicon-issues))
      .monaco-icon-label
  ) {
  font-family: var(--font-sans);
  color: var(--color-text-secondary) !important;
}
.logs-query-editor.o2-query-editor
  :deep(.suggest-widget .monaco-list-row .suggest-icon.codicon-symbol-event::before) {
  content: "\eb19";
}
.logs-query-editor.o2-query-editor
  :deep(.suggest-widget .monaco-list-row .suggest-icon.codicon-symbol-event) {
  color: var(--color-text-secondary) !important;
  animation: codicon-spin 1.5s steps(30) infinite;
}
.logs-query-editor.o2-query-editor
  :deep(.suggest-widget .monaco-list-row .suggest-icon.codicon-issues::before) {
  content: "\ea74";
}
.logs-query-editor.o2-query-editor
  :deep(.suggest-widget .monaco-list-row .suggest-icon.codicon-issues) {
  color: var(--color-text-secondary) !important;
}

/* Group headers are Folder rows (a kind nothing else uses); clicks pass through and the editor swallows them. */
.logs-query-editor.o2-query-editor
  :deep(.suggest-widget .monaco-list .monaco-list-row:has(.codicon-symbol-folder)) {
  pointer-events: none;
  cursor: default;
  background: transparent !important;
}
.logs-query-editor.o2-query-editor
  :deep(.suggest-widget .monaco-list .monaco-list-row:has(.codicon-symbol-folder) .suggest-icon) {
  display: none;
}
.logs-query-editor.o2-query-editor
  :deep(
    .suggest-widget .monaco-list .monaco-list-row:has(.codicon-symbol-folder) .monaco-icon-label
  ) {
  font-family: var(--font-sans) !important;
  font-size: var(--text-2xs);
  font-weight: var(--font-medium);
  color: var(--color-text-secondary) !important;
}
.logs-query-editor.o2-query-editor
  :deep(
    .suggest-widget
      .monaco-list
      .monaco-list-row:has(.codicon-symbol-folder)
      :is(.qualifier-label, .details-label, .signature-label)
  ) {
  display: none !important;
}
.logs-query-editor.o2-query-editor
  :deep(.suggest-widget .monaco-list .monaco-list-row:has(.codicon-symbol-folder) .highlight) {
  color: inherit !important;
  font-weight: inherit !important;
}
.logs-query-editor.o2-query-editor
  :deep(
    .suggest-widget .monaco-list .monaco-list-row:has(.codicon-symbol-folder):not([data-index="0"])
  ) {
  border-top: 0.0625rem solid var(--color-border-subtle);
}
/* In a grouped menu a value or operator row's description is the group name, for screen readers only. */
.logs-query-editor.o2-query-editor
  :deep(
    .suggest-widget:has(.codicon-symbol-folder)
      .monaco-list-row:is(:has(.codicon-symbol-value), :has(.codicon-symbol-operator))
      .details-label
  ) {
  visibility: hidden;
}

/* A one-row menu is sized to its content and a lone status row gets room for its hint (Monaco internals: data-index, data-last-element). */
.logs-query-editor.o2-query-editor
  :deep(.suggest-widget:has(.monaco-list-row[data-index="0"][data-last-element="true"])) {
  width: 16.25rem !important;
}
.logs-query-editor.o2-query-editor
  :deep(
    .suggest-widget:is(
      :has(.monaco-list-row[data-index="0"][data-last-element="true"] .codicon-symbol-event),
      :has(.monaco-list-row[data-index="0"][data-last-element="true"] .codicon-issues)
    )
  ) {
  width: 37.5rem !important;
}

.logs-query-editor :deep(.o2-suggest-inline-hint) {
  color: var(--color-text-secondary) !important;
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-style: italic;
  padding-inline-start: 0.75rem;
}

.logs-query-editor :deep(.o2-free-text-term) {
  background-color: var(--color-surface-accent-hover);
  border-bottom: 0.0625rem dashed var(--color-accent);
}

/* PromQL brackets render plain (like Prometheus). The rainbow colours are
   theme-global and the disable option doesn't strip these classes — repaint. */
.logs-query-editor.promql-mode :deep(.bracket-highlighting-0),
.logs-query-editor.promql-mode :deep(.bracket-highlighting-1),
.logs-query-editor.promql-mode :deep(.bracket-highlighting-2),
.logs-query-editor.promql-mode :deep(.bracket-highlighting-3),
.logs-query-editor.promql-mode :deep(.bracket-highlighting-4),
.logs-query-editor.promql-mode :deep(.bracket-highlighting-5),
.logs-query-editor.promql-mode :deep(.bracket-highlighting-6) {
  color: var(--vscode-editor-foreground, var(--color-text-body)) !important;
}
</style>
