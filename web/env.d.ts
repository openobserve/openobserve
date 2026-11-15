/// <reference types="vite/client" />

// Build-time constants injected by Vite
declare const __COMMIT_HASH__: string;
declare const __BUILD_TIME__: number;

// en-US.json minus the lazily loaded blocks, and one such block (locale-blocks plugin in vite.config.ts).
declare module "*en-US.json?without=serviceVersions" {
  const messages: Omit<typeof import("./src/locales/languages/en-US.json"), "serviceVersions">;
  export default messages;
}
declare module "*en-US.json?block=serviceVersions" {
  const block: (typeof import("./src/locales/languages/en-US.json"))["serviceVersions"];
  export default block;
}

// Virtual modules provided by unplugin-icons — resolved at build time, never at runtime.
declare module "~icons/*" {
  import type { FunctionalComponent, SVGAttributes } from "vue";
  const component: FunctionalComponent<SVGAttributes>;
  export default component;
}
