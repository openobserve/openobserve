import type { SyntheticsFolder } from "@/types/synthetics";

export function selectSyntheticsFolder(
  folders: readonly { folderId: string }[],
  urlFolder?: string,
): string | undefined {
  if (urlFolder?.trim()) return urlFolder;
  return folders.find((folder) => folder.folderId === "default")?.folderId ?? folders[0]?.folderId;
}

/** The listed folders plus a saved check's own folder, which a direct grant can reach unlisted. */
export function withCheckFolder(
  folders: readonly SyntheticsFolder[],
  folderId: string | undefined,
  label: string,
): SyntheticsFolder[] {
  if (!folderId || folders.some((folder) => folder.folderId === folderId)) return [...folders];
  return [...folders, { folderId, name: label }];
}
