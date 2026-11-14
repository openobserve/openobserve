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
import { computed, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { RESERVED_FIELD } from "@/composables/starterPacks/packBinding";
import { MAX_STREAM_COPIES } from "@/composables/starterPacks/streamCandidates";
import type { PackBinding, PackQuestion } from "@/composables/starterPacks/types";
import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{
  flow: StarterPackFlow;
  question?: PackQuestion;
  binding?: PackBinding;
  /** How the row names this data, already translated. */
  what: string;
}>();
const open = defineModel<boolean>("open", { default: false });

const { t } = useI18nTyped();

const picked = ref<string[]>([]);
const stream = ref<string>();
const value = ref<string>();
const column = ref<string>();

const candidates = computed(() => props.question?.candidates ?? []);
const kind = computed(() => (props.binding ? "field" : props.question?.kind));
const manyStreams = computed(() => candidates.value.length > MAX_STREAM_COPIES);
const columns = computed(() =>
  (props.binding ? (props.flow.preview.value?.columns[props.binding.stream] ?? []) : []).filter(
    (name) => name !== RESERVED_FIELD,
  ),
);

const title = computed(() => {
  const what = raw(props.what);
  if (kind.value === "field") return t("starterPacks.adapted.dialogFieldTitle", { what });
  if (kind.value === "shared") return t("starterPacks.adapted.sharedAsk", { what });
  if (kind.value === "none") return t("starterPacks.adapted.notFound", { what });
  const count = candidates.value.length;
  if (count === 1) {
    return t("starterPacks.adapted.oneMatch", { what, stream: raw(candidates.value[0].stream) });
  }
  return t("starterPacks.adapted.severalMatch", { what, count });
});

const pickerOptions = computed(() =>
  candidates.value.map(({ stream: name, matched, total }) => ({
    label: raw(`${name} · ${t("starterPacks.adapted.dialogFields", { matched, total })}`),
    value: name,
  })),
);

const sharedFilter = computed(() =>
  stream.value ? props.question?.filters?.[stream.value] : undefined,
);

const snippet = computed(
  () =>
    `exporters:\n  otlphttp/openobserve:\n    headers:\n      stream-name: ${props.question?.want}`,
);

const reset = () => {
  picked.value = candidates.value.slice(0, MAX_STREAM_COPIES).map((row) => row.stream);
  const sharedFirst = kind.value === "shared" ? candidates.value[0]?.stream : undefined;
  stream.value = props.question?.answer?.to ?? sharedFirst;
  value.value = props.question?.answer?.filter?.value;
  column.value = props.binding?.to;
};
watch(open, (isOpen) => isOpen && reset());

const toggle = (name: string, on: boolean) => {
  picked.value = on ? [...picked.value, name] : picked.value.filter((row) => row !== name);
};

const useStreams = async ([to, ...also]: string[]) => {
  open.value = false;
  await props.flow.chooseStream(props.question!.want, { to, ...(also.length ? { also } : {}) });
};

const useFilter = async () => {
  const to = stream.value!;
  const field = sharedFilter.value!.field;
  open.value = false;
  await props.flow.chooseStream(props.question!.want, {
    to,
    filter: { field, value: value.value! },
  });
};

const useColumn = async () => {
  open.value = false;
  await props.flow.chooseField(props.binding!.from, column.value!);
};

const primaryDisabled = computed(() => {
  if (kind.value === "shared") return !stream.value || !value.value;
  if (kind.value === "none") return !stream.value;
  return kind.value === "field" && !column.value;
});

const applyPrimary = () => {
  if (kind.value === "shared") return useFilter();
  if (kind.value === "none") return useStreams([stream.value!]);
  return useColumn();
};
</script>

<template>
  <ODialog
    v-model:open="open"
    size="md"
    :title="title"
    :primary-button-label="kind === 'confirm' ? undefined : t('starterPacks.adapted.apply')"
    :primary-button-disabled="primaryDisabled"
    primary-button-data-test="starter-pack-repair-apply-btn"
    :secondary-button-label="t('common.cancel')"
    data-test="starter-pack-repair-dialog"
    @click:primary="applyPrimary"
    @click:secondary="open = false"
  >
    <div v-if="kind === 'confirm'" class="flex flex-col gap-2 text-sm">
      <OText v-if="manyStreams" variant="meta">{{
        t("starterPacks.adapted.dialogPickFive", { count: MAX_STREAM_COPIES })
      }}</OText>
      <div
        v-for="row in candidates"
        :key="row.stream"
        class="rounded-default bg-surface-base flex items-center justify-between gap-3 border p-3"
        :class="
          manyStreams && picked.includes(row.stream) ? 'border-primary' : 'border-border-default'
        "
        data-test="starter-pack-repair-candidate"
      >
        <OCheckbox
          v-if="manyStreams"
          :model-value="picked.includes(row.stream)"
          :disabled="!picked.includes(row.stream) && picked.length >= MAX_STREAM_COPIES"
          :aria-label="row.stream"
          @update:model-value="toggle(row.stream, !!$event)"
        />
        <div class="flex min-w-0 flex-1 flex-col">
          <strong class="truncate">{{ raw(row.stream) }}</strong>
          <OText variant="meta">{{
            t("starterPacks.adapted.dialogFields", { matched: row.matched, total: row.total })
          }}</OText>
          <OText v-if="row.samples.length" variant="meta" class="truncate">{{
            t("starterPacks.adapted.values", { values: raw(row.samples.slice(0, 3).join(", ")) })
          }}</OText>
        </div>
        <OButton
          variant="outline"
          size="sm-action"
          data-test="starter-pack-repair-use-btn"
          @click="useStreams([row.stream])"
        >
          {{ t("starterPacks.adapted.dialogUse", { stream: raw(row.stream) }) }}
        </OButton>
      </div>
      <template v-if="candidates.length > 1">
        <OText variant="meta">{{ t("starterPacks.adapted.dialogAllNote") }}</OText>
        <div>
          <OButton
            variant="primary"
            size="sm-action"
            :disabled="!picked.length"
            data-test="starter-pack-repair-use-all-btn"
            @click="useStreams(picked)"
          >
            {{
              t(
                manyStreams
                  ? "starterPacks.adapted.dialogUseChecked"
                  : "starterPacks.adapted.dialogUseAll",
                { count: picked.length },
              )
            }}
          </OButton>
        </div>
      </template>
    </div>

    <div v-else-if="kind === 'shared'" class="flex flex-col gap-2 text-sm">
      <div class="flex items-center gap-2">
        <OIcon name="filter-alt" size="sm" class="text-text-secondary" />
        <OText class="text-text-heading font-medium">{{
          t("starterPacks.adapted.filterTitle", { what: raw(what) })
        }}</OText>
      </div>
      <OSelect
        v-if="candidates.length > 1"
        v-model="stream"
        :label="t('starterPacks.adapted.dialogPickStream')"
        :options="pickerOptions"
        data-test="starter-pack-repair-shared-stream-select"
        @update:model-value="value = undefined"
      />
      <ORadioGroup
        v-if="sharedFilter?.values.length"
        v-model="value"
        data-test="starter-pack-repair-values"
      >
        <ORadio
          v-for="option in sharedFilter.values"
          :key="option"
          :value="option"
          :label="raw(option)"
        />
      </ORadioGroup>
      <OText v-else variant="meta">{{ t("starterPacks.adapted.dialogNoValues") }}</OText>
      <OText v-if="value" variant="meta" data-test="starter-pack-repair-filter-note">{{
        t("starterPacks.adapted.dialogFiltersOn", {
          stream: raw(stream ?? ""),
          field: raw(sharedFilter?.field ?? ""),
          value: raw(value),
        })
      }}</OText>
    </div>

    <div v-else-if="kind === 'none'" class="flex flex-col gap-3 text-sm">
      <OSelect
        v-model="stream"
        :label="t('starterPacks.adapted.dialogPickStream')"
        :placeholder="t('starterPacks.adapted.dialogPickPlaceholder')"
        :options="pickerOptions"
        data-test="starter-pack-repair-stream-select"
      />
      <div class="flex items-center gap-2">
        <OSeparator class="flex-1" />
        <OText variant="meta">{{ t("starterPacks.adapted.or") }}</OText>
        <OSeparator class="flex-1" />
      </div>
      <OText variant="meta">{{
        t("starterPacks.adapted.dialogSend", { stream: raw(question?.want ?? "") })
      }}</OText>
      <OCodeBlock :code="snippet" language="yaml" data-test="starter-pack-repair-snippet" />
    </div>

    <OSelect
      v-else-if="kind === 'field'"
      v-model="column"
      :label="t('starterPacks.adapted.dialogFieldLabel', { stream: raw(binding?.stream ?? '') })"
      :options="columns.map((name) => ({ label: raw(name), value: name }))"
      data-test="starter-pack-repair-field-select"
    />
  </ODialog>
</template>
