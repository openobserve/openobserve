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

<!-- Whether and how to trace, before a row's guide. No and eBPF open the guide at once. A library
     per language opens in place to pick one or more languages; only there a button goes on, and it
     checks the pick instead of being disabled. Hover or focus shows the answer in the side panel. -->
<template>
  <div
    class="grid h-full grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] max-md:h-auto max-md:min-h-full max-md:grid-cols-1 md:grid-rows-1"
    data-test="onboarding-step-traces"
  >
    <section class="flex px-13 pt-8 max-md:px-4 max-md:pt-6 md:overflow-y-auto md:max-lg:px-8">
      <div class="mx-auto flex w-full max-w-176 flex-col">
        <div class="mb-2 flex min-h-8.5 items-center gap-3">
          <OButton
            variant="ghost-muted"
            size="sm"
            icon-left="arrow-back"
            data-test="onboarding-step-traces-back"
            @click="emit('back')"
          >
            {{ t("onboarding.back") }}
          </OButton>
          <span class="text-text-secondary text-compact">{{ choice.name }} / {{ row.name }}</span>
        </div>
        <h1 class="text-text-heading text-2xl leading-tight font-semibold text-balance">
          {{ traces.question }}
        </h1>

        <ul class="mt-6 grid gap-2">
          <li v-for="o in traces.options" :key="o.id">
            <OnboardingChoiceButton
              :icon="o.icon"
              :name="o.name"
              :description="o.description"
              :previewed="previewId === o.id"
              :aria-expanded="o.id === 'library' ? expanded : undefined"
              :aria-controls="o.id === 'library' ? panelId : undefined"
              :data-test="`onboarding-step-traces-${o.id}`"
              @mouseenter="previewId = o.id"
              @focus="previewId = o.id"
              @click="choose(o.id)"
            />
            <!-- Lines up with the row's text: the row's padding, icon and gap. -->
            <div
              v-if="o.id === 'library' && expanded"
              :id="panelId"
              class="ms-16.5 mt-3 mb-2"
              data-test="onboarding-step-traces-library-panel"
            >
              <OForm
                :form="form"
                class="flex flex-col gap-4"
                data-test="onboarding-step-traces-form"
              >
                <OFormCheckboxGroup
                  name="languages"
                  :aria-label="t('onboarding.collect.languages')"
                  data-test="onboarding-step-traces-languages"
                >
                  <div class="flex flex-wrap gap-x-5 gap-y-2">
                    <OCheckbox
                      v-for="l in traces.languages"
                      :key="l.id"
                      :value="l.id"
                      :label="l.name"
                      :data-test="`onboarding-step-traces-language-${l.id}`"
                    />
                  </div>
                </OFormCheckboxGroup>
                <OButton
                  type="submit"
                  variant="primary"
                  size="md"
                  class="self-start"
                  data-test="onboarding-step-traces-continue"
                >
                  {{ t("onboarding.collect.continueToSetup") }}
                </OButton>
              </OForm>
            </div>
          </li>
        </ul>
        <OnboardingStepFooter />
      </div>
    </section>

    <aside class="max-md:hidden" :aria-label="t('onboarding.whatYouGet')">
      <!-- Pinned at the top of the scroll area: the viewport minus the app header, the content card's
           bottom gap (0.5rem) and its top and bottom border hairlines. -->
      <!-- eslint-disable-next-line local/no-hardcoded-px -- the card's two hairline borders -->
      <div class="sticky top-0 h-[calc(100dvh-var(--navbar-height)-0.5rem-2px)]">
        <OnboardingPreview
          :preview="panelText(previewed)"
          :example="previewed.example"
          :reserve="traces.options.map(panelText)"
        />
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from "vue";

import type { SetupCardPresets } from "@/components/ingestion/setupCard/types";
import OButton from "@/lib/core/Button/OButton.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OFormCheckboxGroup from "@/lib/forms/Checkbox/OFormCheckboxGroup.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { useI18nTyped } from "@/types/i18n";

import OnboardingChoiceButton from "./OnboardingChoiceButton.vue";
import OnboardingPreview from "./OnboardingPreview.vue";
import { makeTracesFormSchema, type TracesForm } from "./OnboardingStepTraces.schema";
import OnboardingStepFooter from "./OnboardingStepFooter.vue";
import type {
  OnboardingChoice,
  OnboardingRow,
  OnboardingTraceOption,
  OnboardingTraces,
} from "./onboardingChoices";

const props = defineProps<{
  choice: OnboardingChoice;
  row: OnboardingRow;
  traces: OnboardingTraces;
  /** The answer already in the URL, e.g. after Back from the guide. */
  picked?: SetupCardPresets;
}>();
const emit = defineEmits<{ pick: [answer: SetupCardPresets]; back: [] }>();

const { t } = useI18nTyped();
const panelId = useId();

// A library answer in the URL opens the language list with its languages ticked.
const expanded = ref(props.picked?.traces === "library");

const form = useOForm<TracesForm>({
  defaultValues: { languages: props.picked?.languages ?? [] },
  schema: makeTracesFormSchema(t),
  // Languages in the card's order, so the same pick always gives the same URL.
  onSubmit: ({ languages }) =>
    emit("pick", {
      traces: "library",
      languages: props.traces.languages.map((l) => l.id).filter((id) => languages.includes(id)),
    }),
});

const choose = (id: OnboardingTraceOption["id"]) => {
  if (id === "library") expanded.value = !expanded.value;
  else emit("pick", { traces: id, languages: [] });
};

const previewId = ref(props.picked?.traces ?? props.traces.options[0].id);
const previewed = computed(
  () => props.traces.options.find((o) => o.id === previewId.value) ?? props.traces.options[0],
);
const panelText = (o: OnboardingTraceOption) => ({
  eyebrow: props.row.name,
  title: o.name,
  text: o.about,
  signals: o.signals,
});
</script>
