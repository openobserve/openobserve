// Copyright 2026 OpenObserve Inc.

// Minimal ambient typing for the subset of the Chrome extension messaging API
// used by the synthetics recorder (`useSyntheticsRecorder`). We avoid pulling in
// the full `@types/chrome` dependency — only the externally_connectable surface
// is declared here. The `chrome` global only exists in Chrome when the page's
// origin is listed in the extension manifest's `externally_connectable.matches`,
// so all access must be runtime-guarded with `typeof chrome !== 'undefined'`.

interface ChromeEvent<TListener extends (...args: never[]) => void> {
  addListener(callback: TListener): void;
  removeListener(callback: TListener): void;
}

interface ChromePort {
  name: string;
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: ChromeEvent<(message: unknown) => void>;
  onDisconnect: ChromeEvent<(port: ChromePort) => void>;
}

interface ChromeRuntime {
  lastError?: { message?: string };
  sendMessage(
    extensionId: string,
    message: unknown,
    responseCallback?: (response: unknown) => void,
  ): void;
  connect(extensionId: string, connectInfo?: { name?: string }): ChromePort;
}

interface Chrome {
  runtime?: ChromeRuntime;
}

declare const chrome: Chrome | undefined;
