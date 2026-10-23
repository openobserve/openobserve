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
  <div class="flex flex-col gap-2">
    <OText
      v-if="!canReveal"
      variant="meta"
      as="p"
      data-test="workflow-http-credential-reveal-denied"
    >
      {{ t("workflow.http.revealDenied") }}
    </OText>
    <div class="border-border-default rounded-default overflow-hidden border">
      <OTable
        :data="rows"
        :columns="columns"
        row-key="id"
        pagination="none"
        :show-global-filter="false"
        :cell-overflow-tooltip="false"
        :frame="false"
        data-test="workflow-http-credentials"
      >
        <template #cell-value="{ row }">
          <div
            class="flex min-w-0 flex-col gap-0.5"
            :data-test="`workflow-http-credential-${row.id}-value`"
            data-o2-privacy="mask"
          >
            <OCodeCell
              v-if="revealed[row.id]"
              :value="revealed[row.id]"
              :tooltip="false"
              :copy="false"
              class="break-all"
            />
            <span v-else class="text-compact font-mono">{{ row.display_prefix }}</span>
            <OText
              v-if="revealError[row.id]"
              variant="meta"
              as="p"
              class="text-status-negative"
              :data-test="`workflow-http-credential-${row.id}-reveal-error`"
            >
              {{ revealErrorText(revealError[row.id]) }}
            </OText>
          </div>
        </template>

        <template #cell-created_at="{ row }">
          <OTimeCell :value="row.created_at" unit="us" mode="absolute" :timezone="timezone" />
        </template>

        <template #cell-created_by="{ row }">
          <div class="flex min-w-0 flex-col items-start gap-1">
            <span class="break-all">{{ row.created_by }}</span>
            <OTag
              v-if="!row.creator_in_org"
              variant="default-soft"
              size="sm"
              :label="t('workflow.http.creatorGone')"
              :data-test="`workflow-http-credential-${row.id}-creator-gone`"
            />
          </div>
        </template>

        <template #cell-last_used_at="{ row }">
          <OTimeCell
            :value="row.last_used_at"
            unit="us"
            mode="absolute"
            :timezone="timezone"
            :empty-label="t('workflow.http.never')"
          />
        </template>

        <template #cell-state="{ row }">
          <OTag
            v-if="row.state === 'active'"
            variant="success-soft"
            size="sm"
            dot
            :label="t('workflow.http.active')"
          />
          <div
            v-else-if="isLive(row)"
            class="flex flex-col items-start gap-0.5"
            data-test="workflow-http-credential-retiring"
          >
            <OTag variant="warning-soft" size="sm" dot :label="t('workflow.http.retiring')" />
            <OText variant="meta" as="span">{{ expiresText(row) }}</OText>
          </div>
          <OTag v-else variant="default-soft" size="sm" :label="t('workflow.http.expired')" />
        </template>

        <template #cell-actions="{ row }">
          <div class="flex items-center justify-end gap-1">
            <template v-if="canReveal && isLive(row)">
              <OButton
                variant="ghost"
                size="icon-xs-sq"
                :loading="revealing === row.id"
                :aria-label="
                  revealed[row.id]
                    ? t('ingestion.setupCard.hideToken')
                    : t('ingestion.setupCard.revealToken')
                "
                :data-test="`workflow-http-credential-${row.id}-show`"
                @click="toggleShow(row.id)"
              >
                <OIcon :name="revealed[row.id] ? 'visibility-off' : 'visibility'" size="sm" />
                <OTooltip
                  :content="
                    revealed[row.id]
                      ? t('ingestion.setupCard.hideToken')
                      : t('ingestion.setupCard.revealToken')
                  "
                  side="top"
                />
              </OButton>
              <OButton
                variant="ghost"
                size="icon-xs-sq"
                :aria-label="copyLabel"
                :data-test="`workflow-http-credential-${row.id}-copy`"
                @click="emit('copy', row.id)"
              >
                <OIcon name="content-copy" size="sm" />
                <OTooltip :content="copyLabel" side="top" />
              </OButton>
            </template>
            <OPopover
              v-if="canEdit"
              :open="confirmId === row.id"
              side="bottom"
              align="end"
              :aria-label="t('workflow.http.revoke')"
              @update:open="(open: boolean) => (confirmId = open ? row.id : null)"
            >
              <template #trigger>
                <OButton
                  variant="ghost-destructive"
                  size="xs"
                  :loading="revoking === row.id"
                  :data-test="`workflow-http-credential-${row.id}-revoke`"
                >
                  {{
                    row.state === "retiring"
                      ? t("workflow.http.revokeNow")
                      : t("workflow.http.revoke")
                  }}
                </OButton>
              </template>
              <div
                class="flex w-80 max-w-[calc(100vw-1.5rem)] flex-col gap-3 p-3"
                :data-test="`workflow-http-credential-${row.id}-revoke-popover`"
              >
                <OText as="p">
                  {{ t("workflow.http.revokeTitle", { prefix: raw(row.display_prefix) }) }}
                </OText>
                <div class="flex justify-end gap-2">
                  <OButton
                    variant="outline"
                    size="sm-action"
                    :data-test="`workflow-http-credential-${row.id}-revoke-cancel`"
                    @click="confirmId = null"
                  >
                    {{ t("common.cancel") }}
                  </OButton>
                  <OButton
                    variant="destructive"
                    size="sm-action"
                    :data-test="`workflow-http-credential-${row.id}-revoke-confirm`"
                    @click="confirmRevoke(row.id)"
                  >
                    {{ t("workflow.http.revoke") }}
                  </OButton>
                </div>
              </div>
            </OPopover>
          </div>
        </template>
      </OTable>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OCodeCell from "@/lib/core/Table/cells/OCodeCell.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { HttpAuthMode, HttpCredential } from "@/services/workflows";
