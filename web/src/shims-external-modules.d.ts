// Ambient declarations for third-party modules that ship no type definitions,
// which under moduleResolution "bundler" otherwise raise TS7016 (implicit any
// from an untyped module). These are external boundaries — the app treats their
// surface loosely on purpose. Type-only; no runtime effect.
declare module "sortablejs";
declare module "reodotdev";
declare module "monaco-editor/esm/vs/editor/editor.all.js";
