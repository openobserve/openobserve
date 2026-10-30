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
  <div v-if="op" class="flex flex-col pb-6" data-test="query-plan-detail">
    <ProfileDetailHeader :model="model" :op="op" @select="emit('select', $event)" />

    <div class="flex flex-col gap-4 px-4 pt-3">
      <section v-if="entries.length">
        <h4 class="text-text-secondary m-0 mb-2 text-xs font-semibold">
          {{ t("search.queryProfile.details") }}
        </h4>
        <ODescriptionList dense data-test="query-plan-detail-entries">
          <ODescriptionItem v-for="(e, i) in entries" :key="i" :label="e.label">
            <span class="font-mono text-xs wrap-anywhere">{{ e.value }}</span>
          </ODescriptionItem>
        </ODescriptionList>
      </section>

      <section>
        <h4 class="text-text-secondary m-0 mb-2 text-xs font-semibold">
          {{ t("search.queryProfile.raw") }}
        </h4>
        <div
          class="bg-code-bg text-text-code rounded-default px-2.5 py-2 font-mono text-xs wrap-anywhere"
          data-test="query-plan-detail-raw"
        >
          {{ op.detail }}
        </div>
      </section>

      <div class="text-text-secondary text-xs leading-normal" data-test="query-plan-detail-note">
        {{ t("search.queryProfile.notRunYet") }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatPlanValue, parsePlanDetail, type ProfileModel } from "@/utils/queryProfile";
import ProfileDetailHeader from "./ProfileDetailHeader.vue";

const props = defineProps<{
  model: ProfileModel;
  opId: string | null;
}>();

const emit = defineEmits<{ select: [opId: string] }>();

const { t } = useI18nTyped();

const op = computed(() => (props.opId ? props.model.operators[props.opId] : null));

const entries = computed(() =>
  op.value
    ? parsePlanDetail(op.value.detail).map((e) => ({
        label: e.key ? raw(e.key) : t("search.queryProfile.expression"),
        value: formatPlanValue(e.value),
      }))
    : [],
);
</script>
