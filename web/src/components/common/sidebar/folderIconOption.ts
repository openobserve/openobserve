// Copyright 2026 OpenObserve Inc.
//
// Bridges FolderIcon into OSelect's per-option `iconComponent` slot, so the
// folder dropdowns show the same icon the folder rail does.
//
// OSelect renders whatever component an option carries on `iconComponent`, but
// it passes no props — so each distinct icon needs its own tiny bound wrapper.
// They are memoised by token: a rail with 40 folders sharing 5 icons builds 5
// components, not 40.

import { defineComponent, h, markRaw, type Component } from "vue";
import FolderIcon from "./FolderIcon.vue";
import type { IconToken } from "@/lib/forms/EmojiPicker/OGlyph.types";

const cache = new Map<string, Component>();

/**
 * A component rendering this folder's icon, for `option.iconComponent`.
 * Falls back to the folder glyph when the folder has no icon, so every row in
 * a dropdown keeps the same left inset.
 */
export function folderIconOption(token: IconToken | null | undefined): Component {
  const key = token ?? "";
  const cached = cache.get(key);
  if (cached) return cached;

  const component = markRaw(
    defineComponent({
      name: "FolderIconOption",
      render: () => h(FolderIcon, { token: key || null }),
    }),
  );
  cache.set(key, component);
  return component;
}

/** Test-only: drop the memoised wrappers. */
export function __resetFolderIconOptionCache(): void {
  cache.clear();
}
