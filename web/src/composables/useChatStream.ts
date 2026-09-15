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

import { nextTick, reactive, ref, watch, type Ref } from "vue";
import type { Router } from "vue-router";
import type { Store } from "vuex";

import { chatErrorMessage } from "@/components/O2AIChat.content";
import { extractFrames, extractTailFrames } from "@/components/O2AIChat.framing";
import {
  buildNavigationRoute,
  generateNavigationFromToolResult as generateNavigation,
  navigationPageName,
} from "@/components/O2AIChat.navigation";
import {
  reduce,
  type ReducerCtx,
  type StreamEffect,
  type StreamPhase,
  type StreamState,
} from "@/components/O2AIChat.reducer";
import useAiChat from "@/composables/useAiChat";
import { useAiDashboardEvents } from "@/composables/useAiDashboardEvents";
import type { useAutoNavigationPreferences } from "@/composables/useAutoNavigationPreferences";
import type { useChatHistory } from "@/composables/useChatHistory";
import type { useChatScroll } from "@/composables/useChatScroll";
import type { useTypewriter } from "@/composables/useTypewriter";
import { toast } from "@/lib/feedback/Toast/useToast";
import type {
  ChatHistoryEntry,
  ChatMessage,
  ContentBlock,
  ImageAttachment,
  NavigationAction,
} from "@/ts/interfaces/chat";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import { getUUIDv7 } from "@/utils/zincutils";

const { fetchAiChat } = useAiChat();
const { emit: emitDashboardEvent } = useAiDashboardEvents();

// Module scope, not setup(): O2AIChat mounts in both HomeView and MainLayout, and a stream handed off between them must share this state.
const backgroundStreams = new Set<AbortController>();
const MAX_BACKGROUND_STREAMS = 3;

// loadChat swaps chatMessages.value back to the live msgs so processStream's isActive() identity check writes to the UI again.
const backgroundStreamMap = new Map<
  string,
  {
    msgs: ChatMessage[];
    controller: AbortController;
    chatId: number | null;
  }
>();

// Module scope: processStream resets isLoading only on the instance that started it, so a re-attached instance watches this to clear its spinner.
const sessionStreamingState = reactive<Record<string, boolean>>({});

// Detached streams outlive their component; call only when the turn loses authorization (org switch, logout), never on navigation.
export const abortBackgroundStreams = () => {
  for (const controller of backgroundStreams) controller.abort();
  backgroundStreams.clear();
  backgroundStreamMap.clear();
  for (const key of Object.keys(sessionStreamingState)) {
    delete sessionStreamingState[key];
  }
};

type Typewriter = ReturnType<typeof useTypewriter>;
type AutoNavigation = ReturnType<typeof useAutoNavigationPreferences>;
type ChatScroll = ReturnType<typeof useChatScroll>;

export interface UseChatStreamOptions
  extends
    Pick<
      Typewriter,
      | "startAnalyzingRotation"
      | "stopAnalyzingRotation"
      | "aiGeneratedTitle"
      | "animateTitle"
      | "displayedStreamingContent"
      | "typewriterAnimationId"
      | "resetTypewriterState"
      | "animateStreamingText"
    >,
    Pick<
      AutoNavigation,
      | "autoNavigationPreferences"
      | "pendingAutoNavigation"
      | "isAutoNavigationEnabled"
      | "saveAutoNavigationPreferences"
    >,
    Pick<ChatScroll, "scrollToBottom" | "scrollToLoadingIndicator"> {
  chatMessages: Ref<ChatMessage[]>;
  currentChatId: Ref<number | null>;
  currentTextSegment: Ref<string>;
  dbSaveToHistory: ReturnType<typeof useChatHistory>["saveToHistory"];
  store: Store<any>;
  router: Router;
  t: TranslateFn;
}

