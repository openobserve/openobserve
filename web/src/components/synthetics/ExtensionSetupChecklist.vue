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
import { computed } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import { CHROME_UI_LABELS, CHROME_WEB_STORE_URL } from "@/constants/synthetics";

const props = defineProps<{
  /** Extension detected and connectable (the parent's live probe state). */
  connected?: boolean;
}>();

/**
 * Whether the author confirmed the install. The Web Store install happens in
 * another tab where this page cannot observe it, so the author attests to it —
 * a live bridge connection proves it and supersedes the checkbox.
 */
const installAck = defineModel<boolean>("installAck", { default: false });
/** Whether the author confirmed the incognito toggle — the one step we can never probe. */
const incognitoDone = defineModel<boolean>("incognitoDone", { default: false });

const { t } = useI18nTyped();
const store = useStore();

// Sequential gating: each task unlocks the next; done tasks collapse to a
// check row, later tasks render locked. The connect task completes only on the
// real probe signal, so the attestations can't skip into a broken recording.
const installDone = computed(() => Boolean(props.connected) || installAck.value);
const connectUnlocked = computed(() => installDone.value && incognitoDone.value);
const connectDone = computed(() => Boolean(props.connected) && incognitoDone.value);

function openWebStore() {
  const url = store.state.zoConfig?.synthetics_recorder_extension_url || CHROME_WEB_STORE_URL;
  window.open(url, "_blank", "noopener");
}

function refreshPage() {
  window.location.reload();
}
</script>

