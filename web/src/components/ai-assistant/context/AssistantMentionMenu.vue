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
    :class="[
      'bg-dropdown-bg border-dropdown-border rounded-surface max-h-60 overflow-y-auto border p-1 shadow-md',
      'md:absolute md:inset-x-0 md:bottom-full md:mb-1 md:max-w-96',
    ]"
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
        <div class="text-text-secondary px-2 pt-2 pb-1 text-xs font-medium" aria-hidden="true">
          {{ group.title }}
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
            'rounded-default flex min-h-8 flex-col justify-center px-2 py-1 text-sm max-md:min-h-11 pointer-coarse:min-h-11',
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
          tabindex="-1"
          @mousedown.prevent
          @click="choose(item)"
          @keydown.enter.prevent="choose(item)"
        >
          <OTruncatedText>{{ item.label }}</OTruncatedText>
          <span
            v-if="item.secondary"
            :class="['text-xs', item.id === activeOptionId ? '' : 'text-text-secondary']"
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
import type { ChipKind, ContextChip } from "@/composables/assistant";
import type { I18nText } from "@/types/i18n";

/** One choice of the `@` menu; a time option carries a period, Show more and Retry carry an action (CT-05 AC 2, 4, 11). */
export interface MentionOption {
  id: string;
  kind: ChipKind;
  label: I18nText;
  secondary?: I18nText;
  chip?: ContextChip;
  /** `null` is "Page time". */
  period?: string | null;
  action?: "more" | "retry";
  groupId?: string;
  /** No access: shown, never chosen. */
  disabled?: boolean;
}

export interface AssistantMentionMenuProps {
  open: boolean;
  /** The text typed after `@`. */
  query: string;
  org: string;
  listboxId: string;
}

/** At most this many options per group before "Show more" (CT-05 AC 2). */
export const MENTION_GROUP_LIMIT = 8;

const TIME_PERIODS = ["15m", "1h", "24h", "7d"] as const;

const STREAM_TYPES = ["logs", "metrics", "traces"] as const;
</script>

<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { computed, reactive, ref, watch } from "vue";

import { shortLabelFor, timeRangeText } from "@/composables/assistant";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { alertsListQuery } from "@/services/alerts.queries";
import { dashboardsByFolderQuery } from "@/services/dashboards.queries";
import { pipelinesQuery } from "@/services/pipelines.queries";
import { streamNameListQuery } from "@/services/stream.queries";
import { raw, useI18nTyped } from "@/types/i18n";

type GroupState = "loading" | "ready" | "forbidden" | "error";

interface Group {
  id: string;
  title: I18nText;
  kind: I18nText;
  state: GroupState;
  /** The options, then the Show more, Retry or no-access row, all in the ↑/↓ cycle. */
  items: MentionOption[];
  retry?: () => void;
}

const props = defineProps<AssistantMentionMenuProps>();

const emit = defineEmits<{
  (e: "select", option: MentionOption): void;
  (e: "close"): void;
}>();

const { t } = useI18nTyped();
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

const needle = computed(() => props.query.trim().toLowerCase());
const matches = (option: MentionOption) =>
  !needle.value || `${option.label} ${option.secondary ?? ""}`.toLowerCase().includes(needle.value);

const timeOptions = computed<MentionOption[]>(() => [
  ...TIME_PERIODS.map((period) => ({
    id: `time:${period}`,
    kind: "time" as const,
    label: timeRangeText({ from: 0, to: 0, period, source: "custom" }, t),
    period,
  })),
  {
    id: "time:page",
    kind: "time" as const,
    label: t("assistant.composer.mention.pageTime"),
    period: null,
  },
]);

const streamOptions = computed<MentionOption[]>(() =>
  STREAM_TYPES.flatMap((type, index) =>
    namesOf(streams[index].data.value).map((name) =>
      option(
        "stream",
        `${type}:${name}`,
        t("assistant.context.chip.stream", { name: raw(name) }),
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
      ? [
          option(
            "panel",
            id,
            t("assistant.context.chip.dashboard", { name: raw(title) }),
            undefined,
            { id, type: "dashboard" },
            stringOf(row.title),
          ),
        ]
      : [];
  }),
);

const alertOptions = computed<MentionOption[]>(() =>
  listOf(alerts.data.value).flatMap((row) => {
    const id = stringOf(row.alert_id ?? row.id);
    const name = stringOf(row.name) ?? id;
    return id && name
      ? [
          option(
            "alert",
            id,
            t("assistant.context.chip.alert", { name: raw(name) }),
            undefined,
            { id },
            stringOf(row.name),
          ),
        ]
      : [];
  }),
);

const pipelineOptions = computed<MentionOption[]>(() =>
  listOf(pipelines.data.value).flatMap((row) => {
    const id = stringOf(row.pipeline_id ?? row.id);
    const name = stringOf(row.name) ?? id;
    return id && name
      ? [
          option(
            "pipeline_node",
            id,
            t("assistant.context.chip.pipeline", { name: raw(name) }),
            undefined,
            { id },
            stringOf(row.name),
          ),
        ]
      : [];
  }),
);

const groups = computed<Group[]>(() =>
  [
    group("time", t("assistant.composer.mention.group.time"), raw(""), "ready", timeOptions.value),
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
  ].filter((g) => g.state !== "ready" || g.items.length > 0),
);

const flat = computed(() => groups.value.flatMap((g) => g.items.filter((item) => !item.disabled)));
const results = computed(() => flat.value.filter((item) => !item.action).length);
const empty = computed(() => groups.value.every((g) => g.state === "ready") && results.value === 0);

// Show more and Retry act in place; an option is handed to the composer.
function choose(item: MentionOption): void {
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

function group(
  id: string,
  title: I18nText,
  kind: I18nText,
  state: GroupState,
  all: MentionOption[],
  retry?: () => void,
): Group {
  const found = all.filter(matches);
  const shown = expanded.has(id) ? found : found.slice(0, MENTION_GROUP_LIMIT);
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
            ? [extra("more", t("assistant.composer.mention.showMoreIn", { group: title }))]
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
  return { id, title, kind, state, items, retry };
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
  return { id: chip.id, kind, label, ...(secondary && { secondary }), chip };
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
  /** Runs Enter on the highlighted row: an option is selected, Show more and Retry act in place. */
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
