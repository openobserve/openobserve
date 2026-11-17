import type { SyntheticsFolder } from "@/types/synthetics";

/** `urlFolder` is a raw route query value: a repeated `?folder=` arrives as an array. */
export function selectSyntheticsFolder(
  folders: readonly { folderId: string }[],
  urlFolder?: unknown,
): string | undefined {
  const preferred = (Array.isArray(urlFolder) ? urlFolder : [urlFolder]).find(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
  if (preferred) return preferred;
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
