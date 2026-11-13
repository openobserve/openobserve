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
  <OEmptyState
    size="hero"
    preset="no-access"
    :title="t(copy.title)"
    :description="
      features.length
        ? t(copy.message, { features: raw(featureNames(features)) })
        : t(copy.generic)
    "
  >
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </OEmptyState>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useContractLocks, useFeatureNames } from "@/composables/useFeatureLock";
import { denialCopyKeys } from "@/utils/featureGate";

/** The missing feature keys of a denial, from `licenseDeniedFeatures()`. */
const props = defineProps<{ features: readonly string[] }>();

const { t } = useI18nTyped();
const { featureNames } = useFeatureNames();
const lockedByContract = useContractLocks();
const copy = computed(() => denialCopyKeys(lockedByContract(props.features)));
</script>
