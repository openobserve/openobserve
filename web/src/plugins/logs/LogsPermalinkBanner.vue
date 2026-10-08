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

<!-- The opened line link's outcome (4c C5) and the shared page notice (C7), in the permalink slot of the notice order. -->
<template>
  <OBanner
    v-if="banner"
    :variant="bannerVariant"
    inline-actions
    dense
    data-test="logs-permalink-banner"
    :data-state="banner.state"
    class="mx-2.5 mt-2"
  >
    <i18n-t
      v-if="hasStreamParam"
      :keypath="banner.messageKey"
      tag="span"
      scope="global"
      data-test="logs-permalink-banner-message"
    >
      <template #stream>
        <code class="font-mono">{{ raw(banner.stream) }}</code>
      </template>
    </i18n-t>
    <span v-else data-test="logs-permalink-banner-message">{{ message }}</span>
    <template #actions>
      <OButton
        v-if="actionVisible"
        variant="outline"
        size="sm"
        :loading="permalinkResolving"
        :data-test="actionDataTest"
        @click="onAction"
      >
        {{ actionLabel }}
      </OButton>
      <OButton
        variant="ghost"
        size="icon-sm"
        icon-left="close"
        :aria-label="t('search.linePermalink.bannerDismiss')"
        data-test="logs-permalink-banner-dismiss"
        @click="dismissPermalinkBanner"
      />
    </template>
  </OBanner>
  <OBanner
    v-else-if="sharedPageNotice"
    variant="info"
    inline-actions
    dense
    data-test="logs-shared-page-notice"
    class="mx-2.5 mt-2"
  >
    <span>{{ t("search.linePermalink.pageNotice", { page: sharedPageNotice.page }) }}</span>
    <template #actions>
      <OButton
        variant="outline"
        size="sm"
        data-test="logs-shared-page-go-btn"
        @click="emit('go-to-page', goToPage)"
      >
        {{ goToLabel }}
      </OButton>
      <OButton
        variant="ghost"
        size="icon-sm"
        icon-left="close"
        :aria-label="t('search.linePermalink.bannerDismiss')"
        data-test="logs-shared-page-notice-dismiss"
        @click="dismissPageNotice"
      />
    </template>
  </OBanner>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { LOG_LINK_I18N } from "@/utils/logs/logPermalink";
import {
  activePermalink,
  dismissPermalinkBanner,
  permalinkBanner,
  permalinkResolving,
  sharedLineRecord,
} from "@/composables/useLogs/useLogPermalink";
import { sharedPageNotice } from "@/composables/useLogs/useLogsUrl";
import { searchState } from "@/composables/useLogs/searchState";

const emit = defineEmits<{
  retry: [];
  "show-lines": [ts: number];
  "show-in-context": [];
  "go-to-page": [page: number];
}>();

const { t } = useI18nTyped();
const { searchObj } = searchState();

const VARIANT = { info: "info", warning: "warning", error: "error" } as const;

const banner = computed(() => permalinkBanner.value);

const bannerVariant = computed(() => (banner.value ? VARIANT[banner.value.severity] : "info"));

const hasStreamParam = computed(() => banner.value?.messageParams?.stream !== undefined);

const message = computed<I18nText>(() => {
  const current = banner.value;
  if (!current) return raw("");
  const params = { ...current.messageParams };
  if (typeof params.count === "number") params.count = params.count.toLocaleString();
  const key = current.messageKey as I18nKey;
  return current.pluralCount === null ? t(key, params) : t(key, params, current.pluralCount);
});

// Actions belong to the permalink still open; a banner left after a user search only informs.
const isCurrent = computed(
  () => !!banner.value && activePermalink.value?.generation === banner.value.generation,
);

const actionVisible = computed(() => {
  const key = banner.value?.actionKey;
  if (!key || !isCurrent.value) return false;
  return key !== LOG_LINK_I18N.actionShowInContext || !!sharedLineRecord.value;
});

const actionLabel = computed<I18nText>(() =>
  banner.value?.actionKey ? t(banner.value.actionKey as I18nKey) : raw(""),
);

const actionDataTest = computed(() => {
  switch (banner.value?.actionKey) {
    case LOG_LINK_I18N.actionRetry:
      return "logs-permalink-banner-retry";
    case LOG_LINK_I18N.actionShowLines:
      return "logs-permalink-banner-show-lines";
    default:
      return "logs-permalink-banner-show-in-context";
  }
});

// Same page count the paginator shows; it can grow while the page-count request lands.
const knownPages = computed<number | null>(() => {
  const results = searchObj.data.queryResults ?? {};
  const paged = searchObj.communicationMethod === "streaming" || searchObj.meta.jobId != "";
  const count = paged ? results.pagination?.length : results.partitionDetail?.paginations?.length;
  return count > 0 ? count : null;
});

const lastPage = computed(() => sharedPageNotice.value?.lastPage ?? knownPages.value);

const goToPage = computed(() => {
  const notice = sharedPageNotice.value;
  if (!notice) return 1;
  return lastPage.value !== null && notice.page > lastPage.value ? lastPage.value : notice.page;
});

const goToLabel = computed<I18nText>(() => {
  const notice = sharedPageNotice.value;
  if (notice && lastPage.value !== null && notice.page > lastPage.value) {
    return t("search.linePermalink.pageGoLast", { page: lastPage.value });
  }
  return t("search.linePermalink.pageGo", { page: notice?.page ?? 1 });
});

const dismissPageNotice = () => {
  sharedPageNotice.value = null;
};

const onAction = () => {
  const current = banner.value;
  if (!current) return;
  if (current.actionKey === LOG_LINK_I18N.actionRetry) emit("retry");
  else if (current.actionKey === LOG_LINK_I18N.actionShowLines) emit("show-lines", current.ts);
  else emit("show-in-context");
};
</script>
