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

<!--
  The identity band: WHAT failed (type + how it was handled), WHAT it said, and
  the handles you need to talk about it elsewhere (event id, deploy, when).
  Everything quantitative lives below in the impact strip.
-->
<template>
  <div>
    <OPageHeader
      :back="{ onClick: () => router.back(), dataTest: 'back-button' }"
      title-overflow="visible"
    >
      <template #title>
        <span class="flex min-w-0 items-center gap-2">
          <span class="truncate" data-test="error-header-error-type">{{ errorType }}</span>
          <OTag
            v-if="error.error_handling"
            :label="raw(error.error_handling)"
            :variant="isUnhandled ? 'error' : 'warning-outline'"
            size="xs"
            shape="rounded"
            class="shrink-0 uppercase"
            data-test="error-header-handling-badge"
          />
          <OTag
            v-if="error.source"
            :label="raw(error.source)"
            variant="default-soft"
            size="xs"
            shape="rounded"
            class="shrink-0"
            data-test="error-header-source-badge"
          />
        </span>
      </template>

      <template #actions>
        <ShareButton
          data-test="error-header-share-link-btn"
          :url="shareUrl"
          variant="outline"
          size="icon-toolbar"
          :tooltip="t('rum.errorDetail.copyLinkHint')"
        />
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="content-copy"
          :disabled="!error.error_id"
          data-test="error-header-copy-id-btn"
          @click="copyErrorId"
        >
          {{ t("rum.errorDetail.copyEventId") }}
          <OTooltip :content="raw(error.error_id) || t('rum.errorDetail.copyEventId')" />
        </OButton>
      </template>
    </OPageHeader>

    <div class="px-page-edge pt-2.5">
      <!--
        The message carries the whole diagnosis, so it gets a real alert surface
        rather than a line of body text: it is the first thing read and the thing
        pasted into a ticket.
      -->
      <OBanner
        variant="error-soft"
        dense
        icon="error-outline"
        role="alert"
        data-test="error-header-message"
      >
        <span class="font-mono break-words">{{ messageText }}</span>
      </OBanner>

      <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span class="text-text-secondary flex items-center gap-1">
          <OIcon name="schedule" size="xs" />
          <span data-test="error-header-timestamp">{{ occurredAt }}</span>
        </span>
        <span v-if="error.error_id" class="text-text-secondary flex min-w-0 items-center gap-1">
          <OIcon name="tag" size="xs" />
          <code class="min-w-0 truncate" :title="error.error_id" data-test="error-id">{{
            error.error_id
          }}</code>
        </span>
        <span v-if="route" class="text-text-secondary flex min-w-0 items-center gap-1">
          <OIcon name="web" size="xs" />
          <code class="min-w-0 truncate" :title="error.view_url" data-test="error-header-route">{{
            route
          }}</code>
        </span>
        <ODimensionChip v-if="error.service" dim-key="service" :value="error.service" />
        <ODimensionChip v-if="error.version" dim-key="version" :value="error.version" />
        <ODimensionChip v-if="error.env" dim-key="env" :value="error.env" />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { useRouter } from "vue-router";
import { copyToClipboard } from "@/utils/clipboard";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatDate } from "@/utils/date";
import { routeFromUrl } from "@/utils/rum/errorIssueUtils";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import ShareButton from "@/components/common/ShareButton.vue";
import { useRumShareUrl } from "@/composables/rum/useRumShareUrl";

const props = defineProps<{
  error: Record<string, any>;
}>();

const { t } = useI18nTyped();
const router = useRouter();
const { shareUrl } = useRumShareUrl();

// "handled" is the only safe state — treat missing/other values as unhandled.
const isUnhandled = computed(() => props.error.error_handling !== "handled");

const errorType = computed(() => raw(props.error.error_type) || t("rum.error"));

const messageText = computed(
  () => raw(props.error.error_message) || t("rum.errorDetail.noMessage"),
);

const route = computed(() => routeFromUrl(props.error.view_url));

const occurredAt = computed(() => {
  const micros = Number(props.error._timestamp) || 0;
  if (!micros) return raw(props.error.timestamp) || t("rum.unknown");
  return raw(formatDate(Math.floor(micros / 1000), "MMM DD, YYYY HH:mm:ss Z"));
});

const copyErrorId = () => {
  copyToClipboard(props.error.error_id, t, {
    successMessage: t("rum.copiedToClipboard"),
    timeout: 1500,
  });
};
</script>
