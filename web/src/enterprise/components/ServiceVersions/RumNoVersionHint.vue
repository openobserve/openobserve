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
  <div
    role="status"
    class="flex min-w-0 flex-1 items-center gap-2"
    data-test="svcver-rum-noversion-hint"
  >
    <OIcon name="info" size="sm" class="text-text-secondary shrink-0" />
    <span
      class="text-text-body min-w-0 flex-1 truncate"
      :title="sentence"
      data-test="svcver-rum-noversion-sentence"
      ><i18n-t keypath="serviceVersions.rum.noVersion.hint" tag="span" scope="global">
        <template #version
          ><span class="font-mono">{{ VERSION_FIELD }}</span></template
        >
        <template #app
          ><b>{{ app }}</b></template
        >
        <template #range>{{ range }}</template>
        <template #init
          ><span class="font-mono">{{ INIT_CALL }}</span></template
        >
      </i18n-t></span
    >
    <div class="flex shrink-0 items-center gap-1">
      <OButton
        variant="outline"
        size="xs"
        icon-left="content-copy"
        data-test="svcver-rum-noversion-copy"
        @click="copy"
        >{{ t("serviceVersions.actions.copySnippet") }}</OButton
      >
      <OButton
        variant="ghost-primary"
        size="xs"
        data-test="svcver-rum-noversion-guide"
        @click="openGuide"
        >{{ t("serviceVersions.rum.noVersion.setupGuide") }}</OButton
      >
      <OButton
        variant="ghost"
        size="icon-xs"
        icon-left="close"
        :aria-label="t('serviceVersions.rum.noVersion.dismiss')"
        data-test="svcver-rum-noversion-dismiss"
        @click="emit('dismiss')"
      />
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { copyToClipboard } from "@/utils/clipboard";
const props = defineProps<{ app: string; env?: string; period?: string }>();
const emit = defineEmits<{ dismiss: [] }>();
const { t } = useI18nTyped();
const guide = "https://openobserve.ai/docs/user-guide/data-exploration/rum/setup/";
const VERSION_FIELD = "version";
const INIT_CALL = "openobserveRum.init";
const range = computed(() =>
  props.period
    ? t("serviceVersions.rum.noVersion.rangeRelative", { period: props.period })
    : t("serviceVersions.rum.noVersion.rangeAbsolute"),
);
// The row is one line, so a cut sentence stays readable on hover.
const sentence = computed(() =>
  t("serviceVersions.rum.noVersion.hint", {
    version: VERSION_FIELD,
    app: props.app,
    range: range.value,
    init: INIT_CALL,
  }),
);
const snippet = computed(
  () =>
    `openobserveRum.init({ service: ${JSON.stringify(props.app)}, env: ${JSON.stringify(props.env || "")}, version: import.meta.env.VITE_APP_VERSION })`,
);
function openGuide() {
  window.open(guide, "_blank", "noopener");
}
async function copy() {
  await copyToClipboard(snippet.value, t, {
    successMessage: t("serviceVersions.rum.noVersion.copied"),
  });
}
</script>
