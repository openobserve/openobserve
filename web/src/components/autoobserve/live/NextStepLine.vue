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
  <section
    class="rounded-default border-border-subtle bg-status-info-bg flex h-32 min-w-0 shrink-0 flex-col gap-1.5 overflow-hidden border border-s-4 p-3"
    :class="line ? 'border-s-accent' : 'border-s-border-subtle'"
    :aria-busy="!line"
    data-test="autoobserve-next-step-line"
  >
    <span class="text-text-heading h-4 text-xs font-medium">{{
      t("autoobserve.nextStep.title")
    }}</span>
    <!-- The box is a fixed height: the text stops at two lines (the tooltip keeps the rest), so no step moves anything. -->
    <template v-if="line">
      <div class="h-10" data-test="autoobserve-next-step-line-text">
        <OTruncatedText as="p" :lines="2" class="text-text-heading text-sm font-medium">
          {{ line.text }}
        </OTruncatedText>
      </div>
      <div class="flex h-8 min-w-0 items-center gap-x-3">
        <OButton
          v-if="line.link"
          :variant="line.link.primary ? 'primary' : 'secondary'"
          class="shrink-0"
          data-test="autoobserve-next-step-line-open"
          @click="go(line.link.to)"
        >
          {{ line.link.label }}
        </OButton>
        <span
          v-if="note"
          class="flex min-w-0 items-center gap-1.5 text-xs"
          :class="note.failed ? 'text-status-error-text' : 'text-text-secondary'"
          :role="note.failed ? 'alert' : undefined"
          :data-note="note.kind"
          data-test="autoobserve-next-step-line-note"
        >
          <OSpinner v-if="note.kind === 'working'" size="sm" instant />
          <OTruncatedText>{{ note.text }}</OTruncatedText>
        </span>
        <OButton
          v-if="judgeable"
          :variant="pressed ? 'accent-ghost' : 'secondary'"
          size="sm"
          class="ms-auto shrink-0"
          :icon="pressed ? 'check' : 'thumb-down-off-alt'"
          :aria-disabled="pressed"
          :loading="submitting"
          :aria-pressed="pressed"
          data-test="autoobserve-next-step-line-not-helpful"
          @click="markNotHelpful"
        >
          {{ t("autoobserve.nextStep.notHelpful") }}
        </OButton>
      </div>
    </template>
    <template v-else>
      <span
        class="flex h-10 flex-col justify-center gap-1.5"
        :aria-label="t('autoobserve.nextStep.loading')"
      >
        <OSkeleton class="h-3.5 w-11/12" />
        <OSkeleton class="h-3.5 w-3/5" />
      </span>
      <OSkeleton class="h-8 w-30" />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import OButton from "@/lib/core/Button/OButton.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import type { AutoObserveDeepLink, AutoObserveIssueContext } from "@/services/autoobserve";
import { refusalOf } from "@/services/autoobserveDecisions";
import { stepJudgementMutation } from "@/services/autoobserve.queries";
import { deepLinkRoute } from "./liveAdapter";
import { nextStepLine, type StepNote } from "./nextStepCopy";

interface Press {
  key: string;
  state: "pending" | "done" | "failed";
  failure: I18nText | null;
}

const props = defineProps<{
  // Null while the item is still loading or the first ask is not stored yet.
  context: AutoObserveIssueContext | null;
  nowMs: number;
}>();

const { t } = useI18nTyped();
const router = useRouter();
const org = useOrgId();
const judge = useMutation(() => stepJudgementMutation(org.value));

const view = computed(() =>
  props.context && props.context.asked_at !== null ? props.context.next_step : null,
);

const line = computed(() =>
  view.value && props.context ? nextStepLine(t, view.value, props.context, props.nowMs) : null,
);

// A press belongs to one org, issue and step, so a late reply never lands on the step shown after it.
const stepKey = computed(() =>
  view.value ? [org.value, view.value.issue_id, view.value.step.step_id].join("\n") : null,
);
const press = ref<Press | null>(null);
const mine = computed(() => (press.value?.key === stepKey.value ? press.value : null));

const pressed = computed(
  () => mine.value?.state === "done" || line.value?.notHelpful === "pressed",
);
const submitting = computed(() => mine.value?.state === "pending");
const judgeable = computed(() => !!line.value?.notHelpful && !!view.value?.issue_id);

const note = computed<{ kind: StepNote; text: I18nText; failed: boolean } | null>(() => {
  if (mine.value?.failure) return { kind: null, text: mine.value.failure, failed: true };
  if (mine.value?.state === "done")
    return { kind: "judged", text: t("autoobserve.nextStep.judged"), failed: false };
  const shown = line.value;
  return shown?.noteText ? { kind: shown.note, text: shown.noteText, failed: false } : null;
});

const settle = (key: string, state: Press["state"], failure: I18nText | null) => {
  if (press.value?.key === key) press.value = { key, state, failure };
};

const markNotHelpful = () => {
  const shown = view.value;
  const key = stepKey.value;
  if (!shown || !key || pressed.value || submitting.value) return;
  press.value = { key, state: "pending", failure: null };
  judge.mutate(
    { family: "issue", id: shown.issue_id, action: "not_helpful", step_id: shown.step.step_id },
    {
      onSuccess: () => settle(key, "done", null),
      onError: (error) =>
        settle(key, "failed", raw(refusalOf(error)?.message) || t("autoobserve.nextStep.failed")),
    },
  );
};

const go = (link: AutoObserveDeepLink) => void router.push(deepLinkRoute(link, org.value));
</script>
