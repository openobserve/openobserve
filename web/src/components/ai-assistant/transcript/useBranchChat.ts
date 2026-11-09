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

import { reactive, ref, type Ref } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { useRouter, type Router } from "vue-router";

import { useAssistantStore, type BranchedFromRef, type Sid } from "@/composables/assistant";
import { fullThreadLocation, isFullThreadRoute } from "@/composables/assistant/pure";
import { toast } from "@/lib/feedback/Toast/useToast";
import { branchChatMutation, type BranchChatResponse } from "@/services/ai_chat_branch";
import { trackAssistant } from "@/services/assistantAnalytics";
import { useI18nTyped } from "@/types/i18n";

export interface BranchInput {
  sid: Sid;
  /** The server's id of the answer's turn. */
  turnId: string;
  /** 1-based answer version shown; sent only when the turn has more than one. */
  version?: number;
}

export interface BranchChat {
  pending: Ref<boolean>;
  /** Opens the new chat on success; a failure toasts and resolves null. */
  branch(input: BranchInput): Promise<BranchChatResponse | null>;
}

// The new chat's header names its source at once, before its record is read back from the server.
const branched = reactive(new Map<Sid, BranchedFromRef>());

/** The source of a chat this page branched; the stored record's `branchedFrom` is the durable copy. */
export function rememberedBranch(sid: Sid): BranchedFromRef | null {
  return branched.get(sid) ?? null;
}

/** Opens a chat where the current one shows; on the Full view `?thread=` follows it, so a reload and Back land on the right chat. */
export async function openChatInPlace(
  store: Pick<ReturnType<typeof useAssistantStore>, "openSession">,
  router: Router | undefined,
  sid: Sid,
): Promise<void> {
  await store.openSession({ sid }, { focus: true });
  const route = router?.currentRoute.value;
  if (router && route && isFullThreadRoute(route))
    await router.push(fullThreadLocation(sid, route.query)).catch(() => undefined);
}

/** Branch in new chat: the server copies the turns up to this answer into a new chat, which then opens in place. */
export function useBranchChat(org: () => string): BranchChat {
  const { t } = useI18nTyped();
  const store = useAssistantStore();
  const router = useRouter();
  const pending = ref(false);
  const mutation = useMutation(() => branchChatMutation(org()));

  async function branch(input: BranchInput): Promise<BranchChatResponse | null> {
    if (pending.value) return null;
    pending.value = true;
    try {
      const created = await mutation.mutateAsync({
        sessionId: input.sid,
        turnId: input.turnId,
        ...(input.version !== undefined && { version: input.version }),
      });
      branched.set(created.session_id, {
        sessionId: created.branched_from.session_id,
        turnId: created.branched_from.turn_id,
        title: created.branched_from.title,
      });
      trackAssistant("ai_branch", { result: "created" });
      // The branch exists even when it fails to open; it is then in the chat list, so this is not a branch failure.
      await openChatInPlace(store, router, created.session_id).catch(() =>
        toast({ variant: "error", message: t("assistant.history.openFailed") }),
      );
      return created;
    } catch (err) {
      const status = (err as { response?: { status?: unknown } } | null)?.response?.status;
      trackAssistant("ai_branch", {
        result: "failed",
        ...(typeof status === "number" && { status }),
      });
      toast({ variant: "error", message: t("assistant.message.branchFailed") });
      return null;
    } finally {
      pending.value = false;
    }
  }

  return { pending, branch };
}
