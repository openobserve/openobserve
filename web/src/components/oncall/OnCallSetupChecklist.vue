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

<!--
  Three things must exist before an alert can wake somebody, and each one is
  answered from live data rather than from a static list.

  It is NOT gated on "no teams at all": an org with a team, no rotation and no
  ownership rule gets the calm "nothing is paging" empty state today, which is
  the most dangerous sentence in the product — nothing is paging because
  nothing CAN.

  Two shapes, and which one shows is the page's call, not this component's.
  On an org with no pages at all there is nothing to triage, so the checklist
  IS the screen: full width steps, in order, each one unlocking the next. Once
  pages exist, the same state collapses to the one line the reader has not done
  yet — the same collapsed shape the team's attention banner uses — because a
  wizard sitting on top of a live triage list is the worse failure.
-->
<template>
  <!-- Compact: one line, the next undone step, and the button that does it.
       Opening it gives back the full checklist without leaving the page. -->
  <OBanner
    v-if="compact && !expanded"
    variant="info"
    icon="rocket-launch"
    inline-actions
    dense
    data-test="oncall-setup-banner"
  >
    <span class="flex min-w-0 items-center gap-x-3">
      <span class="text-text-secondary text-2xs shrink-0 tracking-wide uppercase">
        {{ t("oncall.setupFinish") }}
      </span>
      <span class="text-text-body min-w-0 truncate text-sm" data-test="oncall-setup-next">
        {{ t("oncall.setupNextStep", { step: nextStep.title }) }}
      </span>
    </span>

    <template #actions>
      <span class="flex shrink-0 items-center gap-2">
        <OButton
          v-if="canConfigure"
          variant="outline"
          size="xs"
          :data-test="`oncall-setup-bar-cta-${nextStep.key}`"
          @click="nextStep.act()"
        >
          {{ nextStep.cta }}
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
      </span>
    </template>
  </OBanner>

  <div
    v-else
    class="mx-auto flex w-full max-w-3xl flex-col gap-5 py-6"
    data-test="oncall-setup-checklist"
  >
    <div class="flex flex-col gap-1">
      <OText variant="page-title" as="h2">{{ t("oncall.setupTitle") }}</OText>
      <OText variant="meta">{{ t("oncall.setupSubtitle") }}</OText>
    </div>

    <!-- How far along, as a number and as a length. The steps below say which
         one is next; this says how much of it is left. -->
    <div class="flex items-center gap-3" data-test="oncall-setup-progress">
      <OProgressBar :value="doneCount / steps.length" size="xs" class="max-w-64 flex-1" />
      <OText variant="meta">
        {{ t("oncall.setupProgress", { done: doneCount, total: steps.length }) }}
      </OText>
    </div>

    <div class="flex flex-col gap-3">
      <!-- One card per step, and exactly one of them is actionable: the steps
           genuinely depend on each other, so a locked step says what it is
           waiting for rather than offering a button that would dead-end. -->
      <div
        v-for="step in steps"
        :key="step.key"
        class="rounded-surface flex flex-wrap items-center gap-x-4 gap-y-3 border px-4 py-3"
        :class="
          step.state === 'active'
            ? 'border-accent bg-surface-accent-hover'
            : 'border-border-default bg-surface-base'
        "
        :data-test="`oncall-setup-step-${step.key}`"
        :data-state="step.state"
      >
        <span
          class="text-2xs flex size-7 shrink-0 items-center justify-center rounded-full border font-semibold"
          :class="BADGE_CLASS[step.state]"
        >
          <OIcon v-if="step.state === 'done'" name="task-alt" size="sm" />
          <template v-else>{{ raw(String(step.name)) }}</template>
        </span>

        <div class="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
          <OText variant="body-strong" :class="step.state === 'locked' ? 'text-text-muted' : ''">
            {{ step.title }}
          </OText>
          <p
            class="text-sm"
            :class="step.state === 'locked' ? 'text-text-muted' : 'text-text-secondary'"
          >
            {{ step.body }}
          </p>
        </div>

        <span class="flex shrink-0 items-center gap-2">
          <template v-if="step.state === 'done'">
            <OTag variant="success-soft" size="sm">{{ t("oncall.setupStepDone") }}</OTag>
            <OButton
              v-if="canConfigure"
              variant="ghost"
              size="xs"
              :data-test="`oncall-setup-change-${step.key}`"
              @click="step.review()"
            >
              {{ t("oncall.setupStepChange") }}
            </OButton>
          </template>

          <!-- Only the step that is actually next carries a loud button. -->
          <OButton
            v-else-if="step.state === 'active' && canConfigure"
            variant="primary"
            size="sm-action"
            :data-test="`oncall-setup-cta-${step.key}`"
            @click="step.act()"
          >
            {{ step.cta }}
          </OButton>

          <!-- What it is waiting for, in the words of the step above it. -->
          <OTag
            v-else-if="step.state === 'locked'"
            variant="default-soft"
            size="sm"
            :data-test="`oncall-setup-locked-${step.key}`"
          >
            {{ step.lockedLabel }}
          </OTag>
        </span>
      </div>
    </div>

    <!-- Only offered when there is something underneath worth getting back to. -->
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
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    /** Step 1 — a team is who gets paged. */
    hasTeam: boolean;
    /** Step 2 — some team's schedule would actually resolve to a person. */
    hasStaffedRotation: boolean;
    /** Step 3 — an ownership rule, or an alert bound to a team. */
    hasRouting: boolean;
    /**
     * The org already has pages, so this is not the only thing on the screen.
     *
     * Set by the page rather than inferred from progress: half-finished setup
     * on an org with nothing to triage still deserves the whole checklist, and
     * finished-looking setup on an org mid-incident does not deserve a wizard.
     */
    compact?: boolean;
    /** Configuration is an `oncall` write; without it the CTAs would 403. */
    canConfigure?: boolean;
    /** Which team's schedule the second step opens. */
    firstTeamId?: string | null;
  }>(),
  { compact: false, canConfigure: true, firstTeamId: null },
);

