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
  nothing CAN. Once the first step passes it collapses to one banner line, so a
  working org is never blocked behind a wizard.
-->
<template>
  <OBanner
    v-if="collapsed"
    variant="info"
    icon="info"
    inline-actions
    data-test="oncall-setup-banner"
  >
    {{ t("oncall.setupProgress", { done: doneCount, total: steps.length }) }}
    <template #actions>
      <OButton
        variant="outline"
        size="sm-action"
        data-test="oncall-setup-expand"
        @click="expanded = true"
      >
        {{ t("oncall.setupFinish") }}
      </OButton>
    </template>
  </OBanner>

  <div v-else class="mx-auto flex max-w-3xl flex-col gap-4 py-6" data-test="oncall-setup-checklist">
    <div class="flex flex-col gap-1">
      <OText variant="panel-title">{{ t("oncall.setupTitle") }}</OText>
      <OText variant="meta">{{ t("oncall.setupSubtitle") }}</OText>
    </div>

    <OStepper v-model="activeStep" orientation="vertical" expanded :animated="false">
      <OStep
        v-for="step in steps"
        :key="step.key"
        :name="step.name"
        :title="step.title"
        :icon="step.icon"
        :done="step.done"
      >
        <div class="flex flex-col items-start gap-2 pb-2">
          <OText variant="meta">{{ step.body }}</OText>
          <OTag v-if="step.done" variant="success-soft" size="sm">
            {{ t("oncall.setupStepDone") }}
          </OTag>
          <OButton
            v-else-if="canConfigure"
            variant="outline"
            size="sm-action"
            :data-test="`oncall-setup-cta-${step.key}`"
            @click="step.act()"
          >
            {{ step.cta }}
          </OButton>
        </div>
      </OStep>
    </OStepper>

    <div v-if="doneCount > 0" class="flex">
      <OButton
        variant="ghost"
        size="sm-action"
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

import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OStep from "@/lib/navigation/Stepper/OStep.vue";
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import type { I18nText } from "@/types/i18n";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    /** Step 1 — a team is who gets paged. */
    hasTeam: boolean;
    /** Step 2 — some team's schedule would actually resolve to a person. */
    hasStaffedRotation: boolean;
    /** Step 3 — an ownership rule, or an alert bound to a team. */
    hasRouting: boolean;
    /** Configuration is an `oncall` write; without it the CTAs would 403. */
    canConfigure?: boolean;
    /** Which team's schedule the second step opens. */
    firstTeamId?: string | null;
  }>(),
  { canConfigure: true, firstTeamId: null },
);

const emit = defineEmits<{ (e: "create-team"): void }>();

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();

const expanded = ref(false);

const orgQuery = computed(() => ({
  org_identifier: store.state.selectedOrganization?.identifier,
}));

interface ChecklistStep {
  key: string;
  name: number;
  title: I18nText;
  body: I18nText;
  cta: I18nText;
  icon: string;
  done: boolean;
  act: () => void;
}

const steps = computed<ChecklistStep[]>(() => [
  {
    key: "team",
    name: 1,
    title: t("oncall.setupStep1Title"),
    body: t("oncall.setupStep1Body"),
    cta: t("oncall.setupStep1Cta"),
    icon: "group-work",
    done: props.hasTeam,
    act: () => emit("create-team"),
  },
  {
    key: "rotation",
    name: 2,
    title: t("oncall.setupStep2Title"),
    body: t("oncall.setupStep2Body"),
    cta: t("oncall.setupStep2Cta"),
    icon: "schedule",
    done: props.hasStaffedRotation,
    act: () => {
      if (props.firstTeamId) {
        router.push({
          name: "onCallTeamDetail",
          params: { teamId: props.firstTeamId, tab: "schedule" },
          query: orgQuery.value,
        });
        return;
      }
      router.push({ name: "onCallTeams", query: orgQuery.value });
    },
  },
  {
    key: "routing",
    name: 3,
    title: t("oncall.setupStep3Title"),
    body: t("oncall.setupStep3Body"),
    cta: t("oncall.setupStep3Cta"),
    icon: "account-tree",
    done: props.hasRouting,
    act: () => router.push({ name: "onCallRouting", query: orgQuery.value }),
  },
]);

const doneCount = computed(() => steps.value.filter((s) => s.done).length);

/// The first thing still missing — what the reader has to do next.
const activeStep = computed({
  get: () => steps.value.find((s) => !s.done)?.name ?? steps.value.length,
  set: () => {
    /* completion is derived from data, so the header is a progress display */
  },
});

/// Collapsed once the org is past step one: at that point on-call half works,
/// and a wizard covering a live triage list would be the worse failure.
const collapsed = computed(() => !expanded.value && doneCount.value > 0);
</script>
