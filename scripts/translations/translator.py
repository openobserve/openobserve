# Copyright 2026 OpenObserve Inc.
"""
Incremental translation engine for OpenObserve.

Cost model: AWS Translate bills per character. To keep cost minimal we only ever
send a string to AWS Translate when it is genuinely new or its English source has
changed. This is tracked with a committed state file (`.translation_state.json`)
that mirrors en.json and stores, for each key, a hash of the English source that
has been successfully propagated to every supported language.

Decision per key (per locale):
  * source unchanged AND already translated -> keep existing value (no API call)
  * English source changed since last run    -> re-translate (label edits covered)
  * key new / missing in target              -> translate
  * key removed from en.json                  -> pruned from the target file
"""

import json
import os
import hashlib

import boto3
from botocore.exceptions import NoCredentialsError, BotoCoreError, ClientError

translate = boto3.client("translate")

STATE_FILENAME = ".translation_state.json"


class TranslationError(Exception):
    """Raised when AWS Translate fails for a single string."""


def _script_dir():
    return os.path.dirname(os.path.abspath(__file__))


def get_language_file_path(locale):
    """Absolute path to a language file (e.g. fr.json)."""
    languages_dir = os.path.join(
        _script_dir(), "..", "..", "web", "src", "locales", "languages"
    )
    return os.path.join(languages_dir, f"{locale}.json")


def get_state_file_path():
    """Absolute path to the translation state (source-hash) file."""
    return os.path.join(_script_dir(), STATE_FILENAME)


def get_supported_languages():
    """Returns the list of auto-translated language codes."""
    return ["tr", "zh", "fr", "es", "de", "it", "pt", "ja", "ko", "nl"]


def _hash(text):
    """Short, stable hash of an English source string."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def load_json(path, default=None):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {} if default is None else default


def load_source():
    """Load the English source (en.json)."""
    return load_json(get_language_file_path("en"), {})


def load_state():
    """Load the shared source-hash state tree."""
    return load_json(get_state_file_path(), {})


def save_state(state):
    with open(get_state_file_path(), "w", encoding="utf-8") as f:
        f.write(json.dumps(state, indent=2, ensure_ascii=False, sort_keys=True) + "\n")


def new_counters():
    return {"pending": 0, "kept": 0, "translated": 0, "failed": 0, "failed_paths": set()}


def translate_text(text, locale):
    """
    Translate a single string via AWS Translate.

    Empty/whitespace-only strings are returned as-is (no API call, no cost).
    Raises TranslationError on any AWS failure so the caller can leave the key
    un-advanced and retry on the next run instead of billing for a bad result.
    """
    if not text or not text.strip():
        return text
    try:
        resp = translate.translate_text(
            Text=text,
            SourceLanguageCode="en",
            TargetLanguageCode=locale,
        )
        return resp["TranslatedText"]
    except (NoCredentialsError, BotoCoreError, ClientError) as e:
        raise TranslationError(f"AWS Translate failed for [{locale}]: {e}") from e


def _needs_translation(has_existing, prev_hash, cur_hash):
    """
    Whether a leaf must be sent to AWS Translate.

    Bootstrap rule: when there is no recorded state for a key (prev_hash is None)
    but a translation already exists, we trust the existing translation and only
    record its hash — this avoids a one-time full re-translation (and overwriting
    manual fixes) the first time the state file is introduced.
    """
    if not has_existing:
        return True
    if prev_hash is None:
        return False  # bootstrap: adopt existing translation as up to date
    return prev_hash != cur_hash  # re-translate only when the English source changed


def _src_text(value):
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def build_locale(source, existing, state, locale, counters, dry=False, path=()):
    """
    Build the target subtree for one locale, translating only new/modified keys.

    `state` is the shared source-hash tree (prev hashes). Keys absent from
    `source` are pruned. On API failure the path is recorded in
    `counters['failed_paths']` so the shared state is not advanced for it.
    """
    target = {}
    for key, value in source.items():
        cur_path = path + (key,)
        if isinstance(value, dict):
            child_existing = existing.get(key) if isinstance(existing.get(key), dict) else {}
            child_state = state.get(key) if isinstance(state.get(key), dict) else {}
            target[key] = build_locale(
                value, child_existing, child_state, locale, counters, dry, cur_path
            )
            continue

        text = _src_text(value)
        cur_hash = _hash(text)
        prev_hash = state.get(key) if isinstance(state.get(key), str) else None
        has_existing = key in existing and not isinstance(existing.get(key), dict)

        if not text.strip():
            target[key] = value  # empty source, never billed
            counters["kept"] += 1
            continue

        if not _needs_translation(has_existing, prev_hash, cur_hash):
            target[key] = existing[key]
            counters["kept"] += 1
            continue

        counters["pending"] += 1
        if dry:
            target[key] = existing[key] if has_existing else value
            continue

        try:
            target[key] = translate_text(text, locale)
            counters["translated"] += 1
        except TranslationError as e:
            print(f"  ! {e}")
            counters["failed"] += 1
            counters["failed_paths"].add(cur_path)
            # Keep a stale translation if we have one; otherwise leave English as a
            # visible placeholder. State is NOT advanced -> retried next run.
            target[key] = existing[key] if has_existing else value

    return target


def _leaf_present(tree, path):
    node = tree
    for part in path:
        if not isinstance(node, dict) or part not in node:
            return False
        node = node[part]
    return not isinstance(node, dict)


def build_state(source, locale_targets, failed_paths, path=()):
    """
    Rebuild the shared state tree after a full run.

    A key's hash is recorded only when its translation is present in *every*
    supported locale and it did not fail this run — guaranteeing the next run
    treats it as done across all languages.
    """
    state = {}
    for key, value in source.items():
        cur_path = path + (key,)
        if isinstance(value, dict):
            sub = build_state(value, locale_targets, failed_paths, cur_path)
            if sub:
                state[key] = sub
            continue

        text = _src_text(value)
        if not text.strip():
            state[key] = _hash(text)
            continue
        if cur_path in failed_paths:
            continue  # leave unset -> retry next run
        if all(_leaf_present(t, cur_path) for t in locale_targets.values()):
            state[key] = _hash(text)
    return state


def count_pending(source, state, locales):
    """Dry pass: how many leaves would be sent to AWS Translate across `locales`."""
    counters = new_counters()
    for locale in locales:
        existing = load_json(get_language_file_path(locale), {})
        build_locale(source, existing, state, locale, counters, dry=True)
    return counters["pending"]
