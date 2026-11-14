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
import ShareButton from "@/components/common/ShareButton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import { STARTER_PACKS_ENABLED } from "@/constants/starterPacks";
import type { StarterPackPage } from "@/composables/starterPacks/useStarterPackPage";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{ page: StarterPackPage }>();
const emit = defineEmits<{
  review: [];
  remove: [];
  turnOn: [];
  setUp: [];
  undo: [];
  openAlerts: [];
  openFolder: [];
}>();
const folderName = defineModel<string>("folderName", { required: true });

const { t } = useI18nTyped();
const flow = props.page.flow;
const pack = flow.pack;

const installed = computed(() => props.page.installed.value);
const manage = computed(() => installed.value && props.page.canManage.value);
// Alerts on with no destination are listed too, so they can be routed.
const offCount = computed(() => props.page.turn.listedRows.value.length);
const showReview = computed(
  () => STARTER_PACKS_ENABLED && manage.value && props.page.updates.available.value,
);
const showRevert = computed(
  () => STARTER_PACKS_ENABLED && manage.value && props.page.updates.canRevert.value,
);
const notSetUp = computed(() => props.page.pageState.value === "empty");
const folderOptions = computed(() =>
  [...new Set([pack.folder.name, ...props.page.folderNames.value])].map((name) => ({
    label: raw(name),
    value: name,
  })),
);
</script>

<template>
  <OButton
    v-if="showReview"
    variant="outline"
    size="sm-action"
    icon-left="arrow-upward"
    data-test="starter-pack-page-update-btn"
    @click="emit('review')"
  >
    {{ t("starterPacks.page.reviewUpdate") }}
  </OButton>
  <OButton
    v-if="manage"
    variant="outline-destructive"
    size="sm-action"
    icon-left="delete"
    data-test="starter-pack-page-remove-btn"
    @click="emit('remove')"
  >
    {{ t("starterPacks.landing.remove") }}
  </OButton>
  <OButton
    v-if="manage && offCount"
    variant="primary"
    size="sm-action"
    data-test="starter-pack-page-turn-on-btn"
    @click="emit('turnOn')"
  >
    {{ t("starterPacks.turnOn.submit", { count: offCount }, offCount) }}
  </OButton>
  <template v-if="notSetUp">
    <OSelect
      v-if="flow.isAdmin.value"
      v-model="folderName"
      width="md"
      :aria-label="t('starterPacks.page.setUpIn')"
      :options="folderOptions"
      label-key="label"
      value-key="value"
      data-test="starter-pack-page-folder-select"
    />
    <OButton
      variant="primary"
      size="sm-action"
      :disabled="!flow.isAdmin.value"
      :focusable-unavailable="!flow.isAdmin.value"
      icon-left="add"
      data-test="starter-pack-page-setup-btn"
      @click="emit('setUp')"
    >
      <template v-if="!flow.isAdmin.value" #unavailable-reason>{{
        t("starterPacks.page.adminsOnly")
      }}</template>
      {{ t("starterPacks.page.setUpPack") }}
    </OButton>
  </template>
  <ShareButton
    :url="flow.packLink()"
    variant="outline"
    size="icon-md"
    data-test="starter-pack-page-share-btn"
  />
  <ODropdown v-if="manage" align="end">
    <template #trigger>
      <OButton
        variant="outline"
        size="icon-md"
        icon-left="more-vert"
        :aria-label="t('common.more')"
        data-test="starter-pack-page-more-btn"
      />
    </template>
    <ODropdownItem
      icon-left="open-in-new"
      data-test="starter-pack-page-more-open-alerts"
      @select="emit('openAlerts')"
    >
      {{ t("starterPacks.page.openInAlerts") }}
    </ODropdownItem>
    <ODropdownItem
      icon-left="folder"
      data-test="starter-pack-page-more-open-folder"
      @select="emit('openFolder')"
    >
      {{ t("starterPacks.page.openFolder") }}
    </ODropdownItem>
    <template v-if="flow.canUndo.value || showRevert">
      <ODropdownSeparator />
      <ODropdownItem
        v-if="flow.canUndo.value"
        icon-left="undo"
        data-test="starter-pack-page-more-undo"
        @select="emit('undo')"
      >
        {{ t("starterPacks.page.undoSetup") }}
      </ODropdownItem>
      <ODropdownItem
        v-if="showRevert"
        icon-left="history"
        data-test="starter-pack-page-revert-btn"
        @select="page.updates.revert()"
      >
        {{ t("starterPacks.page.revertUpdate") }}
      </ODropdownItem>
    </template>
  </ODropdown>
</template>
