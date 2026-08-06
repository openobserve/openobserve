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

<script setup lang="ts">
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import { CHROME_WEB_STORE_URL } from "@/constants/synthetics";

defineProps<{
  /** Extension detected and connectable (the parent's live probe state). */
  connected?: boolean;
}>();

/** Whether the author confirmed the incognito toggle — the one step we cannot probe. */
const incognitoDone = defineModel<boolean>("incognitoDone", { default: false });

const { t } = useI18nTyped();
const store = useStore();

// Chrome UI element names — must stay in English across all locales
// because they reference the actual Chrome browser interface.
const CHROME_UI_LABELS = {
  allowIncognito: "Allow in Incognito",
  extensionsMenu: "Extensions",
  manageExtension: "Manage extension",
  recorderName: "OpenObserve Recorder",
} as const;

function openWebStore() {
  const url =
    store.state.zoConfig?.synthetics_recorder_extension_url || CHROME_WEB_STORE_URL;
  window.open(url, "_blank", "noopener");
}
</script>

<template>
  <div class="rounded-default border-border-default divide-border-default divide-y border">
    <!-- Step 1: Install the OpenObserve Recorder -->
    <div class="flex items-start gap-4 p-4">
      <span
        class="bg-accent text-text-inverse flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold"
        >{{ "1" }}</span
      >
      <div class="flex min-w-0 flex-1 items-start justify-between gap-4">
        <div class="flex flex-col items-start">
          <h4 class="text-text-heading m-0 mb-1 text-sm font-semibold">
            {{ t("synthetics.createBrowserTest.setupStep1Title") }}
          </h4>
          <p class="text-text-secondary m-0 text-xs">
            {{ t("synthetics.createBrowserTest.setupStep1Description") }}
          </p>
        </div>
        <OButton
          variant="outline"
          size="sm"
          class="shrink-0"
          icon-left="open-in-new"
          data-test="synthetics-setup-install-btn"
          @click="openWebStore"
        >
          {{ t("synthetics.createBrowserTest.setupInstallCta") }}
        </OButton>
      </div>
    </div>

    <!-- Step 2: Enable incognito mode -->
    <div class="flex items-start gap-4 p-4">
      <span
        class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold"
        :class="
          incognitoDone
            ? 'text-text-inverse bg-status-success-text!'
            : 'bg-accent text-text-inverse'
        "
        >{{ "2" }}</span
      >
      <div class="flex min-w-0 flex-1 justify-between">
        <div class="flex flex-col items-start">
          <h4 class="text-text-heading m-0 mb-1 text-sm font-semibold">
            {{ t("synthetics.createBrowserTest.setupStep3Title") }}
          </h4>
          <p class="text-text-secondary m-0 mb-1 text-xs">
            {{
              t("synthetics.createBrowserTest.setupStep3Description", {
                setting: CHROME_UI_LABELS.allowIncognito,
              })
            }}
          </p>
          <ul class="text-text-secondary m-0 flex list-disc flex-col gap-1 pl-4 text-xs">
            <i18n-t keypath="synthetics.createBrowserTest.setupStep3Point1" tag="li" scope="global">
              <template #icon>
                <OIcon name="extension" size="sm" aria-hidden="true" />
              </template>
              <template #menu>{{ CHROME_UI_LABELS.extensionsMenu }}</template>
              <template #more>
                <OIcon name="more-vert" size="sm" aria-hidden="true" />
              </template>
              <template #name>{{ CHROME_UI_LABELS.recorderName }}</template>
              <template #manage>{{ CHROME_UI_LABELS.manageExtension }}</template>
            </i18n-t>
            <li>
              {{
                t("synthetics.createBrowserTest.setupStep3Point2", {
                  setting: CHROME_UI_LABELS.allowIncognito,
                })
              }}
            </li>
          </ul>
        </div>
        <OSwitch
          v-model="incognitoDone"
          :label="t('synthetics.createBrowserTest.setupIncognitoDone')"
          data-test="synthetics-setup-incognito-switch"
        />
      </div>
    </div>

    <!-- Step 3: Click the extension icon to activate -->
    <div class="flex items-start gap-4 p-4" :class="{ 'opacity-60': !incognitoDone }">
      <span
        class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold"
        :class="
          connected
            ? 'text-text-inverse bg-status-success-text!'
            : incognitoDone
              ? 'bg-accent text-text-inverse'
              : 'bg-surface-subtle text-text-muted'
        "
        >{{ "3" }}</span
      >
      <div class="min-w-0 flex-1">
        <h4 class="text-text-heading m-0 mb-1 text-sm font-semibold">
          {{ t("synthetics.createBrowserTest.setupStep2Title") }}
        </h4>
        <ul class="text-text-secondary m-0 flex list-disc flex-col gap-1 pl-4 text-xs">
          <!-- i18n-t so the puzzle-piece icon renders inside the sentence while the
               copy stays one translatable key with correct word order. -->
          <i18n-t keypath="synthetics.createBrowserTest.setupStep2Point1" tag="li" scope="global">
            <template #icon>
              <OIcon name="extension" size="sm" aria-hidden="true" />
            </template>
            <template #menu>{{ CHROME_UI_LABELS.extensionsMenu }}</template>
            <template #name>{{ CHROME_UI_LABELS.recorderName }}</template>
          </i18n-t>
          <li>{{ t("synthetics.createBrowserTest.setupStep2Point2") }}</li>
          <li>
            {{
              t("synthetics.createBrowserTest.setupStep2Point3", {
                connected: t("synthetics.createBrowserTest.setupConnected"),
              })
            }}
          </li>
        </ul>
        <p v-if="connected" class="text-status-success-text! mt-2 text-xs font-medium">
          {{ t("synthetics.createBrowserTest.setupConnected") }}
        </p>
      </div>
    </div>
  </div>
</template>
