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

import { useMutation } from "@tanstack/vue-query";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { useOrgId } from "@/composables/query/useOrgId";
import {
  deleteCollectorsMutation,
  redeliverCollectorMutation,
  renameCollectorMutation,
  restartCollectorsMutation,
  type BulkResult,
} from "@/services/fleet.queries";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { serverMessage, type CollectorRow } from "./useFleetApi";

type Target = Pick<CollectorRow, "id" | "name" | "status">;

/** Confirm, call and toast for the per-collector writes the table and the drawer share. */
export function useCollectorActions() {
  const { t } = useI18nTyped();
  const { confirm } = useConfirmDialog();
  const orgId = useOrgId();
  const removeMutation = useMutation(() => deleteCollectorsMutation(orgId.value));
  const restartMutation = useMutation(() => restartCollectorsMutation(orgId.value));
  const redeliverMutation = useMutation(() => redeliverCollectorMutation(orgId.value));
  const renameMutation = useMutation(() => renameCollectorMutation(orgId.value));

  const failure = (err: unknown) =>
    toast({
      variant: "error",
      message: raw(serverMessage(err)) || t("fleet.common.requestFailed"),
    });

  function bulkToast(res: BulkResult, total: number, done: (n: number) => I18nText) {
    toast(
      res.failed.length
        ? {
            variant: "warning",
            message: t("fleet.collectors.partial", {
              done: res.succeeded.length,
              total,
              reason: raw(serverMessage(res.firstError)) || t("fleet.common.requestFailed"),
            }),
          }
        : { variant: "success", message: done(res.succeeded.length) },
    );
  }

  /** Resolves to the ids that were removed. */
  async function remove(targets: Target[]): Promise<string[]> {
    if (!targets.length) return [];
    const org = orgId.value;
    const online = targets.filter((c) => c.status === "online" || c.status === "degraded").length;
    const ok = await confirm({
      title:
        targets.length === 1
          ? t("fleet.collectors.removeTitle", { name: raw(targets[0].name) })
          : t("fleet.collectors.removeManyTitle", { count: targets.length }),
      message: online
        ? t("fleet.collectors.removeOnlineMessage", { count: online }, online)
        : t("fleet.collectors.removeMessage"),
      confirmLabel: t("fleet.collectors.remove"),
      confirmVariant: "destructive",
      focusCancel: true,
    });
    // The rows belong to the org the confirm was opened in; the mutation follows the current one.
    if (!ok || orgId.value !== org) return [];
    try {
      const res = await removeMutation.mutateAsync(targets.map((c) => c.id));
      bulkToast(res, targets.length, (n) => t("fleet.collectors.removedCount", { count: n }, n));
      return res.succeeded;
    } catch (err) {
      failure(err);
      return [];
    }
  }

  async function restart(targets: Target[]) {
    if (!targets.length) return;
    if (targets.length > 1) {
      const org = orgId.value;
      const ok = await confirm({
        title: t("fleet.collectors.restartManyTitle", { count: targets.length }),
        message: t("fleet.collectors.restartMessage"),
        confirmLabel: t("fleet.collectors.restart"),
      });
      if (!ok || orgId.value !== org) return;
    }
    try {
      const res = await restartMutation.mutateAsync(targets.map((c) => c.id));
      bulkToast(res, targets.length, (n) => t("fleet.collectors.restartQueued", { count: n }, n));
    } catch (err) {
      failure(err);
    }
  }

  async function redeliver(target: Target) {
    try {
      await redeliverMutation.mutateAsync(target.id);
      toast({
        variant: "success",
        message: t("fleet.collectors.redelivered", { name: raw(target.name) }),
      });
    } catch (err) {
      failure(err);
    }
  }

  async function rename(id: string, name: string): Promise<boolean> {
    try {
      await renameMutation.mutateAsync({ id, name });
      toast({ variant: "success", message: t("fleet.collectors.renamed", { name: raw(name) }) });
      return true;
    } catch (err) {
      failure(err);
      return false;
    }
  }

  return {
    remove,
    restart,
    redeliver,
    rename,
    removing: removeMutation.isPending,
    restarting: restartMutation.isPending,
    redelivering: redeliverMutation.isPending,
  };
}
