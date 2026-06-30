#!/usr/bin/env python3
# Copyright 2026 OpenObserve Inc.
"""
Translation Generator for OpenObserve.

Generates translation files from en.json using AWS Translate. Only newly added
or modified English strings are translated; already-translated, unchanged text is
never re-sent to AWS (see translator.py for the change-detection model).

Usage:
    python main.py                 # translate all supported languages
    python main.py fr es de        # translate specific languages
    python main.py --force         # bypass the safety cap (large/intentional run)

Environment:
    TRANSLATION_MAX_KEYS   Max keys allowed per run before aborting (default 5000).
                           Guards against accidental mass re-translation.
"""

import json
import os
import sys

from translator import (
    build_locale,
    build_state,
    count_pending,
    get_language_file_path,
    get_supported_languages,
    load_json,
    load_source,
    load_state,
    new_counters,
    save_state,
)


def main():
    supported = get_supported_languages()

    args = sys.argv[1:]
    force = "--force" in args
    requested = [a for a in args if not a.startswith("--")]

    if requested:
        invalid = [lang for lang in requested if lang not in supported]
        if invalid:
            print(f"WARNING: Unsupported language codes: {', '.join(invalid)}")
            print(f"Supported languages: {', '.join(supported)}")
        locales = [lang for lang in requested if lang in supported]
    else:
        locales = supported

    if not locales:
        print("ERROR: No valid languages to translate.")
        sys.exit(1)

    source = load_source()
    if not source:
        print("ERROR: en.json source is empty or missing.")
        sys.exit(1)

    state = load_state()
    full_run = set(locales) == set(supported)

    # Safety cap: never silently translate a huge batch (e.g. an en.json refactor
    # that renames many keys). Abort and require --force for intentional large runs.
    max_keys = int(os.environ.get("TRANSLATION_MAX_KEYS", "5000"))
    pending = count_pending(source, state, locales)
    print(f"Pending translations across {len(locales)} language(s): {pending}")

    if pending == 0:
        print("Nothing to translate — all targets are up to date.")
        return

    if pending > max_keys and not force:
        print(
            f"ERROR: {pending} pending translations exceeds the safety cap "
            f"({max_keys}). Re-run with --force or raise TRANSLATION_MAX_KEYS "
            f"if this is intentional."
        )
        sys.exit(2)

    print(f"Starting translation for: {', '.join(locales)}")
    print("-" * 60)

    counters = new_counters()
    locale_targets = {}
    for locale in locales:
        print(f"\nTranslating: {locale}")
        existing = load_json(get_language_file_path(locale), {})
        target = build_locale(source, existing, state, locale, counters)
        with open(get_language_file_path(locale), "w", encoding="utf-8") as f:
            f.write(json.dumps(target, indent=2, ensure_ascii=False) + "\n")
        locale_targets[locale] = target

    # Advance shared state only on a full run, where every supported locale was
    # processed and "present in all locales" is meaningful. Subset runs translate
    # what they need but leave state untouched (safe: at worst a later full run
    # re-checks those keys).
    if full_run:
        state = build_state(source, locale_targets, counters["failed_paths"])
        save_state(state)
    else:
        print("\nℹ️  Subset run — state file not advanced (run all languages to persist state).")

    print("\n" + "-" * 60)
    print(
        f"Done. translated={counters['translated']}, kept={counters['kept']}, "
        f"failed={counters['failed']} across {len(locales)} language(s)."
    )

    if counters["failed"]:
        print(
            f"ERROR: {counters['failed']} translation(s) failed — they will retry "
            f"next run."
        )
        sys.exit(3)


if __name__ == "__main__":
    main()
