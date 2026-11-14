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

<script setup lang="ts">
import { computed, ref } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { PackBinding, PackQuestion } from "@/composables/starterPacks/types";
import { useAdaptedData } from "@/composables/starterPacks/useAdaptedData";
import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import StarterPackRepairForm from "./StarterPackRepairForm.vue";

const VISIBLE_FIELDS = 3;

const props = defineProps<{ flow: StarterPackFlow; readonly?: boolean }>();

const { t } = useI18nTyped();
const { answered, open, bindings, flavours } = useAdaptedData(props.flow);

const preview = computed(() => props.flow.preview.value);
const fieldsOpen = ref(false);
const shownBindings = computed(() =>
  fieldsOpen.value ? bindings.value : bindings.value.slice(0, VISIBLE_FIELDS),
);
const moreFields = computed(() => bindings.value.length - shownBindings.value.length);

const editingKey = ref<string>();

const needOf = (question: PackQuestion) =>
  question.titleKey ? t(question.titleKey) : raw(question.want);

const fieldName = ({ group }: PackBinding) => {
  const titleKey: I18nKey | undefined = group ? props.flow.pack.aliasTitles?.[group] : undefined;
  const title = group ? preview.value?.groupTitles[group] : undefined;
  if (title) return raw(title);
  return titleKey ? t(titleKey) : t("starterPacks.adapted.someField");
};

const allStreams = (question: PackQuestion) =>
  question.answer ? [question.answer.to, ...(question.answer.also ?? [])] : [];

const askRow = (question: PackQuestion) => {
  const what = needOf(question);
  if (question.kind === "none") return t("starterPacks.adapted.noneFound", { what });
  if (question.kind === "shared") return t("starterPacks.adapted.sharedAsk", { what });
  return t("starterPacks.adapted.whichStream", { what });
};

const askHint = (question: PackQuestion) => {
  const count = question.candidates.length;
  if (question.kind !== "confirm" || !count) return "";
  return t("starterPacks.adapted.lookRight", { count }, count);
};

const questionKey = ({ want }: PackQuestion) => `stream:${want}`;
const bindingKey = ({ stream, from }: PackBinding) => `field:${stream}/${from}`;
const toggleEdit = (key: string) => {
  editingKey.value = editingKey.value === key ? undefined : key;
};
const closeEdit = () => {
  editingKey.value = undefined;
};
</script>

