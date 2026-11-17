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
  <BaseImport
    ref="baseImportRef"
    :title="t('slos.import.title')"
    test-prefix="slo"
    class="min-h-0 flex-1"
    :is-importing="importing || foldersLoading"
    @back="goToList(initialFolder)"
    @cancel="goToList(initialFolder)"
    @import="importJson"
  >
    <template #url-input-section="{ url, updateUrl }">
      <div class="my-[0.725rem] flex items-end gap-2 max-md:flex-wrap">
        <div class="w-[69%] max-md:w-full">
          <OInput
            data-test="slo-import-url-input"
            :model-value="url"
            size="md"
            :label="t('dashboard.addURL')"
            @update:model-value="updateUrl"
          />
        </div>
        <div class="w-[30%] max-md:w-full" data-test="slo-import-folder-dropdown">
          <!-- SLOs live in alert folders; there is no SLO folder type. -->
          <SelectFolderDropDown
            type="alerts"
            :active-folder-id="selectedFolder"
            @folder-selected="onFolderSelected"
          />
        </div>
      </div>
    </template>

    <template #file-input-section="{ jsonFiles, updateFiles }">
      <div class="mb-1 flex w-[calc(100%-0.625rem)] items-start gap-2 max-md:flex-wrap">
        <div class="w-[69%] max-md:w-full">
          <OFile
            data-test="slo-import-json-file-input"
            :model-value="jsonFiles"
            :label="t('dashboard.dropFileMsg')"
            accept=".json"
            multiple
            drop-zone
            :help-text="t('common.jsonFilesOnlyHint')"
            size="md"
            @update:model-value="updateFiles"
          />
        </div>
        <div class="w-[30%] max-md:w-full">
          <SelectFolderDropDown
            type="alerts"
            :active-folder-id="selectedFolder"
            @folder-selected="onFolderSelected"
          />
        </div>
      </div>
    </template>

    <template #output-content>
      <div
        class="border-border-default flex h-full w-full min-w-100 flex-col border-s max-md:min-w-0"
      >
        <div class="text-text-heading shrink-0 py-3 text-center text-sm font-semibold">
          {{ t("slos.import.results") }}
        </div>
        <OSeparator class="mt-1 shrink-0" />
        <div class="min-h-0 flex-1 overflow-auto p-2.5">
          <div
            v-if="!results.length"
            class="text-text-muted p-3 text-center text-sm"
            data-test="slo-import-no-results"
          >
            {{ t("slos.import.noResults") }}
          </div>
          <div
            v-for="(result, index) in results"
            :key="index"
            class="px-0 py-1.25 text-sm font-bold wrap-break-word"
            :class="result.success ? 'text-green' : 'text-status-negative'"
            :data-test="`slo-import-result-${index}`"
          >
            {{ result.message }}
          </div>
        </div>
      </div>
    </template>
  </BaseImport>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import { saveSloMutation } from "@/services/slos.queries";
import { toast } from "@/lib/feedback/Toast/useToast";
import { getFoldersListByType } from "@/utils/commons";
import BaseImport from "@/components/common/BaseImport.vue";
import SelectFolderDropDown from "@/components/common/sidebar/SelectFolderDropDown.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OFile from "@/lib/forms/File/OFile.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

type ImportResult = { success: boolean; message: I18nText };

// Assigned by the server or the importer; `owner` too, because create keeps a sent one.
const STRIPPED_FIELDS = [
  "id",
  "org",
  "owner",
  "folder_id",
  "status",
  "definition_generation",
  "groups_reserved",
];

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const store = useStore();
const org = useOrgId();

const initialFolder =
  typeof route.query.folder === "string" && route.query.folder ? route.query.folder : "default";
const selectedFolder = ref(initialFolder);
const results = ref<ImportResult[]>([]);
const importing = ref(false);
const baseImportRef = ref<InstanceType<typeof BaseImport> | null>(null);

// Import waits for the folders, or it could target a folder the picker has not resolved yet.
const foldersLoading = ref(false);