import { isLiveCredential } from "@/plugins/workflows/useWorkflowHttpEndpoint";

const HOUR_US = 3_600_000_000;

const props = defineProps<{
  credentials: HttpCredential[];
  mode: HttpAuthMode;
  canEdit: boolean;
  canReveal: boolean;
  revoking: string | null;
  revealed: Readonly<Record<string, string>>;
  revealing: string | null;
  revealError: Readonly<Record<string, string>>;
}>();

const emit = defineEmits<{
  (e: "reveal", id: string): void;
  (e: "hide", id: string): void;
  (e: "copy", id: string): void;
  (e: "revoke", id: string): void;
}>();

const { t } = useI18nTyped();
const store = useStore();

const confirmId = ref<string | null>(null);

const timezone = computed<string>(() => store.state.timezone);
const isSigned = computed(() => props.mode === "signature");
const rows = computed(() => props.credentials.filter((c) => c.state !== "revoked"));
const copyLabel = computed(() =>
  isSigned.value ? t("workflow.http.copySecret") : t("workflow.http.copyToken"),
);

const columns = computed<OTableColumnDef<HttpCredential>[]>(() => [
  {
    id: "value",
    header: isSigned.value ? t("workflow.http.colSecret") : t("workflow.http.colToken"),
    accessorKey: "display_prefix",
    size: 200,
    meta: { align: "left", flex: true, cellOverflowTooltip: false },
  },
  {
    id: "created_at",
    header: t("workflow.http.colCreated"),
    accessorKey: "created_at",
    size: 130,
    meta: { align: "left" },
  },
  {
    id: "created_by",
    header: t("workflow.http.colCreatedBy"),
    accessorKey: "created_by",
    size: 200,
    meta: { align: "left" },
  },
  {
    id: "last_used_at",
    header: t("workflow.http.colLastUsed"),
    accessorKey: "last_used_at",
    size: 130,
    meta: { align: "left" },
  },
  {
    id: "state",
    header: t("workflow.http.colStatus"),
    accessorKey: "state",
    size: 120,
    meta: { align: "left" },
  },
  {
    id: "actions",
    header: t("workflow.http.colActions"),
    size: 150,
    meta: { align: "right" },
  },
]);

const isLive = (c: HttpCredential) => isLiveCredential(c);

// Hour precision, as the run list's reason line; a week reads in days.
const expiresText = (c: HttpCredential): I18nText => {
  const hours = Math.max(1, Math.ceil(((c.expires_at ?? 0) - Date.now() * 1000) / HOUR_US));
  if (hours < 48) return t("workflow.http.expiresInHours", { count: hours }, hours);
  const days = Math.round(hours / 24);
  return t("workflow.http.expiresInDays", { count: days }, days);
};

const revealErrorText = (reason: string): I18nText =>
  isSigned.value
    ? t("workflow.http.revealFailedSigned", { reason: raw(reason) })
    : t("workflow.http.revealFailed", { reason: raw(reason) });

const toggleShow = (id: string) => {
  if (props.revealed[id]) emit("hide", id);
  else emit("reveal", id);
};

const confirmRevoke = (id: string) => {
  confirmId.value = null;
  emit("revoke", id);
};
</script>
