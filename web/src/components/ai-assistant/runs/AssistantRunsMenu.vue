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
    class="flex max-h-[min(32rem,70vh)] min-w-0 flex-col gap-2 p-3"
    data-test="assistant-runs-menu"
  >
    <div class="flex min-w-0 flex-col gap-0.5">
      <OText variant="label" as="h2" class="text-text-heading">
        {{ t("assistant.runs.heading") }}
      </OText>
      <OText variant="meta" as="p" data-test="assistant-runs-capacity">
        {{ t("assistant.runs.capacity", { active: runs.active.value, cap: runs.cap.value }) }}
      </OText>
      <OText v-if="stateSummary" variant="meta" as="p" data-test="assistant-runs-summary">
        {{ stateSummary }}
      </OText>
    </div>
    <ul
      ref="list"
      :aria-label="t('assistant.runs.heading')"
      class="flex min-w-0 flex-col gap-0.5 overflow-y-auto"
      data-test="assistant-runs-list"
    >
      <li
        v-for="row in runs.rows.value"
        :key="row.sid"
        class="rounded-default hover:bg-surface-subtle flex min-w-0 items-center gap-1 ps-1"
        :data-sid="row.sid"
        :data-group="row.group"
        :data-status="row.status"
        :data-current="row.sid === activeSid ? '' : undefined"
        data-test="assistant-runs-row"
      >
        <div
          v-if="row.otherOrg"
          class="flex min-w-0 flex-1 items-start gap-1.5 px-2 py-1.5"
          data-test="assistant-runs-row-other-org"
        >
          <AssistantStatusDot :state="rowSignal(row)" />
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <OTruncatedText class="text-text-body text-sm">{{ titleOf(row) }}</OTruncatedText>
            <OText variant="meta" as="span">
              {{ t("assistant.runs.inOrg", { org: raw(orgName(row.org)) }) }}
            </OText>
          </span>
        </div>
        <OButton
          v-else
          variant="ghost"
          size="sm"
          block
          :tabindex="row.sid === focusSid ? 0 : -1"
          :aria-label="rowName(row)"
          :aria-current="row.sid === activeSid ? 'true' : undefined"
          class="h-auto! min-h-8 min-w-0 flex-1 justify-start! py-1.5 text-start max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-runs-row-open"
          @click="openRow(row, 'composer', $event)"
          @focus="onRowFocus(row)"
          @keydown="onKeydown"
        >
          <span class="flex min-w-0 flex-1 items-start gap-1.5">
            <AssistantStatusDot :state="rowSignal(row)" />
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <OTruncatedText class="text-text-body text-sm">{{ titleOf(row) }}</OTruncatedText>
              <OText variant="meta" as="span" class="tabular-nums">
                {{ metaOf(row) }}
              </OText>
              <OText v-if="row.sid === activeSid" variant="meta" as="span">
                {{ t("assistant.runs.thisChat") }}
              </OText>
            </span>
          </span>
        </OButton>
        <template v-if="!row.otherOrg">
          <OButton
            v-if="row.group === 'answering'"
            variant="ghost"
            size="xs"
            :aria-label="t('assistant.runs.stopName', { title: titleOf(row) })"
            class="shrink-0 max-md:min-h-11 pointer-coarse:min-h-11"
            data-test="assistant-runs-row-stop"
            @click="void runs.stop(row)"
          >
            {{ t("assistant.runs.stop") }}
          </OButton>
          <OButton
            v-else-if="row.group === 'needs_you'"
            variant="outline"
            size="xs"
            :aria-label="t('assistant.runs.reviewName', { title: titleOf(row) })"
            class="shrink-0 max-md:min-h-11 pointer-coarse:min-h-11"
            data-test="assistant-runs-row-review"
            @click="openRow(row, 'card', $event)"
          >
            {{ t("assistant.runs.review") }}
          </OButton>
          <ODropdown align="end" privacy="mask">
            <template #trigger>
              <AssistantIconButton
                :label="t('assistant.runs.rowActions', { title: titleOf(row) })"
                :icon="assistantGlyph.more"
                no-tooltip
                data-test="assistant-runs-row-menu"
              />
            </template>
            <ODropdownItem
              data-test="assistant-runs-row-open-here"
              @select="openRow(row, 'composer', $event)"
            >
              {{ t("assistant.runs.openHere") }}
            </ODropdownItem>
            <ODropdownItem data-test="assistant-runs-row-open-full" @select="openFull(row)">
              {{ t("assistant.runs.openFull") }}
            </ODropdownItem>
            <ODropdownItem
              v-if="isFinished(row)"
              data-test="assistant-runs-row-clear"
              @select="runs.clear(row.sid)"
            >
              {{ t("assistant.runs.clear") }}
            </ODropdownItem>
          </ODropdown>
        </template>
      </li>
    </ul>
    <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <OText variant="meta" as="p" class="min-w-0">{{ t("assistant.runs.footer") }}</OText>
      <OButton
        v-if="ownRows.some(isFinished)"
        variant="ghost"
        size="xs"
        class="max-md:min-h-11 pointer-coarse:min-h-11"
        data-test="assistant-runs-clear-finished"
        @click="runs.clearFinished()"
      >
        {{ t("assistant.runs.clearFinished") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import AssistantStatusDot from "@/components/ai-assistant/common/AssistantStatusDot.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import {
  approvalDuration,
  runsCounts,
  useAssistantName,
  useAssistantRuns,
  useAssistantStore,
  type RunRow,
  type Sid,
} from "@/composables/assistant";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

import { rowSignal, runAgent, runStatus, runsSummary, runTitle } from "./runsText";

const ELAPSED_TICK_MS = 1_000;

const props = defineProps<{ sid?: Sid | null }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18nTyped();
const { product } = useAssistantName();
const store = useAssistantStore();
const runs = useAssistantRuns();
const router = useRouter();
const vuex = useStore();
const list = ref<HTMLElement | null>(null);
const now = ref(Date.now());
const focused = ref<string | null>(null);
// The time left is read out when a row gets focus, never per tick (`95` §1).
const spokenAt = ref(Date.now());
const timer = setInterval(() => (now.value = Date.now()), ELAPSED_TICK_MS);

const activeSid = computed(() => props.sid ?? store.state.shell.activeSid);
const ownRows = computed(() => runs.rows.value.filter((row) => !row.otherOrg));
const focusSid = computed(() =>
  ownRows.value.some((row) => row.sid === focused.value)
    ? focused.value
    : (ownRows.value[0]?.sid ?? null),
);
const stateSummary = computed(() =>
  runsSummary(runsCounts(ownRows.value), ["needs", "answering"], t),
);

function isFinished(row: RunRow): boolean {
  return row.group === "failed" || row.group === "ready";
}

function titleOf(row: RunRow): I18nText {
  return runTitle(row, t);
}

function metaOf(row: RunRow): I18nText {
  return t("assistant.runs.rowMeta", {
    agent: runAgent(row, product, t),
    status: runStatus(row, now.value, t),
  });
}

function rowName(row: RunRow): I18nText {
  const params = {
    title: titleOf(row),
    agent: runAgent(row, product, t),
    status: runStatus({ ...row, expiresAt: null }, spokenAt.value, t),
  };
  if (row.expiresAt === null) return t("assistant.runs.rowName", params);
  const time = approvalDuration(row.expiresAt - spokenAt.value, t);
  return t("assistant.runs.rowExpires", { ...params, time });
}

function orgName(id: string): string {
  const orgs: { identifier: string; name?: string }[] = vuex.state.organizations ?? [];
  return orgs.find((org) => org.identifier === id)?.name ?? id;
}

function onRowFocus(row: RunRow): void {
  focused.value = row.sid;
  spokenAt.value = Date.now();
}

function openRow(row: RunRow, focus: "composer" | "card", event: Event): void {
  const target = event.currentTarget;
  emit("close");
  void runs.open(row, { focus, invoker: target instanceof HTMLElement ? target : null });
}

async function openFull(row: RunRow): Promise<void> {
  emit("close");
  await runs.open(row);
  store.moveTo({ kind: "full" });
  void router.push({ name: "assistant", params: { chatId: row.sid } }).catch(() => undefined);
}

function rowButtons(): HTMLElement[] {
  return [
    ...(list.value?.querySelectorAll<HTMLElement>('[data-test="assistant-runs-row-open"]') ?? []),
  ];
}

function moveFocus(event: KeyboardEvent, buttons: HTMLElement[], index: number): void {
  const last = buttons.length - 1;
  const steps: Record<string, number> = {
    ArrowDown: Math.min(index + 1, last),
    ArrowUp: Math.max(index - 1, 0),
    Home: 0,
    End: last,
  };
  const next = steps[event.key];
  if (next === undefined) return;
  event.preventDefault();
  buttons[next]?.focus();
}

function onKeydown(event: KeyboardEvent): void {
  const buttons = rowButtons();
  const index = buttons.indexOf(event.target as HTMLElement);
  if (index < 0) return;
  if (event.key !== "Delete") return moveFocus(event, buttons, index);
  const row = ownRows.value[index];
  if (!row || !isFinished(row)) return;
  event.preventDefault();
  runs.clear(row.sid);
  buttons[index + 1]?.focus();
}

onBeforeUnmount(() => clearInterval(timer));
</script>
