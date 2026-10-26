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

<!-- The "which one?" page: guide tiles in groups, with a search box when there are many. -->
<template>
  <div
    class="grid min-h-full grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] max-md:grid-cols-1"
    data-test="onboarding-step-which"
  >
    <section class="flex px-13 pt-8 pb-5 max-md:px-4 max-md:pt-6 md:max-lg:px-8">
      <div class="mx-auto flex w-full max-w-176 flex-col">
        <div class="mb-2 flex min-h-8.5 items-center gap-3">
          <OButton
            variant="ghost-muted"
            size="sm"
            icon-left="arrow-back"
            data-test="onboarding-step-which-back"
            @click="emit('back')"
          >
            {{ t("onboarding.back") }}
          </OButton>
          <span class="text-text-secondary text-compact">{{ choice.name }} / {{ row.name }}</span>
        </div>
        <h1 class="text-text-heading text-2xl leading-tight font-semibold text-balance">
          {{ row.question }}
        </h1>

        <OSearchInput
          v-if="total > 8"
          v-model="query"
          class="mt-5"
          size="md"
          :placeholder="t('onboarding.searchGuides', total)"
          data-test="onboarding-step-which-search"
        />

        <div v-if="!empty" class="mt-6 grid gap-6">
          <section v-for="group in shown" :key="group.gi" data-test="onboarding-step-which-group">
            <h2 v-if="group.heading" class="text-text-secondary text-compact mb-2 font-semibold">
              {{ group.heading }}
            </h2>
            <!-- One full-width row each, as on steps 1 and 2, with each source's logo. -->
            <div class="grid gap-2">
              <OnboardingChoiceButton
                v-for="g in group.guides"
                :key="g.id"
                :icon="row.icon"
                :logo="guideLogo(g)"
                :name="g.name"
                :description="g.about"
                :data-test="`onboarding-step-which-guide-${g.id}`"
                @click="emit('open', { row, guide: g })"
              />
            </div>
            <OButton
              v-if="group.extra"
              variant="ghost-primary"
              size="sm"
              class="mt-2"
              data-test="onboarding-step-which-show-more"
              @click="expanded.add(group.gi)"
            >
              {{ t("onboarding.showMore", group.extra) }}
            </OButton>
          </section>
          <OButton
            v-if="row.agent"
            variant="ghost-primary"
            size="xs"
            icon-left="smart-toy"
            class="-ms-2.5 self-start"
            data-test="onboarding-step-which-agent"
            @click="emit('agent')"
          >
            {{ t("onboarding.agentLink") }}
          </OButton>
        </div>

        <div v-else class="mt-6" data-test="onboarding-step-which-empty">
          <p class="text-text-heading text-sm font-medium">
            {{ t("onboarding.noMatch", { query: raw(query.trim()) }) }}
          </p>
          <template v-if="hits.length">
            <p class="text-text-secondary text-compact mt-2">
              {{ t("onboarding.foundElsewhere") }}
            </p>
            <ul class="mt-1 grid gap-1">
              <li v-for="h in hits" :key="`${h.choice.id}/${h.row.id}/${h.guide.id}`">
                <OButton
                  variant="ghost-primary"
                  size="sm"
                  data-test="onboarding-step-which-hit"
                  @click="emit('open', { row: h.row, guide: h.guide, choice: h.choice.id })"
                >
                  {{ h.guide.name }}
                </OButton>
                <span
                  class="text-text-secondary text-compact"
                  data-test="onboarding-step-which-hit-where"
                  >{{ t("onboarding.inChoice", { choice: h.choice.name }) }}</span
                >
              </li>
            </ul>
          </template>
          <i18n-t
            v-else-if="curlRow"
            keypath="onboarding.tryShorter"
            tag="p"
            class="text-text-secondary text-compact mt-2"
          >
            <template #link>
              <OButton
                variant="ghost-primary"
                size="sm"
                data-test="onboarding-step-which-curl"
                @click="emit('open', { row: curlRow, guide: curlGuide, choice: 'logs' })"
              >
                {{ t("onboarding.sendOverHttp") }}
              </OButton>
            </template>
          </i18n-t>
          <OButton
            variant="outline"
            size="sm"
            class="mt-3"
            data-test="onboarding-step-which-clear"
            @click="query = ''"
          >
            {{ t("onboarding.clearSearch") }}
          </OButton>
        </div>
      </div>
    </section>

    <aside class="max-md:hidden" :aria-label="t('onboarding.whatYouGet')">
      <!-- Pinned at the top of the scroll area: the viewport minus the app header, the content card's
           bottom gap (0.5rem) and its top and bottom border hairlines. -->
      <!-- eslint-disable-next-line local/no-hardcoded-px -- the card's two hairline borders -->
      <div class="sticky top-0 h-[calc(100dvh-var(--navbar-height)-0.5rem-2px)]">
        <OnboardingPreview :preview="{ eyebrow: choice.name, title: row.name, text: row.about }" />
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import { raw, useI18nTyped } from "@/types/i18n";

import OnboardingChoiceButton from "./OnboardingChoiceButton.vue";
import OnboardingPreview from "./OnboardingPreview.vue";
import {
  findGuides,
  guideLogo,
  type OnboardingChoice,
  type OnboardingChoiceId,
  type OnboardingGuide,
  type OnboardingRow,
} from "./onboardingChoices";

const props = defineProps<{
  choices: OnboardingChoice[];
  choice: OnboardingChoice;
  row: OnboardingRow;
}>();
const emit = defineEmits<{
  open: [payload: { row: OnboardingRow; guide?: OnboardingGuide; choice?: OnboardingChoiceId }];
  back: [];
  agent: [];
}>();

const { t } = useI18nTyped();

const query = ref("");
// Groups the user has expanded, by index. Reset when the row changes.
const expanded = ref(new Set<number>());
watch(
  () => props.row.id,
  () => {
    query.value = "";
    expanded.value = new Set();
  },
);

const groups = computed(() => props.row.groups ?? []);
const total = computed(() => groups.value.reduce((n, g) => n + g.guides.length, 0));
// A long row shows 8 tiles per group until the user asks for more.
const cap = computed(() => (total.value > 12 ? 8 : Infinity));

const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  return groups.value
    .map((g, gi) => {
      if (q) {
        return {
          gi,
          heading: g.heading,
          guides: g.guides.filter((x) => x.name.toLowerCase().includes(q)),
          extra: 0,
        };
      }
      const limit = expanded.value.has(gi) ? Infinity : cap.value;
      return {
        gi,
        heading: g.heading,
        guides: g.guides.slice(0, limit),
        extra: Math.max(0, g.guides.length - limit),
      };
    })
    .filter((g) => g.guides.length);
});

const empty = computed(() => query.value.trim() !== "" && shown.value.length === 0);

const hits = computed(() =>
  empty.value
    ? findGuides(props.choices, query.value, `${props.choice.id}/${props.row.id}`).slice(0, 5)
    : [],
);

// With no hit anywhere, the curl guide works for any tool.
const curlRow = computed(() =>
  props.choices.find((c) => c.id === "logs")?.rows.find((r) => r.id === "over-http-with-curl"),
);
const curlGuide = computed<OnboardingGuide | undefined>(() =>
  curlRow.value?.route
    ? {
        id: curlRow.value.id,
        name: curlRow.value.name,
        route: curlRow.value.route,
        firstSource: curlRow.value.firstSource,
      }
    : undefined,
);
</script>
