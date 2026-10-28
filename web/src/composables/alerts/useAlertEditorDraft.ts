// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { nextTick, ref, type Ref } from "vue";
import type { RouteLocationNormalized } from "vue-router";
import { useEditorDraft, type EditorDraftController } from "@/composables/useEditorDraft";
import type { useAlertForm } from "@/composables/useAlertForm";
import {
  ALERT_DRAFT_KIND,
  ANOMALY_DRAFT_VARIANT,
  alertDraftBase,
  anomalyDraftConfig,
  type AlertSavedOptions,
} from "@/utils/alerts/alertEditorDraft";

type AlertForm = ReturnType<typeof useAlertForm>;

type AnomalyConfig = AlertForm["anomalyConfig"]["value"];

export interface AlertDraftData {
  values: Record<string, unknown>;
  tab: string;
  folderId: string;
  aggregationEnabled: boolean;
  anomaly: Record<string, unknown>;
}

export interface UseAlertEditorDraftOptions {
  form: AlertForm;
  /** The alert the editor opened with (edit mode: the server copy). */
  modelValue: () => Record<string, unknown> | null | undefined;
  /** Tells the host a save succeeded; the leave dialog's Save passes `navigate: false`. */
  onSaved: (folderId: string | undefined, options: AlertSavedOptions) => void;
}

export interface AlertEditorDraft {
  draft: EditorDraftController;
  /** Bumped when a draft is continued, so step components re-read the restored form. */
  formKey: Ref<number>;
  start: () => Promise<void>;
  handleSaved: (folderId?: string) => void;
}

// The list hosts the editor on its own path, so opening or closing it only changes these query keys.
const leavesEditor = (to: RouteLocationNormalized, from: RouteLocationNormalized) =>
  to.path !== from.path ||
  to.query.action !== from.query.action ||
  to.query.alert_id !== from.query.alert_id;

/** Local drafts for the alert editor (scheduled, real-time, composite and anomaly). */
export const useAlertEditorDraft = ({
  form,
  modelValue,
  onSaved,
}: UseAlertEditorDraftOptions): AlertEditorDraft => {
  const formKey = ref(0);
  let serverAlert: Record<string, unknown> | null = null;
  let serverAnomaly: Record<string, unknown> | null = null;
  // Set while the leave dialog's Save runs, so a successful save does not navigate.
  let leaveSave: { saved: boolean } | null = null;

  const anomalyId = (): string | null => {
    const id = form.router.currentRoute.value.params.anomaly_id;
    return typeof id === "string" && id !== "" ? id : null;
  };

  const entityId = (): string | null => {
    const anomaly = anomalyId();
    if (anomaly) return anomaly;
    if (!form.beingUpdated.value) return null;
    const alert = modelValue();
    const id = alert?.id ?? alert?.alert_id;
    return id === null || id === undefined || id === "" ? null : String(id);
  };

  const content = () => ({
    values: form.formData.value as Record<string, unknown>,
    folderId: String(form.activeFolderId.value ?? "default"),
    aggregationEnabled: form.isAggregationEnabled.value,
    anomaly: anomalyDraftConfig(form.anomalyConfig.value),
  });

  const reloadStreams = async () => {
    const values = form.form.state.values;
    if (values.is_real_time === "composite") return;
    const streamName = String(values.stream_name ?? "");
    try {
      const pending = form.updateStreams(false);
      if (pending) await pending;
      else if (streamName) await form.updateStreamFields(streamName);
      await form.updateEditorContent(streamName);
    } catch {
      // A stream that no longer exists leaves its pickers empty, as a normal load does.
    }
  };

  const apply = async (data: AlertDraftData) => {
    form.resetForm(data.values);
    form.activeFolderId.value = data.folderId;
    form.isAggregationEnabled.value = data.aggregationEnabled;
    form.anomalyConfig.value = {
      ...form.anomalyConfig.value,
      ...(data.anomaly as Partial<AnomalyConfig>),
    };
    // The alert-type watcher picks a tab for the restored type first; the draft's tab wins after it.
    await nextTick();
    form.activeTab.value = data.tab;
    formKey.value += 1;
    void reloadStreams();
  };

  const base = (): unknown => {
    if (anomalyId()) return form.anomalyLoadStatus.value === "missing" ? null : serverAnomaly;
    return form.beingUpdated.value ? serverAlert : undefined;
  };

  const save = async (): Promise<boolean> => {
    const run = { saved: false };
    leaveSave = run;
    try {
      await form.handleSave();
    } finally {
      leaveSave = null;
    }
    return run.saved;
  };

  const draft = useEditorDraft<AlertDraftData>({
    kind: ALERT_DRAFT_KIND,
    entityLabel: () => form.t("common.editorDraft.entities.alert"),
    entityId,
    newVariant: () =>
      form.router.currentRoute.value.name === "addAnomalyDetection" ? ANOMALY_DRAFT_VARIANT : null,
    snapshot: () => ({ ...content(), tab: form.activeTab.value }),
    // The open tab alone is not an unsaved change.
    contentOf: ({ tab: _tab, ...rest }) => rest,
    // A load landing after Discard must not count as an edit, or autosave writes the discarded draft back.
    rebaselineOnInputAfterDiscard: true,
    apply,
    base,
    save,
    leaveOnRouteUpdate: leavesEditor,
  });

  const start = async () => {
    await form.formReady;
    // A failed fetch is not a deleted item: the draft stays for when the anomaly loads again.
    if (anomalyId() && form.anomalyLoadStatus.value === "failed") return;
    serverAlert = form.beingUpdated.value ? alertDraftBase(modelValue()) : null;
    serverAnomaly =
      anomalyId() && form.anomalyLoadStatus.value === "loaded"
        ? anomalyDraftConfig(form.anomalyConfig.value)
        : null;
    await draft.start();
  };

  const handleSaved = (folderId?: string) => {
    if (leaveSave) {
      leaveSave.saved = true;
      onSaved(folderId, { navigate: false });
      return;
    }
    draft.markSaved();
    onSaved(folderId, { navigate: true });
  };

  return { draft, formKey, start, handleSaved };
};