<template>
  <div class="flex flex-col text-sm" data-test="starter-pack-adapted">
    <template v-if="open.length || answered.length">
      <OText variant="label" class="text-text-label pt-2 pb-0.5">{{
        t("starterPacks.adapted.streams")
      }}</OText>
      <div class="divide-border-default flex flex-col divide-y">
        <template v-for="question in open" :key="question.want">
          <div
            :class="[
              'flex min-h-9 items-center gap-3',
              question.kind !== 'none' && 'bg-status-warning-bg',
            ]"
            data-test="starter-pack-adapted-question"
          >
            <span class="flex min-w-0 flex-1 items-center gap-2">
              <span
                :class="[
                  'size-1.5 shrink-0 rounded-full',
                  question.kind === 'none' ? 'bg-border-strong' : 'bg-status-warning-text',
                ]"
              />
              <span class="text-text-heading min-w-0 truncate" :title="String(askRow(question))">{{
                askRow(question)
              }}</span>
              <OText v-if="askHint(question)" variant="meta" class="shrink-0">{{
                askHint(question)
              }}</OText>
            </span>
            <OButton
              v-if="!readonly"
              variant="outline"
              size="sm-action"
              data-test="starter-pack-adapted-choose-btn"
              @click="toggleEdit(questionKey(question))"
            >
              {{ t("starterPacks.adapted.choose") }}
            </OButton>
          </div>
          <StarterPackRepairForm
            v-if="editingKey === questionKey(question)"
            :flow="flow"
            :question="question"
            :what="String(needOf(question))"
            @close="closeEdit"
          />
        </template>
        <template v-for="question in answered" :key="question.want">
          <div class="flex min-h-9 items-center gap-3" data-test="starter-pack-adapted-stream">
            <span
              :class="[
                'w-36 shrink-0 truncate',
                !question.titleKey && 'text-text-secondary font-mono text-xs',
              ]"
              :title="String(needOf(question))"
              >{{ needOf(question) }}</span
            >
            <span class="flex min-w-0 flex-1 items-center gap-1.5 py-1.5">
              <OIcon name="arrow-forward" size="sm" class="text-text-label shrink-0" />
              <OBadge
                variant="default-soft"
                shape="rounded"
                size="xs"
                class="max-w-44 shrink-0 font-mono"
                :title="question.answer?.to"
                data-test="starter-pack-adapted-stream-chip"
                ><span class="truncate">{{ question.answer?.to }}</span></OBadge
              >
              <OBadge
                v-if="question.answer?.filter"
                variant="default-outline"
                size="xs"
                icon="filter-alt"
                class="min-w-0"
                :title="`${question.answer.filter.field} = ${question.answer.filter.value}`"
                data-test="starter-pack-adapted-filter-chip"
                ><span class="truncate font-mono"
                  >{{ question.answer.filter.field }} = {{ question.answer.filter.value }}</span
                ></OBadge
              >
              <OBadge
                v-else-if="question.answer?.also?.length"
                variant="default-outline"
                size="xs"
                icon="layers"
                class="min-w-0"
                :title="allStreams(question).join(', ')"
                data-test="starter-pack-adapted-all-chip"
                ><span class="truncate">{{
                  t(
                    "starterPacks.adapted.streamCount",
                    { count: allStreams(question).length },
                    allStreams(question).length,
                  )
                }}</span></OBadge
              >
            </span>
            <OButton
              v-if="!readonly"
              variant="ghost-primary"
              size="sm-action"
              data-test="starter-pack-adapted-change-btn"
              @click="toggleEdit(questionKey(question))"
            >
              {{ t("starterPacks.adapted.change") }}
            </OButton>
          </div>
          <StarterPackRepairForm
            v-if="editingKey === questionKey(question)"
            :flow="flow"
            :question="question"
            :what="String(needOf(question))"
            @close="closeEdit"
          />
        </template>
      </div>
    </template>
    <template v-if="bindings.length">
      <OText variant="label" class="text-text-label pt-2 pb-0.5">{{
        t("starterPacks.adapted.fields")
      }}</OText>
      <div class="divide-border-default flex flex-col divide-y">
        <template v-for="binding in shownBindings" :key="bindingKey(binding)">
          <div class="flex min-h-9 items-center gap-3" data-test="starter-pack-adapted-field">
            <span class="w-36 shrink-0 truncate" :title="String(fieldName(binding))">{{
              fieldName(binding)
            }}</span>
            <span class="flex min-w-0 flex-1 items-center gap-1.5 py-1.5">
              <OIcon name="arrow-forward" size="sm" class="text-text-label shrink-0" />
              <OBadge
                variant="default-soft"
                shape="rounded"
                size="xs"
                class="max-w-44 shrink-0 font-mono"
                :title="binding.to"
                ><span class="truncate">{{ binding.to }}</span></OBadge
              >
            </span>
            <OButton
              v-if="!readonly"
              variant="ghost-primary"
              size="sm-action"
              data-test="starter-pack-adapted-field-change-btn"
              @click="toggleEdit(bindingKey(binding))"
            >
              {{ t("starterPacks.adapted.change") }}
            </OButton>
          </div>
          <StarterPackRepairForm
            v-if="editingKey === bindingKey(binding)"
            :flow="flow"
            :binding="binding"
            :what="String(fieldName(binding))"
            @close="closeEdit"
          />
        </template>
      </div>
      <div v-if="bindings.length > VISIBLE_FIELDS" class="py-0.5">
        <OButton
          v-if="fieldsOpen"
          variant="ghost-primary"
          size="sm-action"
          icon-left="expand-less"
          data-test="starter-pack-adapted-fields-hide-btn"
          @click="fieldsOpen = false"
        >
          {{ t("starterPacks.adapted.showFewer") }}
        </OButton>
        <OButton
          v-else
          variant="ghost-primary"
          size="sm-action"
          icon-left="expand-more"
          data-test="starter-pack-adapted-fields-show-btn"
          @click="fieldsOpen = true"
        >
          {{ t("starterPacks.adapted.showMore", { count: moreFields }) }}
        </OButton>
      </div>
    </template>
    <div
      v-for="flavour in flavours"
      :key="flavour.id"
      class="border-border-default mt-1 flex min-h-9 items-center gap-3 border-t"
      data-test="starter-pack-adapted-flavour"
    >
      <span class="w-36 shrink-0 truncate">{{ t("starterPacks.adapted.version") }}</span>
      <span class="flex min-w-0 flex-1 items-center gap-1.5">
        <OIcon name="arrow-forward" size="sm" class="text-text-label shrink-0" />
        <span class="text-text-heading truncate font-medium">{{ t(flavour.titleKey) }}</span>
      </span>
    </div>
  </div>
</template>
