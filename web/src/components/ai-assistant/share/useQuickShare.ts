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

import { reactive } from "vue";
import { useQueryClient, type QueryClient } from "@tanstack/vue-query";
import { useStore } from "vuex";

import { toAssistantError, type AssistantError, type Sid } from "@/composables/assistant";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { CreateShareRequest, ShareView } from "@/services/ai_chat_share";
import { createShareMutation } from "@/services/ai_chat_share.queries";
import { trackAssistant } from "@/services/assistantAnalytics";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";

import {
  buildCreateRequest,
  canRedactAttachments,
  quickShareForm,
  shareLinkOf,
  statusOfError,
} from "./chatShare";

export interface QuickShareOptions {
  /** Named in the toast when the share starts outside the chat's own thread. */
  title?: I18nText;
  /** The toast's Change settings; only passed where a settings surface exists. */
  onSettings?: () => void;
}

export type QuickShareResult =
  | { ok: true; link: string; copied: boolean; share: ShareView }
  | { ok: false; error: AssistantError };

export interface QuickShare {
  /** `org` is the chat's own org, which a share list and its invalidation also use. */
  create(org: string, sid: Sid, options?: QuickShareOptions): Promise<QuickShareResult>;
}

// A 403 on create holds for the rest of the page session, so Share stops offering what fails.
const deniedOrgs = reactive(new Set<string>());

// Module scope: a toast's Retry and a second control on the same chat must not post a second link.
const inFlight = new Set<string>();

/** True once the server refused this org's share create; the control then shows the G3 state. */
export function isShareDenied(org: string): boolean {
  return deniedOrgs.has(org);
}

/** Records a 403 on create from any surface. */
export function denyShare(org: string): void {
  deniedOrgs.add(org);
}

export function resetShareDenials(): void {
  deniedOrgs.clear();
  inFlight.clear();
}

/** One click to an org snapshot with tool data hidden, copied and toasted; the toast is the one announcement. */
export function useQuickShare(): QuickShare {
  const { t } = useI18nTyped();
  const vuex = useStore();
  const queryClient = useQueryClient();

  async function create(
    org: string,
    sid: Sid,
    options: QuickShareOptions = {},
  ): Promise<QuickShareResult> {
    const key = `${org}\u0000${sid}`;
    if (inFlight.has(key)) return { ok: false, error: busyError() };
    inFlight.add(key);
    try {
      return await run(org, sid, options);
    } finally {
      inFlight.delete(key);
    }
  }

  async function run(org: string, sid: Sid, options: QuickShareOptions): Promise<QuickShareResult> {
    const body = buildCreateRequest(
      quickShareForm(),
      false,
      undefined,
      canRedactAttachments(vuex.state.zoConfig),
    );
    let share: ShareView;
    try {
      share = await execute(queryClient, org, sid, body);
    } catch (err) {
      return {
        ok: false,
        error: refuse(
          err,
          org,
          once(() => void create(org, sid, options)),
        ),
      };
    }
    const link = shareLinkOf(share);
    const copied = await copyToClipboard(link, t, { silent: true });
    trackAssistant("ai_share", { action: "create", visibility: "org", mode: "snapshot" });
    const orgName = orgNameOf(vuex.state, org);
    toast({
      variant: "success",
      message: copied
        ? t("assistant.share.createdToast", { org: orgName })
        : t(
            options.onSettings
              ? "assistant.share.createdNotCopied"
              : "assistant.share.createdNotCopiedMenu",
          ),
      ...(options.title && { title: options.title, mask: true }),
      ...(options.onSettings && {
        action: {
          label: t("assistant.share.changeSettings"),
          handler: options.onSettings,
          dataTest: "assistant-share-toast-settings",
        },
      }),
    });
    return { ok: true, link, copied, share };
  }

  // Never the server's text: a 403 reads one sentence and flips Share to the G3 state.
  function refuse(err: unknown, org: string, retry: () => void): AssistantError {
    const error = toAssistantError(err, { phase: "mutation" });
    if (statusOfError(err) === 403) {
      denyShare(org);
      toast({ variant: "error", message: t("assistant.share.forbidden") });
    } else {
      toast({
        variant: "error",
        message: t("assistant.share.createFailed"),
        action: { label: t("common.retry"), handler: retry },
      });
    }
    return error;
  }

  return { create };
}

// A toast's Retry fires once, however often it is clicked.
function once(fn: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fn();
  };
}

function busyError(): AssistantError {
  return toAssistantError(new Error("share in flight"), { phase: "mutation" });
}

function orgNameOf(state: any, org: string): string {
  const selected = state.selectedOrganization;
  return selected?.identifier === org && selected?.name ? selected.name : org;
}

function execute(
  client: QueryClient,
  org: string,
  sid: Sid,
  body: CreateShareRequest,
): Promise<ShareView> {
  return client.getMutationCache().build(client, createShareMutation(org, sid)).execute(body);
}
