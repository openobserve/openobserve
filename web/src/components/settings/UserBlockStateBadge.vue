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
  <OBadge
    v-if="state === 'email' || state === 'domain'"
    variant="error-soft"
    size="sm"
    data-test="user-block-state-blocked"
  >
    {{
      state === "email"
        ? t("settings.userManagementPage.blockedByEmail")
        : t("settings.userManagementPage.blockedByDomain")
    }}
    <OTooltip v-if="ssoOnly" :content="t('settings.userManagementPage.ssoOnlyHint')" />
  </OBadge>
  <span
    v-else-if="state === 'none'"
    class="text-text-secondary text-sm"
    data-test="user-block-state-none"
    >{{ t("settings.userManagementPage.notBlocked") }}</span
  >
  <span v-else class="text-text-muted text-sm" data-test="user-block-state-unknown">{{
    raw("—")
  }}</span>
</template>

<script setup lang="ts">
import { raw, useI18nTyped } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { ShownBlockState } from "@/utils/domainRestrictions";

// A native account is checked against the list only when it signs in through SSO.
withDefaults(defineProps<{ state: ShownBlockState; ssoOnly?: boolean }>(), { ssoOnly: false });

const { t } = useI18nTyped();
</script>