const emit = defineEmits<{ (e: "create-team"): void }>();

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();

const expanded = ref(false);

const orgQuery = computed(() => ({
  org_identifier: store.state.selectedOrganization?.identifier,
}));

/// `done` is answered from data; `active` is the first one that is not, and
/// everything after it is `locked` — the steps build on each other, so there is
/// never more than one thing to do.
type StepState = "done" | "active" | "locked";

const BADGE_CLASS: Record<StepState, string> = {
  done: "border-transparent bg-status-success-bg text-status-success-text",
  active: "border-transparent bg-button-primary text-button-primary-foreground",
  locked: "border-border-subtle bg-surface-subtle text-text-muted",
};

interface ChecklistStep {
  key: string;
  name: number;
  title: I18nText;
  body: I18nText;
  cta: I18nText;
  /** What this step is waiting on, shown in place of its button while locked. */
  lockedLabel: I18nText;
  done: boolean;
  state: StepState;
  /** Do the step. */
  act: () => void;
  /** Look at what was already done — never the create form for it. */
  review: () => void;
}

function openTeams() {
  router.push({ name: "onCallTeams", query: orgQuery.value });
}

function openSchedule() {
  if (props.firstTeamId) {
    router.push({
      name: "onCallTeamDetail",
      params: { teamId: props.firstTeamId, tab: "schedule" },
      query: orgQuery.value,
    });
    return;
  }
  openTeams();
}

function openRouting() {
  router.push({ name: "onCallRouting", query: orgQuery.value });
}

const steps = computed<ChecklistStep[]>(() => {
  const defs = [
    {
      key: "team",
      title: t("oncall.setupStep1Title"),
      body: t("oncall.setupStep1Body"),
      cta: t("oncall.setupStep1Cta"),
      lockedLabel: t("oncall.setupNeedsTeam"),
      done: props.hasTeam,
      act: () => emit("create-team"),
      review: openTeams,
    },
    {
      key: "rotation",
      title: t("oncall.setupStep2Title"),
      body: t("oncall.setupStep2Body"),
      cta: t("oncall.setupStep2Cta"),
      lockedLabel: t("oncall.setupNeedsTeam"),
      done: props.hasStaffedRotation,
      act: openSchedule,
      review: openSchedule,
    },
    {
      key: "routing",
      title: t("oncall.setupStep3Title"),
      body: t("oncall.setupStep3Body"),
      cta: t("oncall.setupStep3Cta"),
      lockedLabel: t("oncall.setupNeedsRotation"),
      done: props.hasRouting,
      act: openRouting,
      review: openRouting,
    },
  ];

  // The first undone step is the one to do; the rest are waiting on it. A step
  // that is done stays done even when an earlier one is not — the data said so,
  // and marking it locked would be the UI arguing with the server.
  const firstUndone = defs.findIndex((def) => !def.done);

  return defs.map((def, index) => ({
    ...def,
    name: index + 1,
    state: def.done ? "done" : index === firstUndone ? "active" : "locked",
  }));
});

const doneCount = computed(() => steps.value.filter((step) => step.done).length);

/// What the collapsed line is about. The component is only rendered while
/// something is undone, so the fallback is never reached in practice.
const nextStep = computed<ChecklistStep>(
  () => steps.value.find((step) => step.state === "active") ?? (steps.value[0] as ChecklistStep),
);
</script>
