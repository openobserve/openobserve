#!/usr/bin/env python3
# Copyright 2026 OpenObserve Inc.
"""
Translation Generator for OpenObserve.

Generates translation files from en-US.json using DeepSeek (an LLM) via its
OpenAI-compatible API. Only newly added or modified English strings are
translated; already-translated, unchanged text is never re-sent (see
translator.py for the change-detection model).

Usage:
    python main.py                    # translate all supported languages
    python main.py fr-FR es-ES de-DE  # translate specific languages (filename stems)

Environment:
    DEEPSEEK_API_KEY   Required. API key for https://api.deepseek.com.
    DEEPSEEK_MODEL     Model id (default "deepseek-v4-flash").
    TRANSLATION_BATCH_SIZE  Strings per API call (default 50).
"""

import json
import sys

from translator import (
    build_locale,
    build_state,
    collect_pending_leaves,
    get_language_file_path,
    get_supported_languages,
    load_json,
    load_source,
    load_state,
    new_counters,
    save_state,
    translate_pending,
)


def main():
    supported = get_supported_languages()

    args = sys.argv[1:]
    # `--force` is accepted for backward compatibility but is now a no-op: there
    # is no safety cap to bypass.
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
        print("ERROR: en-US.json source is empty or missing.")
        sys.exit(1)

    state = load_state()
    full_run = set(locales) == set(supported)

    counters = new_counters()
    locale_targets = {}
    for locale in locales:
        existing = load_json(get_language_file_path(locale), {})
        pending = collect_pending_leaves(source, existing, state)
        print(f"\nTranslating: {locale} ({len(pending)} strings pending)")

        translated = translate_pending(pending, locale) if pending else {}

        target = build_locale(source, existing, state, translated, counters)
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
