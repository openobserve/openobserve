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
  <OContent y class="min-h-0 flex-1 overflow-auto" data-test="autoobserve-how">
    <div class="mx-auto flex w-full max-w-7xl flex-col gap-10 pb-10">
      <section class="flex flex-col gap-6 pt-4" data-test="autoobserve-how-hero">
        <div class="flex flex-col gap-2 text-center">
          <div class="flex items-center justify-center gap-2">
            <OText variant="label">{{ t("autoobserve.howItWorks.hero.eyebrow") }}</OText>
            <OTag
              variant="purple-soft"
              size="xs"
              :label="t('autoobserve.howItWorks.conceptPreview')"
              data-test="autoobserve-how-concept-tag"
            />
          </div>
          <OText
            as="h2"
            variant="body-strong"
            class="text-text-heading mx-auto max-w-4xl text-3xl! leading-tight"
          >
            {{ t("autoobserve.howItWorks.hero.promise") }}
          </OText>
        </div>
        <div class="flex justify-center">
          <OTag
            variant="blue-soft"
            size="sm"
            :label="t('autoobserve.howItWorks.exampleWeek')"
            data-test="autoobserve-how-hero-example"
          />
        </div>
        <div class="grid grid-cols-2 gap-4 max-md:grid-cols-1">
          <OCard variant="outlined" data-test="autoobserve-how-without">
            <OCardSection role="header">
              <OIcon name="cancel" size="sm" class="text-text-muted" />
              <OText variant="panel-title">{{
                t("autoobserve.howItWorks.hero.withoutTitle")
              }}</OText>
            </OCardSection>
            <OCardSection role="body" class="flex flex-col gap-3 pt-0">
              <div class="flex items-baseline gap-2">
                <span class="text-text-secondary text-4xl font-semibold">{{ firingsLabel }}</span>
                <OText variant="meta">{{ t("autoobserve.howItWorks.hero.withoutCount") }}</OText>
              </div>
              <ul class="flex flex-col gap-2">
                <li v-for="key in WITHOUT" :key="key" class="flex items-start gap-2">
                  <OIcon name="remove" size="sm" class="text-text-muted mt-0.5 shrink-0" />
                  <OText variant="body">{{ t(key) }}</OText>
                </li>
              </ul>
            </OCardSection>
          </OCard>
          <OCard variant="outlined" class="border-accent" data-test="autoobserve-how-with">
            <OCardSection role="header">
              <OIcon name="check-circle" size="sm" class="text-icon-chip-success-text" />
              <OText variant="panel-title">{{ t("autoobserve.howItWorks.hero.withTitle") }}</OText>
            </OCardSection>
            <OCardSection role="body" class="flex flex-col gap-3 pt-0">
              <div class="flex items-baseline gap-2">
                <span class="text-accent text-4xl font-semibold">{{ notifications }}</span>
                <OText variant="meta">{{ t("autoobserve.howItWorks.hero.withCount") }}</OText>
              </div>
              <ul class="flex flex-col gap-2">
                <li v-for="key in WITH" :key="key" class="flex items-start gap-2">
                  <OIcon
                    name="check"
                    size="sm"
                    class="text-icon-chip-success-text mt-0.5 shrink-0"
                  />
                  <OText variant="body">{{ t(key) }}</OText>
                </li>
              </ul>
            </OCardSection>
          </OCard>
        </div>
      </section>

      <AutoObserveHowItWorksMachine
        v-model:step="step"
        v-model:overview="overview"
        @go="(target, focusId) => emit('go', target, focusId)"
      />

      <section class="flex flex-col gap-4" data-test="autoobserve-how-trust">
        <OText as="h3" variant="body-strong" class="text-text-heading text-xl!">{{
          t("autoobserve.howItWorks.trust.title")
        }}</OText>
        <div class="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
          <OCard
            v-for="card in TRUST"
            :key="card.key"
            variant="outlined"
            :data-test="`autoobserve-how-trust-${card.key}`"
          >
            <OCardSection role="body" class="flex h-full flex-col gap-3">
              <div
                class="bg-icon-chip-primary-bg text-icon-chip-primary-text rounded-default flex size-9 items-center justify-center"
              >
                <OIcon :name="card.icon" size="sm" />
              </div>
              <OText variant="card-title">{{ t(card.title) }}</OText>
              <OText variant="body" class="flex-1">{{ t(card.body) }}</OText>
              <OButton
                variant="ghost-primary"
                size="sm"
                class="self-start"
                :data-test="`autoobserve-how-trust-${card.key}-link`"
                @click="emit('go', card.tab)"
              >
                {{ t("autoobserve.howItWorks.seeIn", { tab: t(TAB_LABEL[card.tab]) }) }}
              </OButton>
            </OCardSection>
          </OCard>
        </div>
      </section>

      <section class="flex flex-col gap-4" data-test="autoobserve-how-roadmap">
        <OText as="h3" variant="body-strong" class="text-text-heading text-xl!">{{
          t("autoobserve.howItWorks.roadmap.title")
        }}</OText>
        <div class="grid grid-cols-2 gap-4 max-md:grid-cols-1">
          <OCard variant="outlined">
            <OCardSection role="header">
              <OText variant="panel-title">{{ t("autoobserve.howItWorks.roadmap.phase1") }}</OText>
              <OTag
                class="ms-auto"
                variant="success-soft"
                size="xs"
                :label="t('autoobserve.howItWorks.roadmap.next')"
              />
            </OCardSection>
            <OCardSection role="body" class="flex flex-col gap-3 pt-0">
              <div class="flex flex-wrap gap-2">
                <OTag
                  v-for="key in PHASE1"
                  :key="key"
                  variant="blue-soft"
                  size="sm"
                  :label="t(key)"
                />
              </div>
              <OText variant="body">{{ t("autoobserve.howItWorks.roadmap.phase1Body") }}</OText>
            </OCardSection>
          </OCard>
          <OCard variant="outlined">
            <OCardSection role="header">
              <OText variant="panel-title">{{ t("autoobserve.howItWorks.roadmap.phase2") }}</OText>
              <OTag
                class="ms-auto"
                variant="purple-soft"
                size="xs"
                :label="t('autoobserve.howItWorks.roadmap.afterThat')"
              />
            </OCardSection>
            <OCardSection role="body" class="flex flex-col gap-3 pt-0">
              <div class="flex flex-wrap gap-2">
                <OTag
                  v-for="key in PHASE2"
                  :key="key"
                  variant="default-soft"
                  size="sm"
                  :label="t(key)"
                />
              </div>
              <OText variant="body">{{ t("autoobserve.howItWorks.roadmap.phase2Body") }}</OText>
            </OCardSection>
          </OCard>
        </div>
      </section>

      <section class="flex flex-col gap-4" data-test="autoobserve-how-explain">
        <OText as="h3" variant="body-strong" class="text-text-heading text-xl!">{{
          t("autoobserve.howItWorks.explain.title")
        }}</OText>
        <div class="grid grid-cols-2 gap-x-10 gap-y-6 max-md:grid-cols-1">
          <div v-for="item in EXPLAIN" :key="item.title" class="flex flex-col gap-2">
            <OText variant="card-title">{{ t(item.title) }}</OText>
            <OText variant="body" class="leading-relaxed">{{ t(item.body) }}</OText>
          </div>
        </div>
      </section>
    </div>
  </OContent>
