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
  <OPopover
    v-if="state !== 'hidden'"
    :open="gateOpen"
    side="bottom"
    align="start"
    :aria-label="
      gate === 'off_for_org'
        ? t('assistant.gate.offForOrg.title', { product })
        : t('assistant.gate.noPermission.title', { product })
    "
    @update:open="onGateOpen"
  >
    <template #anchor>
      <ODropdownItem
        v-if="appearance === 'menu-item'"
        :data-test="dataTest"
        :data-door-state="viewState"
        :aria-disabled="locked || unavailable || undefined"
        :aria-label="locked || added ? name : undefined"
        :description="touch ? raw(tooltipLines.join(' ')) : undefined"
        class="max-md:min-h-11 pointer-coarse:min-h-11"
        @select="onSelect"
      >
        <template #icon-left>
          <OIcon :name="glyph" size="sm" :class="glyphClass" />
          <OIcon
            v-if="locked"
            :name="assistantGlyph.locked"
            size="xs"
            class="text-text-secondary"
          />
        </template>
        <span ref="menuLabel">{{ visibleLabel }}</span>
        <OTooltip v-if="!touch" side="right">
          <template #content
            ><span v-for="line in tooltipLines" :key="line" class="block">{{
              line
            }}</span></template
          >
        </OTooltip>
      </ODropdownItem>
      <AssistantIconButton
        v-else-if="appearance === 'toolbar-icon'"
        ref="control"
        :label="name"
        :icon="glyph"
        :badge="locked ? assistantGlyph.locked : undefined"
        :no-tooltip="touch"
        :size="size === 'md' ? 'toolbar' : 'sm'"
        :data-test="dataTest"
        :data-door-state="viewState"
        :aria-disabled="locked || unavailable || undefined"
        :class="locked ? 'text-text-secondary!' : 'text-ai-accent!'"
        @click="onClick"
      >
        <template #tooltip
          ><span v-for="line in tooltipLines" :key="line" class="block">{{ line }}</span></template
        >
      </AssistantIconButton>
      <OButton
        v-else
        ref="control"
        :variant="appearance === 'toggle' ? 'outline' : 'ghost'"
        :size="size"
        :data-test="dataTest"
        :data-door-state="viewState"
        :aria-disabled="locked || unavailable || undefined"
        :aria-pressed="appearance === 'toggle' ? !!pressed : undefined"
        :aria-label="locked || added ? name : undefined"
        :class="[
          'focus-visible:ring-ai-accent/40 focus-visible:ring-2 max-md:min-h-11 pointer-coarse:min-h-11',
          appearance === 'chip' ? 'max-md:h-auto max-md:py-1 max-md:whitespace-normal' : '',
          appearance === 'toggle' && pressed ? 'border-border-strong' : '',
        ]"
        @click="onClick"
      >
        <template #icon-left>
          <OIcon :name="glyph" size="sm" :class="glyphClass" />
          <OIcon
            v-if="locked"
            :name="assistantGlyph.locked"
            size="xs"
            class="text-text-secondary"
          />
        </template>
        <span class="flex min-w-0 flex-col items-start text-start">
          <span :class="appearance === 'toggle' ? 'max-md:sr-only' : ''">{{ visibleLabel }}</span>
          <span
            v-if="appearance === 'chip'"
            class="text-text-secondary hidden text-xs font-normal max-md:block"
            data-test="ai-entry-secondary"
            >{{ tooltipLines.join(" ") }}</span
          >
        </span>
        <OTooltip v-if="!touch" :shortcut-id="shortcutId">
          <template #content
            ><span v-for="line in tooltipLines" :key="line" class="block">{{
              line
            }}</span></template
          >
        </OTooltip>
      </OButton>
    </template>
    <AssistantGateState
      v-if="gateOpen"
      :reason="gate === 'off_for_org' ? 'off_for_org' : 'no_permission'"
      size="popover"
      :is-admin="capability.isAdmin"
      :context="{ org: org }"
      focus-on-mount
      @action="onGateAction"
    />
  </OPopover>
  <OTooltip
    v-if="errorAnchor"
    :anchor="errorAnchor"
    :open="!!errorAnchor"
    :content="t('assistant.entry.buildFailed')"
  />
</template>

<script lang="ts">
import { shallowReactive } from "vue";

