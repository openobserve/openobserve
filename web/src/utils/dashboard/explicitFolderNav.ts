// In-memory (not persisted) marker used to distinguish an explicit
// "go back to the dashboard list, scoped to this folder" navigation from a
// fresh landing on /dashboards whose URL only happens to carry ?folder=...
// because the folder watcher stamps it on every ordinary visit.
//
// A hard page reload clears this (it lives in JS memory only), so the
// favorites-first landing in Dashboards.vue still applies on reload — it only
// kicks in for in-app navigations that explicitly mark their target folder
// right before pushing the route.
let pendingFolder: string | null = null;

export const markExplicitDashboardFolderNav = (
  folderId: string | null | undefined,
): void => {
  pendingFolder = folderId ?? null;
};

export const consumeExplicitDashboardFolderNav = (): string | null => {
  const folderId = pendingFolder;
  pendingFolder = null;
  return folderId;
};
