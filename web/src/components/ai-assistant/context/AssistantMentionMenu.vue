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
  <div
    v-if="open"
    :class="
      inline
        ? 'max-h-72 overflow-y-auto'
        : [
            'bg-dropdown-bg border-dropdown-border rounded-surface max-h-60 overflow-y-auto border p-1 shadow-md',
            'md:absolute md:inset-x-0 md:bottom-full md:mb-1 md:max-w-96',
          ]
    "
    data-test="assistant-mention-panel"
    data-dd-privacy="mask"
  >
    <div
      :id="listboxId"
      role="listbox"
      :aria-label="t('assistant.composer.mention.title')"
      data-test="assistant-mention-menu"
      class="flex flex-col"
    >
      <div
        v-for="group in groups"
        :key="group.id"
        role="group"
        :aria-label="group.title"
        :aria-busy="group.state === 'loading' || undefined"
        :data-test="`assistant-mention-group-${group.id}`"
      >
        <div
          class="text-text-secondary flex justify-between px-2 pt-2 pb-1 text-xs font-medium"
          aria-hidden="true"
        >
          <span>{{ group.title }}</span>
          <span v-if="group.total" class="tabular-nums" data-test="assistant-mention-group-count">{{
            group.total
          }}</span>
        </div>
        <div v-if="group.state === 'loading'" class="px-2 py-1" aria-hidden="true">
          <OSkeleton type="text" class="h-5 w-2/3" />
        </div>
        <div
          v-for="item in group.items"
          :id="optionId(item)"
          :key="item.id"
          role="option"
          :aria-selected="item.id === activeOptionId"
          :aria-disabled="item.disabled || undefined"
          :aria-label="
            item.action
              ? item.label
              : t('assistant.composer.mention.optionName', {
                  group: group.title,
                  label: item.label,
                })
          "
          :class="[
            'rounded-default flex min-h-8 items-center gap-2 px-2 py-1 text-sm max-md:min-h-11 pointer-coarse:min-h-11',
            item.disabled ? 'text-text-secondary' : 'cursor-pointer',
            item.id === activeOptionId
              ? 'bg-dropdown-item-hover-bg text-text-heading'
              : item.disabled
                ? ''
                : 'text-text-body hover:bg-dropdown-item-hover-bg',
          ]"
          :data-test="
            item.action
              ? `assistant-mention-${item.action}`
              : item.disabled
                ? 'assistant-mention-no-access'
                : 'assistant-mention-option'
          "
          :data-kind="item.kind"
          :data-agent="item.agent"
          tabindex="-1"
          @mousedown.prevent
          @click="choose(item)"
          @keydown.enter.prevent="choose(item)"
        >
          <OIcon
            v-if="item.glyph"
            :name="item.glyph"
            size="xs"
            class="text-text-secondary shrink-0"
          />
          <OTruncatedText :class="['min-w-0 flex-1', item.code ? 'font-mono' : '']">{{
            item.label
          }}</OTruncatedText>
          <span
            v-if="item.secondary && (item.agent || query)"
            :class="['shrink-0 text-xs', item.id === activeOptionId ? '' : 'text-text-secondary']"
            >{{ item.secondary }}</span
          >
        </div>
      </div>
    </div>
    <p
      v-if="empty"
      class="text-text-secondary px-2 py-2 text-sm"
      data-test="assistant-mention-empty"
    >
      {{ t("assistant.composer.mention.empty", { q: query }) }}
    </p>
  </div>
</template>

<script lang="ts">
import type { AgentId, ChipKind, ContextChip } from "@/composables/assistant";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import type { I18nText } from "@/types/i18n";

/** One choice of the `@` menu; Show all and Retry carry an action (CT-05 AC 2, 4, 11). */
export interface MentionOption {
  id: string;
  kind: ChipKind;
  label: I18nText;
  secondary?: I18nText;
  chip?: ContextChip;
  action?: MentionAction;
  groupId?: string;
  /** No access: shown, never chosen. */
  disabled?: boolean;
  /** An Agents row: it sets who answers and adds no chip. */
  agent?: AgentId;
  glyph?: IconName;
  /** Names read as identifiers, in the mono face. */
  code?: boolean;
}

/** An action row of the menu: Show all and Retry act in place, Image hands over to the file picker. */
export type MentionAction = "more" | "retry" | "image" | "agent";

