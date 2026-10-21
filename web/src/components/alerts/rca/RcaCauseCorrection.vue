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

<!-- "Correct the cause": the caller's correction of the incident's cause, in any finished run state. -->
<template>
  <div data-test="rca-correction" class="flex flex-col gap-2">
    <div v-if="!open" class="flex flex-wrap items-center gap-2">
      <template v-if="mine">
        <p
          data-test="rca-correction-message"
          class="text-text-body m-0 flex items-center gap-1.5 text-xs"
        >
          <OIcon name="check-circle" size="xs" class="text-status-positive" />
          {{ savedMessage }}
        </p>
        <template v-if="!forbidden">
          <OButton
            data-test="rca-correction-edit"
            variant="ghost"
            size="sm"
            :disabled="busy"
            @click="openForm"
          >
            {{ t("alerts.incidents.rcaCorrection.edit") }}
          </OButton>
          <OButton
            data-test="rca-correction-undo"
            variant="ghost"
            size="sm"
            :loading="undoing"
            :disabled="saving"
            @click="undo"
          >
            {{ t("alerts.incidents.rcaCorrection.undo") }}
          </OButton>
        </template>
      </template>
      <OButton
        v-else-if="!forbidden"
        data-test="rca-correction-open"
        variant="outline"
        size="sm"
        icon-left="edit"
        :disabled="busy"
        @click="openForm"
      >
        {{ t("alerts.incidents.rcaCorrection.open") }}
      </OButton>
      <span v-if="others > 0" data-test="rca-correction-others" class="text-text-secondary text-xs">
        {{ t("alerts.incidents.rcaCorrection.others", { count: others }, others) }}
      </span>
    </div>

    <!-- The on-call cause form, without "still unknown". -->
    <div
      v-else
      data-test="rca-correction-panel"
      class="rounded-default border-border-default bg-surface-base flex max-w-215 flex-col gap-2 border p-3"
    >
      <OnCallResolveCauseForm
        v-model:cause="cause"
        v-model:note="note"
        data-test-prefix="rca-correction"
        :cause-label="t('alerts.incidents.rcaCorrection.label')"
        :cause-hint="null"
        :note-label="t('alerts.incidents.rcaCorrection.noteLabel')"
        :exclude-causes="['still_unknown']"
        :note-maxlength="MAX_NOTE_CHARS"
        :disabled="busy"
      />
      <div class="flex justify-end gap-2">
        <OButton
          data-test="rca-correction-cancel"
          variant="ghost"
          size="sm"
          :disabled="busy"
          @click="closeForm"
        >
          {{ t("alerts.incidents.rcaCorrection.cancel") }}
        </OButton>
        <OButton
          data-test="rca-correction-save"
          variant="primary"
          size="sm"
          :disabled="!cause"
          :loading="saving"
          @click="save"
        >
          {{ t("alerts.incidents.rcaCorrection.save") }}
        </OButton>
      </div>
    </div>

    <p
      v-if="error"
      data-test="rca-correction-error"
      role="alert"
      class="text-status-error-text m-0 text-xs"
    >
      {{ error }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { isAxiosError } from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OnCallResolveCauseForm from "@/components/oncall/OnCallResolveCauseForm.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { ListRcaCauseCorrectionResponse, RcaCauseCorrection } from "@/services/incidents";
import {
  deleteRcaCorrectionMutation,
  putRcaCorrectionMutation,
  rcaCorrectionQuery,
} from "@/services/incidents.queries";
import { incidentKeys } from "@/services/incidents.querykeys";
import type { ResolutionCause } from "@/ts/interfaces/oncall";

const props = defineProps<{
  orgId: string;
  incidentId: string;
}>();

const { t } = useI18nTyped();
const queryClient = useQueryClient();

/** The server's note limit. */
const MAX_NOTE_CHARS = 1000;

const read = useQuery(() => rcaCorrectionQuery(props.orgId, props.incidentId));
const saveMutation = useMutation(() => putRcaCorrectionMutation(props.orgId, props.incidentId));
const undoMutation = useMutation(() =>
  deleteRcaCorrectionMutation(props.orgId, props.incidentId),
);

/** The caller's saved correction, or null. */
const mine = computed(() => read.data.value?.mine ?? null);
/** How many other responders corrected the cause. */
const others = computed(() => {
  const items = read.data.value?.items ?? [];
  const own = mine.value?.author_email;
  return items.filter((item) => item.author_email !== own).length;
});

const open = ref(false);
const cause = ref<ResolutionCause | "">("");
const note = ref("");
const saving = computed(() => saveMutation.isPending.value);
const undoing = computed(() => undoMutation.isPending.value);
/** A write's failure; a read failure comes from the query. */
const writeError = ref<I18nText | null>(null);
/** The server refused the caller a write: the control turns read-only. */
const forbidden = ref(false);
/** One request at a time: the read, a save or an Undo. */
const busy = computed(() => read.isLoading.value || saving.value || undoing.value);

const savedMessage = computed<I18nText | null>(() =>
  mine.value
    ? t("alerts.incidents.rcaCorrection.saved", {
        cause: t(`oncall.cause_${mine.value.cause}`),
      })
    : null,
);

const errorText = (failure: unknown, fallback: I18nText): I18nText => {
  const status = isAxiosError(failure) ? failure.response?.status : undefined;
  if (status === 403) return t("alerts.incidents.rcaCorrection.forbidden");
  const body: unknown = isAxiosError(failure) ? failure.response?.data : null;
  const message =
    body && typeof body === "object" && "message" in body && typeof body.message === "string"
      ? body.message
      : "";
  return message ? raw(message) : fallback;
};

const error = computed<I18nText | null>(() => {
  if (writeError.value) return writeError.value;
  const failure = read.error.value;
  return failure ? errorText(failure, t("alerts.incidents.rcaCorrection.loadFailed")) : null;
});

watch(read.error, (failure) => {
  if (failure) console.error("Failed to load the RCA cause correction:", failure);
});

// Another incident starts closed and writable; the old incident's writes no longer hold it busy.
watch(
  () => [props.orgId, props.incidentId],
  () => {
    open.value = false;
    writeError.value = null;
    forbidden.value = false;
    saveMutation.reset();
    undoMutation.reset();
  },
);

/** Opens the form with the saved values, if any. */
const openForm = () => {
  writeError.value = null;
  cause.value = mine.value?.cause ?? "";
  note.value = mine.value?.note ?? "";
  open.value = true;
};

const closeForm = () => {
  open.value = false;
  writeError.value = null;
};

/** Puts the caller's row into that incident's cached read, so it shows before the refetch. */
const setMine = (incidentId: string, row: RcaCauseCorrection | null) => {
  queryClient.setQueryData<ListRcaCauseCorrectionResponse>(
    incidentKeys.rcaCorrection(props.orgId, incidentId),
    (current) => {
      const own = row?.author_email ?? current?.mine?.author_email;
      const items = (current?.items ?? []).filter((item) => item.author_email !== own);
      return { items: row ? [...items, row] : items, mine: row };
    },
  );
};

/** A 403 turns the control read-only; any failure shows its message. */
const fail = (incidentId: string, failure: unknown, fallback: I18nText) => {
  if (incidentId !== props.incidentId) return;
  if (isAxiosError(failure) && failure.response?.status === 403) {
    forbidden.value = true;
    open.value = false;
  }
  writeError.value = errorText(failure, fallback);
};

const save = async () => {
  const picked = cause.value;
  if (busy.value || !picked) return;
  const incidentId = props.incidentId;
  writeError.value = null;
  try {
    const row = await saveMutation.mutateAsync({
      cause: picked,
      note: note.value.trim() || undefined,
    });
    setMine(incidentId, row);
    if (incidentId === props.incidentId) open.value = false;
  } catch (failure) {
    console.error("Failed to save the RCA cause correction:", failure);
    fail(incidentId, failure, t("alerts.incidents.rcaCorrection.saveFailed"));
  }
};

const undo = async () => {
  if (busy.value) return;
  const incidentId = props.incidentId;
  writeError.value = null;
  try {
    await undoMutation.mutateAsync();
    setMine(incidentId, null);
  } catch (failure) {
    console.error("Failed to undo the RCA cause correction:", failure);
    fail(incidentId, failure, t("alerts.incidents.rcaCorrection.undoFailed"));
  }
};
</script>
