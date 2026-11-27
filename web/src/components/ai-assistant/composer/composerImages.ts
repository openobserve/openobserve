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

import { MAX_IMAGES, type ContextChip } from "@/composables/assistant";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  type ImageAttachment,
} from "@/ts/interfaces/chat";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import { formatBytes } from "@/utils/formatters";

export type ImageCap = "images" | "type" | "size";

export function imageTooBigLine(t: TranslateFn, picked: File): I18nText {
  return t("assistant.composer.imageTooBig", {
    name: raw(picked.name),
    size: raw(formatBytes(picked.size)),
    count: MAX_IMAGES,
    max: raw(formatBytes(MAX_IMAGE_SIZE_BYTES)),
  });
}

/** Reads each file into `add`; a wrong type, an oversize or unreadable file is refused, and the first cap `add` hits ends the run. */
export async function attachImageFiles(
  files: readonly File[],
  opts: {
    t: TranslateFn;
    add(image: ImageAttachment): { ok: true } | { ok: false; cap: ImageCap };
    refuse(cap: ImageCap, line: I18nText): void;
    nameOf?(picked: File): string;
  },
): Promise<void> {
  const { t } = opts;
  for (const picked of files) {
    const mimeType = ALLOWED_IMAGE_TYPES.find((type) => type === picked.type);
    if (!mimeType) {
      opts.refuse("type", t("assistant.context.imageType"));
      continue;
    }
    if (picked.size > MAX_IMAGE_SIZE_BYTES) {
      opts.refuse("size", imageTooBigLine(t, picked));
      continue;
    }
    const data = await readBase64(picked).catch(() => null);
    if (data === null) {
      opts.refuse("type", t("assistant.composer.imageReadFailed", { name: raw(picked.name) }));
      continue;
    }
    const filename = opts.nameOf?.(picked) ?? picked.name;
    const result = opts.add({ data, mimeType, filename, size: picked.size });
    if (!result.ok) {
      opts.refuse(
        result.cap,
        t("assistant.composer.imageCap", {
          name: raw(filename),
          count: MAX_IMAGES,
          size: raw(formatBytes(MAX_IMAGE_SIZE_BYTES)),
        }),
      );
      break;
    }
  }
}

/** An attached image as a tray chip; the chip's id is the image's. */
export function imageChipOf(image: ImageAttachment): ContextChip {
  return {
    id: image.id ?? image.filename,
    kind: "image",
    label: raw(image.filename),
    secondary: raw(formatBytes(image.size)),
    sizeBytes: image.size,
    provenance: "attach",
    sent: "serialized",
  };
}

function readBase64(picked: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(picked);
  });
}