<template>
  <div class="rounded-default border-border-default divide-border-default divide-y border">
    <!-- Task 1: install — verified automatically by the bridge probe -->
    <div v-if="installDone" class="flex items-center gap-4 p-4">
      <span
        class="bg-status-success-text! text-text-inverse flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
      >
        <OIcon name="check" size="sm" aria-hidden="true" />
      </span>
      <h4 class="text-text-heading m-0 flex-1 text-sm font-semibold">
        {{ t("synthetics.createBrowserTest.setupInstallDone") }}
      </h4>
      <span v-if="connected" class="text-status-success-text! text-xs font-medium">
        {{ t("synthetics.createBrowserTest.setupDetectedAuto") }}
      </span>
      <OButton
        v-else
        variant="ghost"
        size="sm"
        class="text-text-link underline"
        data-test="synthetics-setup-install-undo"
        @click="installAck = false"
      >
        {{ t("synthetics.createBrowserTest.setupUndo") }}
      </OButton>
    </div>
    <div v-else class="flex items-start gap-4 p-4">
      <span
        class="bg-accent text-text-inverse flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold"
        >{{ "1" }}</span
      >
      <div class="flex min-w-0 flex-1 flex-col items-start">
        <h4 class="text-text-heading m-0 mb-1 text-sm font-semibold">
          {{ t("synthetics.createBrowserTest.setupInstallTitle") }}
        </h4>
        <p class="text-text-secondary m-0 mb-3 text-xs">
          {{ t("synthetics.createBrowserTest.setupInstallDescription") }}
        </p>
        <OButton
          variant="primary"
          size="sm"
          icon-left="open-in-new"
          data-test="synthetics-setup-install-btn"
          @click="openWebStore"
        >
          {{ t("synthetics.createBrowserTest.setupInstallCta") }}
        </OButton>
        <label
          class="border-border-default rounded-default mt-3 flex w-full cursor-pointer items-start gap-2 border p-3"
        >
          <OCheckbox
            :model-value="installAck"
            size="sm"
            data-test="synthetics-setup-install-ack"
            @update:model-value="installAck = $event === true"
          />
          <span class="flex min-w-0 flex-col">
            <span class="text-text-heading text-sm font-semibold">
              {{ t("synthetics.createBrowserTest.setupInstallAckLabel") }}
            </span>
            <span class="text-text-secondary text-xs">
              {{ t("synthetics.createBrowserTest.setupInstallAckNote") }}
            </span>
          </span>
        </label>
      </div>
    </div>

    <!-- Task 2: allow in Incognito — Chrome hides this setting from the page,
         so the author attests to it; locked until the recorder is detected -->
    <div v-if="!installDone" class="flex items-center gap-4 p-4 opacity-60">
      <span
        class="bg-surface-subtle text-text-muted flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold"
        >{{ "2" }}</span
      >
      <h4 class="text-text-muted m-0 flex-1 text-sm font-semibold">
        {{ t("synthetics.createBrowserTest.setupIncognitoTitle") }}
      </h4>
      <OIcon name="lock" size="sm" class="text-text-muted" aria-hidden="true" />
    </div>
    <div v-else-if="incognitoDone" class="flex items-center gap-4 p-4">
      <span
        class="bg-status-success-text! text-text-inverse flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
      >
        <OIcon name="check" size="sm" aria-hidden="true" />
      </span>
      <h4 class="text-text-heading m-0 flex-1 text-sm font-semibold">
        {{ t("synthetics.createBrowserTest.setupIncognitoDoneTitle") }}
      </h4>
      <OButton
        variant="ghost"
        size="sm"
        class="text-text-link underline"
        data-test="synthetics-setup-incognito-undo"
        @click="incognitoDone = false"
      >
        {{ t("synthetics.createBrowserTest.setupUndo") }}
      </OButton>
    </div>
    <div v-else class="flex items-start gap-4 p-4">
      <span
        class="bg-accent text-text-inverse flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold"
        >{{ "2" }}</span
      >
      <div class="flex min-w-0 flex-1 flex-col items-stretch">
        <h4 class="text-text-heading m-0 mb-1 text-sm font-semibold">
          {{ t("synthetics.createBrowserTest.setupIncognitoTitle") }}
        </h4>
        <p class="text-text-secondary m-0 mb-3 text-xs">
          {{ t("synthetics.createBrowserTest.setupIncognitoDescription") }}
        </p>
        <div class="bg-surface-subtle rounded-default mb-3 p-3">
          <p class="text-text-muted text-2xs m-0 mb-2 font-semibold tracking-wide uppercase">
            {{ t("synthetics.createBrowserTest.setupIncognitoCalloutTitle") }}
          </p>
          <ol class="text-text-secondary m-0 flex list-decimal flex-col gap-1 pl-4 text-xs">
            <i18n-t
              keypath="synthetics.createBrowserTest.setupIncognitoCalloutStep1"
              tag="li"
              scope="global"
            >
              <template #icon>
                <OIcon name="extension" size="sm" aria-hidden="true" />
              </template>
              <template #menu>{{ CHROME_UI_LABELS.extensionsMenu }}</template>
              <template #more>
                <OIcon name="more-vert" size="sm" aria-hidden="true" />
              </template>
              <template #name>
                <strong>{{ CHROME_UI_LABELS.recorderName }}</strong>
              </template>
              <template #manage>
                <strong>{{ CHROME_UI_LABELS.manageExtension }}</strong>
              </template>
            </i18n-t>
            <i18n-t
              keypath="synthetics.createBrowserTest.setupIncognitoCalloutStep2"
              tag="li"
              scope="global"
            >
              <template #setting>
                <strong>{{ CHROME_UI_LABELS.allowIncognito }}</strong>
              </template>
            </i18n-t>
          </ol>
        </div>
        <label
          class="border-border-default rounded-default flex cursor-pointer items-start gap-2 border p-3"
        >
          <OCheckbox
            :model-value="incognitoDone"
            size="sm"
            data-test="synthetics-setup-incognito-ack"
            @update:model-value="incognitoDone = $event === true"
          />
          <span class="flex min-w-0 flex-col">
            <span class="text-text-heading text-sm font-semibold">
              {{
                t("synthetics.createBrowserTest.setupIncognitoAckLabel", {
                  setting: CHROME_UI_LABELS.allowIncognito,
                })
              }}
            </span>
            <span class="text-text-secondary text-xs">
              {{ t("synthetics.createBrowserTest.setupIncognitoAckNote") }}
            </span>
          </span>
        </label>
      </div>
    </div>

    <!-- Task 3: connect — only the real probe signal completes it, so the
         attestations above can't skip into a broken recording -->
    <div v-if="connectDone" class="flex items-center gap-4 p-4">
      <span
        class="bg-status-success-text! text-text-inverse flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
      >
        <OIcon name="check" size="sm" aria-hidden="true" />
      </span>
      <h4 class="text-text-heading m-0 flex-1 text-sm font-semibold">
        {{ t("synthetics.createBrowserTest.setupConnectDone") }}
      </h4>
      <span class="text-status-success-text! text-xs font-medium">
        {{ t("synthetics.createBrowserTest.setupDetectedAuto") }}
      </span>
    </div>
    <div v-else-if="connectUnlocked" class="flex items-start gap-4 p-4">
      <span
        class="bg-accent text-text-inverse flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold"
        >{{ "3" }}</span
      >
      <div class="flex min-w-0 flex-1 flex-col items-start">
        <h4 class="text-text-heading m-0 mb-1 text-sm font-semibold">
          {{ t("synthetics.createBrowserTest.setupConnectTitle") }}
        </h4>
        <p class="text-text-secondary m-0 mb-3 text-xs">
          {{ t("synthetics.createBrowserTest.setupConnectDescription") }}
        </p>
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <OButton
            variant="outline"
            size="sm"
            icon-left="refresh"
            data-test="synthetics-setup-refresh-btn"
            @click="refreshPage"
          >
            {{ t("synthetics.createBrowserTest.setupConnectRefreshCta") }}
          </OButton>
          <i18n-t
            keypath="synthetics.createBrowserTest.setupConnectAlt"
            tag="span"
            scope="global"
            class="text-text-secondary text-xs"
          >
            <template #name>
              <strong>{{ CHROME_UI_LABELS.recorderName }}</strong>
            </template>
            <template #icon>
              <OIcon name="extension" size="sm" aria-hidden="true" />
            </template>
            <template #menu>{{ CHROME_UI_LABELS.extensionsMenu }}</template>
          </i18n-t>
        </div>
        <p class="text-text-secondary m-0 flex items-center gap-2 text-xs">
          <OIcon
            name="progress-activity"
            size="sm"
            class="flex-shrink-0 animate-spin"
            aria-hidden="true"
          />
          {{
            t("synthetics.createBrowserTest.setupConnectWaiting", {
              connected: t("synthetics.createBrowserTest.setupConnectDone"),
            })
          }}
        </p>
      </div>
    </div>
    <div v-else class="flex items-center gap-4 p-4 opacity-60">
      <span
        class="bg-surface-subtle text-text-muted flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold"
        >{{ "3" }}</span
      >
      <h4 class="text-text-muted m-0 flex-1 text-sm font-semibold">
        {{ t("synthetics.createBrowserTest.setupConnectTitle") }}
      </h4>
      <OIcon name="lock" size="sm" class="text-text-muted" aria-hidden="true" />
    </div>
  </div>
</template>
