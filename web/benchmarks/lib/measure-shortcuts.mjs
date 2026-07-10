import path from "node:path";
import fs from "node:fs";
import { walkFiles } from "./util.mjs";

// Static source analysis of keyboard-accessibility surface area. This is a
// FEATURE-COVERAGE metric (0 → N), not a perf number: the Quasar baseline has
// essentially no shortcut system, the current code has a full registry.
export function measureShortcuts(webDir) {
  const srcDir = path.join(webDir, "src");
  const registryPath = path.join(srcDir, "lib", "vue-shortcut-manager", "shortcutRegistry.ts");
  const cheatsheetPath = path.join(srcDir, "lib", "vue-shortcut-manager", "ShortcutCheatsheet.vue");

  const registrySrc = fs.existsSync(registryPath) ? fs.readFileSync(registryPath, "utf8") : null;

  // Count registered shortcuts. Each entry carries a `descriptionKey:` — a
  // reliable per-shortcut marker that excludes the TS interface declaration
  // (which has `id:` but no descriptionKey). Fall back to `id:` if the schema
  // changes.
  let registeredShortcuts = 0;
  if (registrySrc) {
    const byDesc = (registrySrc.match(/descriptionKey\s*:/g) || []).length;
    registeredShortcuts = byDesc || (registrySrc.match(/\bid\s*:/g) || []).length;
  }

  // Count component files wiring keyboard handling across the codebase.
  const files = walkFiles(srcDir, [".vue", ".ts", ".tsx", ".js"]);
  let keydownFiles = 0;
  let ariaKeyshortcuts = 0;
  for (const f of files) {
    let txt;
    try {
      txt = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    if (/@keydown|onKeydown|addEventListener\(\s*["']keydown/.test(txt)) keydownFiles += 1;
    ariaKeyshortcuts += (txt.match(/aria-keyshortcuts/g) || []).length;
  }

  return {
    hasRegistry: !!registrySrc,
    hasCheatsheet: fs.existsSync(cheatsheetPath),
    registeredShortcuts,
    keydownFiles,
    ariaKeyshortcuts,
  };
}