// The picker only reads the store, which is empty when this page is the first one loaded.
if (!store.state.organizationData?.foldersByType?.alerts?.length) {
  foldersLoading.value = true;
  getFoldersListByType(store, "alerts")
    .catch((err: unknown) => {
      console.error("[slos] failed to load alert folders", err);
      // Without folders the picker shows "default", so that is where the import goes.
      selectedFolder.value = "default";
    })
    .finally(() => (foldersLoading.value = false));
}

// The picker shows "default" for a folder that no longer exists, so the import must target that too.
watch(
  () => store.state.organizationData?.foldersByType?.alerts,
  (folders: { folderId: string }[] | undefined) => {
    if (folders?.length && !folders.some((f) => f.folderId === selectedFolder.value)) {
      selectedFolder.value = "default";
    }
  },
  { immediate: true },
);

const createSlo = useMutation(() =>
  saveSloMutation(
    org.value,
    () => false,
    () => "",
  ),
);

function onFolderSelected(folder: { value?: string }) {
  selectedFolder.value = folder?.value || selectedFolder.value;
}

function goToList(folder: string) {
  router.push({
    name: "sloList",
    query: { ...route.query, org_identifier: org.value, folder },
  });
}

function toCreatePayload(
  item: unknown,
  folderId: string,
): { payload: Record<string, unknown>; name: string } | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const payload: Record<string, unknown> = { ...item };
  const name = payload.name;
  if (typeof name !== "string" || !name.trim()) return null;
  for (const field of STRIPPED_FIELDS) delete payload[field];
  payload.folder_id = folderId;
  // Create rejects a null `tags`; an absent `group_by` is how an ungrouped SLO is written.
  payload.tags ??= [];
  if (payload.group_by === null) delete payload.group_by;
  return { payload, name };
}

function skipReason(item: unknown, index: number): I18nText {
  const isObject = !!item && typeof item === "object" && !Array.isArray(item);
  return isObject
    ? t("slos.import.nameRequired", { index })
    : t("slos.import.notAnObject", { index });
}

function serverReason(e: unknown): string {
  const response = e && typeof e === "object" && "response" in e ? e.response : undefined;
  const body =
    response && typeof response === "object" && "data" in response ? response.data : undefined;
  if (typeof body === "string" && body.trim()) return body.trim();
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
    if (body.message) return body.message;
  }
  return (e instanceof Error && e.message) || t("slos.import.unknownError");
}

function parseItems(jsonStr: string): unknown[] | null {
  if (!jsonStr?.trim()) return [];
  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return null;
  }
}

async function importItem(item: unknown, index: number, folderId: string): Promise<ImportResult> {
  const prepared = toCreatePayload(item, folderId);
  if (!prepared) return { success: false, message: skipReason(item, index) };
  const { payload, name } = prepared;
  try {
    await createSlo.mutateAsync(payload);
    return { success: true, message: t("slos.import.created", { index, name }) };
  } catch (e: unknown) {
    return {
      success: false,
      message: t("slos.import.failed", { index, name, reason: serverReason(e) }),
    };
  }
}

async function importJson({ jsonStr }: { jsonStr: string }) {
  results.value = [];
  const items = parseItems(jsonStr);
  if (!items?.length) {
    toast({
      variant: "error",
      message: items ? t("slos.import.jsonEmpty") : t("slos.import.invalidJson"),
    });
    if (baseImportRef.value) baseImportRef.value.isImportingLocal = false;
    return;
  }

  importing.value = true;
  const folderId = selectedFolder.value;
  // Sequential on purpose: results land in input order and imports are small.
  for (const [i, item] of items.entries()) {
    results.value.push(await importItem(item, i + 1, folderId));
  }
  importing.value = false;
  if (baseImportRef.value) baseImportRef.value.isImportingLocal = false;

  if (results.value.every((r) => r.success)) {
    toast({
      variant: "success",
      message: t("slos.import.succeeded", { count: items.length }, items.length),
    });
    goToList(folderId);
  }
}
</script>
