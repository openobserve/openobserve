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
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useRefreshMatches } from "@/composables/starterPacks/useRefreshMatches";
import { useI18nTyped } from "@/types/i18n";

const props = defineProps<{ org: string }>();
const emit = defineEmits<{ checked: [] }>();

const { t } = useI18nTyped();
const checker = useRefreshMatches(props.org);
const refresh = async () => {
  if (await checker.refresh()) emit("checked");
};
</script>

<template>
  <div class="flex items-center gap-2" data-test="starter-packs-match-check">
    <OButton
      variant="outline"
      size="icon-md"
      icon-left="refresh"
      :loading="checker.running.value"
      :disabled="checker.running.value"
      :aria-label="
        checker.running.value
          ? t('starterPacks.matchCheck.checking')
          : t('starterPacks.matchCheck.checkAgain')
      "
      data-test="starter-packs-refresh-btn"
      @click="refresh"
    />
    <OText
      v-if="checker.running.value"
      variant="meta"
      class="whitespace-nowrap"
      data-test="starter-packs-checking"
      >{{ t("starterPacks.matchCheck.checking") }}</OText
    >
    <span
      v-else-if="checker.checkedLabel.value && checker.checkedTip.value"
      class="flex items-center gap-1.5"
    >
      <span aria-hidden="true" class="bg-text-muted size-2 shrink-0 rounded-full" />
      <OTooltip :content="checker.checkedTip.value">
        <OText
          variant="meta"
          tabindex="0"
          class="whitespace-nowrap underline decoration-dotted"
          data-test="starter-packs-checked"
          >{{ checker.checkedLabel.value }}</OText
        >
      </OTooltip>
    </span>
  </div>
</template>
