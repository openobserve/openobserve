export function selectSyntheticsFolder(
  folders: readonly { folderId: string }[],
  urlFolder?: string,
): string | undefined {
  return (
    urlFolder ??
    folders.find((folder) => folder.folderId === "default")?.folderId ??
    folders[0]?.folderId
  );
}