import type {
  DockHostId,
  EntryKind,
  EntryVerb,
  ObjectKind,
  OpenAssistantArgs,
  OpenAssistantResult,
} from "@/composables/assistant";
import type { I18nText } from "@/types/i18n";

export interface AiEntryButtonProps {
  verb: EntryVerb;
  entryKind: EntryKind;
  objectKind: ObjectKind;
  /** Lazy, so a row pays nothing until its door is used. */
  build: () => OpenAssistantArgs["payload"] | Promise<OpenAssistantArgs["payload"]>;
  thread?: "new" | "current";
  appearance?: "button" | "menu-item" | "chip" | "toolbar-icon" | "toggle";
  label?: I18nText;
  /** States what is sent and whether it sends. */
  tooltip: I18nText;
  count?: number;
  added?: boolean;
  pressed?: boolean;
  dockHost?: DockHostId;
  size?: "sm" | "md";
  dataTest: `ai-entry-${string}-${string}`;
  /** Keeps the door focusable but inert with this reason as its tooltip (the multi-select cap). */
  disabledReason?: I18nText;
  /** The object behind an Add door (row id, field, panel id): the "In chat" tick follows it, never an earlier object. */
  objectKey?: string;
  /** The org the host loaded this object under; a door left on screen after an org switch is then refused. */
  boundOrg?: string;
  /** A door that navigates first: activation runs this instead, and the destination opens the assistant. */
  handoff?: () => void | Promise<void>;
  /** Registry id whose keycaps the tooltip shows beside its text. */
  shortcutId?: string;
}

export interface AiEntryButtonEmits {
  (e: "opened", result: OpenAssistantResult): void;
  /** A pressed toggle was activated again: the host closes its dock. */
  (e: "closed"): void;
}

/** One door of the app: its test id and the telemetry envelope it reports. */
export interface DoorRegistration {
  dataTest: `ai-entry-${string}-${string}`;
  entryKind: EntryKind;
  entryVerb: EntryVerb;
  objectKind: ObjectKind;
}

