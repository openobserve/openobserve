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
  <p
    class="text-text-secondary flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs"
    role="note"
    data-test="agent-home-ask-note"
    :data-reason="reason"
  >
    <OIcon name="info-outline" size="xs" class="shrink-0" />
    <span>{{ why }}</span>
    <span v-if="who" data-test="agent-home-ask-note-admins">· {{ who }}</span>
  </p>
</template>

<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { computed } from "vue";

import { adminEmails } from "@/components/ai-assistant/gate/AssistantAskAdminPopover.vue";
import { hostOrgName, useAssistantName } from "@/composables/assistant";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { orgUsersQuery } from "@/services/users.queries";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

import type { AskOffReason } from "./homeState";

// Two names say who to ask; the full list sits behind the gate's Ask an admin.
const ADMIN_NAMES_SHOWN = 2;

const props = defineProps<{ reason: AskOffReason; org: string }>();

const { t } = useI18nTyped();
const { product } = useAssistantName();

// A disabled observer reads the IAM users page's cache, so a role that cannot list members sends nothing.
const members = useQuery(
  computed(() => ({ ...orgUsersQuery(props.org), enabled: false as const })),
);

const why = computed<I18nText>(() => t(`home.agent.askOff.${props.reason}`, { product }));
const who = computed<I18nText | null>(() => {
  if (props.reason === "oss") return null;
  const admins = adminEmails(members.data.value);
  if (admins.length === 0)
    return t("assistant.askAdmin.anAdminOf", { org: hostOrgName(props.org) });
  return t("home.agent.admins", { names: raw(admins.slice(0, ADMIN_NAMES_SHOWN).join(", ")) });
});
</script>
