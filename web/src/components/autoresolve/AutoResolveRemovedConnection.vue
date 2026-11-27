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
  <OTag
    variant="error-outline"
    :size="size"
    icon="link-off"
    class="max-w-full"
    :removable="removable"
    :remove-label="t('autoresolve.connection.removeConnection', { name: raw(name) })"
    data-test="autoresolve-removed-connection"
    @remove="emit('remove')"
  >
    <i18n-t
      keypath="autoresolve.connection.removedChip"
      tag="span"
      scope="global"
      class="flex min-w-0 whitespace-pre"
    >
      <template #name>
        <OTruncatedText class="min-w-0">{{ raw(name) }}</OTruncatedText>
      </template>
    </i18n-t>
  </OTag>
</template>

<script setup lang="ts">
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { BadgeSize } from "@/lib/core/Badge/OBadge.types";
import { raw, useI18nTyped } from "@/types/i18n";

withDefaults(
  defineProps<{
    /** The connection's last known name. */
    name: string;
    removable?: boolean;
    size?: BadgeSize;
  }>(),
  { removable: false, size: "sm" },
);

const emit = defineEmits<{ remove: [] }>();

const { t } = useI18nTyped();
</script>