/** Every door this app ships; a spec pins each `data-test` here to the pattern and to its use in `src`. */
export const AI_ENTRY_DOORS: readonly DoorRegistration[] = [
  {
    dataTest: "ai-entry-log-row-explain",
    entryKind: "object_verb",
    entryVerb: "explain",
    objectKind: "log_row",
  },
  {
    dataTest: "ai-entry-log-row-add",
    entryKind: "object_verb",
    entryVerb: "add_to_chat",
    objectKind: "log_row",
  },
  {
    dataTest: "ai-entry-log-rows-explain",
    entryKind: "object_verb",
    entryVerb: "explain",
    objectKind: "log_row",
  },
  {
    dataTest: "ai-entry-log-field-explain",
    entryKind: "object_verb",
    entryVerb: "explain",
    objectKind: "log_field",
  },
  {
    dataTest: "ai-entry-log-field-add",
    entryKind: "object_verb",
    entryVerb: "add_to_chat",
    objectKind: "log_field",
  },
  {
    dataTest: "ai-entry-log-record-explain",
    entryKind: "object_verb",
    entryVerb: "explain",
    objectKind: "log_row",
  },
  {
    dataTest: "ai-entry-log-record-add",
    entryKind: "object_verb",
    entryVerb: "add_to_chat",
    objectKind: "log_row",
  },
  {
    dataTest: "ai-entry-correlated-row-explain",
    entryKind: "object_verb",
    entryVerb: "explain",
    objectKind: "log_row",
  },
  {
    dataTest: "ai-entry-function-test-add",
    entryKind: "object_verb",
    entryVerb: "add_to_chat",
    objectKind: "log_row",
  },
  {
    dataTest: "ai-entry-pipeline-preview-add",
    entryKind: "object_verb",
    entryVerb: "add_to_chat",
    objectKind: "log_row",
  },
  {
    dataTest: "ai-entry-no-stream-troubleshoot",
    entryKind: "empty_state",
    entryVerb: "troubleshoot",
    objectKind: "empty_result",
  },
  {
    dataTest: "ai-entry-empty-result-troubleshoot",
    entryKind: "empty_state",
    entryVerb: "troubleshoot",
    objectKind: "empty_result",
  },
  {
    dataTest: "ai-entry-query-error-troubleshoot",
    entryKind: "empty_state",
    entryVerb: "troubleshoot",
    objectKind: "query_error",
  },
  {
    dataTest: "ai-entry-trace-explain",
    entryKind: "object_verb",
    entryVerb: "explain",
    objectKind: "trace",
  },
  {
    dataTest: "ai-entry-trace-add",
    entryKind: "object_verb",
    entryVerb: "add_to_chat",
    objectKind: "trace",
  },
  {
    dataTest: "ai-entry-span-explain",
    entryKind: "object_verb",
    entryVerb: "explain",
    objectKind: "span",
  },
  {
    dataTest: "ai-entry-span-troubleshoot",
    entryKind: "object_verb",
    entryVerb: "troubleshoot",
    objectKind: "span",
  },
  {
    dataTest: "ai-entry-span-add",
    entryKind: "object_verb",
    entryVerb: "add_to_chat",
    objectKind: "span",
  },
  {
    dataTest: "ai-entry-trace-no-stream-troubleshoot",
    entryKind: "empty_state",
    entryVerb: "troubleshoot",
    objectKind: "empty_result",
  },
  {
    dataTest: "ai-entry-panel-explain",
    entryKind: "object_verb",
    entryVerb: "explain",
    objectKind: "panel",
  },
  {
    dataTest: "ai-entry-panel-add",
    entryKind: "object_verb",
    entryVerb: "add_to_chat",
    objectKind: "panel",
  },
  {
    dataTest: "ai-entry-panel-cell-explain",
    entryKind: "object_verb",
    entryVerb: "explain",
    objectKind: "log_field",
  },
  {
    dataTest: "ai-entry-panel-cell-add",
    entryKind: "object_verb",
    entryVerb: "add_to_chat",
    objectKind: "log_field",
  },
  {
    dataTest: "ai-entry-alert-explain",
    entryKind: "object_verb",
    entryVerb: "explain",
    objectKind: "alert",
  },
  {
    dataTest: "ai-entry-alert-troubleshoot",
    entryKind: "object_verb",
    entryVerb: "troubleshoot",
    objectKind: "alert",
  },
  {
    dataTest: "ai-entry-alert-firing-troubleshoot",
    entryKind: "object_verb",
    entryVerb: "troubleshoot",
    objectKind: "alert_firing",
  },
  {
    dataTest: "ai-entry-alert-firing-add",
    entryKind: "object_verb",
    entryVerb: "add_to_chat",
    objectKind: "alert_firing",
  },
  {
    dataTest: "ai-entry-metric-series-explain",
    entryKind: "object_verb",
    entryVerb: "explain",
    objectKind: "metric_series",
  },
  {
    dataTest: "ai-entry-metric-series-add",
    entryKind: "object_verb",
    entryVerb: "add_to_chat",
    objectKind: "metric_series",
  },
  {
    dataTest: "ai-entry-service-edge-explain",
    entryKind: "object_verb",
    entryVerb: "explain",
    objectKind: "service_edge",
  },
  {
    dataTest: "ai-entry-ingestion-troubleshoot",
    entryKind: "empty_state",
    entryVerb: "troubleshoot",
    objectKind: "ingestion",
  },
  {
    dataTest: "ai-entry-dbm-finding-fix",
    entryKind: "object_verb",
    entryVerb: "fix",
    objectKind: "dbm_finding",
  },
  {
    dataTest: "ai-entry-alert-query-ask",
    entryKind: "editor_toggle",
    entryVerb: "ask",
    objectKind: "alert",
  },
  {
    dataTest: "ai-entry-json-editor-ask",
    entryKind: "editor_toggle",
    entryVerb: "ask",
    objectKind: "pipeline_node",
  },
  {
    dataTest: "ai-entry-function-ask",
    entryKind: "editor_toggle",
    entryVerb: "ask",
    objectKind: "function",
  },
  {
    dataTest: "ai-entry-scheduled-query-ask",
    entryKind: "editor_toggle",
    entryVerb: "ask",
    objectKind: "pipeline_node",
  },
  {
    dataTest: "ai-entry-regex-ask",
    entryKind: "editor_toggle",
    entryVerb: "ask",
    objectKind: "regex",
  },
  {
    dataTest: "ai-entry-regex-field-ask",
    entryKind: "object_verb",
    entryVerb: "ask",
    objectKind: "log_field",
  },
  {
    dataTest: "ai-entry-query-generate",
    entryKind: "editor_button",
    entryVerb: "generate_query",
    objectKind: "query",
  },
  {
    dataTest: "ai-entry-autoobserve-ask-ask",
    entryKind: "autoobserve_card",
    entryVerb: "ask",
    objectKind: "none",
  },
];

