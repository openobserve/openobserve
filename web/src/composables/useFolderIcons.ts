// Copyright 2026 OpenObserve Inc.
//
// The ONE place a folder's icon is read from.
//
// The icon is a column on the folders table, so it arrives with the folder and
// needs no separate fetch, cache or invalidation: every folder mutation in
// utils/commons calls refreshFolderLists(), which repopulates the store from the
// API, so a create or rename already brings the new icon back with it.
//
// Writes go out with the folder itself — the Add/Edit dialogs put `icon` in the
// create/update payload — so there is deliberately no setIcon here.

/** A folder as the rail, the dialogs and the dropdowns see it. */
export interface FolderWithIcon {
  folderId?: string;
  icon?: string | null;
}

export function useFolderIcons() {
  /**
   * The icon token to show for a folder, or null when it has none. Whitespace
   * and empty strings normalise to null so callers only ever branch on one
   * "no icon" value.
   */
  function iconFor(folder: FolderWithIcon | null | undefined): string | null {
    return folder?.icon?.trim() || null;
  }

  return { iconFor };
}
