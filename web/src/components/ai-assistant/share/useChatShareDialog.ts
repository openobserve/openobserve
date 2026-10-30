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

import { computed, reactive, ref, watch, type Ref } from "vue";
import { useMutation, useQuery, type QueryClient } from "@tanstack/vue-query";
import { useStore } from "vuex";
import type { ShareView, ShareVisibility, UpdateShareRequest } from "@/services/ai_chat_share";
import {
  chatSharesQuery,
  createShareMutation,
  revokeShareMutation,
  updateShareMutation,
} from "@/services/ai_chat_share.queries";
import { orgUsersQuery } from "@/services/users.queries";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import { toast } from "@/lib/feedback/Toast/useToast";
import { copyToClipboard } from "@/utils/clipboard";
import {
  applyVisibility,
  buildCreateRequest,
  defaultShareForm,
  expiryPresetsFor,
  isAdminInMembers,
  orgAdminFlag,
  otherMode,
  serverMessageOf,
  shareLinkOf,
  visibilityChoices,
} from "./chatShare";

export interface ShareActionsOptions {
  orgId: Ref<string>;
  t: TranslateFn;
  /** Called after a share changed: the updated share, or `null` once revoked. */
  onChanged?: (share: ShareView, updated: ShareView | null) => void;
}

/** Refresh, mode switch, revoke and copy for existing shares, with a per-share busy flag. */
export function useShareActions(options: ShareActionsOptions) {
  const { orgId, t, onChanged } = options;
  const pendingShareId = ref<string | null>(null);
  const updateMutation = useMutation(() => updateShareMutation(orgId.value));
  const revokeMutation = useMutation(() => revokeShareMutation(orgId.value));

  const withPending = async <T>(share: ShareView, run: () => Promise<T>): Promise<T> => {
    pendingShareId.value = share.id;
    try {
      return await run();
    } finally {
      pendingShareId.value = null;
    }
  };

  const updateShare = (share: ShareView, body: UpdateShareRequest, successMessage: I18nText) =>
    withPending(share, async () => {
      try {
        const updated = await updateMutation.mutateAsync({ id: share.id, body });
        onChanged?.(share, updated);
        toast({ variant: "success", message: successMessage });
        return updated;
      } catch (error) {
        failToast(error, t("aiChatShare.updateFailed"));
        return null;
      }
    });

  const refreshSnapshot = (share: ShareView) =>
    updateShare(share, { refresh_snapshot: true }, t("aiChatShare.snapshotRefreshed"));

  const switchMode = (share: ShareView) =>
    updateShare(share, { mode: otherMode(share.mode) }, t("aiChatShare.modeChanged"));

  const toggleRedaction = (share: ShareView) =>
    updateShare(
      share,
      { redact_tools: !share.redact_tools },
      share.redact_tools ? t("aiChatShare.toolsShown") : t("aiChatShare.toolsHidden"),
    );

  const revoke = (share: ShareView) =>
    withPending(share, async () => {
      try {
        await revokeMutation.mutateAsync(share.id);
        onChanged?.(share, null);
        toast({ variant: "success", message: t("aiChatShare.revoked") });
        return true;
      } catch (error) {
        failToast(error, t("aiChatShare.revokeFailed"));
        return false;
      }
    });

  const copyLink = (share: ShareView) => copyToClipboard(shareLinkOf(share), t);

  return { pendingShareId, refreshSnapshot, switchMode, toggleRedaction, revoke, copyLink };
}

export interface ChatShareDialogOptions {
  orgId: Ref<string>;
  sessionId: Ref<string | null | undefined>;
  open: Ref<boolean>;
  publicEnabled: Ref<boolean>;
  /** Longest lifetime of a public link, in seconds. */
  maxPublicSecs: Ref<number>;
  t: TranslateFn;
}

/** Create-form state, the chat's active shares, and the per-share actions of the share dialog. */
export function useChatShareDialog(options: ChatShareDialogOptions) {
  const { orgId, sessionId, open, publicEnabled, maxPublicSecs, t } = options;

  const form = reactive(defaultShareForm());
  const createdShare = ref<ShareView | null>(null);

  const sharesQuery = useQuery(() =>
    Object.assign(chatSharesQuery(orgId.value, sessionId.value ?? ""), {
      enabled: open.value && !!orgId.value && !!sessionId.value,
    }),
  );
  const shares = computed(() => sharesQuery.data.value ?? []);
  const sharesLoading = computed(() => sharesQuery.isPending.value && sharesQuery.isFetching.value);
  const sharesError = computed(() => !!sharesQuery.error.value);

  const createMutation = useMutation(() => createShareMutation(orgId.value, sessionId.value ?? ""));
  const creating = computed(() => createMutation.isPending.value);

  const actions = useShareActions({
    orgId,
    t,
    onChanged: (share, updated) => {
      if (createdShare.value?.id === share.id) createdShare.value = updated;
    },
  });

  const visibilityOptions = computed(() => visibilityChoices(publicEnabled.value));
  const createdLink = computed(() => (createdShare.value ? shareLinkOf(createdShare.value) : ""));
  const expiryPresets = computed(() => expiryPresetsFor(form.visibility, maxPublicSecs.value));

  const setVisibility = (visibility: ShareVisibility) =>
    applyVisibility(form, visibility, maxPublicSecs.value);

  const resetForm = () => {
    Object.assign(form, defaultShareForm());
    createdShare.value = null;
  };

  watch(open, (isOpen) => {
    if (isOpen) resetForm();
  });

  watch(publicEnabled, (enabled) => {
    if (!enabled && form.visibility === "public") setVisibility("org");
  });

  const create = async (): Promise<ShareView | null> => {
    if (!sessionId.value) return null;
    try {
      const share = await createMutation.mutateAsync(
        buildCreateRequest(form, publicEnabled.value, maxPublicSecs.value),
      );
      createdShare.value = share;
      toast({ variant: "success", message: t("aiChatShare.linkCreated") });
      return share;
    } catch (error) {
      failToast(error, t("aiChatShare.createFailed"));
      return null;
    }
  };

  return {
    ...actions,
    form,
    createdShare,
    createdLink,
    shares,
    sharesLoading,
    sharesError,
    creating,
    visibilityOptions,
    expiryPresets,
    setVisibility,
    resetForm,
    create,
  };
}

/** Org admin of the selected org: the server's flag, else the member list the IAM pages read, fetched only while `enabled`. */
export function useIsOrgAdmin(orgId: Ref<string>, enabled: Ref<boolean>) {
  const store = useStore();
  const explicit = computed(() => orgAdminFlag(store.state));
  const membersQuery = useQuery(() =>
    Object.assign(orgUsersQuery(orgId.value), {
      enabled: enabled.value && explicit.value === undefined && !!orgId.value,
    }),
  );
  return computed(
    () => explicit.value ?? isAdminInMembers(membersQuery.data.value, store.state.userInfo?.email),
  );
}

/** Active links of a chat, for warning before it is deleted; 0 when they cannot be read. */
export async function activeShareCount(
  client: QueryClient,
  orgId: string,
  sessionId: string | undefined,
): Promise<number> {
  if (!orgId || !sessionId) return 0;
  try {
    return (await client.fetchQuery(chatSharesQuery(orgId, sessionId))).length;
  } catch {
    return 0;
  }
}

function failToast(error: unknown, fallback: I18nText) {
  toast({ variant: "error", message: raw(serverMessageOf(error)) || fallback });
}