/** An empty-state door appends to the chat it opened from this route within this window. */
export const EMPTY_STATE_THREAD_MS = 10 * 60_000;

/** The build-failure tooltip stays this long. */
export const BUILD_ERROR_MS = 4_000;

const SEND_VERBS: ReadonlySet<EntryVerb> = new Set(["explain", "troubleshoot", "fix"]);

// Doors never hide on health: the next send tells the truth.
const READY_GATES: ReadonlySet<string> = new Set(["available", "unhealthy"]);

const LOCKED_GATES: ReadonlySet<string> = new Set(["no_permission", "off_for_org"]);

// Route name → the chat an empty-state door last opened there; module scope so a remount keeps it.
const emptyStateThreads = new Map<string, { sid: string; at: number }>();

// Door + object → the chips its Add staged, so a remounted door ticks without building again.
const stagedByKey = shallowReactive(new Map<string, ContextChip[]>());

// Org → the user+org key the runtime reported for it, so a door bound to an earlier org sends that org's key.
const keyByOrg = new Map<string, string>();

// Kinds that count against the 20-row cap, as the store counts them.
const ROW_CHIP_KINDS: ReadonlySet<string> = new Set(["log_row", "cell", "span"]);
</script>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { announceComposer, noteCap } from "@/components/ai-assistant/composer/composerUi";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import AssistantGateState, {
  type GateCta,
} from "@/components/ai-assistant/gate/AssistantGateState.vue";
import {
  MAX_ATTACHED_BYTES,
  MAX_ATTACHED_ROWS,
  isRunning,
  openAssistant,
  truncateChip,
  useAssistantCapability,
  useAssistantName,
  useAssistantPlacement,
  useAssistantStore,
  type ContextChip,
  type OpenAssistantCall,
} from "@/composables/assistant";
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import { OTableToolbarOwnerKey } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw, useI18nTyped } from "@/types/i18n";
import { uiIntlLocale } from "@/utils/formatters";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<AiEntryButtonProps>(), {
  thread: undefined,
  appearance: "button",
  label: undefined,
  count: undefined,
  added: undefined,
  pressed: false,
  dockHost: undefined,
  size: "sm",
  disabledReason: undefined,
  objectKey: undefined,
  handoff: undefined,
  shortcutId: undefined,
});

const emit = defineEmits<AiEntryButtonEmits>();

const { t } = useI18nTyped();
const { product } = useAssistantName();
const capability = useAssistantCapability();
const store = useAssistantStore();
const placement = useAssistantPlacement(store);
const route = useRoute();
const vuex = useStore();
const { mdUp } = useBreakpoint();
// Inside a table cell's toolbar the cell is the invoker: the toolbar unmounts once focus leaves it.
const toolbarOwner = inject(OTableToolbarOwnerKey, null);

const control = ref<{ $el?: Element } | null>(null);
const menuLabel = ref<HTMLElement | null>(null);
const gateOpen = ref(false);
const errorAnchor = shallowRef<HTMLElement | null>(null);
const localChips = shallowRef<ContextChip[]>([]);
const coarse = ref(matchesCoarse());
// The user and org this door's data was loaded under; a stale page's payload is then refused.
const boundKey = ref<string | null>(store.state.userOrgKey);
let errorTimer: ReturnType<typeof setTimeout> | null = null;
let busy = false;

const objectId = computed(() => (props.objectKey ? `${props.dataTest}|${props.objectKey}` : null));
const built = computed(
  () => (objectId.value ? stagedByKey.get(objectId.value) : undefined) ?? localChips.value,
);

const gate = computed(() => capability.gate.value);
const state = computed<"hidden" | "locked" | "ready">(() => {
  if (READY_GATES.has(gate.value)) return "ready";
  return LOCKED_GATES.has(gate.value) ? "locked" : "hidden";
});
const locked = computed(() => state.value === "locked");
const unavailable = computed(() => state.value === "ready" && !!props.disabledReason);
const sends = computed(() => SEND_VERBS.has(props.verb));
const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const touch = computed(() => coarse.value || !mdUp.value);

