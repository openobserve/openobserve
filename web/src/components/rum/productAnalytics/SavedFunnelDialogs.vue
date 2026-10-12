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
  <SaveFunnelDialog
    v-if="dialog.open"
    v-model:open="dialog.open"
    :mode="dialog.mode"
    :initial-name="dialog.name"
    :initial-description="dialog.description"
    :taken-name="
      (n: string) => sf.nameTaken(n, dialog.mode === 'rename' ? dialog.target?.id : undefined)
    "
    :submit="submitDialog"
  />
  <ODialog
    :open="!!conflict"
    size="sm"
    :title="t('rum.analytics.saved.conflictTitle')"
    :primary-button-label="
      conflict?.renaming
        ? t('rum.analytics.saved.renameAnyway')
        : t('rum.analytics.saved.overwrite')
    "
    :primary-button-disabled="!!overwriteBlocked"
    :secondary-button-label="t('rum.analytics.saved.reload')"
    data-test="rum-analytics-funnel-conflict-dialog"
    @update:open="(v) => !v && (conflict = null)"
    @click:primary="overwriteConflict"
    @click:secondary="reloadConflict"
  >
    <span v-if="conflict" class="text-text-body text-sm">{{
      t(`rum.analytics.saved.${conflict.renaming ? "renameConflictMessage" : "conflictMessage"}`, {
        user: raw(conflict.current.updatedBy),
        name: raw(conflict.current.name),
        time: raw(fmt(conflict.current.updatedAt)),
      })
    }}</span>
    <p
      v-if="overwriteBlocked"
      class="text-text-secondary mt-2 text-sm"
      data-test="rum-analytics-funnel-conflict-blocked"
    >
      {{ overwriteBlocked }}
    </p>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import SaveFunnelDialog, {
  type SaveFunnelMode,
  type SaveFunnelOutcome,
} from "@/components/rum/productAnalytics/SaveFunnelDialog.vue";
import useProductAnalytics from "@/composables/rum/useProductAnalytics";
import useSavedFunnels, {
  type SavedFunnelDraft,
  type SaveFunnelResult,
} from "@/composables/rum/useSavedFunnels";
import useFunnelDraft, { useFunnelSaveBlockers } from "@/composables/rum/useFunnelDraft";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { NamedEvent, SavedFunnel } from "@/utils/rum/productAnalyticsModel";
import type { FunnelDef } from "@/utils/rum/productAnalyticsQueries";

type Conflict = {
  current: SavedFunnel;
  renaming: boolean;
  retry: (current: SavedFunnel) => Promise<unknown>;
  reload: () => unknown;
};

const props = withDefaults(
  defineProps<{
    events: NamedEvent[];
    eventsReady: boolean;
    compileSql?: (d: FunnelDef) => string | null;
  }>(),
  { compileSql: () => null },
);
const { t, locale } = useI18nTyped();
const store = useStore();
const pa = useProductAnalytics();
const sf = useSavedFunnels();
const { confirm } = useConfirmDialog();
const { confirmDiscard } = useFunnelDraft();
const { sql, uncompiled } = useFunnelSaveBlockers(props);

const conflict = ref<Conflict | null>(null);
const dialog = ref<{
  open: boolean;
  mode: SaveFunnelMode;
  name: string;
  description: string;
  target: SavedFunnel | null;
  def: FunnelDef | null;
  sql: string;
}>({ open: false, mode: "save", name: "", description: "", target: null, def: null, sql: "" });

const org = () => pa.toQuery().org_identifier as string;
const app = () => pa.state.app;
const opened = pa.openedFunnel;

// A rename retry stores their def and sql, so only an Overwrite needs the funnel on screen to compile.
const overwriteBlocked = computed<I18nText | null>(() =>
  conflict.value && !conflict.value.renaming ? uncompiled.value : null,
);

// The user's locale orders and words the date, so it is not a fixed English pattern.
const fmt = (ms: number) =>
  new Intl.DateTimeFormat(locale.value, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: store.state.timezone || "UTC",
  }).format(new Date(ms));

const openDialog = (
  mode: SaveFunnelMode,
  name: string,
  target: SavedFunnel | null = null,
  description = "",
  source: { def: FunnelDef; sql: string } | null = null,
) => {
  dialog.value = {
    open: true,
    mode,
    name,
    description: target?.description ?? description ?? "",
    target,
    def: source?.def ?? null,
    sql: source?.sql ?? "",
  };
};

// The funnel on screen with the sql compiled from that same def; the Save buttons are disabled when it is null.
const draftOf = (name: string, description?: string): SavedFunnelDraft | null =>
  sql.value === null ? null : { name, description, def: pa.funnel.value, sql: sql.value };

const settle = async (
  res: SaveFunnelResult,
  retry: Conflict["retry"],
  keepSteps: boolean,
  fallbackName: string,
  renaming = false,
): Promise<SaveFunnelOutcome> => {
  if (res.kind === "saved") {
    pa.openSavedFunnel(res.funnel, keepSteps);
    return "saved";
  }
  if (res.kind === "duplicate") return "duplicate";
  if (res.kind === "forbidden") return "forbidden";
  if (res.kind === "conflict") {
    const current = res.current;
    // Only an Overwrite conflict says Reload discards; a rename one would drop step edits unasked.
    const reload = renaming
      ? async () => (await confirmDiscard()) && pa.openSavedFunnel(current)
      : () => pa.openSavedFunnel(current);
    conflict.value = { current, renaming, retry, reload };
    return "saved";
  }
  const again = await confirm({
    title: t("rum.analytics.saved.goneTitle"),
    message: t("rum.analytics.saved.goneMessage"),
    confirmLabel: t("rum.analytics.saved.saveAsNew"),
  });
  pa.detachSavedFunnel();
  if (!again) return "saved";
  openDialog("save-as", fallbackName);
  return "replaced";
};

