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

<!-- What must exist before an alert can wake somebody, each step answered from live data. -->
<template>
  <OBanner
    v-if="compact && !expanded && !dismissed"
    variant="info"
    icon="rocket-launch"
    inline-actions
    dense
    data-test="oncall-setup-banner"
  >
    <OTruncatedText
      class="text-text-body text-sm max-lg:line-clamp-2 max-lg:whitespace-normal"
      data-test="oncall-setup-next"
    >
      {{ t("oncall.setupNextStep", { step: nextStep.title }) }}
    </OTruncatedText>

    <template #actions>
      <span class="flex shrink-0 items-center gap-2">
        <OButton
          v-if="canConfigure"
          variant="outline"
          size="xs"
          :data-test="`oncall-setup-bar-cta-${nextStep.key}`"
          @click="nextStep.act()"
        >
          <OIcon :name="nextStep.icon" size="sm" />{{ nextStep.cta }}
        </OButton>
        <OButton
          variant="ghost"
          size="xs"
          icon-right="expand-more"
          data-test="oncall-setup-expand"
          @click="expanded = true"
        >
          {{ t("oncall.setupProgress", { done: doneCount, total: steps.length }) }}
        </OButton>
        <OButton
          v-if="dismissible"
          variant="ghost"
          size="icon-xs"
          icon-left="close"
          :aria-label="t('oncall.setupHideBanner')"
          data-test="oncall-setup-dismiss"
          @click="dismiss"
        >
          <OTooltip :content="t('oncall.setupHideBanner')" />
        </OButton>
      </span>
    </template>
  </OBanner>

  <div
    v-else-if="!compact || !dismissed"
    class="max-lg:px-page-edge mx-auto flex w-full max-w-3xl flex-col gap-4 py-6"
    data-test="oncall-setup-checklist"
  >
    <div class="flex flex-col gap-1">
      <OText variant="page-title" as="h2">{{ t("oncall.setupTitle") }}</OText>
      <OText variant="meta" data-test="oncall-setup-progress">
        {{ t("oncall.setupProgress", { done: doneCount, total: steps.length }) }}
      </OText>
    </div>

    <div class="flex flex-col gap-2">
      <div
        v-for="step in steps"
        :key="step.key"
        class="rounded-surface flex items-center gap-x-3 border px-4"
        :class="[
          step.state === 'active'
            ? 'border-accent bg-surface-accent-hover py-3'
            : 'border-border-default bg-surface-base',
          step.state === 'done' ? 'py-2' : 'py-3',
        ]"
        :data-test="`oncall-setup-step-${step.key}`"
        :data-state="step.state"
      >
        <span
          class="text-2xs flex size-6 shrink-0 items-center justify-center rounded-full border font-semibold"
          :class="BADGE_CLASS[step.state]"
        >
          <OIcon v-if="step.state === 'done'" name="check" size="sm" />
          <template v-else>{{ raw(String(step.name)) }}</template>
        </span>

        <div class="flex min-w-0 flex-1 flex-col">
          <OTruncatedText
            class="text-text-body text-sm font-semibold max-md:line-clamp-2 max-md:whitespace-normal"
          >
            {{ step.state === "done" && step.doneLabel ? step.doneLabel : step.title }}
          </OTruncatedText>
          <OTruncatedText
            v-if="step.state !== 'done' && step.body"
            class="text-text-secondary text-xs max-md:line-clamp-2 max-md:whitespace-normal"
            :data-test="`oncall-setup-body-${step.key}`"
          >
            {{ step.body }}
          </OTruncatedText>
        </div>

        <template v-if="canConfigure">
          <OButton
            v-if="step.state === 'done'"
            variant="outline"
            size="xs"
            icon-left="edit"
            :data-test="`oncall-setup-change-${step.key}`"
            @click="step.review()"
          >
            {{ t("oncall.setupStepChange") }}
          </OButton>
          <template v-else>
            <OButton
              v-if="step.markDone"
              variant="ghost"
              size="sm"
              icon-left="check"
              :data-test="`oncall-setup-mark-done-${step.key}`"
              @click="step.markDone()"
            >
              {{ t("oncall.setupStepMarkDone") }}
            </OButton>
            <OButton
              :variant="step.state === 'active' ? 'primary' : 'outline'"
              size="sm"
              :loading="step.key === 'test' && testing"
              :data-test="`oncall-setup-cta-${step.key}`"
              @click="step.act()"
            >
              <OIcon :name="step.icon" size="sm" />{{ step.cta }}
            </OButton>
          </template>
        </template>
      </div>
    </div>

    <div v-if="compact" class="flex">
      <OButton
        variant="ghost"
        size="sm-action"
        icon-right="expand-less"
        data-test="oncall-setup-collapse"
        @click="expanded = false"
      >
        {{ t("oncall.setupDismiss") }}
      </OButton>
    </div>
  </div>

  <ConfirmDialog
    :model-value="testConfirmOpen"
    :title="t('oncall.testPageConfirmTitle')"
    :message="t('oncall.setupTestConfirm', { team: raw(firstTeamName ?? '') })"
    :ok-label="t('oncall.setupStep5Cta')"
    @update:ok="sendTestPage"
    @update:cancel="testConfirmOpen = false"
  />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useMutation } from "@tanstack/vue-query";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useOnCallPolicyReviewed } from "@/composables/useOnCallPolicyReviewed";