// The session an Add to chat or a degraded send lands in: the one the open container shows.
const target = computed(() => {
  const sid = store.state.shell.activeSid;
  const session = sid ? store.state.sessions[sid] : undefined;
  return session && session.userOrgKey === store.state.userOrgKey ? session : null;
});
const visibleTarget = computed(() => (placement.isVisible.value ? target.value : null));
const queued = computed(
  () => sends.value && !!visibleTarget.value && isRunning(visibleTarget.value.turn),
);
const drafted = computed(
  () => sends.value && !queued.value && !!visibleTarget.value?.composer.text.trim(),
);

const added = computed(() => {
  if (props.added !== undefined) return props.added;
  if (props.verb !== "add_to_chat" || built.value.length === 0) return false;
  const chips = target.value?.composer.chips ?? [];
  return built.value.every((chip) => chips.some((staged) => sameChip(staged, chip)));
});

const viewState = computed(() => {
  if (locked.value) return "locked";
  if (unavailable.value) return "unavailable";
  return added.value ? "added" : "ready";
});

const visibleLabel = computed(() => {
  if (added.value) return t("assistant.entry.inChat");
  if (props.label) return props.label;
  if (props.count !== undefined)
    return t("assistant.entry.explainRows", { count: props.count }, props.count);
  return verbLabel();
});

const name = computed(() =>
  locked.value
    ? t("assistant.entry.lockedName", { label: visibleLabel.value })
    : visibleLabel.value,
);

const glyph = computed<IconName>(() => {
  if (added.value) return assistantGlyph.done;
  if (props.verb === "troubleshoot" || props.verb === "fix") return assistantGlyph.troubleshoot;
  if (props.verb === "explain") return assistantGlyph.explain;
  if (props.verb === "add_to_chat") return assistantGlyph.addToChat;
  return props.verb === "generate_query" ? assistantGlyph.helper : assistantGlyph.assistant;
});

const glyphClass = computed(() => (locked.value ? "text-text-secondary" : "text-ai-accent"));

const tooltipLines = computed(() => {
  if (locked.value)
    return [
      gate.value === "off_for_org"
        ? t("assistant.gate.offForOrg.title", { product })
        : t("assistant.gate.noPermission.tooltip"),
    ];
  if (added.value) return [t("assistant.entry.inChatRemove")];
  if (props.disabledReason) return [props.disabledReason];
  const lines = [props.tooltip];
  if (queued.value) lines.push(t("assistant.entry.queuedWhileRunning"));
  else if (drafted.value) lines.push(t("assistant.entry.addedToDraft"));
  const mode = capability.value.creditMode;
  if (sends.value && (mode === "consent_required" || mode === "pay_as_you_go"))
    lines.push(t("assistant.entry.cost", { count: 1 }, 1));
  if (sends.value && !uiIntlLocale().startsWith("en"))
    lines.push(t("assistant.entry.englishPromptNote"));
  return lines;
});

watch(
  () => store.state.userOrgKey,
  (key) => {
    if (!boundKey.value && key) boundKey.value = key;
  },
);
watch(
  [() => store.state.userOrgKey, org],
  ([key, current]) => {
    if (key && current) keyByOrg.set(current, key);
  },
  { immediate: true },
);

watch(objectId, () => (localChips.value = []));

onBeforeUnmount(() => {
  if (errorTimer) clearTimeout(errorTimer);
});

function verbLabel(): I18nText {
  if (props.verb === "explain") return t("assistant.entry.explain");
  if (props.verb === "troubleshoot") return t("assistant.entry.troubleshoot");
  if (props.verb === "add_to_chat") return t("assistant.entry.addToChat");
  if (props.verb === "fix") return t("assistant.entry.fix");
  return t("assistant.entry.ask", { product });
}

function controlEl(): HTMLElement | null {
  const el = props.appearance === "menu-item" ? menuLabel.value : control.value?.$el;
  return el instanceof HTMLElement ? el : null;
}

function onSelect(event: Event): void {
  // A locked item keeps the menu open so its popover has an anchor.
  if (locked.value || unavailable.value || (props.verb === "add_to_chat" && added.value))
    event.preventDefault();
  void activate();
}

function onClick(event: MouseEvent): void {
  event.stopPropagation();
  if (props.appearance === "toggle" && props.pressed && !locked.value) return emit("closed");
  void activate();
}

async function activate(): Promise<void> {
  if (locked.value) return openGate();
  // A second activation while the first is in flight would stage the same prompt again.
  if (unavailable.value || busy) return;
  // A second Add to chat never removes; the tick is already the answer.
  if (props.verb === "add_to_chat" && added.value) return;
  busy = true;
  try {
    await (props.handoff ? runHandoff(props.handoff) : run());
  } finally {
    busy = false;
  }
}

