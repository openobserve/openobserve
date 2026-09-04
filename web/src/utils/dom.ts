// Copyright 2026 OpenObserve Inc.

export function downloadFile(fileName: string, data: string, mimeType: string): boolean {
  try {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

export function toggleFullscreen(element?: HTMLElement): Promise<void> {
  const target = element || document.documentElement;
  if (document.fullscreenElement) {
    return document.exitFullscreen();
  }
  return target.requestFullscreen();
}