export interface AssistantMentionMenuProps {
  open: boolean;
  /** The text typed after `@`. */
  query: string;
  org: string;
  listboxId: string;
  /** Inside the `+` popover: no panel chrome of its own (D4 §3.6). */
  inline?: boolean;
  /** The `+` menu adds an Image row after the groups (D4 §3.6). */
  withImage?: boolean;
}

/** At most this many options per group before "Show all", with no query typed. */
export const MENTION_GROUP_LIMIT = 2;

/** With a query the list is short already, so a group shows more of what matched. */
export const MENTION_SEARCH_LIMIT = 8;

const STREAM_TYPES = ["logs", "metrics", "traces"] as const;
</script>

<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { computed, reactive, ref, watch } from "vue";

import { agentGlyph, assistantGlyph, chipGlyph } from "@/components/ai-assistant/common/glyphs";
import { agentClause } from "@/components/ai-assistant/agents/agentClause";
import { announceComposer } from "@/components/ai-assistant/composer/composerUi";
import { shortLabelFor, useAssistantCapability, useAssistantStore } from "@/composables/assistant";
import {
  agentMatches,
  agentName,
  agentReason,
  rosterOffersChoice,
} from "@/composables/assistant/pure";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { alertsListQuery } from "@/services/alerts.queries";
import { dashboardsByFolderQuery } from "@/services/dashboards.queries";
import { pipelinesQuery } from "@/services/pipelines.queries";
import { streamNameListQuery } from "@/services/stream.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import { isInternalStreamName } from "@/utils/internalStreams";

type GroupState = "loading" | "ready" | "forbidden" | "error";

interface Group {
  id: string;
  title: I18nText;
  kind: I18nText;
  state: GroupState;
  /** The options, then the Show all, Retry or no-access row, all in the ↑/↓ cycle. */
  items: MentionOption[];
  retry?: () => void;
  /** How many the group holds; the header's right-hand count. */
  total?: number;
}

const props = withDefaults(defineProps<AssistantMentionMenuProps>(), {
  inline: false,
  withImage: false,
});

const emit = defineEmits<{
  (e: "select", option: MentionOption): void;
  (e: "close"): void;
}>();

const { t } = useI18nTyped();
const store = useAssistantStore();
const capability = useAssistantCapability();
const active = ref(0);
const expanded = reactive(new Set<string>());
const enabled = computed(() => props.open && !!props.org);

// Existing list queries, fetched only while the menu is open (`40` §5).
const streams = STREAM_TYPES.map((type) =>
  useQuery(computed(() => ({ ...streamNameListQuery(props.org, type), enabled: enabled.value }))),
);
const dashboards = useQuery(
  computed(() => ({ ...dashboardsByFolderQuery(props.org, "default"), enabled: enabled.value })),
);
const alerts = useQuery(
  computed(() => ({ ...alertsListQuery(props.org, "default"), enabled: enabled.value })),
);
const pipelines = useQuery(
  computed(() => ({ ...pipelinesQuery(props.org), enabled: enabled.value })),
);

watch(
  () => [props.open, props.query],
  () => {
    active.value = 0;
    if (!props.open) expanded.clear();
  },
);

// Every typed term must occur somewhere in the name, so `digests` and `cart err` find mid-name matches (BUG-015).
const terms = computed(() =>
  props.query
    .trim()
    .toLowerCase()
    .split(/[\s_.-]+/)
    .filter(Boolean),
);
const matches = (option: MentionOption) => {
  const hay = `${option.label} ${option.secondary ?? ""}`.toLowerCase();
  return terms.value.every((term) => hay.includes(term));
};

const streamOptions = computed<MentionOption[]>(() =>
  STREAM_TYPES.flatMap((type, index) =>
    namesOf(streams[index].data.value)
      .filter((name) => !isInternalStreamName(name))
      .map((name) =>
        option(
          "stream",
          `${type}:${name}`,
          raw(name),
          raw(type),
          {
            id: name,
            stream: name,
            streamType: type,
          },
          name,
        ),
      ),
  ),
);

const dashboardOptions = computed<MentionOption[]>(() =>
  listOf(dashboards.data.value).flatMap((row) => {
    const id = stringOf(row.dashboard_id ?? row.dashboardId);
    const title = stringOf(row.title) ?? id;
    return id && title
      ? [option("panel", id, raw(title), undefined, { id, type: "dashboard" }, stringOf(row.title))]
      : [];
  }),
);

