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

import { toast } from "@/lib/feedback/Toast/useToast";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  type ImageAttachment,
} from "@/ts/interfaces/chat";
import type { TranslateFn } from "@/types/i18n";
import { chartColor } from "@/utils/chartTheme";

const escapeRegExp = (str: string) => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/**
 * Owns the pending-image attachments of the chat composer: validation, base64
 * conversion, the `@[file]` reference chip inserted into the input, and the
 * preview dialog. `chatInput` is the RichTextInput component instance.
 */
export function useChatImages(
  chatInput: Ref<any>,
  inputMessage: Ref<string>,
  focusInput: () => void,
  t: TranslateFn,
) {
  // Pending images for current message
  const pendingImages = ref<ImageAttachment[]>([]);
  const imageInputRef = ref<HTMLInputElement | null>(null);
  // Image preview dialog state
  const showImagePreview = ref(false);
  const previewImage = ref<ImageAttachment | null>(null);

  const editableTarget = () =>
    chatInput.value?.$el?.querySelector('[contenteditable="true"]') ||
    chatInput.value?.$el?.querySelector(".rich-text-input");

  const triggerImageUpload = () => {
    imageInputRef.value?.click();
  };

  const addImage = async (file: File): Promise<boolean> => {
    // Validate file size first (before reading)
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      toast({
        variant: "error",
        message: t("toastMessages.components.imageExceeds2mbLimitMb", {
          size: (file.size / 1024 / 1024).toFixed(1),
        }),
      });
      return false;
    }

    // Basic file type check for immediate feedback (backend will detect actual type)
    if (!ALLOWED_IMAGE_TYPES.includes(file.type as any)) {
      toast({
        variant: "error",
        message: t("toastMessages.components.onlyPngAndJpegImagesAre"),
      });
      return false;
    }

    // Convert to base64
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = (e.target?.result as string).split(",")[1]; // Remove data:image/...;base64, prefix
        const imageRef = `@[${file.name}]`;

        // Use file.type for display - backend will detect and correct actual mime type
        pendingImages.value.push({
          data: base64,
          mimeType: file.type as "image/png" | "image/jpeg",
          filename: file.name,
          size: file.size,
        });

        const contenteditable = editableTarget();

        if (contenteditable) {
          // RichTextInput - insert at cursor position in contenteditable
          const selection = window.getSelection();
          const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

          // Create a non-editable span for the image reference
          const imageRefSpan = document.createElement("span");
          imageRefSpan.contentEditable = "false";
          imageRefSpan.className = "image-reference";
          // eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel rule must not scale with text or it smears at fractional zoom
          imageRefSpan.style.cssText = `display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.125rem 0.375rem; margin: 0 0.125rem; background: ${chartColor("--color-status-success-bg")}; border: 1px solid ${chartColor("--color-success-200")}; border-radius: 0.25rem; font-size: var(--text-compact); color: ${chartColor("--color-status-success-text")}; user-select: none;`;

          const imageIcon = document.createElement("span");
          imageIcon.textContent = "🖼️";
          imageIcon.style.cssText = "font-size: var(--text-xs);";

          const filenameText = document.createElement("span");
          filenameText.textContent = file.name;

          const removeBtn = document.createElement("button");
          removeBtn.textContent = "×";
          removeBtn.style.cssText = `display: flex; align-items: center; justify-content: center; width: 0.875rem; height: 0.875rem; padding: 0; margin-left: 0.125rem; background: transparent; border: none; border-radius: 0.1875rem; font-size: var(--text-base); line-height: 1; cursor: pointer; color: ${chartColor("--color-status-success-text")}; transition: all 0.15s ease;`;
          removeBtn.onmouseover = () => {
            removeBtn.style.background = chartColor("--color-status-negative");
            removeBtn.style.color = chartColor("--color-white");
          };
          removeBtn.onmouseout = () => {
            removeBtn.style.background = "transparent";
            removeBtn.style.color = chartColor("--color-status-success-text");
          };
          removeBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();

            const imageIndex = pendingImages.value.findIndex((img) => img.filename === file.name);
            if (imageIndex !== -1) {
              pendingImages.value.splice(imageIndex, 1);
            }

            imageRefSpan.remove();

            contenteditable.dispatchEvent(new Event("input", { bubbles: true }));
          };

          imageRefSpan.appendChild(imageIcon);
          imageRefSpan.appendChild(filenameText);
          imageRefSpan.appendChild(removeBtn);

          if (range && contenteditable.contains(range.startContainer)) {
            // Insert at cursor position
            range.deleteContents();

            // Add space before if needed
            const textBefore = range.startContainer.textContent || "";
            if (textBefore.length > 0 && !textBefore.endsWith(" ") && !textBefore.endsWith("\n")) {
              range.insertNode(document.createTextNode(" "));
            }

            range.insertNode(imageRefSpan);

            // Add space after for cursor positioning
            const spaceAfter = document.createTextNode(" ");
            range.setStartAfter(imageRefSpan);
            range.insertNode(spaceAfter);

            // Move cursor after the space
            range.setStartAfter(spaceAfter);
            range.collapse(true);
            selection?.removeAllRanges();
            selection?.addRange(range);
          } else {
            // No selection or selection outside - append to end
            const spaceNeeded =
              contenteditable.textContent &&
              !contenteditable.textContent.endsWith(" ") &&
              !contenteditable.textContent.endsWith("\n");
            if (spaceNeeded) {
              contenteditable.appendChild(document.createTextNode(" "));
            }
            contenteditable.appendChild(imageRefSpan);
            const spaceAfter = document.createTextNode(" ");
            contenteditable.appendChild(spaceAfter);

            // Move cursor to end
            const newRange = document.createRange();
            newRange.setStartAfter(spaceAfter);
            newRange.collapse(true);
            selection?.removeAllRanges();
            selection?.addRange(newRange);
          }

          // Trigger input event to update model
          contenteditable.dispatchEvent(new Event("input", { bubbles: true }));
          focusInput();
        } else {
          // Legacy textarea fallback
          const textarea = chatInput.value?.$el?.querySelector(
            "textarea",
          ) as HTMLTextAreaElement | null;
          if (textarea) {
            const start = textarea.selectionStart || 0;
            const end = textarea.selectionEnd || 0;
            const text = inputMessage.value;
            const before = text.substring(0, start);
            const after = text.substring(end);

            const needsSpaceBefore =
              before.length > 0 && !before.endsWith(" ") && !before.endsWith("\n");
            const needsSpaceAfter =
              after.length > 0 && !after.startsWith(" ") && !after.startsWith("\n");

            const insertion =
              (needsSpaceBefore ? " " : "") + imageRef + (needsSpaceAfter ? " " : "");
            inputMessage.value = before + insertion + after;

            // Set cursor position after the inserted reference
            nextTick(() => {
              const newPos = start + insertion.length;
              textarea.setSelectionRange(newPos, newPos);
              textarea.focus();
            });
          } else {
            // Final fallback: append to end
            const currentText = inputMessage.value;
            const separator =
              currentText && !currentText.endsWith(" ") && !currentText.endsWith("\n") ? " " : "";
            inputMessage.value = currentText + separator + imageRef + " ";
          }
        }

        resolve(true);
      };
      reader.onerror = () => {
        toast({
          variant: "error",
          message: t("toastMessages.components.failedToReadImage", { error: file.name }),
        });
        resolve(false);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleImageSelect = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      await addImage(file);
    }
    // Reset input so the same file can be selected again
    input.value = "";
  };

  const removeImage = (index: number) => {
    const image = pendingImages.value[index];
    if (image) {
      const imageRef = `@[${image.filename}]`;

      const contenteditable = editableTarget();

      if (contenteditable) {
        const imageRefSpans = contenteditable.querySelectorAll(".image-reference");
        imageRefSpans.forEach((span: Element) => {
          if (span.textContent === imageRef) {
            span.remove();
          }
        });

        // Trigger input event to update model
        contenteditable.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        // Legacy textarea - remove from text
        inputMessage.value = inputMessage.value
          .replace(new RegExp(`\\s*${escapeRegExp(imageRef)}\\s*`, "g"), " ")
          .trim();
      }
    }
    pendingImages.value.splice(index, 1);
  };

  const clearPendingImages = () => {
    pendingImages.value = [];
  };

  // Handle drag and drop for images
  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDrop = async (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const files = event.dataTransfer?.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/")) {
        await addImage(file);
      }
    }
  };

  // Handle paste for images
  const handlePaste = async (event: ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          await addImage(file);
        }
      }
    }
  };

  const openImagePreview = (img: ImageAttachment) => {
    previewImage.value = img;
    showImagePreview.value = true;
  };

  const closeImagePreview = () => {
    showImagePreview.value = false;
    previewImage.value = null;
  };

  return {
    pendingImages,
    imageInputRef,
    showImagePreview,
    previewImage,
    triggerImageUpload,
    handleImageSelect,
    addImage,
    removeImage,
    clearPendingImages,
    handleDragOver,
    handleDrop,
    handlePaste,
    openImagePreview,
    closeImagePreview,
  };
}
