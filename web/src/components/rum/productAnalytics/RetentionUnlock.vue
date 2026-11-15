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
    icon="lock"
    :title="t('rum.analytics.retention.unlockTitle')"
    :text="t('rum.analytics.retention.unlockDescription', { reason })"
    data-test="rum-analytics-retention-unlock"
  >
    <template #actions>
      <OButton
        variant="secondary"
        icon="open-in-new"
        data-test="rum-analytics-retention-unlock-docs-link"
        @click="openDocs"
        >{{ t("rum.analytics.retention.docs") }}</OButton
      >
    </template>
    <template #extra>
      <div class="flex w-full max-w-xl flex-col gap-3 text-start">
        <OCodeBlock
          :code="snippet"
          lang="javascript"
          copyable
          data-test="rum-analytics-retention-unlock-snippet"
        />
        <span
          class="text-text-secondary text-xs"
          data-test="rum-analytics-retention-unlock-unidentified"
          >{{
            t(
              "rum.analytics.retention.unidentified",
              { count: addCommasToNumber(unidentifiedSessions) },
              unidentifiedSessions,
            )
          }}</span
        >
      </div>
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";

const DOCS_URL = "https://openobserve.ai/docs/user-guide/data-exploration/rum/setup/";

defineProps<{ unidentifiedSessions: number; reason: I18nText }>();
const { t } = useI18nTyped();

// The app's own user fields, never the setup card's constant id, which the identity check would reject.
const snippet = `openobserveRum.setUser({
  id: currentUser.id,
  name: currentUser.name,
  email: currentUser.email,
});`;

const openDocs = () => {
  window.open(DOCS_URL, "_blank", "noopener");
};
</script>