const alertOptions = computed<MentionOption[]>(() =>
  listOf(alerts.data.value).flatMap((row) => {
    const id = stringOf(row.alert_id ?? row.id);
    const name = stringOf(row.name) ?? id;
    return id && name
      ? [option("alert", id, raw(name), undefined, { id }, stringOf(row.name))]
      : [];
  }),
);

const pipelineOptions = computed<MentionOption[]>(() =>
  listOf(pipelines.data.value).flatMap((row) => {
    const id = stringOf(row.pipeline_id ?? row.id);
    const name = stringOf(row.name) ?? id;
    return id && name
      ? [option("pipeline_node", id, raw(name), undefined, { id }, stringOf(row.name))]
      : [];
  }),
);

// The menu's own filter, not `group()`'s: a purpose line must never match (MULTI-AGENT-02 AC 2).
const agentGroup = computed<Group[]>(() => {
  const roster = capability.value.agents;
  if (props.inline || !rosterOffersChoice(roster)) return [];
  const items = (roster ?? []).flatMap((agent): MentionOption[] => {
    const label = agentName(agent.id, t);
    if (!agentMatches(agent.id, String(label), props.query)) return [];
    const reason = agentReason(agent, store.agentRefusal(agent.id), t);
    return [
      {
        id: `agent:${agent.id}`,
        kind: "field",
        label,
        action: "agent",
        agent: agent.id,
        glyph: reason ? assistantGlyph.locked : agentGlyph[agent.id],
        secondary: reason ?? agentClause(agent, t),
        ...(reason && { disabled: true }),
      },
    ];
  });
  const title = t("assistant.composer.mention.group.agents");
  return [{ id: "agents", title, kind: title, state: "ready", items, total: items.length }];
});

const groups = computed<Group[]>(() =>
  [
    ...agentGroup.value,
    group(
      "streams",
      t("assistant.composer.mention.group.streams"),
      t("assistant.composer.mention.kind.streams"),
      stateOf(streams),
      streamOptions.value,
      () => streams.forEach((q) => void q.refetch()),
    ),
    group(
      "dashboards",
      t("assistant.composer.mention.group.dashboards"),
      t("assistant.composer.mention.kind.dashboards"),
      stateOf([dashboards]),
      dashboardOptions.value,
      () => void dashboards.refetch(),
    ),
    group(
      "alerts",
      t("assistant.composer.mention.group.alerts"),
      t("assistant.composer.mention.kind.alerts"),
      stateOf([alerts]),
      alertOptions.value,
      () => void alerts.refetch(),
    ),
    group(
      "pipelines",
      t("assistant.composer.mention.group.pipelines"),
      t("assistant.composer.mention.kind.pipelines"),
      stateOf([pipelines]),
      pipelineOptions.value,
      () => void pipelines.refetch(),
    ),
    ...(props.withImage ? [imageGroup()] : []),
  ].filter(
    (g) =>
      (g.state !== "ready" || g.items.length > 0) && (g.id !== "pipelines" || !!terms.value.length),
  ),
);

// A disabled agent stays in the ↑/↓ cycle, so Enter on it can read its reason (MULTI-AGENT-02 AC 6).
const flat = computed(() =>
  groups.value.flatMap((g) => g.items.filter((item) => !item.disabled || item.action === "agent")),
);
const results = computed(
  () =>
    flat.value.filter((item) => !item.action || item.action === "image" || item.action === "agent")
      .length,
);
const empty = computed(() => groups.value.every((g) => g.state === "ready") && results.value === 0);

function imageGroup(): Group {
  const label = t("assistant.composer.addImage");
  const item: MentionOption = {
    id: "action:image",
    kind: "image",
    label,
    action: "image",
    glyph: chipGlyph.image,
  };
  return {
    id: "attach",
    title: t("assistant.composer.addGroupAttach"),
    kind: label,
    state: "ready",
    items: terms.value.length === 0 || matches(item) ? [item] : [],
  };
}

// Show all and Retry act in place; an option or the Image row is handed to the composer.
function choose(item: MentionOption): void {
  if (item.action === "agent") return chooseAgent(item);
  if (item.disabled) return;
  if (item.action === "more" && item.groupId) {
    expanded.add(item.groupId);
    return;
  }
  if (item.action === "retry") {
    groups.value.find((g) => g.id === item.groupId)?.retry?.();
    return;
  }
  emit("select", item);
}
const activeOptionId = computed(() => flat.value[active.value]?.id ?? null);

