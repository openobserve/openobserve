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
import { computed, inject } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import type { AlertSectionId } from "./alertFormSections";
import type { AlertSectionTierView, AlertSettingId } from "./alertSettingTiers";
import { ALERT_SETTING_TIERS_KEY } from "@/composables/alerts/useAlertSettingTiers";

const props = defineProps<{
  section: AlertSectionId;
  view: AlertSectionTierView;
}>();

const emit = defineEmits<{
  (e: "add", id: AlertSettingId): void;
  (e: "toggle"): void;
}>();

const { t } = useI18nTyped();
const tiers = inject(ALERT_SETTING_TIERS_KEY, null);
const placement = computed(() => tiers?.placementOrder(props.section) ?? []);
const SEP = raw(" · ");
// Only the anomaly window hint has values, and a listed setting always holds its default.

const links = computed(() => props.view.addLinks.filter((d) => !d.inline));
const messageLinks = computed(() => links.value.filter((d) => d.row === "message"));
const ownLinks = computed(() => links.value.filter((d) => d.row !== "message"));
</script>

<!-- A row like any other: "+ add" links and More options start at the control column, Show fewer takes More options' slot. -->
<template>
  <div
    v-if="links.length || view.more.length"
    class="flex flex-col"
    :data-test="`add-alert-section-${section}-tiers`"
  >
    <OSettingRow
      v-if="messageLinks.length"
      :label="t('alerts.form.messageRow')"
      :data-test="`add-alert-section-${section}-row-message`"
    >
      <div class="-ms-3.5 flex flex-wrap items-center gap-x-1 max-[85.5rem]:-ms-3">
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
    </OSettingRow>
    <OSettingRow
      v-if="ownLinks.length || view.more.length"
      :label="t('alerts.sections.optional.title')"
      :description="t('alerts.sections.optional.help')"
      fill
      data-test="add-alert-optional-heading"
    >
      <div class="-ms-3.5 flex flex-wrap items-center gap-x-1 max-[85.5rem]:-ms-3">
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
        <OButton
          v-if="view.more.length"
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
      </div>
      <template v-if="view.more.length && !view.expanded" #note>
        <span class="whitespace-normal" :data-test="`add-alert-section-${section}-more-names`">
          <template v-for="(item, index) in view.more" :key="item.id"
            ><template v-if="index">{{ SEP }}</template
            >{{ t(item.noteKey ?? item.nameKey) }}</template
          >
        </span>
      </template>
    </OSettingRow>
  </div>
  <div
    v-for="id in placement"
    :key="id"
    :ref="(el) => tiers?.setSlot(id, el as Element | null)"
    class="[&_[data-o-setting-row]]:border-border-default empty:hidden [&_[data-o-setting-row]]:border-t [&_[data-o-setting-row]]:py-2"
    :data-test="`add-alert-tier-slot-${id}`"
  />
</template>
