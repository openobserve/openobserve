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
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import type { AlertSectionId } from "./alertFormSections";
import type { AlertSectionTierView, AlertSettingId } from "./alertSettingTiers";

const props = defineProps<{
  section: AlertSectionId;
  view: AlertSectionTierView;
}>();

const emit = defineEmits<{
  (e: "add", id: AlertSettingId): void;
  (e: "toggle"): void;
}>();

const { t } = useI18nTyped();
const SEP = raw(" · ");
// Only the anomaly window hint has values, and a listed setting always holds its default.
const HINT_DEFAULTS = { fire: 100, buckets: 1 };

const links = computed(() => props.view.addLinks.filter((d) => !d.inline));
const messageLinks = computed(() => links.value.filter((d) => d.row === "message"));
const ownLinks = computed(() => links.value.filter((d) => d.row !== "message"));
</script>

<template>
  <div
    v-if="links.length || view.more.length"
    class="flex flex-col"
    :data-test="`add-alert-section-${section}-tiers`"
  >
    <div
      v-if="messageLinks.length"
      class="flex flex-col gap-0.5 py-1"
      :data-test="`add-alert-section-${section}-row-message`"
    >
      <p class="m-0 flex flex-wrap items-baseline gap-x-2">
        <span class="text-text-heading text-sm font-medium">{{ t("alerts.form.messageRow") }}</span>
        <span class="text-text-secondary text-xs">{{ t("alerts.form.messageRowHelp") }}</span>
      </p>
      <div class="flex flex-wrap items-center gap-x-1 gap-y-0.5">
        <OButton
          v-for="item in messageLinks"
          :key="item.id"
          variant="ghost-primary"
          size="sm"
          icon-left="add"
          :data-test="`add-alert-add-${item.id}`"
          @click="emit('add', item.id)"
        >
          {{ t(item.nameKey) }}
        </OButton>
      </div>
    </div>
    <div
      v-if="ownLinks.length || view.more.length"
      class="flex flex-wrap items-center gap-x-1 gap-y-0.5 py-1"
    >
      <OButton
        v-for="item in ownLinks"
        :key="item.id"
        variant="ghost-primary"
        size="sm"
        icon-left="add"
        :data-test="`add-alert-add-${item.id}`"
        @click="emit('add', item.id)"
      >
        {{ t(item.nameKey) }}
      </OButton>
      <div
        v-if="view.more.length"
        class="flex min-w-0 flex-1 basis-60 flex-wrap items-baseline gap-x-2 gap-y-0.5"
      >
        <OButton
          class="shrink-0"
          variant="ghost-primary"
          size="sm"
          :icon-left="view.expanded ? 'expand-less' : 'expand-more'"
          :aria-expanded="view.expanded"
          :data-test="`add-alert-section-${section}-more`"
          @click="emit('toggle')"
        >
          {{
            view.expanded
              ? t("alerts.tiers.showFewer")
              : t("alerts.form.moreOptions", { count: view.more.length })
          }}
        </OButton>
        <span
          v-if="!view.expanded"
          class="text-text-secondary min-w-0 flex-1 text-xs whitespace-normal"
          :data-test="`add-alert-section-${section}-more-names`"
        >
          <template v-for="(item, index) in view.more" :key="item.id"
            ><template v-if="index">{{ SEP }}</template
            >{{ t(item.nameKey)
            }}<template v-if="item.defaultHintKey"
              >{{ " " }}{{ t(item.defaultHintKey, HINT_DEFAULTS) }}</template
            ></template
          >
        </span>
      </div>
    </div>
  </div>
</template>
