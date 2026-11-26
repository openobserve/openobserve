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

<!-- The installation status line for root users. The request itself decides who is root: a 403
     renders nothing. The body has one shape, so `enabled` and `tls` alone choose the line. -->
<template>
  <div
    v-if="installation"
    class="border-border-subtle rounded-default flex flex-col gap-2 border p-3"
    data-test="status-page-domain-installation"
  >
    <p
      v-if="!installation.enabled"
      class="text-text-secondary text-sm"
      data-test="status-page-domain-installation-off"
    >
      {{ t("statusPages.domains.installation.off") }}
    </p>
    <p
      v-else-if="installation.tls === 'proxy'"
      class="text-text-secondary text-sm"
      data-test="status-page-domain-installation-proxy"
    >
      {{ t("statusPages.domains.installation.proxy") }}
    </p>
    <template v-else>
      <div class="flex items-center justify-between gap-2">
        <span class="text-text-heading text-sm font-medium">
          {{ t("statusPages.domains.installation.title") }}
        </span>
        <OButton
          variant="outline"
          size="sm"
          :disabled="checking"
          data-test="status-page-domain-installation-check"
          @click="checkAgain"
        >
          {{ t("statusPages.domains.installation.checkAgain") }}
        </OButton>
      </div>
      <p
        v-if="notReady"
        class="text-text-secondary text-sm"
        data-test="status-page-domain-installation-not-ready"
      >
        {{ t("statusPages.domains.installation.notReady") }}: {{ notReady }}
      </p>
      <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <template v-for="row in rows" :key="row.id">
          <dt class="text-text-label">{{ t(row.label) }}</dt>
          <dd
            class="text-text-secondary min-w-0 break-words"
            :data-test="`status-page-domain-installation-${row.id}`"
          >
            {{ row.value }}
          </dd>
        </template>
      </dl>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import statusPagesService, { type DomainInstallation } from "@/services/status_pages";
import { formatDomainTime } from "./domainMessages";

const props = defineProps<{ orgIdentifier: string }>();

const { t } = useI18nTyped();
const store = useStore();

const installation = ref<DomainInstallation | null>(null);
const checking = ref(false);

const NOT_READY_KEYS: Record<string, I18nKey> = {
  no_key: "statusPages.domains.installation.notReadyReason.noKey",
  key_mismatch: "statusPages.domains.installation.notReadyReason.keyMismatch",
  epoch_mismatch: "statusPages.domains.installation.notReadyReason.epochMismatch",
  no_listener: "statusPages.domains.installation.notReadyReason.noListener",
  target_check_failed: "statusPages.domains.installation.notReadyReason.targetCheckFailed",
  wildcard_missing: "statusPages.domains.installation.notReadyReason.wildcardMissing",
};

const KEY_CHECK_KEYS: Record<string, I18nKey> = {
  ok: "statusPages.domains.installation.keyOk",
  missing: "statusPages.domains.installation.keyMissing",
  mismatch: "statusPages.domains.installation.keyMismatch",
};

const fmt = (us: number) => formatDomainTime(us, store.state.timezone);
const yesNo = (value: boolean | null) =>
  t(value == null ? "common.unknown" : value ? "common.yes" : "common.no");

const notReady = computed<I18nText | null>(() => {
  const reason = installation.value?.not_ready_reason;
  if (!reason) return null;
  const key: I18nKey | undefined = NOT_READY_KEYS[reason];
  return key ? t(key) : raw(reason);
});

interface Row {
  id: string;
  label: I18nKey;
  value: I18nText;
}

const rows = computed<Row[]>(() => {
  const i = installation.value;
  if (!i?.enabled || i.tls !== "built_in") return [];
  const unknown = t("common.unknown");
  const none = t("common.none");
  return [
    {
      id: "target",
      label: "statusPages.domains.installation.target",
      value: i.target ? raw(i.target) : unknown,
    },
    {
      id: "target-resolves",
      label: "statusPages.domains.installation.targetResolves",
      value: yesNo(i.target_resolves),
    },
    {
      id: "wildcard-resolves",
      label: "statusPages.domains.installation.wildcardResolves",
      value: yesNo(i.wildcard_resolves),
    },
    {
      id: "certificate",
      label: "statusPages.domains.installation.targetCertificate",
      value:
        i.target_certificate_expires_at == null ? none : raw(fmt(i.target_certificate_expires_at)),
    },
    {
      id: "key-check",
      label: "statusPages.domains.installation.keyCheck",
      value: i.key_check ? t(KEY_CHECK_KEYS[i.key_check]) : unknown,
    },
    {
      id: "listeners",
      label: "statusPages.domains.installation.listeners",
      value: listenersText(i),
    },
    {
      id: "last-validation",
      label: "statusPages.domains.installation.lastValidation",
      value: i.last_validation_at == null ? none : raw(fmt(i.last_validation_at)),
    },
    {
      id: "last-ca-error",
      label: "statusPages.domains.installation.lastCaError",
      value: i.last_ca_error ? raw(`${fmt(i.last_ca_error.at)}: ${i.last_ca_error.message}`) : none,
    },
    {
      id: "visitor-addresses",
      label: "statusPages.domains.installation.visitorAddresses",
      value: yesNo(i.visitor_addresses_visible),
    },
  ];
});

function listenersText(i: DomainInstallation): I18nText {
  if (!i.listeners.length) return t("statusPages.domains.installation.listenersNone");
  let lastSync: number | null = null;
  for (const listener of i.listeners) {
    if (listener.last_sync_at != null && (lastSync == null || listener.last_sync_at > lastSync)) {
      lastSync = listener.last_sync_at;
    }
  }
  return t("statusPages.domains.installation.listenersValue", {
    count: i.listeners.length,
    time: lastSync == null ? t("common.unknown") : fmt(lastSync),
  });
}

onMounted(async () => {
  try {
    const res = await statusPagesService.getDomainInstallation(props.orgIdentifier);
    installation.value = res.data;
  } catch (err: any) {
    // A 403 means the user is not root: the line is not for them, and that is not an error.
    if (err?.response?.status !== 403) {
      console.error("[status-pages] failed to load the domain installation", err);
    }
  }
});

async function checkAgain() {
  checking.value = true;
  try {
    const res = await statusPagesService.checkDomainInstallation(props.orgIdentifier);
    installation.value = res.data;
  } catch (err: any) {
    toast({
      variant: "error",
      message:
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        t("statusPages.domains.installation.checkAgainFailed"),
    });
    console.error("[status-pages] installation check failed", err);
  } finally {
    checking.value = false;
  }
}
</script>
