// Ambient declarations for third-party modules that ship no type definitions,
// which under moduleResolution "bundler" otherwise raise TS7016 (implicit any
// from an untyped module). These are external boundaries — the app treats their
// surface loosely on purpose. Type-only; no runtime effect.
// NB: sortablejs is intentionally NOT shimmed — those files use it as a type
// (Sortable.SortableEvent), and an empty declaration removes those members. It
// stays untyped (its TS7016 is grandfathered in the baseline).
declare module "reodotdev";
declare module "monaco-editor/esm/vs/editor/editor.all.js";