const overwrite = async (f: SavedFunnel, version: number) => {
  const draft = draftOf(f.name, f.description);
  if (!draft) return;
  try {
    const res = await sf.save(org(), app(), draft, { id: f.id, version });
    await settle(res, (c) => overwrite(f, c.version), false, f.name);
  } catch {
    // useSavedFunnels already toasted the failure.
  }
};

/** Overwrites the open funnel with the one on screen, or names a new one when none is open. */
const save = () => {
  if (opened.value) void overwrite(opened.value, opened.value.version);
  else openDialog("save", "");
};

const saveAs = () =>
  openDialog("save-as", opened.value?.name ?? "", null, opened.value?.description);

const rename = (f: SavedFunnel) => openDialog("rename", f.name, f);

/** `asStored` copies the funnel as saved; otherwise the copy is the funnel on screen. */
const duplicate = (f: SavedFunnel, asStored: boolean) =>
  openDialog(
    "duplicate",
    t("rum.analytics.saved.copyName", { name: raw(f.name) }),
    null,
    f.description,
    asStored ? { def: f.def, sql: f.sql } : null,
  );

// A rename changes only the name, so a retry after a conflict renames their version as it now stands.
const submitRename = async (f: SavedFunnel, name: string): Promise<SaveFunnelOutcome> => {
  const res = await sf.save(
    org(),
    app(),
    { name, description: f.description, def: f.def, sql: f.sql },
    { id: f.id, version: f.version },
  );
  const retry = (c: SavedFunnel) => submitRename(c, name);
  if (opened.value?.id === f.id) return settle(res, retry, true, name, true);
  return settleRow(res, f, retry);
};

// A row that is not the open funnel answers for itself: the open funnel is never detached, replaced or saved.
const settleRow = (
  res: SaveFunnelResult,
  f: SavedFunnel,
  retry: Conflict["retry"],
): SaveFunnelOutcome => {
  if (res.kind === "duplicate") return "duplicate";
  if (res.kind === "forbidden") return "forbidden";
  if (res.kind === "gone") {
    toast({
      variant: "error",
      message: t("rum.analytics.saved.renameGone", { name: raw(f.name) }),
    });
  } else if (res.kind === "conflict") {
    conflict.value = {
      current: res.current,
      renaming: true,
      retry,
      reload: () => sf.load(org(), app(), true),
    };
  }
  return "saved";
};

const submitDialog = async (value: {
  name: string;
  description: string;
}): Promise<SaveFunnelOutcome> => {
  const d = dialog.value;
  try {
    if (d.mode === "rename" && d.target) return await submitRename(d.target, value.name);
    const draft = d.def
      ? { name: value.name, description: value.description, def: d.def, sql: d.sql }
      : draftOf(value.name, value.description);
    if (!draft) return "failed";
    const res = await sf.save(org(), app(), draft);
    // A stored copy is made from the list, which shows it as a new row and leaves the open funnel alone.
    if (d.def) return res.kind === "duplicate" || res.kind === "forbidden" ? res.kind : "saved";
    return await settle(res, async () => undefined, false, value.name);
  } catch {
    return "failed";
  }
};

const overwriteConflict = async () => {
  const c = conflict.value;
  if (overwriteBlocked.value) return;
  conflict.value = null;
  try {
    if (c) await c.retry(c.current);
  } catch {
    // useSavedFunnels already toasted the failure.
  }
};

const reloadConflict = () => {
  const c = conflict.value;
  conflict.value = null;
  if (c) void c.reload();
};

/** Deletes `f` once confirmed; resolves true when it is gone. */
const remove = async (f: SavedFunnel): Promise<boolean> => {
  const ok = await confirm({
    title: t("rum.analytics.saved.deleteTitle"),
    message: t("rum.analytics.saved.deleteMessage", { name: raw(f.name) }),
    confirmLabel: t("rum.analytics.saved.delete"),
  });
  if (!ok) return false;
  try {
    await sf.remove(org(), app(), f.id);
  } catch {
    return false;
  }
  if (opened.value?.id === f.id) pa.detachSavedFunnel();
  return true;
};

/** Deletes every funnel in `rows` once confirmed; resolves to the ids now gone. */
const removeMany = async (rows: readonly SavedFunnel[]): Promise<string[]> => {
  if (!rows.length) return [];
  const ok = await confirm({
    title: t("rum.analytics.saved.bulkDeleteTitle"),
    message: t("rum.analytics.saved.bulkDeleteMessage", { count: rows.length }, rows.length),
    confirmLabel: t("rum.analytics.saved.delete"),
  });
  if (!ok) return [];
  const gone = await sf.removeMany(
    org(),
    app(),
    rows.map((r) => r.id),
  );
  if (opened.value && gone.includes(opened.value.id)) pa.detachSavedFunnel();
  return gone;
};

defineExpose({ save, saveAs, rename, duplicate, remove, removeMany });
</script>
