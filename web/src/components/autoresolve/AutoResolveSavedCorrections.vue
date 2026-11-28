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
  <section v-if="total > 0" class="flex flex-col gap-2" data-test="autoresolve-saved-corrections">
    <div class="flex min-h-8 items-center gap-2">
      <h2 class="text-text-heading m-0 text-sm font-semibold">
        {{ t("autoresolve.corrections.title") }}
      </h2>
      <OTag
        variant="default-soft"
        size="sm"
        :label="raw(String(total))"
        data-test="autoresolve-saved-corrections-count"
      />
    </div>
    <p class="text-text-secondary m-0 text-xs">{{ t("autoresolve.corrections.help") }}</p>
    <ul
      class="rounded-surface border-border-default bg-surface-base divide-border-subtle m-0 flex list-none flex-col divide-y border p-0"
    >
      <li
        v-for="correction in shown"
        :key="correction.id"
        class="flex min-w-0 items-start gap-3 px-4 py-3"
        data-test="autoresolve-saved-correction"
        :data-test-value="correction.id"
      >
        <OTag
          type="autoresolveCorrectionKind"
          :value="correction.kind"
          size="sm"
          class="shrink-0"
        />
        <span class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="text-text-body text-compact wrap-anywhere whitespace-pre-wrap">{{
            correction.note
          }}</span>
          <span
            v-if="correction.run_started_at_us === null"
            class="text-text-secondary text-xs wrap-anywhere"
            data-test="autoresolve-saved-correction-run-gone"
          >
            {{ goneSource(correction) }}
          </span>
          <i18n-t
            v-else
            keypath="autoresolve.corrections.source"
            tag="span"
            class="text-text-secondary text-xs wrap-anywhere"
          >
            <template #run>
              <router-link
                :to="runLink(correction.run_id)"
                class="text-text-link hover:underline"
                data-test="autoresolve-saved-correction-run"
                >{{ runOf(correction) }}</router-link
              >
            </template>
            <template #name>{{ correction.created_by }}</template>
          </i18n-t>
        </span>
        <OButton
          v-if="canRemove"
          variant="ghost"
          size="xs"
          :loading="removing === correction.id"
          :disabled="!!removing"
          data-test="autoresolve-saved-correction-remove"
          @click="onRemove(correction)"
        >
          {{ t("common.remove") }}
        </OButton>
      </li>
    </ul>
    <OButton
      v-if="hidden"
      variant="ghost"
      size="sm"
      class="self-start"
      data-test="autoresolve-saved-corrections-more"
      @click="expanded = true"
    >
      {{ andMoreText(hidden, t) }}
    </OButton>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { autoresolveErrorMessage, type AutoResolveCorrection } from "@/services/autoresolve";
import {
  autoresolveCorrectionsQuery,
  removeAutoResolveCorrectionMutation,
} from "@/services/autoresolve.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import { andMoreText, autoresolveTime } from "@/utils/autoresolve/autoresolveText";

const SHOWN = 5;

const props = defineProps<{ org: string; autoresolveId: string }>();

const { t } = useI18nTyped();

const query = useQuery(() =>
  Object.assign(autoresolveCorrectionsQuery(props.org, props.autoresolveId), {
    enabled: !!props.org && !!props.autoresolveId,
  }),
);
const corrections = computed(() => query.data.value?.corrections ?? []);
const total = computed(() => query.data.value?.total ?? 0);
const canRemove = computed(() => query.data.value?.can_remove === true);

const expanded = ref(false);
const shown = computed(() =>
  expanded.value ? corrections.value : corrections.value.slice(0, SHOWN),
);
// The server may count more than it sent, so "and N more" counts from the total.
const hidden = computed(() => (expanded.value ? 0 : Math.max(0, total.value - shown.value.length)));

const runLink = (runId: string) => ({
  name: "autoresolveRun",
  params: { id: runId },
  query: { org_identifier: props.org },
});
const runOf = (c: AutoResolveCorrection) =>
  t("autoresolve.corrections.runOf", {
    time: autoresolveTime(c.run_started_at_us ?? c.created_at_us, "MMM d, HH:mm"),
  });
const goneSource = (c: AutoResolveCorrection) =>
  t("autoresolve.corrections.sourceGone", {
    time: autoresolveTime(c.created_at_us, "MMM d, HH:mm"),
    name: raw(c.created_by),
  });

const remove = useMutation(() => removeAutoResolveCorrectionMutation(props.org));
const removing = ref<string | null>(null);
const onRemove = (c: AutoResolveCorrection) => {
  removing.value = c.id;
  remove.mutate(
    { autoresolveId: props.autoresolveId, correctionId: c.id },
    {
      onSettled: () => (removing.value = null),
      onError: (err: unknown) =>
        toast({
          variant: "error",
          message: raw(autoresolveErrorMessage(err)) || t("autoresolve.corrections.removeFailed"),
        }),
    },
  );
};
</script>