// The composer strips the `@…` token on `select`; the sentence here replaces its "added" one in the same tick.
function chooseAgent(item: MentionOption): void {
  const sid = store.state.shell.activeSid;
  if (item.disabled) {
    if (sid && item.secondary) announceComposer(sid, item.secondary);
    return;
  }
  emit("select", item);
  const target = store.state.shell.activeSid;
  if (!target || !item.agent) return;
  store.pickAgent(target, item.agent, "mention");
  announceComposer(target, t("assistant.agent.announceChosen", { agent: item.label }));
}

function group(
  id: string,
  title: I18nText,
  kind: I18nText,
  state: GroupState,
  all: MentionOption[],
  retry?: () => void,
): Group {
  const found = all.filter(matches);
  const limit = terms.value.length > 0 ? MENTION_SEARCH_LIMIT : MENTION_GROUP_LIMIT;
  const shown = expanded.has(id) ? found : found.slice(0, limit);
  const extra = (action: "more" | "retry", label: I18nText): MentionOption => ({
    id: `${action}:${id}`,
    kind: "field",
    label,
    action,
    groupId: id,
  });
  const items: MentionOption[] =
    state === "ready"
      ? [
          ...shown,
          ...(found.length > shown.length
            ? [extra("more", t("assistant.composer.mention.showAll"))]
            : []),
        ]
      : state === "error"
        ? [extra("retry", t("assistant.composer.mention.retry", { kind }))]
        : state === "forbidden"
          ? [
              {
                id: `none:${id}`,
                kind: "field",
                label: t("assistant.composer.mention.noAccess", { kind }),
                disabled: true,
              },
            ]
          : [];
  return { id, title, kind, state, items, retry, total: state === "ready" ? found.length : 0 };
}

function option(
  kind: ChipKind,
  key: string,
  label: I18nText,
  secondary: I18nText | undefined,
  ref: { id: string; type?: string; stream?: string; streamType?: string },
  name: string | null,
): MentionOption {
  const short = shortLabelFor(kind, name);
  const chip: ContextChip = {
    id: `mention:${kind}:${key}`,
    kind,
    label,
    ...(short && { short }),
    ...(secondary && { secondary }),
    ref: { type: ref.type ?? kind, org: props.org, ...ref },
    sizeBytes: label.length,
    provenance: "mention",
    sent: "whitelist",
  };
  return {
    id: chip.id,
    kind,
    label,
    ...(secondary && { secondary }),
    chip,
    code: kind === "stream" || kind === "alert",
  };
}

function stateOf(
  queries: { isPending: { value: boolean }; error: { value: unknown } }[],
): GroupState {
  const failed = queries.find((q) => q.error.value);
  if (failed) {
    const status = (failed.error.value as { response?: { status?: number } } | null)?.response
      ?.status;
    return status === 403 ? "forbidden" : "error";
  }
  return queries.some((q) => q.isPending.value) ? "loading" : "ready";
}

function listOf(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data)
    ? data.filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    : [];
}

function namesOf(data: unknown): string[] {
  return listOf(data).flatMap((row) => (stringOf(row.name) ? [String(row.name)] : []));
}

function stringOf(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() ? value : null;
}

function optionId(option: MentionOption): string {
  return `${props.listboxId}-${option.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

defineExpose({
  /** ↑/↓ from the textbox (the textbox keeps focus, CT-05 AC 1). */
  move(delta: number) {
    const count = flat.value.length;
    if (count > 0) active.value = (active.value + delta + count) % count;
  },
  /** The option Enter picks; `null` when nothing matches, so Enter inserts nothing (CT-05 AC 5). */
  current: () => flat.value[active.value] ?? null,
  /** Runs Enter on the highlighted row: an option is selected, Show all and Retry act in place. */
  choose,
  activeId: computed(() => {
    const current = flat.value[active.value];
    return current ? optionId(current) : undefined;
  }),
  /** How many choices the query leaves, for the composer's announcement (U7). */
  results,
  empty,
  /** A group still loading would change the count, so the count waits for it (V3). */
  loading: computed(() => groups.value.some((group) => group.state === "loading")),
});
</script>
