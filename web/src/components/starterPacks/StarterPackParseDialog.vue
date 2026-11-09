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
import { computed, ref, watch } from "vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import type { StreamReader, StreamReaderKind } from "@/composables/starterPacks/nginxParse";
import type { RawLogNotice } from "@/composables/starterPacks/rawLogs";
import type { ParsePreview } from "@/composables/starterPacks/useNginxParse";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";

const props = defineProps<{
  notice: RawLogNotice;
  load: (notice: RawLogNotice) => Promise<[ParsePreview | null, StreamReader[]]>;
  apply: (notice: RawLogNotice, preview: ParsePreview) => Promise<void>;
}>();
const open = defineModel<boolean>("open", { default: false });

const { t } = useI18nTyped();

const READER_KEYS: Record<StreamReaderKind, I18nKey> = {
  dashboard: "starterPacks.parse.readerDashboard",
  alert: "starterPacks.parse.readerAlert",
  savedView: "starterPacks.parse.readerSavedView",
  pipeline: "starterPacks.parse.readerPipeline",
};

const state = ref<"loading" | "ready" | "error" | "unparsed">("loading");
const preview = ref<ParsePreview | null>(null);
const readers = ref<StreamReader[]>([]);
const saving = ref(false);

const blocked = computed(() => readers.value.some((reader) => reader.realtimeSource));

const fieldsLine = (added: Record<string, unknown>) =>
  raw(
    Object.entries(added)
      .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
      .join(" · "),
  );

let runs = 0;
const run = async () => {
  runs += 1;
  const current = runs;
  state.value = "loading";
  try {
    const [found, listed] = await props.load(props.notice);
    if (current !== runs) return;
    preview.value = found;
    readers.value = listed;
    state.value = found ? "ready" : "unparsed";
  } catch {
    if (current === runs) state.value = "error";
  }
};

watch(open, (now) => now && void run(), { immediate: true });

const confirm = async () => {
  if (!preview.value) return;
  saving.value = true;
  // A failure leaves an incomplete record whose Undo sits on the Library banner behind this dialog.
  await props.apply(props.notice, preview.value).catch(() => {});
  saving.value = false;
  open.value = false;
};
</script>

<template>
  <ODialog
    v-model:open="open"
    size="md"
    :title="t('starterPacks.parse.title', { stream: raw(notice.stream) })"
    :primary-button-label="t('starterPacks.parse.confirm')"
    :primary-button-disabled="state !== 'ready' || blocked || saving"
    primary-button-data-test="starter-pack-parse-confirm-btn"
    :secondary-button-label="t('common.cancel')"
    data-test="starter-pack-parse-dialog"
    @click:primary="confirm"
    @click:secondary="open = false"
  >
    <div class="flex flex-col gap-3 text-sm">
      <div v-if="state === 'loading'" class="flex flex-col gap-2">
        <OSkeleton v-for="index in 3" :key="index" type="rect" class="h-6 w-full" />
      </div>
      <OText v-else-if="state === 'error'" class="text-text-error">{{
        t("starterPacks.parse.loadFailed")
      }}</OText>
      <OText v-else-if="state === 'unparsed'" data-test="starter-pack-parse-unparsed">{{
        t("starterPacks.parse.unparsed")
      }}</OText>
      <template v-else-if="preview">
        <OText variant="meta">{{
          t("starterPacks.parse.previewNote", { count: preview.rows.length })
        }}</OText>
        <div
          v-for="(row, index) in preview.rows"
          :key="index"
          class="border-border-default flex flex-col gap-1 border-b pb-2"
          data-test="starter-pack-parse-preview-row"
        >
          <OText variant="meta" class="truncate">{{ raw(row.line) }}</OText>
          <OText v-if="Object.keys(row.added).length" class="wrap-break-word">{{
            t("starterPacks.parse.adds", { fields: fieldsLine(row.added) })
          }}</OText>
          <OText v-else class="text-text-secondary">{{
            t("starterPacks.parse.addsNothing")
          }}</OText>
        </div>
        <strong>{{ t("starterPacks.parse.readersTitle") }}</strong>
        <OText v-if="!readers.length" variant="meta" data-test="starter-pack-parse-no-readers">{{
          t("starterPacks.parse.noReaders")
        }}</OText>
        <ul v-else class="flex flex-col gap-1" data-test="starter-pack-parse-readers">
          <li v-for="reader in readers" :key="`${reader.kind}/${reader.name}`">
            {{ t(READER_KEYS[reader.kind], { name: raw(reader.name) }) }}
          </li>
        </ul>
        <OText v-if="blocked" class="text-text-error" data-test="starter-pack-parse-blocked">{{
          t("starterPacks.parse.blocked")
        }}</OText>
        <OText variant="meta">{{ t("starterPacks.parse.newDataOnly") }}</OText>
        <OText variant="meta">{{ t("starterPacks.parse.undoNote") }}</OText>
      </template>
    </div>
  </ODialog>
</template>