</template>

<script setup lang="ts">
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import OContent from "@/lib/core/Content/OContent.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import AutoObserveHowItWorksMachine from "./AutoObserveHowItWorksMachine.vue";
import { BUDGETS, FUNNEL } from "./fixtures";

const emit = defineEmits<{ go: [tab: string, focusId?: string] }>();
const step = defineModel<number>("step", { default: 0 });
const overview = defineModel<boolean>("overview", { default: false });

const { t } = useI18nTyped();

const TAB_LABEL: Record<string, I18nKey> = {
  coverage: "autoobserve.tabs.coverage",
  activity: "autoobserve.tabs.activity",
  issues: "autoobserve.tabs.issues",
  policy: "autoobserve.tabs.policy",
};

const WITHOUT: I18nKey[] = [
  "autoobserve.howItWorks.hero.without1",
  "autoobserve.howItWorks.hero.without2",
  "autoobserve.howItWorks.hero.without3",
];
const WITH: I18nKey[] = [
  "autoobserve.howItWorks.hero.with1",
  "autoobserve.howItWorks.hero.with2",
  "autoobserve.howItWorks.hero.with3",
];

const TRUST: { key: string; icon: IconName; title: I18nKey; body: I18nKey; tab: string }[] = [
  {
    key: "silence",
    icon: "radar",
    title: "autoobserve.howItWorks.trust.silenceTitle",
    body: "autoobserve.howItWorks.trust.silenceBody",
    tab: "coverage",
  },
  {
    key: "undo",
    icon: "undo",
    title: "autoobserve.howItWorks.trust.undoTitle",
    body: "autoobserve.howItWorks.trust.undoBody",
    tab: "activity",
  },
  {
    key: "level",
    icon: "tune",
    title: "autoobserve.howItWorks.trust.levelTitle",
    body: "autoobserve.howItWorks.trust.levelBody",
    tab: "policy",
  },
];

const PHASE1: I18nKey[] = [
  "autoobserve.loops.coverage",
  "autoobserve.loops.calibration",
  "autoobserve.loops.investigation",
];
const PHASE2: I18nKey[] = [
  "autoobserve.howItWorks.roadmap.action",
  "autoobserve.howItWorks.roadmap.outcome",
];

const EXPLAIN: { title: I18nKey; body: I18nKey }[] = [
  {
    title: "autoobserve.howItWorks.explain.sendTitle",
    body: "autoobserve.howItWorks.explain.sendBody",
  },
  {
    title: "autoobserve.howItWorks.explain.spamTitle",
    body: "autoobserve.howItWorks.explain.spamBody",
  },
  {
    title: "autoobserve.howItWorks.explain.wrongTitle",
    body: "autoobserve.howItWorks.explain.wrongBody",
  },
  {
    title: "autoobserve.howItWorks.explain.changesTitle",
    body: "autoobserve.howItWorks.explain.changesBody",
  },
];

const firingsLabel = FUNNEL.incident.firings.toLocaleString();
const notifications = (
  BUDGETS.reduce((sum, b) => sum + b.used.incident, 0) + FUNNEL.incident.exemptDeliveries
).toLocaleString();
</script>
