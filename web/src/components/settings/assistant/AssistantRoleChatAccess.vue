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
  <section
    v-if="page.isAdmin.value && page.rbacEnabled.value"
    class="border-border-default rounded-surface flex flex-col gap-3 border p-4"
    :aria-labelledby="headingId"
    data-test="settings-assistant-role-access"
  >
    <h2 :id="headingId" class="text-text-heading text-sm font-semibold">
      {{ t("assistant.settings.access.roles.title") }}
    </h2>
    <div v-if="access.isPending.value" class="flex flex-col gap-2">
      <OSkeleton v-for="n in 3" :key="n" type="rect" class="h-6 w-full max-w-120" />
    </div>
    <p
      v-else-if="access.isError.value"
      class="text-text-body text-sm"
      data-test="settings-assistant-role-access-error"
    >
      {{ t("assistant.settings.access.roles.loadFailed") }}
      <OButton
        variant="ghost-primary"
        size="xs"
        data-test="settings-assistant-role-access-retry"
        @click="access.refetch()"
      >
        {{ t("common.retry") }}
      </OButton>
    </p>
    <ul v-else class="flex flex-col gap-2">
      <li
        v-for="row in access.data.value?.roles ?? []"
        :key="row.role"
        class="flex flex-wrap items-center gap-2 text-sm"
        :data-test="`settings-assistant-role-${row.role}`"
      >
        <OTruncatedText class="text-text-body max-w-60">{{ raw(row.role) }}</OTruncatedText>
        <OTag
          variant="default-soft"
          :label="
            row.chat === null
              ? t('assistant.settings.access.roles.unknown')
              : row.chat
                ? t('assistant.settings.access.roles.chat')
                : t('assistant.settings.access.roles.noChat')
          "
          :data-test="`settings-assistant-role-${row.role}-access`"
        />
        <router-link
          v-if="row.chat === false"
          class="text-text-link-hover underline hover:no-underline max-md:inline-flex max-md:min-h-11 max-md:items-center"
          :to="{
            name: 'editRole',
            params: { role_name: row.role },
            query: { org_identifier: page.org.value, module: 'assistant', focus: 'ai' },
          }"
          :aria-label="t('assistant.settings.access.roles.grantNamed', { role: row.role })"
          :data-test="`settings-assistant-grant-chat-${row.role}`"
          >{{ t("assistant.settings.access.roles.grant") }}</router-link
        >
      </li>
    </ul>
    <p
      v-if="access.data.value && access.data.value.total > access.data.value.roles.length"
      class="text-text-secondary text-sm"
      data-test="settings-assistant-role-access-capped"
    >
      <i18n-t keypath="assistant.settings.access.roles.capped" tag="span">
        <template #shown>{{ access.data.value.roles.length }}</template>
        <template #total>{{ access.data.value.total }}</template>
        <template #link>
          <router-link
            class="text-text-link-hover underline hover:no-underline"
            :to="{ name: 'roles', query: { org_identifier: page.org.value } }"
            data-test="settings-assistant-role-access-all"
            >{{ t("assistant.settings.access.roles.allRoles") }}</router-link
          >
        </template>
      </i18n-t>
    </p>
  </section>
</template>

<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { computed, useId } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { roleChatAccessQuery } from "@/services/assistant_roles.queries";
import { raw, useI18nTyped } from "@/types/i18n";

import { useAssistantSettingsPage } from "./useAssistantSettingsPage";

const { t } = useI18nTyped();
const page = useAssistantSettingsPage();
const headingId = useId();

const access = useQuery(
  computed(() => ({
    ...roleChatAccessQuery(page.org.value),
    enabled: !!page.org.value && page.isAdmin.value && page.rbacEnabled.value,
  })),
);

function refresh() {
  return access.refetch();
}

defineExpose({ refresh });
</script>
