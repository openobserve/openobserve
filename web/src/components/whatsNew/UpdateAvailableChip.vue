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
  <OPopover v-if="updateAvailable" v-model:open="open" side="bottom" align="end" :side-offset="6">
    <template #trigger>
      <OButton
        variant="warning"
        size="sm"
        icon-left="update"
        data-test="update-available-chip"
        :aria-label="t('whatsNew.updateAvailable')"
      >
        {{ t("whatsNew.updateAvailable") }}
      </OButton>
    </template>

    <div class="flex w-80 flex-col gap-3 p-3" data-test="update-available-popover">
      <OText variant="page-title" as="h3" class="text-sm font-semibold">
        {{ t("whatsNew.updateHeadline", { version: latestVersion }) }}
      </OText>

      <div
        class="bg-surface-subtle rounded-default flex items-center gap-2.5 px-3 py-2.5 font-mono text-sm tabular-nums"
      >
        <span class="text-text-muted">{{ raw(`v${runningVersion}`) }}</span>
        <OIcon name="arrow-forward" size="xs" class="text-text-muted shrink-0" />
        <span class="text-status-positive font-semibold">{{ raw(`v${latestVersion}`) }}</span>
        <OText variant="meta" class="text-text-muted ms-auto font-sans">
          {{ t("whatsNew.releasesBehind", { count: releasesBehind }, releasesBehind) }}
        </OText>
      </div>

      <OText v-if="latestRelease" variant="body" class="text-text-secondary text-sm">
        {{ latestRelease.title }}
      </OText>

      <!-- The command matters more than the announcement: an admin told to
           upgrade should not then have to go find how. -->
      <div class="flex flex-col gap-1.5">
        <div class="flex gap-1">
          <OButton
            v-for="method in UPGRADE_METHODS"
            :key="method.id"
            :variant="activeMethod === method.id ? 'ghost-primary' : 'ghost-muted'"
            size="xs"
            :aria-selected="activeMethod === method.id"
            :data-test="`update-method-${method.id}`"
            @click="activeMethod = method.id"
          >
            {{ method.label }}
          </OButton>
        </div>

        <div class="bg-surface-subtle border-border-default rounded-default flex gap-2 border p-2">
          <code
            class="text-text-body min-w-0 flex-1 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap"
            data-test="update-command"
          >
            {{ upgradeCommand }}
          </code>
          <OButton
            variant="ghost-muted"
            size="icon-xs"
            :aria-label="t('whatsNew.copyCommand')"
            data-test="update-copy-command"
            @click="copyCommand"
          >
            <OIcon name="content-copy" size="xs" />
          </OButton>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <OButton
          as="a"
          :href="UPGRADE_DOCS_URL"
          target="_blank"
          rel="noopener noreferrer"
          variant="primary"
          size="sm-action"
          data-test="update-upgrade-guide"
        >
          {{ t("whatsNew.upgradeGuide") }}
        </OButton>
        <OButton variant="ghost" size="sm-action" data-test="update-later" @click="open = false">
          {{ t("whatsNew.later") }}
        </OButton>
        <OButton
          variant="ghost-muted"
          size="sm-action"
          data-test="update-skip-version"
          @click="skipThisVersion"
        >
          {{ t("whatsNew.skipVersion") }}
        </OButton>
      </div>
    </div>
  </OPopover>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import { useWhatsNew } from "@/composables/useWhatsNew";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { raw, useI18nTyped } from "@/types/i18n";

type UpgradeMethodId = "helm" | "docker" | "binary";

const UPGRADE_DOCS_URL = "https://openobserve.ai/docs/";

/**
 * Install-method labels are product names, not copy — translating "Helm" is how
 * you ship a command nobody can run.
 */
const UPGRADE_METHODS = [
  { id: "helm" as const, label: raw("Helm") },
  { id: "docker" as const, label: raw("Docker") },
  { id: "binary" as const, label: raw("Binary") },
];

const { t } = useI18nTyped();
const {
  latestVersion,
  load,
  releases,
  releasesBehind,
  runningVersion,
  skipUpdate,
  updateAvailable,
} = useWhatsNew();

const open = ref(false);
const activeMethod = ref<UpgradeMethodId>("helm");

const latestRelease = computed(() => releases.value.find((r) => r.version === latestVersion.value));

const upgradeCommand = computed(() => {
  const version = latestVersion.value;
  switch (activeMethod.value) {
    case "docker":
      return raw(
        `docker pull public.ecr.aws/zinclabs/openobserve:v${version}\ndocker compose up -d`,
      );
    case "binary":
      return raw(
        `curl -L https://openobserve.ai/downloads/v${version} | tar xz\nsudo systemctl restart openobserve`,
      );
    default:
      return raw(
        `helm repo update openobserve\nhelm upgrade openobserve openobserve/openobserve --version ${version} -n openobserve`,
      );
  }
});

const copyCommand = () => {
  navigator.clipboard
    .writeText(upgradeCommand.value)
    .then(() => toast({ message: t("toastMessages.views.copiedToClipboard"), variant: "success" }));
};

const skipThisVersion = () => {
  skipUpdate();
  open.value = false;
};

onMounted(load);
</script>
