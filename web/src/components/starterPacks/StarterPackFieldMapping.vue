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
import { computed, ref, useId } from "vue";
import FitItems from "@/components/common/FitItems.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { PackBinding, PackBindingTier, PackQuestion } from "@/composables/starterPacks/types";
import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import StarterPackRepairForm from "./StarterPackRepairForm.vue";

interface MappingRow {
  key: string;
  field: string;
  from: string;
  to: string;
  streams: string[];
  tier: PackBindingTier;
  binding: PackBinding;
}

const TIERS: Record<PackBindingTier, { variant: BadgeVariant; key: I18nKey }> = {
  exact: { variant: "default-soft", key: "starterPacks.page.fields.tierExact" },
  semantic: { variant: "info-soft", key: "starterPacks.page.fields.tierSemantic" },
  alias: { variant: "default-soft", key: "starterPacks.page.fields.tierAlias" },
  chosen: { variant: "primary-soft", key: "starterPacks.page.fields.tierChosen" },
};

const props = defineProps<{
  flow: StarterPackFlow;
  /** Shows Change and Choose, for someone who may set the pack up. */
  manager: boolean;
  /** Set up already: Change only rewrites the setup plan, so it shows disabled with the reason. */
  locked: boolean;
}>();

const { t } = useI18nTyped();
const pack = props.flow.pack;
const editing = ref<string[]>([]);

const plan = computed(() => props.flow.record.value ?? props.flow.preview.value);
const fieldName = ({ group }: PackBinding) => {
  const title = group ? props.flow.preview.value?.groupTitles[group] : undefined;
  if (title) return title;
  const titleKey = group ? pack.aliasTitles?.[group] : undefined;
  return String(titleKey ? t(titleKey) : t("starterPacks.adapted.someField"));
};

// One rename that holds in several streams is one row listing them all.
const rows = computed<MappingRow[]>(() => {
  const byRename = new Map<string, MappingRow>();
  for (const binding of plan.value?.bindings ?? []) {
    const key = `${binding.from}/${binding.to}`;
    const known = byRename.get(key);
    if (known) known.streams.push(binding.stream);
    else
      byRename.set(key, {
        key,
        field: fieldName(binding),
        from: binding.from,
        to: binding.to,
        streams: [binding.stream],
        tier: binding.tier,
        binding,
      });
  }
  return [...byRename.values()].sort((a, b) => a.field.localeCompare(b.field));
});

const open = computed<PackQuestion[]>(() =>
  (props.flow.preview.value?.questions ?? []).filter(({ answer }) => !answer),
);
const flavourNames = computed(() => {
  const ids = new Set(Object.values(plan.value?.flavours ?? {}));
  return (pack.flavours ?? []).filter(({ id }) => ids.has(id)).map(({ titleKey }) => t(titleKey));
});
const needOf = (question: PackQuestion) =>
  question.titleKey ? t(question.titleKey) : raw(question.want);

const columns = computed<OTableColumnDef<MappingRow>[]>(() => [
  { id: "field", header: t("starterPacks.page.fields.colField"), accessorKey: "field", size: 160 },
  { id: "from", header: t("starterPacks.page.fields.colPackField"), size: 200 },
  { id: "to", header: t("starterPacks.page.fields.colYourField"), size: 170 },
  { id: "streams", header: t("starterPacks.page.fields.colStream"), size: 300 },
  { id: "tier", header: t("starterPacks.page.fields.colMatchedBy"), size: 140 },
  { id: "change", header: raw(""), size: 90 },
]);

// One reason for both Change and Choose: the help line under the table describes the disabled button.
const lockedId = useId();
const lockedHelp = computed(() => t("starterPacks.page.fields.lockedHelp"));
const lockState = computed(() =>
  props.locked ? { disabled: true, focusableUnavailable: true, descriptionId: lockedId } : {},
);

const toggle = (key: string) => {
  editing.value = editing.value.includes(key) ? [] : [key];
};
</script>

