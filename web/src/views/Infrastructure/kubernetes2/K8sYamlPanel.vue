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
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { KIND_INFO } from "./kubernetesQueries";
import type { AnyRow } from "./kubernetesModel";
import { toYaml } from "./k8sYaml";

const props = defineProps<{ row: AnyRow | null }>();

const { t } = useI18nTyped();

const text = computed(() =>
  props.row?.object ? toYaml({ kind: KIND_INFO[props.row.kind].kind, ...props.row.object }) : null,
);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-test="k8s2-yaml-panel">
    <div
      class="bg-surface-subtle border-border-default flex shrink-0 items-center gap-2 border-b px-3 py-1.5"
    >
      <OIcon name="lock" size="xs" class="text-text-secondary" aria-hidden="true" />
      <OTruncatedText
        class="text-text-secondary min-w-0 flex-1 text-xs"
        data-test="k8s2-yaml-readonly"
        >{{ t("infra.k8s2.yamlReadOnly") }}</OTruncatedText
      >
      <OButton
        variant="secondary"
        icon="lock"
        disabled
        :disabled-reason="t('infra.k8s2.readOnlyAccess')"
        data-test="k8s2-yaml-edit"
      >
        {{ t("infra.k8s2.yamlEdit") }}
      </OButton>
    </div>
    <div v-if="text" class="min-h-0 flex-1 overflow-auto px-3">
      <OCodeBlock :code="text" lang="yaml" line-numbers data-test="k8s2-yaml" />
    </div>
    <OEmptyState
      v-else
      size="inline"
      :title="t('infra.k8s2.yamlUnavailable')"
      :text="t('infra.k8s2.objectsNotObserved')"
      data-test="k8s2-yaml-unavailable"
    />
  </div>
</template>
