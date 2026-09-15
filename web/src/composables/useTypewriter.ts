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

import { ref, type Ref } from "vue";

import type { TranslateFn } from "@/types/i18n";

const TYPEWRITER_SPEED = 8; // ms per character - fast like ChatGPT (5-10ms range)

/**
 * The three animated surfaces of the chat: the rotating "analyzing…" label, the
 * chat title typewriter, and the per-character reveal of streamed assistant text.
 * `currentTextSegment` is owned by the stream shell and passed in so both sides
 * read the same ref.
 */
export function useTypewriter(currentTextSegment: Ref<string>, t: TranslateFn) {
  // Analyzing messages for loading indicator
  const ANALYZING_MESSAGES = [
    t("aiAssistant.aiChat.analyzingMessages.analyzing"),
    t("aiAssistant.aiChat.analyzingMessages.thinking"),
    t("aiAssistant.aiChat.analyzingMessages.processing"),
    t("aiAssistant.aiChat.analyzingMessages.examiningData"),
    t("aiAssistant.aiChat.analyzingMessages.reviewingContext"),
    t("aiAssistant.aiChat.analyzingMessages.formulatingResponse"),
    t("aiAssistant.aiChat.analyzingMessages.checkingDetails"),
    t("aiAssistant.aiChat.analyzingMessages.gatheringInsights"),
    t("aiAssistant.aiChat.analyzingMessages.evaluatingOptions"),
    t("aiAssistant.aiChat.analyzingMessages.synthesizingInformation"),
    t("aiAssistant.aiChat.analyzingMessages.workingOnIt"),
    t("aiAssistant.aiChat.analyzingMessages.almostThere"),
    t("aiAssistant.aiChat.analyzingMessages.divingDeeper"),
    t("aiAssistant.aiChat.analyzingMessages.connectingTheDots"),
    t("aiAssistant.aiChat.analyzingMessages.crunchingNumbers"),
    t("aiAssistant.aiChat.analyzingMessages.exploringPossibilities"),
    t("aiAssistant.aiChat.analyzingMessages.refiningAnswer"),
    t("aiAssistant.aiChat.analyzingMessages.stillThinking"),
    t("aiAssistant.aiChat.analyzingMessages.makingProgress"),
    t("aiAssistant.aiChat.analyzingMessages.piecingTogether"),
  ];
  const currentAnalyzingMessage = ref(ANALYZING_MESSAGES[0]);
  const analyzingRotationInterval = ref<NodeJS.Timeout | null>(null);

  // AI-generated chat title state
  const aiGeneratedTitle = ref<string | null>(null);
  const displayedTitle = ref<string>("");
  const isTypingTitle = ref(false);
  const titleAnimationId = ref<number>(0); // Used to cancel stale animations

  // Interval ID for title animation
  let titleIntervalId: ReturnType<typeof setInterval> | null = null;

  // Typewriter animation state for LLM responses
  const displayedStreamingContent = ref("");
  const typewriterAnimationId = ref<number | null>(null);

  /**
   * Start rotating the analyzing message every 5 seconds
   */
  const startAnalyzingRotation = () => {
    currentAnalyzingMessage.value =
      ANALYZING_MESSAGES[Math.floor(Math.random() * ANALYZING_MESSAGES.length)];
    analyzingRotationInterval.value = setInterval(() => {
      currentAnalyzingMessage.value =
        ANALYZING_MESSAGES[Math.floor(Math.random() * ANALYZING_MESSAGES.length)];
    }, 5000);
  };

  /**
   * Stop rotating the analyzing message
   */
  const stopAnalyzingRotation = () => {
    if (analyzingRotationInterval.value) {
      clearInterval(analyzingRotationInterval.value);
      analyzingRotationInterval.value = null;
    }
  };

  /**
   * Animate title with typewriter effect
   * Characters appear one by one from left to right
   * Uses setInterval for reliable timing with Vue reactivity
   */
  const animateTitle = (title: string) => {
    // Clear any existing animation
    if (titleIntervalId) {
      clearInterval(titleIntervalId);
      titleIntervalId = null;
    }

    // Increment animation ID to track this animation
    const currentAnimationId = ++titleAnimationId.value;

    isTypingTitle.value = true;
    displayedTitle.value = "";
    let charIndex = 0;

    titleIntervalId = setInterval(() => {
      // Check if this animation was superseded
      if (titleAnimationId.value !== currentAnimationId) {
        if (titleIntervalId) {
          clearInterval(titleIntervalId);
          titleIntervalId = null;
        }
        return;
      }

      if (charIndex < title.length) {
        displayedTitle.value = title.slice(0, charIndex + 1);
        charIndex++;
      } else {
        // Animation complete
        if (titleIntervalId) {
          clearInterval(titleIntervalId);
          titleIntervalId = null;
        }
        isTypingTitle.value = false;
      }
    }, 30); // 30ms per character
  };

  /**
   * Reset title state for new chat
   */
  const resetTitleState = () => {
    // Cancel any ongoing animation
    titleAnimationId.value++;
    if (titleIntervalId) {
      clearInterval(titleIntervalId);
      titleIntervalId = null;
    }
    aiGeneratedTitle.value = null;
    displayedTitle.value = "";
    isTypingTitle.value = false;
  };

  /**
   * Drop the title interval without resetting the title itself (unmount cleanup).
   */
  const clearTitleInterval = () => {
    if (titleIntervalId) {
      clearInterval(titleIntervalId);
      titleIntervalId = null;
    }
  };

  /**
   * Reset typewriter animation state
   */
  const resetTypewriterState = () => {
    displayedStreamingContent.value = "";
    if (typewriterAnimationId.value) {
      cancelAnimationFrame(typewriterAnimationId.value);
      typewriterAnimationId.value = null;
    }
  };

  /**
   * Animate text reveal with typewriter effect
   * Skips animation for code blocks (reveals them instantly)
   */
  const animateStreamingText = () => {
    const target = currentTextSegment.value;
    const current = displayedStreamingContent.value;

    if (current.length >= target.length) {
      // Caught up, stop animation
      if (typewriterAnimationId.value) {
        cancelAnimationFrame(typewriterAnimationId.value);
        typewriterAnimationId.value = null;
      }
      return;
    }

    // Check if we're at the start of a code block - if so, skip to end of code block
    const remaining = target.slice(current.length);
    const codeBlockStart = remaining.match(/^```[\w]*/);

    if (codeBlockStart) {
      // Find the closing ``` and reveal entire code block instantly
      const codeBlockEnd = remaining.indexOf("```", codeBlockStart[0].length);
      if (codeBlockEnd !== -1) {
        const endPos = codeBlockEnd + 3;
        displayedStreamingContent.value = target.slice(0, current.length + endPos);
      } else {
        // Code block not complete yet, reveal opening and wait
        displayedStreamingContent.value = target.slice(
          0,
          current.length + codeBlockStart[0].length,
        );
      }
    } else {
      // Regular text - reveal one character per tick when caught up, but
      // catch up faster when a backlog has built up (e.g. the backend
      // delivered a large chunk in one burst). Without this, a fixed
      // 1-char-per-tick reveal can lag the actual stream by many seconds
      // on bursty responses, then "snap" to the full text once the stream
      // ends and the remaining backlog is force-flushed.
      const backlog = remaining.length;
      const revealCount = backlog > 200 ? Math.ceil(backlog / 20) : 1;
      displayedStreamingContent.value = target.slice(0, current.length + revealCount);
    }

    // Schedule next frame
    typewriterAnimationId.value = requestAnimationFrame(() => {
      setTimeout(animateStreamingText, TYPEWRITER_SPEED);
    });
  };

  return {
    currentAnalyzingMessage,
    startAnalyzingRotation,
    stopAnalyzingRotation,
    aiGeneratedTitle,
    displayedTitle,
    isTypingTitle,
    animateTitle,
    resetTitleState,
    clearTitleInterval,
    displayedStreamingContent,
    typewriterAnimationId,
    resetTypewriterState,
    animateStreamingText,
  };
}
