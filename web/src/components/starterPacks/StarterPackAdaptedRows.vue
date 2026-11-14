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
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { PackBinding, PackQuestion } from "@/composables/starterPacks/types";
import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import StarterPackRepairDialog from "./StarterPackRepairDialog.vue";

const VISIBLE_FIELDS = 3;

const props = defineProps<{ flow: StarterPackFlow }>();

const { t } = useI18nTyped();

const preview = computed(() => props.flow.preview.value);
const questions = computed(() => preview.value?.questions ?? []);
const answered = computed(() => questions.value.filter(({ answer }) => answer));
const open = computed(() => questions.value.filter(({ answer }) => !answer));
const bindings = computed(() => {
  const rows = new Map(
    (preview.value?.bindings ?? []).map((row) => [`${row.from}/${row.to}`, row]),
  );
  return [...rows.values()];
});
const flavours = computed(() => {
  const ids = new Set(Object.values(preview.value?.flavours ?? {}));
  return (props.flow.pack.flavours ?? []).filter(({ id }) => ids.has(id));
});
const fieldsOpen = ref(false);
const shownBindings = computed(() =>
  fieldsOpen.value ? bindings.value : bindings.value.slice(0, VISIBLE_FIELDS),
);
const moreFields = computed(() => bindings.value.length - shownBindings.value.length);
const hasRows = computed(
  () => answered.value.length + bindings.value.length + flavours.value.length > 0,
);

const dialogOpen = ref(false);
const activeQuestion = ref<PackQuestion>();
const activeBinding = ref<PackBinding>();
const activeWhat = ref("");

const whatOf = (question: PackQuestion) =>
  question.titleKey ? t(question.titleKey) : t("starterPacks.adapted.someData");

const fieldName = ({ group }: PackBinding) => {
  const titleKey: I18nKey | undefined = group ? props.flow.pack.aliasTitles?.[group] : undefined;
  const title = group ? preview.value?.groupTitles[group] : undefined;
  if (title) return raw(title);
  return titleKey ? t(titleKey) : t("starterPacks.adapted.someField");
};

const questionRow = (question: PackQuestion) => {
  const { answer, titleKey } = question;
  if (!answer) return "";
  const what = whatOf(question);
  const stream = raw(answer.to);
  if (answer.filter) {
    const { field, value } = answer.filter;
    return t("starterPacks.adapted.readsFiltered", {
      what,
      stream,
      field: raw(field),
      value: raw(value),
    });
  }
  if (answer.also?.length) {
    const streams = [answer.to, ...answer.also];
    return t("starterPacks.adapted.readsAll", {
      what,
      count: streams.length,
      streams: raw(streams.join(", ")),
    });
  }
  return titleKey
    ? t("starterPacks.adapted.readsRole", { what, stream })
    : t("starterPacks.adapted.readsMetric", { stream });
};

const askRow = (question: PackQuestion) => {
  const what = whatOf(question);
  if (question.kind === "none") return t("starterPacks.adapted.notFound", { what });
  if (question.kind === "shared") return t("starterPacks.adapted.sharedAsk", { what });
  const [first] = question.candidates;
  return question.candidates.length === 1
    ? t("starterPacks.adapted.oneMatch", { what, stream: raw(first.stream) })
    : t("starterPacks.adapted.severalMatch", { what, count: question.candidates.length });
};

const changeQuestion = (question: PackQuestion) => {
  activeBinding.value = undefined;
  activeQuestion.value = question;
  activeWhat.value = whatOf(question);
  dialogOpen.value = true;
};

const changeBinding = (binding: PackBinding) => {
  activeQuestion.value = undefined;
  activeBinding.value = binding;
  activeWhat.value = fieldName(binding);
  dialogOpen.value = true;
};
</script>

<template>
  <div class="flex flex-col gap-2" data-test="starter-pack-adapted">
    <OBanner
      v-for="question in open"
      :key="question.want"
      :variant="question.kind === 'none' ? 'default' : 'warning'"
      dense
      :content="askRow(question)"
      data-test="starter-pack-adapted-question"
    >
      <template #actions>
        <OButton
          variant="outline"
          size="sm-action"
          data-test="starter-pack-adapted-choose-btn"
          @click="changeQuestion(question)"
        >
          {{ t("starterPacks.adapted.choose") }}
        </OButton>
      </template>
    </OBanner>
    <div v-if="hasRows" class="flex flex-col">
      <div
        v-for="question in answered"
        :key="question.want"
        class="border-border-default flex items-center justify-between gap-3 border-b py-1"
        data-test="starter-pack-adapted-stream"
      >
        <span class="min-w-0 truncate" :title="String(questionRow(question))">{{
          questionRow(question)
        }}</span>
        <OButton
          variant="ghost-primary"
          size="sm-action"
          data-test="starter-pack-adapted-change-btn"
          @click="changeQuestion(question)"
        >
          {{ t("starterPacks.adapted.change") }}
        </OButton>
      </div>
      <div
        v-for="binding in shownBindings"
        :key="`${binding.stream}/${binding.from}`"
        class="border-border-default flex items-center justify-between gap-3 border-b py-1"
        data-test="starter-pack-adapted-field"
      >
        <span class="min-w-0 truncate">{{
          t("starterPacks.adapted.fieldRead", {
            what: fieldName(binding),
            field: raw(binding.to),
          })
        }}</span>
        <OButton
          variant="ghost-primary"
          size="sm-action"
          data-test="starter-pack-adapted-field-change-btn"
          @click="changeBinding(binding)"
        >
          {{ t("starterPacks.adapted.change") }}
        </OButton>
      </div>
      <div v-if="moreFields > 0" class="flex items-center gap-2 py-1">
        <OText variant="meta">{{
          t("starterPacks.adapted.fieldsMore", { count: moreFields })
        }}</OText>
        <OButton
          variant="ghost-primary"
          size="sm-action"
          data-test="starter-pack-adapted-fields-show-btn"
          @click="fieldsOpen = true"
        >
          {{ t("starterPacks.adapted.show") }}
        </OButton>
      </div>
      <OText
        v-for="flavour in flavours"
        :key="flavour.id"
        variant="meta"
        class="py-1"
        data-test="starter-pack-adapted-flavour"
        >{{ t("starterPacks.adapted.flavour", { name: t(flavour.titleKey) }) }}</OText
      >
    </div>
    <StarterPackRepairDialog
      v-model:open="dialogOpen"
      :flow="flow"
      :question="activeQuestion"
      :binding="activeBinding"
      :what="activeWhat"
    />
  </div>
</template>
