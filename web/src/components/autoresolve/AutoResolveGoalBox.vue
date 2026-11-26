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
  <div v-if="!connections.length && !loading" data-test="autoresolve-goal-box-empty">
    <OEmptyState
      v-if="canAddMcps"
      preset="no-autoresolve-connections"
      :action-label="t('autoresolve.goalBox.addConnection')"
      action-id="add-connection"
      @action="addConnection"
    />
    <OEmptyState
      v-else
      preset="no-access"
      :title="t('emptyState.noUsable.mcps')"
      :description="t('emptyState.noUsable.askAdmin')"
      data-test="autoresolve-goal-box-no-access"
    />
  </div>
  <section v-else data-test="autoresolve-goal-box" class="flex flex-col gap-3">
    <label :for="fieldId" class="text-text-heading text-xl font-semibold">
      {{ t("autoresolve.goalBox.heading") }}
    </label>
    <div
      class="border-border-default bg-surface-base rounded-surface flex flex-col gap-3 border p-3"
    >
      <OTextarea
        :id="fieldId"
        :model-value="modelValue"
        autogrow
        :min-rows="WRITING_ROWS_REST"
        :max-rows="WRITING_ROWS_MAX"
        :placeholder="t('autoresolve.goalBox.placeholder')"
        :disabled="starting || loading"
        data-test="autoresolve-goal-box-input"
        @update:model-value="onGoalInput"
        @keydown="onKeydown"
      />
      <AutoResolveConnectionPicker
        :model-value="connectionIds"
        :connections="connections"
        :max="maxConnections"
        :label="t('autoresolve.goalBox.connectionsLabel')"
        hide-label
        inline-chips
        :loading="loading"
        :disabled="starting"
        test-prefix="autoresolve-goal-box"
        @update:model-value="onPick"
      >
        <template #beside>
          <div class="ms-auto flex shrink-0 items-start gap-3 max-md:ms-0">
            <p
              :id="reasonId"
              class="text-text-secondary m-0 flex min-h-8.5 w-56 items-center justify-end text-end text-xs max-md:w-auto max-md:flex-1 max-md:justify-start max-md:text-start"
              data-test="autoresolve-goal-box-reason"
            >
              {{ limitText }}
            </p>
            <OButton
              v-if="cancellable"
              variant="outline"
              size="sm-action"
              :disabled="starting"
              data-test="autoresolve-goal-box-cancel"
              @click="emit('cancel')"
            >
              {{ t("common.cancel") }}
            </OButton>
            <OButton
              variant="primary"
              size="sm-action"
              :disabled="!canStart"
              :loading="starting"
              :aria-describedby="error ? `${reasonId} ${errorId}` : reasonId"
              data-test="autoresolve-goal-box-start"
              @click="start"
            >
              {{ t("autoresolve.goalBox.start") }}
            </OButton>
          </div>
        </template>
      </AutoResolveConnectionPicker>
    </div>
    <div class="flex min-h-6 items-center max-md:min-h-10" data-test="autoresolve-goal-box-below">
      <OInlineNotice
        v-if="error"
        :id="errorId"
        variant="error"
        wrap
        :text="error"
        data-test="autoresolve-goal-box-error"
      />
      <p
        v-else
        :class="['text-text-secondary m-0 text-xs', goal ? '' : 'invisible']"
        data-test="autoresolve-goal-box-asks-first"
      >
        {{ t("autoresolve.goalBox.asksFirst") }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, useId, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import AutoResolveConnectionPicker from "@/components/autoresolve/AutoResolveConnectionPicker.vue";
import type { AutoResolveConnectionRef } from "@/services/autoresolve";
import {
  connectionLimitText,
  WRITING_ROWS_MAX,
  WRITING_ROWS_REST,
} from "@/utils/autoresolve/autoresolveText";

const props = withDefaults(
  defineProps<{
    connections: AutoResolveConnectionRef[];
    modelValue: string;
    connectionIds: readonly string[];
    maxConnections: number;
    starting: boolean;
    loading?: boolean;
    /** Why the last start was refused, said under the box in place of the asks-first line. */
    error?: I18nText | null;
    /** With no MCPs, offer to add one only to someone who may. */
    canAddMcps?: boolean;
    /** Show Cancel beside Start, for a box opened in place of other content. */
    cancellable?: boolean;
  }>(),
  { loading: false, error: null, canAddMcps: false, cancellable: false },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "update:connectionIds", ids: string[]): void;
  (e: "start", run: { goal: string; connectionIds: string[] }): void;
  /** The person changed the goal or the connections; a dropped removed connection is not an edit. */
  (e: "edit"): void;
  (e: "cancel"): void;
}>();

const { t } = useI18nTyped();
const router = useRouter();
const fieldId = useId();
const reasonId = useId();
const errorId = useId();

const goal = computed(() => props.modelValue.trim());
const chosen = computed(() => props.connectionIds.length);
const limitText = computed(() =>
  props.loading ? null : connectionLimitText(chosen.value, props.maxConnections, t),
);
const canStart = computed(
  () => !!goal.value && !props.loading && chosen.value > 0 && chosen.value <= props.maxConnections,
);

// One connection is the only choice, so it is chosen; a choice the org no longer has is dropped.
watch(
  () => props.connections.map((c) => c.id),
  (ids) => {
    const kept = props.connectionIds.filter((id) => ids.includes(id));
    if (ids.length === 1 && !kept.length) emit("update:connectionIds", [ids[0]]);
    else if (kept.length !== props.connectionIds.length) emit("update:connectionIds", kept);
  },
  { immediate: true },
);

const onGoalInput = (value: string) => {
  emit("update:modelValue", value);
  emit("edit");
};

const onPick = (ids: string[]) => {
  emit("update:connectionIds", ids);
  emit("edit");
};

const start = () => {
  if (canStart.value && !props.starting) {
    emit("start", { goal: goal.value, connectionIds: [...props.connectionIds] });
  }
};

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    start();
  }
};

const addConnection = () =>
  router.push({
    name: "aiToolsets",
    query: { org_identifier: router.currentRoute.value.query.org_identifier },
  });
</script>
