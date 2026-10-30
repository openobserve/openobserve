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
  <div class="bg-surface-base border-border-default sticky top-0 z-1 border-b px-4 py-3">
    <div class="text-text-secondary text-2xs font-semibold" data-test="query-profile-detail-where">
      {{ where }}
    </div>
    <div class="mt-0.5 flex min-w-0 items-center gap-2">
      <span class="rounded-default grid size-6 shrink-0 place-items-center" :class="style.chip">
        <OIcon :name="style.icon" size="sm" />
      </span>
      <OTruncatedText class="text-text-heading text-lg font-semibold">{{ label }}</OTruncatedText>
    </div>
    <div v-if="relatives.length" class="mt-2 flex flex-wrap gap-1.5">
      <OBadge
        v-for="r in relatives"
        :key="r.id"
        clickable
        size="sm"
        shape="rounded"
        variant="default-outline"
        :data-test="`query-profile-detail-link-${r.id}`"
        @click="emit('select', r.id)"
      >
        <OIcon :name="r.up ? 'arrow-upward' : 'arrow-downward'" size="xs" />
        <span class="size-1.5 shrink-0 rounded-full" :class="r.swatch" />
        {{ r.label }}
      </OBadge>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { useI18nTyped } from "@/types/i18n";
import type { ProfileModel, ProfileOperator } from "@/utils/queryProfile";
import { CATEGORY_STYLE } from "./profileStyles";
import { operatorTitle, operatorWhere } from "./profileText";

const props = defineProps<{
  model: ProfileModel;
  op: ProfileOperator;
}>();

const emit = defineEmits<{ select: [opId: string] }>();

const { t } = useI18nTyped();

const style = computed(() => CATEGORY_STYLE[props.op.category]);
const label = computed(() => operatorTitle(t, props.op));
const where = computed(() => operatorWhere(t, props.model, props.op));

const relatives = computed(() => {
  const toLink = (id: string, up: boolean) => {
    const rel = props.model.operators[id];
    return { id, up, label: operatorTitle(t, rel), swatch: CATEGORY_STYLE[rel.category].swatch };
  };
  const parent = props.op.parentId ? [toLink(props.op.parentId, true)] : [];
  return [...parent, ...props.op.childIds.map((id) => toLink(id, false))];
});
</script>
