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

<!-- A refused send names the secret and who to ask; consumer history pages render it from `secret_error:{code}:{name}`. -->
<template>
  <OBanner
    v-if="parsed"
    variant="error"
    icon="error"
    :content="t('secrets.errorCard.notSent', { name: parsed.name || t('secrets.none'), reason })"
    data-test="secret-error-card"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { parseSecretError, secretCodeText } from "./secretErrors";

const props = defineProps<{ error: string }>();
const { t } = useI18nTyped();

const parsed = computed(() => parseSecretError(props.error));
const reason = computed(() =>
  parsed.value ? (secretCodeText(t, parsed.value.code) ?? raw(parsed.value.code)) : raw(""),
);
</script>
