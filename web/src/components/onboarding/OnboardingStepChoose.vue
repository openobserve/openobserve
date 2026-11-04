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
    class="grid h-full grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] max-md:h-auto max-md:min-h-full max-md:grid-cols-1 md:grid-rows-1"
    data-test="onboarding-step-choose"
  >
    <section class="flex px-13 pt-8 max-md:px-4 max-md:pt-6 md:overflow-y-auto md:max-lg:px-8">
      <div class="mx-auto flex w-full max-w-176 flex-col">
        <!-- Same height as the Back row on the other steps (a small button is 2.125rem), so the title never moves. -->
        <div class="mb-2 min-h-8.5" aria-hidden="true"></div>
        <h1 class="text-text-heading text-2xl leading-tight font-semibold text-balance">
          {{ t("onboarding.chooseTitle") }}
        </h1>

        <ul class="mt-6 grid gap-2">
          <li v-for="choice in choices" :key="choice.id">
            <OnboardingChoiceButton
              :icon="choice.icon"
              :name="choice.name"
              :description="choice.description"
              :previewed="previewId === choice.id"
              :data-test="`onboarding-step-choose-choice-${choice.id}`"
              @mouseenter="previewId = choice.id"
              @focus="previewId = choice.id"
              @click="emit('pick', choice.id)"
            />
          </li>
        </ul>

        <section
          class="border-border-subtle mt-6 border-t pt-4"
          aria-labelledby="onboarding-step-choose-others-title"
        >
          <h2
            id="onboarding-step-choose-others-title"
            class="text-text-secondary text-compact font-semibold"
          >
            {{ t("onboarding.othersTitle") }}
          </h2>
          <!-- One row of three on a wide screen, so the step fits without scrolling. -->
          <div class="mt-2.5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-2">
            <OnboardingChoiceButton
              v-for="other in others"
              :key="other.id"
              quiet
              :icon="other.icon"
              :name="other.name"
              :description="other.description"
              :previewed="previewId === other.id"
              :data-test="`onboarding-step-choose-other-${other.id}`"
              @mouseenter="other.gets && (previewId = other.id)"
              @focus="other.gets && (previewId = other.id)"
              @click="openOther(other)"
            />
          </div>
        </section>

        <OnboardingStepFooter />
      </div>
    </section>

    <aside class="max-md:hidden" :aria-label="t('onboarding.whatYouGet')">
      <!-- Pinned at the top of the scroll area: the viewport minus the app header, the content card's
           bottom gap (0.5rem) and its top and bottom border hairlines. -->
      <!-- eslint-disable-next-line local/no-hardcoded-px -- the card's two hairline borders -->
      <div class="sticky top-0 h-[calc(100dvh-var(--navbar-height)-0.5rem-2px)]">
        <OnboardingPreview :preview="preview" :example="preview.example" :reserve="reserve" />
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";

import {
  prefillFirstSource,
  readPrefill,
  type FirstSourceId,
} from "@/components/login/firstSourceOptions";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import { useI18nTyped, type I18nText } from "@/types/i18n";

import OnboardingChoiceButton from "./OnboardingChoiceButton.vue";
import OnboardingPreview from "./OnboardingPreview.vue";
import type { OnboardingExampleKind } from "./examples/onboardingExamples";
import OnboardingStepFooter from "./OnboardingStepFooter.vue";
import {
  CODING_AGENTS,
  type OnboardingChoice,
  type OnboardingChoiceId,
  type OnboardingSignal,
} from "./onboardingChoices";

const props = defineProps<{
  choices: OnboardingChoice[];
  /** Admins and root can invite; the view opens the invite dialog in place. */
  canInvite?: boolean;
}>();
const emit = defineEmits<{
  pick: [id: OnboardingChoiceId];
  // Exits that leave onboarding; the view routes them, and records a data-source pick when there is one.
  leave: [exit: { id: string; route: string; firstSource?: FirstSourceId }];
  invite: [];
  agent: [];
}>();

const { t } = useI18nTyped();
const store = useStore();

// The signup link or docs page the user came from picks the choice the panel opens on.
const PREFILL_CHOICE: Partial<Record<FirstSourceId, OnboardingChoiceId>> = {
  kubernetes: "infrastructure",
  linux: "infrastructure",
  windows: "infrastructure",
  cloud: "infrastructure",
  otel: "backend",
  rum: "frontend",
  http: "logs",
  webserver: "logs",
  llm: "llm",
};
const prefill = prefillFirstSource(readPrefill());
const previewId = ref<string>((prefill && PREFILL_CHOICE[prefill]) || props.choices[0].id);

interface OtherWay {
  id: string;
  icon: IconName;
  name: I18nText;
  description: I18nText;
  /** Where the option leaves to; without one it opens in place. */
  route?: string;
  gets?: I18nText;
  signals?: OnboardingSignal[];
  example?: OnboardingExampleKind;
}

const others = computed<OtherWay[]>(() => [
  {
    id: "agent",
    icon: "terminal",
    name: t("onboarding.others.agent.name"),
    description: t("onboarding.others.agent.description", CODING_AGENTS),
    gets: t("onboarding.others.agent.gets"),
    signals: ["logs", "metrics", "traces"],
    example: "agent",
  },
  ...(store.state.zoConfig?.synthetics_enabled === true
    ? [
        {
          id: "synthetics",
          icon: "public" as const,
          name: t("onboarding.others.synthetics.name"),
          description: t("onboarding.others.synthetics.description"),
          route: "synthetics",
          gets: t("onboarding.others.synthetics.gets"),
          signals: ["uptime", "latency", "certificates"] satisfies OnboardingSignal[],
          example: "synthetics" as const,
        },
      ]
    : []),
  ...(props.canInvite
    ? [
        {
          id: "invite",
          icon: "person-add" as const,
          name: t("onboarding.others.invite.name"),
          description: t("onboarding.others.invite.description"),
        },
      ]
    : []),
]);

const openOther = (other: OtherWay) => {
  if (other.route) emit("leave", { id: other.id, route: other.route });
  else if (other.id === "agent") emit("agent");
  else emit("invite");
};

// Every text the panel can show on this step, so its text area never changes height on hover.
const reserve = computed(() => [
  ...props.choices.map((c) => ({
    eyebrow: t("onboarding.whatYouGet"),
    title: c.name,
    text: c.gets,
    signals: c.signals,
  })),
  ...others.value.flatMap((o) =>
    o.gets
      ? [{ eyebrow: t("onboarding.whatYouGet"), title: o.name, text: o.gets, signals: o.signals }]
      : [],
  ),
]);

const preview = computed(() => {
  const other = others.value.find((o) => o.id === previewId.value && o.gets);
  const choice = props.choices.find((c) => c.id === previewId.value) ?? props.choices[0];
  return {
    eyebrow: t("onboarding.whatYouGet"),
    title: other?.name ?? choice.name,
    text: other?.gets ?? choice.gets,
    signals: other?.signals ?? choice.signals,
    example: other?.example ?? choice.id,
  };
});
</script>
