/// <reference types="vite/client" />

// Build-time constants injected by Vite
declare const __COMMIT_HASH__: string;
declare const __BUILD_TIME__: number;

// Virtual modules provided by unplugin-icons — resolved at build time, never at runtime.
declare module "~icons/*" {
  import type { FunctionalComponent, SVGAttributes } from "vue";
  const component: FunctionalComponent<SVGAttributes>;
  export default component;
}
