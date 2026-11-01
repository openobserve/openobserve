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
    class="border-border-default rounded-surface flex flex-col gap-3 border p-4"
    :aria-labelledby="headingId"
    data-test="settings-assistant-who"
  >
    <h2 :id="headingId" class="text-text-heading text-sm font-semibold">
      {{ t("assistant.settings.access.whoCanUse") }}
    </h2>
    <template v-if="page.rbacEnabled.value">
      <i18n-t
        keypath="assistant.settings.access.grantedPerRole"
        tag="p"
        class="text-text-body text-sm"
      >
        <template #whereToGrant>
          <router-link
            v-if="page.isAdmin.value"
            class="text-text-link-hover underline hover:no-underline"
            data-test="settings-assistant-roles-link"
            :to="{ name: 'roles', query: { org_identifier: page.org.value } }"
            >{{ whereToGrant }}</router-link
          >
          <template v-else>{{ whereToGrant }}</template>
        </template>
      </i18n-t>
      <ul class="flex flex-col gap-2" data-test="settings-assistant-builtin-roles">
        <li
          v-for="role in BUILT_IN"
          :key="role.value"
          class="flex flex-wrap items-center gap-2 text-sm"
        >
          <OTag type="userRole" :value="role.value" />
          <span class="text-text-body">{{ t(role.accessKey) }}</span>
        </li>
      </ul>
      <p class="text-text-secondary text-sm">{{ t("assistant.settings.access.noRole") }}</p>
    </template>
    <p v-else class="text-text-body text-sm" data-test="settings-assistant-rbac-off">
      {{ t("assistant.settings.access.rbacOff") }}
    </p>
    <p
      v-if="!page.isAdmin.value"
      class="text-text-body text-sm"
      data-test="settings-assistant-own-access"
    >
      {{ t("assistant.settings.access.you", { access: ownAccess }) }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, useId } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import { useI18nTyped, type I18nKey } from "@/types/i18n";

import { useAssistantSettingsPage } from "./useAssistantSettingsPage";

const BUILT_IN: { value: string; accessKey: I18nKey }[] = [
  { value: "admin", accessKey: "assistant.settings.access.builtInAdmin" },
  { value: "editor", accessKey: "assistant.settings.access.builtInEditor" },
  { value: "viewer", accessKey: "assistant.settings.access.builtInViewer" },
];

const { t } = useI18nTyped();
const page = useAssistantSettingsPage();
const headingId = useId();

const whereToGrant = computed(() =>
  t("assistant.gate.whereToGrant", {
    iam: t("menu.iam"),
    roles: t("iam.roles"),
    group: t("iam.modules.groups.assistant"),
  }),
);

const ownAccess = computed(() => {
  const cap = page.capability.value;
  if (cap.canChat === "no") return t("assistant.settings.access.youNone");
  if (cap.canChat === "unknown") return t("assistant.settings.access.youUnknown");
  return cap.canShare === "yes"
    ? t("assistant.settings.access.youChatShare")
    : t("assistant.settings.access.youChat");
});
</script>