import { useOnCallSetupDismissed } from "@/composables/useOnCallSetupDismissed";
import { testPageMutation } from "@/services/oncall.queries";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { apiErrorMessage, testPageOutcome } from "@/utils/oncall";

const props = withDefaults(
  defineProps<{
    hasTeam: boolean;
    /** Some team's schedule would actually resolve to a person. */
    hasStaffedRotation: boolean;
    /** Some team has an escalation policy; `null` when no read could answer. */
    hasPolicy: boolean | null;
    /** An ownership rule, or an alert bound to a team. */
    hasRouting: boolean;
    /** The org already has pages, so the checklist is one bar over the list rather than the screen. */
    compact?: boolean;
    /** Configuration is an `oncall` write; without it the buttons would 403. */
    canConfigure?: boolean;
    firstTeamId?: string | null;
    firstTeamName?: string | null;
    /** The compact bar carries a close button that hides it for this person in this org. */
    dismissible?: boolean;
  }>(),
  {
    compact: false,
    canConfigure: true,
    firstTeamId: null,
    firstTeamName: null,
    dismissible: false,
  },
);

const emit = defineEmits<{ (e: "create-team"): void }>();

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();

const expanded = ref(false);

const setupDismissed = useOnCallSetupDismissed();
const dismissed = computed(() => props.dismissible && setupDismissed.dismissed.value);
const dismiss = setupDismissed.dismiss;
const policyReviewed = useOnCallPolicyReviewed(() => props.firstTeamId);
const testConfirmOpen = ref(false);
const testing = ref(false);
// The test page leaves no record on the server, so "it landed" is only known for this visit.
const testLanded = ref(false);

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const orgQuery = computed(() => ({ org_identifier: orgId.value }));
const testWrite = useMutation(() => testPageMutation(orgId.value));

type StepState = "done" | "active" | "todo";

const BADGE_CLASS: Record<StepState, string> = {
  done: "border-transparent bg-status-success-bg text-status-success-text",
  active: "border-transparent bg-button-primary text-button-primary-foreground",
  todo: "border-border-subtle bg-surface-subtle text-text-secondary",
};

interface ChecklistStep {
  key: string;
  name: number;
  title: I18nText;
  /** What a done step reads as on its one line, when it has more to say than its title. */
  doneLabel?: I18nText;
  body?: I18nText;
  cta: I18nText;
  /** The step's own verb, so each button reads as the action it takes. */
  icon: IconName;
  done: boolean;
  state: StepState;
  act: () => void;
  /** Look at what was already done, never the create form for it. */
  review: () => void;
  /** Only for a step whose done-ness is the reader's judgement, not a fact the server holds. */
  markDone?: () => void;
}

