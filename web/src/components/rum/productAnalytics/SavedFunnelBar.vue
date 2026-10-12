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
  <div
    class="px-page-edge border-border-default flex items-center gap-2 border-b py-2"
    data-test="rum-analytics-funnel-saved-bar"
  >
    <OButton
      variant="ghost"
      size="icon-toolbar"
      icon-left="chevron-left"
      :aria-label="t('rum.analytics.saved.back')"
      data-test="rum-analytics-funnel-back-btn"
      @click="draft.toList()"
      ><OTooltip :content="t('rum.analytics.saved.back')"
    /></OButton>
    <span
      class="text-text-heading min-w-0 truncate text-sm font-semibold"
      data-test="rum-analytics-funnel-saved-name"
      >{{ opened ? opened.name : t("rum.analytics.saved.unsaved") }}</span
    >
    <OTag
      v-if="draft.dirty.value"
      :label="t('rum.analytics.saved.edited')"
      variant="warning-soft"
      size="sm"
      data-test="rum-analytics-funnel-dirty-tag"
    />
    <span
      v-if="permission === 'read'"
      class="text-text-secondary min-w-0 truncate text-xs max-md:hidden"
      data-test="rum-analytics-funnel-saved-read-only"
      >{{ t("rum.analytics.saved.readOnly") }}</span
    >
    <span class="ms-auto flex shrink-0 items-center gap-1">
      <span v-if="canWrite">
        <OButton
          variant="primary"
          size="sm"
          :disabled="!!saveBlocked"
          data-test="rum-analytics-funnel-save-btn"
          @click="dialogs?.save()"
          >{{ t("rum.analytics.saved.save") }}</OButton
        >
        <OTooltip v-if="saveBlocked" :content="saveBlocked" />
      </span>
      <ODropdown v-if="canWrite || opened" side="bottom" align="end">
        <template #trigger>
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="more-vert"
            :aria-label="t('rum.analytics.saved.more')"
            data-test="rum-analytics-funnel-saved-menu-btn"
            ><OTooltip :content="t('rum.analytics.saved.more')"
          /></OButton>
        </template>
        <ODropdownItem
          v-if="canWrite"
          icon-left="bookmark-add"
          :disabled="!!copyBlocked"
          data-test="rum-analytics-funnel-saved-menu-save-as"
          @select="dialogs?.saveAs()"
          >{{ t("rum.analytics.saved.saveAsNew") }}</ODropdownItem
        >
        <template v-if="opened">
          <template v-if="canWrite">
            <ODropdownItem
              icon-left="edit"
              data-test="rum-analytics-funnel-saved-menu-rename"
              @select="dialogs?.rename(opened)"
              >{{ t("rum.analytics.saved.rename") }}</ODropdownItem
            >
            <ODropdownItem
              icon-left="content-copy"
              :disabled="!!copyBlocked"
              data-test="rum-analytics-funnel-saved-menu-duplicate"
              @select="dialogs?.duplicate(opened, false)"
              >{{ t("rum.analytics.saved.duplicate") }}</ODropdownItem
            >
          </template>
          <ODropdownItem
            icon-left="link"
            data-test="rum-analytics-funnel-saved-menu-copy-link"
            @select="copyLink"
            >{{ t("rum.analytics.saved.copyLink") }}</ODropdownItem
          >
          <ODropdownItem
            v-if="canWrite"
            variant="destructive"
            icon-left="delete"
            data-test="rum-analytics-funnel-saved-menu-delete"
            @select="removeOpened"
            >{{ t("rum.analytics.saved.delete") }}</ODropdownItem
          >
        </template>
      </ODropdown>
    </span>
    <SavedFunnelDialogs
      ref="dialogs"
      :events="events"
      :events-ready="eventsReady"
      :compile-sql="compileSql"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import SavedFunnelDialogs from "@/components/rum/productAnalytics/SavedFunnelDialogs.vue";
import useProductAnalytics from "@/composables/rum/useProductAnalytics";
import useSavedFunnels from "@/composables/rum/useSavedFunnels";
import useFunnelDraft, {
  emptyFunnel,
  useFunnelLeaveGuard,
  useFunnelSaveBlockers,
} from "@/composables/rum/useFunnelDraft";
import { useI18nTyped } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import type { NamedEvent } from "@/utils/rum/productAnalyticsModel";
import type { FunnelDef } from "@/utils/rum/productAnalyticsQueries";

const props = defineProps<{
  events: NamedEvent[];
  eventsReady: boolean;
  compileSql: (d: FunnelDef) => string | null;
}>();
const { t } = useI18nTyped();
const pa = useProductAnalytics();
const sf = useSavedFunnels();
const draft = useFunnelDraft();
useFunnelLeaveGuard(draft);
const { copyBlocked, saveBlocked } = useFunnelSaveBlockers(props);
const { permission } = sf;
const dialogs = ref<InstanceType<typeof SavedFunnelDialogs> | null>(null);

const org = () => pa.toQuery().org_identifier as string;
const app = () => pa.state.app;
const opened = pa.openedFunnel;
const canWrite = computed(() => permission.value === "write");

// A deleted funnel is not left on screen as a draft, so the list it returns to starts clean.
const removeOpened = async () => {
  const f = opened.value;
  if (!f || !(await dialogs.value?.remove(f))) return;
  pa.funnel.value = emptyFunnel();
  await draft.toList();
};

const copyLink = async () => {
  await copyToClipboard(draft.builderLink(), t, {
    successMessage: t("rum.analytics.saved.linkCopied"),
  });
};

onMounted(() => void sf.ensure(org(), app()));
watch(app, (a) => a && void sf.ensure(org(), a));
</script>
