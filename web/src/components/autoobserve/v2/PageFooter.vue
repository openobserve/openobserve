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
  <footer
    class="text-text-secondary mx-auto flex max-w-[80ch] flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 text-center text-sm leading-relaxed"
    data-test="autoobserve2-footer"
  >
    <p class="text-pretty">
      <OIcon
        name="verified-user"
        size="sm"
        class="text-text-muted me-1 inline-block align-text-bottom"
      />
      {{ t("autoobserve2.footer.text") }}
    </p>
    <div class="flex flex-wrap items-center justify-center gap-x-1 gap-y-1">
      <OButton
        variant="ghost-primary"
        size="xs"
        icon-right="arrow-forward"
        data-test="autoobserve2-footer-coverage"
        @click="emit('open-coverage')"
      >
        {{ t("autoobserve2.footer.seeAll") }}
      </OButton>
      <OButton
        variant="ghost-primary"
        size="xs"
        icon-right="arrow-forward"
        data-test="autoobserve2-footer-activity"
        @click="emit('open-activity')"
      >
        {{ t("autoobserve2.footer.seeChanges") }}
      </OButton>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const emit = defineEmits<{ "open-coverage": []; "open-activity": [] }>();

const { t } = useI18nTyped();
</script>