<template>
  <section class="flex flex-col gap-2" data-test="starter-pack-page-field-mapping">
    <div class="flex items-baseline gap-2">
      <h3 class="text-text-heading text-sm font-semibold">
        {{ t("starterPacks.page.fields.title") }}
      </h3>
      <span v-if="rows.length" class="text-text-secondary text-xs">{{
        t("starterPacks.page.fields.count", { count: rows.length })
      }}</span>
    </div>
    <p class="text-text-secondary text-xs">{{ t("starterPacks.page.fields.help") }}</p>
    <p
      v-if="flavourNames.length"
      class="text-text-body text-xs"
      data-test="starter-pack-page-field-source"
    >
      <span class="text-text-secondary">{{ t("starterPacks.page.fields.dataSource") }}</span>
      {{ raw(flavourNames.join(", ")) }}
    </p>
    <div
      v-for="question in open"
      :key="question.want"
      class="flex flex-col"
      data-test="starter-pack-page-field-question"
    >
      <div class="bg-status-warning-bg rounded-default flex min-h-9 items-center gap-3 px-3">
        <OIcon name="warning-amber" size="sm" class="text-status-warning-text shrink-0" />
        <span class="text-text-heading min-w-0 flex-1 truncate">{{
          t("starterPacks.adapted.whichStream", { what: needOf(question) })
        }}</span>
        <OButton
          v-if="manager && question.kind !== 'none'"
          variant="outline"
          size="xs"
          v-bind="lockState"
          data-test="starter-pack-page-field-choose"
          @click="toggle(`q:${question.want}`)"
        >
          <OTooltip v-if="locked" :content="lockedHelp" />
          {{ t("starterPacks.adapted.choose") }}
        </OButton>
      </div>
      <StarterPackRepairForm
        v-if="editing.includes(`q:${question.want}`)"
        :flow="flow"
        :question="question"
        :what="String(needOf(question))"
        @close="editing = []"
      />
    </div>
    <OTable
      v-if="rows.length"
      :data="rows"
      :columns="columns"
      row-key="key"
      pagination="none"
      :show-global-filter="false"
      :frame="false"
      expansion="single"
      :expand-button="false"
      :expanded-ids="editing"
      data-test="starter-pack-page-field-table"
    >
      <template #cell-from="{ row }">
        <span class="text-text-secondary truncate font-mono text-xs">{{ row.from }}</span>
      </template>
      <template #cell-to="{ row }">
        <span class="flex min-w-0 items-center gap-1.5">
          <OIcon name="arrow-forward" size="xs" class="text-text-label shrink-0" />
          <OTag variant="default-soft" size="sm" :label="raw(row.to)" />
        </span>
      </template>
      <template #cell-streams="{ row }">
        <span class="flex min-w-0">
          <OTooltip :content="raw(row.streams.join('\n'))" content-class="whitespace-pre-wrap" />
          <FitItems :items="row.streams">
            <template #default="{ item }">
              <span class="block truncate font-mono text-xs">{{ item }}</span>
            </template>
            <template #more="{ count }">
              <OTag variant="default-soft" size="xs" :label="raw(`+${count}`)" />
            </template>
          </FitItems>
        </span>
      </template>
      <template #cell-tier="{ row }">
        <OTag
          :variant="TIERS[row.tier].variant"
          size="sm"
          :label="t(TIERS[row.tier].key)"
          :data-test="`starter-pack-page-field-tier-${row.tier}`"
        />
      </template>
      <template #cell-change="{ row }">
        <OButton
          v-if="manager"
          variant="ghost-primary"
          size="xs"
          v-bind="lockState"
          data-test="starter-pack-page-field-change"
          @click.stop="toggle(row.key)"
        >
          <OTooltip v-if="locked" :content="lockedHelp" />
          {{ t("starterPacks.adapted.change") }}
        </OButton>
      </template>
      <template #expansion="{ row }">
        <StarterPackRepairForm
          :flow="flow"
          :binding="row.binding"
          :what="row.field"
          @close="editing = []"
        />
      </template>
    </OTable>
    <p v-else class="text-text-secondary py-3 text-sm" data-test="starter-pack-page-field-empty">
      {{ t("starterPacks.page.fields.empty") }}
    </p>
    <p
      v-if="manager && locked && (rows.length || open.length)"
      :id="lockedId"
      class="text-text-secondary text-xs"
      data-test="starter-pack-page-field-locked"
    >
      {{ lockedHelp }}
    </p>
  </section>
</template>