/** Stream lifecycle of one chat instance; the detached-stream registry above is shared by every instance. */
export function useChatStream(options: UseChatStreamOptions) {
  const {
    chatMessages,
    currentChatId,
    currentTextSegment,
    dbSaveToHistory,
    store,
    router,
    t,
    scrollToBottom,
    scrollToLoadingIndicator,
    autoNavigationPreferences,
    pendingAutoNavigation,
    isAutoNavigationEnabled,
    saveAutoNavigationPreferences,
    startAnalyzingRotation,
    stopAnalyzingRotation,
    aiGeneratedTitle,
    animateTitle,
    displayedStreamingContent,
    typewriterAnimationId,
    resetTypewriterState,
    animateStreamingText,
  } = options;

  const isLoading = ref(false);
  const currentStreamingMessage = ref("");
  const currentSessionId = ref<string | null>(null);
  const lastTraceId = ref<string | null>(null); // OTEL trace_id from last workflow for feedback correlation
  const saveHistoryLoading = ref(false);

  const pendingConfirmation = ref<{
    tool: string;
    args: Record<string, any>;
    message: I18nText;
    navAction?: NavigationAction;
  } | null>(null);

  const activeToolCall = ref<{
    tool: string;
    message: I18nText;
    context: Record<string, any>;
    call_id?: string;
  } | null>(null);

  const currentAbortController = ref<AbortController | null>(null);

  // Throttle save during streaming to prevent data loss on page reload
  const lastStreamingSaveTime = ref<number>(0);
  const STREAMING_SAVE_INTERVAL = 3000;

  // Set by processStream when the owning replica is gone; the stream already returned 200, so sendMessage reads it after it ends.
  const streamOwnerUnavailable = ref(false);

  const cancelCurrentRequest = async () => {
    if (currentAbortController.value) {
      currentAbortController.value.abort();
      currentAbortController.value = null;

      toast({
        message: t("toastMessages.components.responseGenerationStopped"),
        variant: "info",
      });

      isLoading.value = false;
      activeToolCall.value = null;
      stopAnalyzingRotation();

      displayedStreamingContent.value = currentTextSegment.value;
      if (typewriterAnimationId.value) {
        cancelAnimationFrame(typewriterAnimationId.value);
        typewriterAnimationId.value = null;
      }

      if (chatMessages.value.length > 0) {
        const lastMessage = chatMessages.value[chatMessages.value.length - 1];
        if (lastMessage.role === "assistant") {
          if (!lastMessage.content) {
            chatMessages.value.pop();
          } else if (currentStreamingMessage.value) {
            if (lastMessage.contentBlocks) {
              const lastBlock = lastMessage.contentBlocks[lastMessage.contentBlocks.length - 1];
              if (lastBlock && lastBlock.type === "text") {
                lastBlock.text = currentTextSegment.value;
              }
            }
            lastMessage.content = raw(
              lastMessage.content + "\n\n_[" + t("aiAssistant.responseStoppedByUser") + "]_",
            );
          }
        }
      }

      currentStreamingMessage.value = "";
      currentTextSegment.value = "";
      displayedStreamingContent.value = "";

      await saveToHistory();

      await scrollToBottom();
    }
  };

  const processStream = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
    const decoder = new TextDecoder();
    let buffer = "";
    let messageComplete = false;

    // Captured array: isActive() is identity against it, so a detached stream keeps writing its own array after a session switch.
    const msgs = chatMessages.value;
    let ctxSessionId = currentSessionId.value;
    let ctxChatId = currentChatId.value;
    let ctxTitle: string | undefined = aiGeneratedTitle.value || undefined;

    // Local streaming accumulators (synced to refs only when active)
    let streamingMsg = currentStreamingMessage.value;
    let textSegment = currentTextSegment.value;

    const isActive = () => chatMessages.value === msgs;

    const syncStreamingRefs = () => {
      if (isActive()) {
        currentStreamingMessage.value = streamingMsg;
        currentTextSegment.value = textSegment;
      }
    };

    const saveCtx = async () => {
      if (msgs.length === 0) return;
      if (!ctxSessionId) {
        ctxSessionId = getUUIDv7();
        if (isActive()) currentSessionId.value = ctxSessionId;
      }
      const title = isActive() ? aiGeneratedTitle.value || undefined : ctxTitle;
      const chatId = isActive() ? currentChatId.value : ctxChatId;
      const resultId = await dbSaveToHistory(msgs, ctxSessionId, title, chatId);
      if (!chatId && resultId) {
        if (isActive()) {
          currentChatId.value = resultId;
          // Persist the actual value (ON by default) so an explicit user disable is honored.
          autoNavigationPreferences.value.set(resultId, pendingAutoNavigation.value);
          saveAutoNavigationPreferences();
        } else {
          ctxChatId = resultId;
        }
      }
    };

    let lastSaveTime = lastStreamingSaveTime.value;
    const throttledSaveCtx = async (force = false) => {
      const now = Date.now();
      if (force || now - lastSaveTime >= STREAMING_SAVE_INTERVAL) {
        lastSaveTime = now;
        if (isActive()) lastStreamingSaveTime.value = now;
        await saveCtx();
      }
    };

    const postConfirmation = async (approved: boolean) => {
      try {
        const orgId = store.state.selectedOrganization.identifier;
        const res = await fetch(
          `${store.state.API_ENDPOINT}/api/${orgId}/ai/confirm/${ctxSessionId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ approved }),
          },
        );
        // A silent failure leaves the agent paused with nobody left to answer it.
        if (!res.ok) {
          console.error(
            approved
              ? `Auto-approval not registered (HTTP ${res.status}) for session ${ctxSessionId}`
              : `Auto-deny not registered (HTTP ${res.status}) for background stream ${ctxSessionId}`,
          );
        }
      } catch (error) {
        console.error(
          approved
            ? "Error auto-confirming navigation:"
            : "Error auto-denying confirmation for background stream:",
          error,
        );
      }
    };

    const seedState = (): StreamState => ({
      messages: msgs,
      activeToolCall: activeToolCall.value,
      textSegment,
      streamingMsg,
      title: ctxTitle,
      lastTraceId: lastTraceId.value,
      ownerUnavailable: streamOwnerUnavailable.value,
      pendingConfirmation: pendingConfirmation.value,
      messageComplete,
      halted: false,
    });

    // A detached stream must not write a ref the original would have left untouched.
    const setIfChanged = <T>(target: Ref<T>, value: T) => {
      if (target.value !== value) target.value = value;
    };

    const commitState = (state: StreamState) => {
      textSegment = state.textSegment;
      streamingMsg = state.streamingMsg;
      ctxTitle = state.title;
      messageComplete = state.messageComplete;
      setIfChanged(activeToolCall, state.activeToolCall);
      setIfChanged(lastTraceId, state.lastTraceId);
      setIfChanged(streamOwnerUnavailable, state.ownerUnavailable);
      setIfChanged(pendingConfirmation, state.pendingConfirmation);
    };

    const buildCtx = (phase: StreamPhase): ReducerCtx => ({
      isActive: isActive(),
      autoNavigationEnabled: isAutoNavigationEnabled.value,
      phase,
      t,
      generateNavigation: generateNavigationFromToolResult,
    });

    const runEffects = async (effects: StreamEffect[]) => {
      for (const effect of effects) {
        switch (effect.kind) {
          case "scroll":
            if (!effect.whenActive || isActive()) await scrollToBottom();
            break;
          case "save":
            await saveCtx();
            break;
          case "throttledSave":
            await throttledSaveCtx(effect.force);
            break;
          case "navigate":
            await handleNavigationAction(effect.action);
            break;
          case "confirmPost":
            await postConfirmation(effect.approved);
            break;
          case "dashboardEvent":
            emitDashboardEvent(effect.payload);
            break;
          case "animateTitle":
            aiGeneratedTitle.value = effect.title;
            animateTitle(effect.title);
            break;
          case "syncSegments":
            syncStreamingRefs();
            break;
          case "animateText":
            if (!typewriterAnimationId.value) animateStreamingText();
            break;
          case "finalizeText":
            if (typewriterAnimationId.value) {
              cancelAnimationFrame(typewriterAnimationId.value);
              typewriterAnimationId.value = null;
            }
            displayedStreamingContent.value = "";
            syncStreamingRefs();
            break;
        }
      }
    };

    const applyEvent = async (data: any, phase: StreamPhase) => {
      const state = seedState();
      const effects = reduce(state, data, buildCtx(phase));
      commitState(state);
      await runEffects(effects);
      return state.halted;
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const { events, rest } = extractFrames(buffer);
        buffer = rest;

        for (const jsonStr of events) {
          try {
            const data = JSON.parse(jsonStr);

            if (await applyEvent(data, "stream")) return;
          } catch (jsonError) {
            console.debug("JSON parse error:", jsonError, "for line:", jsonStr);
            continue;
          }
        }
      }

      for (const jsonStr of extractTailFrames(buffer)) {
        try {
          const data = JSON.parse(jsonStr);

          if (await applyEvent(data, "tailFlush")) return;
        } catch (e) {
          console.debug("Error processing remaining buffer:", e);
          continue;
        }
      }

      if (messageComplete) {
        if (isActive()) {
          displayedStreamingContent.value = textSegment;
          if (typewriterAnimationId.value) {
            cancelAnimationFrame(typewriterAnimationId.value);
            typewriterAnimationId.value = null;
          }
        }
        const lastMessage = msgs[msgs.length - 1];
        if (lastMessage && lastMessage.role === "assistant" && lastMessage.contentBlocks) {
          const lastBlock = lastMessage.contentBlocks[lastMessage.contentBlocks.length - 1];
          if (lastBlock && lastBlock.type === "text") {
            lastBlock.text = textSegment;
          }
        }
        await saveCtx();
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        // User cancel is expected; a detached stream still needs its final save.
        if (!isActive() && msgs.length > 0 && ctxSessionId) {
          await dbSaveToHistory(msgs, ctxSessionId, ctxTitle, ctxChatId);
        }
        return;
      } else {
        console.error("Error reading stream:", error);
      }
    }
  };

  const saveToHistory = async () => {
    saveHistoryLoading.value = true;
    if (chatMessages.value.length === 0) {
      saveHistoryLoading.value = false;
      return;
    }

    try {
      if (!currentSessionId.value) {
        currentSessionId.value = getUUIDv7();
      }

      const title = aiGeneratedTitle.value || undefined;

      const chatId = await dbSaveToHistory(
        chatMessages.value,
        currentSessionId.value,
        title,
        currentChatId.value,
      );

      if (!currentChatId.value && chatId) {
        currentChatId.value = chatId;

        // Persist the actual value (ON by default) so an explicit user disable is honored.
        autoNavigationPreferences.value.set(chatId, pendingAutoNavigation.value);
        saveAutoNavigationPreferences();
      }
    } catch (error) {
      console.error("Error saving chat history:", error);
    } finally {
      saveHistoryLoading.value = false;
    }
  };

  /** Detach the stream so it keeps writing its captured array in the background and saves via saveCtx() when done. */
  const detachCurrentStream = () => {
    if (!currentAbortController.value) return;

    if (backgroundStreams.size >= MAX_BACKGROUND_STREAMS) {
      const oldest = backgroundStreams.values().next().value;
      if (oldest) {
        oldest.abort();
        backgroundStreams.delete(oldest);
      }
    }
    const detachedController = currentAbortController.value;
    backgroundStreams.add(detachedController);
    currentAbortController.value = null;

    // loadChat re-attaches by swapping chatMessages.value to this live array.
    if (currentSessionId.value) {
      backgroundStreamMap.set(currentSessionId.value, {
        msgs: chatMessages.value,
        controller: detachedController,
        chatId: currentChatId.value,
      });
    }

    isLoading.value = false;
    activeToolCall.value = null;
    stopAnalyzingRotation();
    if (typewriterAnimationId.value) {
      cancelAnimationFrame(typewriterAnimationId.value);
      typewriterAnimationId.value = null;
    }
    currentStreamingMessage.value = "";
    currentTextSegment.value = "";
    displayedStreamingContent.value = "";
  };

  // Logout must kill the foreground turn too; MainLayout.signout() sends a window event because its Options API half can't reach setup scope.
  const abortAllStreams = () => {
    abortBackgroundStreams();
    if (currentAbortController.value) {
      currentAbortController.value.abort();
      currentAbortController.value = null;
    }
  };

  const resolveConfirmationBlock = (approved: boolean) => {
    for (const msg of chatMessages.value) {
      if (msg.contentBlocks) {
        for (const block of msg.contentBlocks) {
          if (block.pendingConfirmation) {
            block.pendingConfirmation = false;
            if (!approved) {
              block.success = false;
              block.resultMessage = t("aiAssistant.aiChat.actionCancelledByUser");
            }
            return;
          }
        }
      }
    }
  };

  // Shown after a restore: only the dialogue came back, not tool results, files or permission decisions.
  const RESTORED_NOTICE =
    "This conversation was interrupted and has been restored. Earlier messages are preserved, but any files, queries or other actions from before the interruption were not carried over.";

  // Keyed on the explicit server code, never a generic failure: restoring abandons the current session.
  const isSessionOwnerUnavailable = (errorBody: unknown): boolean => {
    // `unknown`, not `any` — narrow before reading, or a non-object body throws.
    if (typeof errorBody !== "object" || errorBody === null) return false;
    const body = errorBody as { code?: unknown; detail?: { code?: unknown } };
    const code = body.detail?.code ?? body.code;
    return code === "session_owner_unavailable";
  };

  const appendErrorBlock = (message: string, recoverable = false) => {
    const block: ContentBlock = { type: "error", message: raw(message), recoverable };
    const msgs = chatMessages.value;
    const last = msgs[msgs.length - 1];
    if (last && last.role === "assistant") {
      if (!last.contentBlocks) last.contentBlocks = [];
      last.contentBlocks.push(block);
    } else {
      msgs.push({ role: "assistant", content: raw(""), contentBlocks: [block] });
    }
  };

  /** POST a confirmation answer and report whether it landed, so a 404 from a replica without the pending confirmation isn't silent. */
  const sendConfirmation = async (sessionId: string, approved: boolean): Promise<boolean> => {
    try {
      const orgId = store.state.selectedOrganization.identifier;
      const res = await fetch(`${store.state.API_ENDPOINT}/api/${orgId}/ai/confirm/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ approved }),
      });

      if (!res.ok) {
        console.error(`Confirmation not registered (HTTP ${res.status}) for session ${sessionId}`);
        appendErrorBlock(
          approved
            ? "Your approval could not be delivered — the assistant may have already cancelled this action. Please check the result before retrying."
            : "Your response could not be delivered — the assistant may have already cancelled this action.",
        );
        return false;
      }
      return true;
    } catch (error) {
      console.error("Error sending confirmation:", error);
      appendErrorBlock(
        "Your response could not be delivered. Please check your connection and try again.",
      );
      return false;
    }
  };

  const handleToolConfirm = async () => {
    resolveConfirmationBlock(true);

    if (pendingConfirmation.value?.tool === "navigation_action") {
      const navAction = pendingConfirmation.value?.navAction;
      if (navAction) {
        await handleNavigationAction(navAction);
      }
      pendingConfirmation.value = null;
      return;
    }

    if (!currentSessionId.value) return;

    await sendConfirmation(currentSessionId.value, true);
    pendingConfirmation.value = null;
  };

  const handleToolCancel = async () => {
    resolveConfirmationBlock(false);

    if (pendingConfirmation.value?.tool === "navigation_action") {
      pendingConfirmation.value = null;
      return;
    }

    if (!currentSessionId.value) return;

    await sendConfirmation(currentSessionId.value, false);
    pendingConfirmation.value = null;
  };

  const handleToolAlwaysConfirm = async () => {
    isAutoNavigationEnabled.value = true;

    resolveConfirmationBlock(true);

    if (pendingConfirmation.value?.tool === "navigation_action") {
      const navAction = pendingConfirmation.value?.navAction;
      if (navAction) {
        await handleNavigationAction(navAction);
      }
      pendingConfirmation.value = null;
      return;
    }

    if (!currentSessionId.value) return;

    await sendConfirmation(currentSessionId.value, true);
    pendingConfirmation.value = null;
  };

  const generateNavigationFromToolResult = (
    toolName: string,
    callArgs: any,
    responseBody: any,
  ): NavigationAction | null => generateNavigation(toolName, callArgs, responseBody, t);

  const handleNavigationAction = async (action: NavigationAction) => {
    // Detach before navigating so the route change can't abort the in-flight turn and its queued tool calls.
    detachCurrentStream();

    const pageName = navigationPageName(action);

    const target = buildNavigationRoute(action, store.state.selectedOrganization.identifier);
    if (target) {
      await router.push({ path: target.path, query: target.query });
    }

    // Use setTimeout to add message AFTER navigation fully completes and settles
    setTimeout(async () => {
      try {
        const successMessage = t("aiAssistant.navigatedTo", { page: pageName });
        let lastMessage = chatMessages.value[chatMessages.value.length - 1];

        if (!lastMessage || lastMessage.role !== "assistant") {
          chatMessages.value.push({
            role: "assistant",
            content: raw(successMessage),
            contentBlocks: [{ type: "text", text: successMessage }],
          });
        } else {
          if (lastMessage.content) {
            lastMessage.content = raw(lastMessage.content + "\n\n" + successMessage);
          } else {
            lastMessage.content = raw(successMessage);
          }
          if (!lastMessage.contentBlocks) {
            lastMessage.contentBlocks = [];
          }
          lastMessage.contentBlocks.push({
            type: "text",
            text: successMessage,
          });
        }

        await saveToHistory();
        await scrollToBottom();
      } catch (error) {
        console.error("Error adding navigation success message:", error);
      }
    }, 500);
  };

  const tryReattach = (chat: ChatHistoryEntry, chatId: number): boolean => {
    // Re-attach to a live background stream: assigning its array makes processStream's isActive() identity true again.
    const bgCtx = chat.sessionId ? backgroundStreamMap.get(chat.sessionId) : null;

    if (bgCtx) {
      chatMessages.value = bgCtx.msgs;
      currentChatId.value = bgCtx.chatId || chatId;
      currentSessionId.value = chat.sessionId || null;

      currentAbortController.value = bgCtx.controller;
      backgroundStreams.delete(bgCtx.controller);
      backgroundStreamMap.delete(chat.sessionId!);

      isLoading.value = true;
      startAnalyzingRotation();

      // Prime the typewriter with text streamed before re-attach; processStream only syncs on the next chunk, so the backlog would stay invisible.
      const lastMsg = chatMessages.value[chatMessages.value.length - 1];
      if (lastMsg?.role === "assistant" && lastMsg.contentBlocks?.length) {
        const lastBlock = lastMsg.contentBlocks[lastMsg.contentBlocks.length - 1];
        if (lastBlock?.type === "text" && lastBlock.text) {
          currentStreamingMessage.value = lastMsg.content || lastBlock.text;
          currentTextSegment.value = lastBlock.text;
          displayedStreamingContent.value = lastBlock.text;
        }
      }
      return true;
    }
    return false;
  };

  const runTurn = async (hasImages: boolean, messagesToSend: ImageAttachment[]) => {
    isLoading.value = true;
    currentStreamingMessage.value = "";
    currentTextSegment.value = "";
    resetTypewriterState();
    startAnalyzingRotation();

    // Mint the session id before the try so every exit path's cleanup clears the SAME id, or a re-attached instance spins forever.
    if (!currentSessionId.value) {
      currentSessionId.value = getUUIDv7();
    }
    const streamSessionId = currentSessionId.value;

    sessionStreamingState[streamSessionId] = true;

    currentAbortController.value = new AbortController();

    // At most one restore attempt per turn; the notice shows only once the replacement request succeeds.
    let hasReseeded = false;
    let reseedNotice = false;

    // Clear any flag left by a turn that threw or aborted early; a stale `true` abandons a healthy session.
    streamOwnerUnavailable.value = false;

    try {
      // Don't add empty assistant message here - wait for actual content
      await scrollToLoadingIndicator();

      let response: any;
      try {
        response = await fetchAiChat(
          chatMessages.value,
          "",
          store.state.selectedOrganization.identifier,
          currentAbortController.value.signal,
          undefined, // explicitContext
          currentSessionId.value,
          hasImages ? messagesToSend : undefined,
        );
      } catch (error) {
        console.error("Error fetching AI chat:", error);
        return;
      }

      if (response && response.cancelled) {
        return;
      }

      if (!response.ok) {
        let errorBody = null;
        try {
          errorBody = await response.json();
        } catch (_) {
          // body may not be JSON
        }

        // Session gone but transcript remains: resend under a fresh session for the server to seed; this code only, once only.
        if (isSessionOwnerUnavailable(errorBody) && !hasReseeded) {
          hasReseeded = true;
          console.warn(
            `Session ${currentSessionId.value} is no longer available; restoring the conversation in a new session.`,
          );

          // A NEW id, since the old one would be refused again; streamSessionId stays pinned to the original for cleanup.
          currentSessionId.value = getUUIDv7();
          reseedNotice = true;

          response = await fetchAiChat(
            chatMessages.value,
            "",
            store.state.selectedOrganization.identifier,
            currentAbortController.value?.signal,
            undefined,
            currentSessionId.value,
            hasImages ? messagesToSend : undefined,
          );
        }
      }

      // Re-check: the reseed above may have produced a fresh response.
      if (!response.ok) {
        let errorBody = null;
        try {
          errorBody = await response.json();
        } catch (_) {
          // body may not be JSON
        }
        const err: any = new Error(
          errorBody?.message ||
            t("aiAssistant.aiChat.serverErrorStatus", { status: response.status }),
        );
        err.status = response.status;
        err.errorBody = errorBody;
        throw err;
      }

      // Announce before content arrives; silence hides that earlier tool results and file state were lost.
      if (reseedNotice) {
        reseedNotice = false;
        appendErrorBlock(RESTORED_NOTICE, true);
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();

      const streamController = currentAbortController.value;
      const streamMsgs = chatMessages.value;

      await processStream(reader);

      // A streaming 409 arrives as an SSE event inside a 200; restore only while this turn is on screen, or it clobbers another chat's session.
      const stillOnScreen = chatMessages.value === streamMsgs;
      if (streamOwnerUnavailable.value && !hasReseeded && stillOnScreen) {
        streamOwnerUnavailable.value = false;
        hasReseeded = true;

        if (streamController) backgroundStreams.delete(streamController);
        if (streamSessionId) backgroundStreamMap.delete(streamSessionId);

        // The streaming registry must follow the new id, or a re-attaching instance never sees this stream finish.
        const restoredSessionId = getUUIDv7();
        currentSessionId.value = restoredSessionId;
        sessionStreamingState[restoredSessionId] = true;

        const retry: any = await fetchAiChat(
          chatMessages.value,
          "",
          store.state.selectedOrganization.identifier,
          currentAbortController.value?.signal,
          undefined,
          currentSessionId.value,
          hasImages ? messagesToSend : undefined,
        );

        if (retry && !retry.cancelled && retry.ok && retry.body) {
          // Announced only once the replacement is accepted, or the claim can turn out false.
          appendErrorBlock(RESTORED_NOTICE, true);
          await processStream(retry.body.getReader());
        } else if (!(retry && retry.cancelled)) {
          // Retry failed and hasReseeded blocks another attempt, so explain instead of ending silently; a cancel stays silent.
          appendErrorBlock(
            "This conversation was interrupted and could not be restored. Please try sending your message again.",
          );
        }

        // Clear the restored turn's entry either way, or a re-attaching instance spins forever.
        sessionStreamingState[restoredSessionId] = false;
        backgroundStreamMap.delete(restoredSessionId);
      }
      streamOwnerUnavailable.value = false;

      if (streamController) backgroundStreams.delete(streamController);
      if (streamSessionId) backgroundStreamMap.delete(streamSessionId);

      // Only update UI/store if stream was NOT detached (session is still the same)
      const wasDetached = chatMessages.value !== streamMsgs;
      if (!wasDetached) {
        store.dispatch("setCurrentChatTimestamp", currentChatId.value);
        store.dispatch("setChatUpdated", true);
      }
    } catch (error: any) {
      if (
        chatMessages.value.length > 0 &&
        chatMessages.value[chatMessages.value.length - 1].role === "assistant" &&
        !chatMessages.value[chatMessages.value.length - 1].content
      ) {
        chatMessages.value.pop();
      }
      const errorMessage = chatErrorMessage(error, t);
      chatMessages.value.push({
        role: "assistant",
        content: raw(errorMessage),
      });
      await saveToHistory();
    }

    isLoading.value = false;
    activeToolCall.value = null;
    stopAnalyzingRotation();

    // Clear by the id captured before the request, not currentSessionId, which may belong to another chat by an early failure.
    sessionStreamingState[streamSessionId] = false;

    currentAbortController.value = null;

    await scrollToBottom();
  };

  // Throttle the reactive write: each one re-parses and re-highlights the whole markdown, which is O(n^2) at typewriter tick rate.
  const STREAMING_RENDER_INTERVAL = 80;
  let lastStreamingRenderTime = 0;
  let pendingStreamingRenderContent: string | null = null;
  let streamingRenderFlushTimer: ReturnType<typeof setTimeout> | null = null;

  const flushStreamingRenderNow = (content: string) => {
    lastStreamingRenderTime = Date.now();
    pendingStreamingRenderContent = null;
    if (streamingRenderFlushTimer) {
      clearTimeout(streamingRenderFlushTimer);
      streamingRenderFlushTimer = null;
    }

    const lastMessage = chatMessages.value[chatMessages.value.length - 1];
    if (lastMessage && lastMessage.role === "assistant" && lastMessage.contentBlocks) {
      const lastBlock = lastMessage.contentBlocks[lastMessage.contentBlocks.length - 1];
      if (lastBlock && lastBlock.type === "text") {
        // Additive-only: the typewriter reveals a prefix of text already written here, so a lagging or reset reveal must never shorten it.
        if ((content?.length || 0) >= (lastBlock.text?.length || 0)) {
          lastBlock.text = content;
        }
      }
    }
  };

  const disposeRenderFlush = () => {
    if (streamingRenderFlushTimer) {
      clearTimeout(streamingRenderFlushTimer);
      streamingRenderFlushTimer = null;
    }
    pendingStreamingRenderContent = null;
  };

  watch(displayedStreamingContent, (newContent) => {
    if (!isLoading.value) return;
    // An empty displayedStreamingContent means a new segment starts, not that previous content should be cleared.
    if (!newContent) return;

    const now = Date.now();
    if (now - lastStreamingRenderTime >= STREAMING_RENDER_INTERVAL) {
      flushStreamingRenderNow(newContent);
      return;
    }

    // Trailing edge: the latest content must land even if ticks keep arriving faster than the interval.
    pendingStreamingRenderContent = newContent;
    if (!streamingRenderFlushTimer) {
      const delay = STREAMING_RENDER_INTERVAL - (now - lastStreamingRenderTime);
      streamingRenderFlushTimer = setTimeout(() => {
        streamingRenderFlushTimer = null;
        if (pendingStreamingRenderContent !== null) {
          flushStreamingRenderNow(pendingStreamingRenderContent);
        }
      }, delay);
    }
  });

  watch(
    () => (currentSessionId.value ? sessionStreamingState[currentSessionId.value] : undefined),
    (isStreaming) => {
      // React to false, not true->false: a mid-stream re-attach never saw `true`, so it would skip cleanup and spin forever.
      if (isStreaming === false && isLoading.value) {
        isLoading.value = false;
        activeToolCall.value = null;
        stopAnalyzingRotation();
        // The owning instance's processStream already wrote the final text, so only clear this instance's typewriter UI.
        resetTypewriterState();
        // Publish the finished turn so a later mount reads it, not a mid-stream snapshot.
        store.dispatch("setCurrentChatTimestamp", currentChatId.value);
        nextTick(() => scrollToBottom());
      }
    },
  );

  return {
    isLoading,
    currentSessionId,
    lastTraceId,
    saveHistoryLoading,
    pendingConfirmation,
    activeToolCall,
    currentAbortController,
    streamOwnerUnavailable,
    cancelCurrentRequest,
    saveToHistory,
    detachCurrentStream,
    abortAllStreams,
    handleToolConfirm,
    handleToolCancel,
    handleToolAlwaysConfirm,
    handleNavigationAction,
    sendConfirmation,
    isSessionOwnerUnavailable,
    appendErrorBlock,
    runTurn,
    tryReattach,
    disposeRenderFlush,
  };
}