// A stale door is refused like any other before it navigates; openAssistant says why.
async function runHandoff(handoff: () => void | Promise<void>): Promise<void> {
  const key = callerKey();
  if (key && key !== store.state.userOrgKey) {
    emit("opened", await openAssistant(callFor(undefined, controlEl())));
    return;
  }
  await handoff();
}

async function run(): Promise<void> {
  const payload = await safeBuild();
  if (payload === null) return failBuild();
  // A send that falls back to staging lands in the open chat too, so it is held to the same cap as Add.
  const intoOpenChat = props.verb === "add_to_chat" || (sends.value && threadFor() === "current");
  if (intoOpenChat && wouldOverflow(payload?.chips ?? [])) return refuseCap();
  if (props.verb === "add_to_chat") remember(payload?.chips ?? []);
  const invoker = toolbarOwner?.() ?? controlEl();
  const result = await openAssistant(callFor(payload, invoker));
  if (result.ok) rememberEmptyState(result.sid);
  emit("opened", result);
  if (!result.ok || result.sent || result.staged === 0) return;
  if (!placement.isVisible.value) return toastAdded();
  const total = store.state.sessions[result.sid]?.composer.chips.length ?? result.staged;
  announceComposer(result.sid, t("assistant.entry.addedAnnounce", { count: total }, total));
}

function remember(chips: ContextChip[]): void {
  if (objectId.value) stagedByKey.set(objectId.value, chips);
  else localChips.value = chips;
}

function callFor(
  built: OpenAssistantArgs["payload"],
  invoker: HTMLElement | null,
): OpenAssistantCall {
  const payload = props.verb === "add_to_chat" ? addOnly(built) : built;
  const base = {
    entryKind: props.entryKind,
    objectKind: props.objectKind,
    payload,
    thread: threadFor(),
    invoker,
    ...(props.dockHost && { dockHost: props.dockHost }),
    ...(callerKey() !== undefined && { userOrgKey: callerKey() as string }),
  };
  if (props.verb === "explain" || props.verb === "troubleshoot" || props.verb === "fix")
    return { ...base, intent: "send", entryVerb: props.verb };
  const empty = !payload || (!payload.text && payload.chips.length === 0);
  return { ...base, intent: empty ? "open" : "stage", entryVerb: props.verb };
}

// Add to chat stages the chips alone: the builder's prompt and title belong to Explain, never to the open chat.
function addOnly(payload: OpenAssistantArgs["payload"]): OpenAssistantArgs["payload"] {
  if (!payload || payload.chips.length === 0) return payload;
  return { chips: payload.chips };
}

// A send into a busy or drafted open chat stays there and degrades to stage; else the door's own rule.
function threadFor(): "new" | "current" | "auto" {
  if (props.thread) return props.thread;
  if (!sends.value) return "current";
  const shown = visibleTarget.value;
  if (shown && (queued.value || drafted.value || shown.pendingApproval || shown.pendingConsent))
    return "current";
  if (props.entryKind !== "empty_state") return "new";
  const last = emptyStateThreads.get(routeKey());
  const fresh = !!last && Date.now() - last.at < EMPTY_STATE_THREAD_MS;
  return fresh && last.sid === store.state.shell.activeSid ? "current" : "new";
}

function rememberEmptyState(sid: string): void {
  if (props.entryKind === "empty_state") emptyStateThreads.set(routeKey(), { sid, at: Date.now() });
}

function routeKey(): string {
  return route?.path ?? "";
}

async function safeBuild(): Promise<OpenAssistantArgs["payload"] | null> {
  try {
    const built = await props.build();
    const payload = built && { ...built, chips: fitChips(built.chips) };
    if (!payload || overCap(payload.chips)) return null;
    return props.boundOrg ? { ...payload, chips: payload.chips.map(stampOrg) } : payload;
  } catch {
    return null;
  }
}

// Each door chip is capped alone, so the largest gives up the room the others take to fit the message cap.
function fitChips(chips: ContextChip[]): ContextChip[] {
  if (chips.length < 2 || bytesOf(chips) <= MAX_ATTACHED_BYTES) return chips;
  const largest = chips.reduce((big, chip) => (chip.sizeBytes > big.sizeBytes ? chip : big));
  const room = MAX_ATTACHED_BYTES - (bytesOf(chips) - largest.sizeBytes);
  if (room <= 0) return chips;
  const fitted = truncateChip(largest, room);
  const truncated = [...new Set([...(largest.truncated ?? []), ...(fitted.truncated ?? [])])];
  return chips.map((chip) => (chip === largest ? { ...fitted, truncated } : chip));
}

