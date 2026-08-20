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
    python main.py --check            # report what is pending; translate nothing

Exit codes:
    0  nothing to do, or everything translated
    1  bad usage / missing source
    2  --check only: translations are pending
    3  at least one string failed validation (retried on the next run)

Environment:
    DEEPSEEK_API_KEY   Required. API key for https://api.deepseek.com.
    DEEPSEEK_MODEL     Model id (default "deepseek-v4-flash").
    TRANSLATION_BATCH_SIZE  Strings per API call (default 50).
    TRANSLATION_CONCURRENCY Batches in flight per locale (default 4; 1 = serial).
"""

import os
import sys

from translator import (
    SOURCE_LOCALE,
    build_locale,
    build_state,
    collect_pending_leaves,
    find_duplicate_keys,
    get_language_file_path,
    get_state_file_path,
    get_supported_languages,
    load_json,
    load_source,
    load_state,
    new_counters,
    save_state,
    translate_pending,
    write_json,
)


def run_check(locales):
    """Report every key still needing translation, without touching the API.

    Pure comparison of en-US.json against the locale files and
    .translation_state.json, so it costs nothing, needs no API key, and writes
    nothing. This is what the merge-queue gate runs to prove a merge is not about
    to land English-only strings on main.
    """
    source = load_source()
    if not source:
        print("ERROR: en-US.json source is empty or missing.")
        sys.exit(1)

    # Before comparing anything: a duplicated key makes every comparison below
    # read the last block and ignore the first, so a file looks up to date while
    # half of it is dead. Structural, so it fails like a bad source.
    duplicated = False
    for path in [get_language_file_path(SOURCE_LOCALE), get_state_file_path()] + [
        get_language_file_path(locale) for locale in locales
    ]:
        if not os.path.exists(path):
            continue
        dupes = find_duplicate_keys(path)
        if dupes:
            duplicated = True
            print(f"ERROR: duplicate keys in {path}: {', '.join(dupes)}")
    if duplicated:
        print("\nA duplicated key hides the earlier block from every reader. Merge them.")
        sys.exit(1)

    state = load_state()
    total = 0
    for locale in locales:
        existing = load_json(get_language_file_path(locale), {})
        pending = collect_pending_leaves(source, existing, state)
        if not pending:
            continue
        total += len(pending)
        shown = [".".join(path) for path, _ in pending[:5]]
        more = f" (+{len(pending) - len(shown)} more)" if len(pending) > len(shown) else ""
        print(f"  {locale}: {len(pending)} pending — {', '.join(shown)}{more}")

    if total:
        print(
            f"\n{total} translation(s) pending across {len(locales)} language(s)."
        )
        sys.exit(2)

    print(f"All {len(locales)} language(s) are up to date with en-US.json.")


def main():
    supported = get_supported_languages()

    args = sys.argv[1:]
    # `--force` is accepted for backward compatibility but is now a no-op: there
    # is no safety cap to bypass.
    check_only = "--check" in args
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

    if check_only:
        run_check(locales)
        return

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
        locale_targets[locale] = target
        # Only rewrite the file when it actually changed. `json.dumps(indent=2)`
        # does not match prettier's formatting (short arrays are written
        # multi-line), so an unconditional write would reformat an otherwise
        # unchanged locale file and break the `format:check` gate. Skipping the
        # write keeps the committed prettier formatting intact.
        if target != existing:
            # Flushed per locale (atomically), so a run that is cancelled or dies
            # part way through still leaves every completed locale on disk for CI
            # to commit.
            write_json(get_language_file_path(locale), target)

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