type StepDef = Omit<ChecklistStep, "name" | "state"> & { unknown?: boolean };

function openTeams() {
  router.push({ name: "onCallTeams", query: orgQuery.value });
}

function openTeamTab(tab: string) {
  if (!props.firstTeamId) return openTeams();
  router.push({
    name: "onCallTeamDetail",
    params: { teamId: props.firstTeamId, tab },
    query: orgQuery.value,
  });
}

function reviewEscalation() {
  policyReviewed.markReviewed();
  openTeamTab("escalation");
}

function openRouting() {
  router.push({ name: "onCallRouting", query: orgQuery.value });
}

function askTestPage() {
  if (!props.firstTeamId) return openTeams();
  testConfirmOpen.value = true;
}

async function sendTestPage() {
  testConfirmOpen.value = false;
  if (!props.firstTeamId) return;
  testing.value = true;
  try {
    const res = await testWrite.mutateAsync({ teamId: props.firstTeamId });
    const outcome = testPageOutcome(res.data, t);
    testLanded.value = testLanded.value || outcome.landed;
    toast({ variant: outcome.variant, message: outcome.message });
  } catch (err: unknown) {
    toast({
      variant: "error",
      message: raw(apiErrorMessage(err)) || t("oncall.testPageFailed"),
    });
  } finally {
    testing.value = false;
  }
}

const steps = computed<ChecklistStep[]>(() => {
  const policyDone = props.hasPolicy === true || policyReviewed.reviewed.value;
  const defs: StepDef[] = [
    {
      key: "team",
      title: t("oncall.setupStep1Title"),
      doneLabel: props.firstTeamName
        ? t("oncall.setupStepDoneNamed", {
            step: t("oncall.setupStep1Title"),
            name: raw(props.firstTeamName),
          })
        : undefined,
      body: t("oncall.setupStep1Body"),
      cta: t("oncall.setupStep1Cta"),
      icon: "group-add" as IconName,
      done: props.hasTeam,
      act: () => emit("create-team"),
      review: openTeams,
    },
    {
      key: "rotation",
      title: t("oncall.setupStep2Title"),
      body: t("oncall.setupStep2Body"),
      cta: t("oncall.setupStep2Cta"),
      icon: "person-add" as IconName,
      done: props.hasStaffedRotation,
      act: () => openTeamTab("schedule"),
      review: () => openTeamTab("schedule"),
    },
    {
      key: "policy",
      title: t("oncall.setupStep3Title"),
      cta: t("oncall.setupStep3Cta"),
      icon: "trending-up" as IconName,
      done: policyDone,
      // Neither read answered, so the step is neither owed nor done: it is left out rather than guessed.
      unknown: !policyDone && props.hasPolicy === null,
      act: reviewEscalation,
      review: reviewEscalation,
      markDone: policyReviewed.markReviewed,
    },
    {
      key: "routing",
      title: t("oncall.setupStep4Title"),
      body: t("oncall.setupStep4Body"),
      cta: t("oncall.setupStep4Cta"),
      icon: "alt-route" as IconName,
      done: props.hasRouting,
      act: openRouting,
      review: openRouting,
    },
    {
      key: "test",
      title: t("oncall.setupStep5Title"),
      body: t("oncall.setupStep5Body"),
      cta: t("oncall.setupStep5Cta"),
      icon: "campaign" as IconName,
      done: testLanded.value,
      act: askTestPage,
      review: askTestPage,
    },
  ];

  const shown = defs.filter((def) => !def.unknown);
  const firstUndone = shown.findIndex((def) => !def.done);

  return shown.map((def, index) => ({
    ...def,
    markDone: def.done ? undefined : def.markDone,
    name: index + 1,
    state: (def.done ? "done" : index === firstUndone ? "active" : "todo") as StepState,
  }));
});

const doneCount = computed(() => steps.value.filter((step) => step.done).length);

const nextStep = computed<ChecklistStep>(
  () => steps.value.find((step) => step.state === "active") ?? (steps.value[0] as ChecklistStep),
);
</script>