// The host's load-time org wins over the org the builder read at click time, so the runtime's org guard sees it.
function stampOrg(chip: ContextChip): ContextChip {
  return chip.ref ? { ...chip, ref: { ...chip.ref, org: props.boundOrg as string } } : chip;
}

// A bound door speaks for the org its host last loaded, even after it outlived an org switch.
function callerKey(): string | undefined {
  const key = props.boundOrg ? (keyByOrg.get(props.boundOrg) ?? boundKey.value) : boundKey.value;
  return key ?? undefined;
}

function rowsOf(chips: readonly ContextChip[]): number {
  return chips
    .filter((chip) => ROW_CHIP_KINDS.has(chip.kind))
    .reduce(
      (sum, chip) => sum + (chip.count ?? (Array.isArray(chip.data) ? chip.data.length : 1)),
      0,
    );
}

function bytesOf(chips: readonly ContextChip[]): number {
  return chips.reduce((sum, chip) => sum + chip.sizeBytes, 0);
}

function overCap(chips: readonly ContextChip[]): boolean {
  return rowsOf(chips) > MAX_ATTACHED_ROWS || bytesOf(chips) > MAX_ATTACHED_BYTES;
}

// The store drops a chip past the message caps without a word; the door says so instead.
function wouldOverflow(chips: readonly ContextChip[]): boolean {
  const staged = target.value?.composer.chips ?? [];
  const fresh = chips.filter((chip) => !staged.some((other) => sameChip(other, chip)));
  if (fresh.length === 0) return false;
  return overCap([...staged, ...fresh]);
}

function refuseCap(): void {
  trackAssistant("ai_entry_clicked", {
    entry_kind: props.entryKind,
    entry_verb: props.verb,
    object_kind: props.objectKind,
    sends: false,
    gate: gate.value,
    queued: false,
    error: true,
  });
  const shown = visibleTarget.value;
  // Caps speak under the tray when it is on screen; a hidden one gets the toast.
  if (shown) noteCap(shown.sid, t("assistant.entry.capReached"));
  else toast({ variant: "default", message: t("assistant.entry.capReached") });
}

function failBuild(): void {
  trackAssistant("ai_entry_clicked", {
    entry_kind: props.entryKind,
    entry_verb: props.verb,
    object_kind: props.objectKind,
    sends: false,
    gate: gate.value,
    queued: false,
    error: true,
  });
  if (errorTimer) clearTimeout(errorTimer);
  errorAnchor.value = controlEl();
  errorTimer = setTimeout(() => {
    errorAnchor.value = null;
    errorTimer = null;
  }, BUILD_ERROR_MS);
}

// A locked click counts against impressions and opens the reason; nothing is staged.
function openGate(): void {
  trackAssistant("ai_entry_clicked", {
    entry_kind: props.entryKind,
    entry_verb: props.verb,
    object_kind: props.objectKind,
    sends: false,
    gate: gate.value,
    queued: false,
  });
  gateOpen.value = true;
}

function onGateOpen(open: boolean): void {
  gateOpen.value = open;
}

function onGateAction(cta: GateCta): void {
  if (cta === "close" || cta === "see_plans") gateOpen.value = false;
}

function toastAdded(): void {
  toast({
    variant: "default",
    message: t("assistant.entry.addedToast"),
    action: {
      label: t("assistant.entry.open"),
      handler: () =>
        void openAssistant({
          entryKind: "toast",
          entryVerb: "ask",
          objectKind: "none",
          intent: "open",
          thread: "current",
        }),
    },
  });
}

// Same rule as the store's dedupe: one id, or one object by ref.
function sameChip(a: ContextChip, b: ContextChip): boolean {
  if (a.id === b.id) return true;
  if (a.kind !== b.kind || !a.ref?.id || !b.ref?.id) return false;
  return a.ref.type === b.ref.type && a.ref.id === b.ref.id && a.ref.org === b.ref.org;
}

function matchesCoarse(): boolean {
  try {
    return window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  } catch {
    return false;
  }
}
</script>
