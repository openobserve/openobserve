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

/**
 * Stick-to-bottom scrolling of the chat transcript and the jump-to-bottom button.
 * `messagesContainer` is the template ref of the scrolling element.
 */
export function useChatScroll(messagesContainer: Ref<HTMLElement | null>) {
  const shouldAutoScroll = ref(true);
  const showScrollToBottom = ref(false);

  const getScrollThreshold = () => {
    return 50; // Fixed 50px threshold for all screens
  };

  const checkIfShouldAutoScroll = () => {
    if (!messagesContainer.value) return;

    const { scrollTop, scrollHeight, clientHeight } = messagesContainer.value;
    const threshold = getScrollThreshold();
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - threshold;

    shouldAutoScroll.value = isAtBottom;

    // Show scroll to bottom button when user scrolls up significantly
    // Only show if there's enough content to scroll and user is not at bottom
    const hasScrollableContent = scrollHeight > clientHeight + 100; // At least 100px more content
    const isScrolledUp = scrollTop + clientHeight < scrollHeight - 100; // 100px from bottom

    showScrollToBottom.value = hasScrollableContent && isScrolledUp;
  };

  const scrollToBottom = async () => {
    await nextTick();
    if (messagesContainer.value && shouldAutoScroll.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  };

  const scrollToBottomSmooth = async () => {
    await nextTick();
    if (messagesContainer.value) {
      messagesContainer.value.scrollTo({
        top: messagesContainer.value.scrollHeight,
        behavior: "smooth",
      });
      // Hide the button immediately when user clicks it
      showScrollToBottom.value = false;
      // Reset auto-scroll when user manually scrolls to bottom
      shouldAutoScroll.value = true;
    }
  };

  // No element carries this id, but sendMessage relies on the tick it awaits before the first request.
  const scrollToLoadingIndicator = async () => {
    await nextTick();
    const loadingElement = document.getElementById("loading-indicator");
    if (loadingElement) {
      loadingElement.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  };

  return {
    shouldAutoScroll,
    showScrollToBottom,
    getScrollThreshold,
    checkIfShouldAutoScroll,
    scrollToBottom,
    scrollToBottomSmooth,
    scrollToLoadingIndicator,
  };
}
