# Copyright 2026 OpenObserve Inc.
"""
Incremental translation engine for OpenObserve (DeepSeek-backed).

Cost model: translation is done by an LLM (DeepSeek) via its OpenAI-compatible
API. To keep cost and latency minimal we only ever send a string for translation
when it is genuinely new or its English source has changed. This is tracked with
a committed state file (`.translation_state.json`) that mirrors en.json and stores,
for each key, a hash of the English source that has been successfully propagated
to every supported language.

Decision per key (per locale):
  * source unchanged AND already translated -> keep existing value (no API call)
  * English source changed since last run    -> re-translate (label edits covered)
  * key new / missing in target              -> translate
  * key removed from en.json                  -> pruned from the target file

Pending leaves are translated in batches (many strings per API call) to keep the
request count and cost low. Each item is validated independently — a string whose
translation drops/alters an interpolation placeholder (e.g. `{count}`) is rejected
and left un-advanced so it retries on the next run, exactly like a hard API failure.

Environment:
    DEEPSEEK_API_KEY   Required. API key for https://api.deepseek.com.
    DEEPSEEK_MODEL     Model id (default "deepseek-v4-flash").
    DEEPSEEK_BASE_URL  API base URL (default "https://api.deepseek.com").
    TRANSLATION_BATCH_SIZE  Strings per API call (default 50).
"""

import json
import os
import re
import hashlib
import time

from openai import OpenAI

STATE_FILENAME = ".translation_state.json"

# Human-readable target names used in the translation prompt.
LANGUAGE_NAMES = {
    "tr": "Turkish",
    "zh": "Simplified Chinese",
    "fr": "French",
    "es": "Spanish",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
    "ja": "Japanese",
    "ko": "Korean",
    "nl": "Dutch",
}

# vue-i18n / printf style interpolation tokens that MUST survive translation
# unchanged: {count}, {name}, {0}, %s, %d, @:linked.key
_PLACEHOLDER = re.compile(r"{[^{}]*}|%[sd]|@:[\w.]+")

_client = None


class TranslationError(Exception):
    """Raised when the translation backend fails for a batch."""


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


def _placeholders(text):
    """Multiset of interpolation tokens in a string (order-independent)."""
    return sorted(_PLACEHOLDER.findall(text))


def _get_client():
    """Lazily construct the DeepSeek (OpenAI-compatible) client.

    Constructed on first use so that dry passes / imports don't require the API
    key to be present (e.g. when only counting pending work).
    """
    global _client
    if _client is None:
        api_key = os.environ.get("DEEPSEEK_API_KEY")
        if not api_key:
            raise TranslationError(
                "DEEPSEEK_API_KEY is not set — cannot reach the translation service."
            )
        _client = OpenAI(
            api_key=api_key,
            base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
        )
    return _client


def _model():
    return os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash")


def _system_prompt(locale):
    lang = LANGUAGE_NAMES.get(locale, locale)
    return (
        f"You are a professional software localization engine. Translate UI strings "
        f"for OpenObserve, an observability platform, from English into {lang}.\n"
        "Rules:\n"
        '- Reply with ONLY a JSON object of the form {\"translations\": [...]} '
        "containing exactly one translated string per input string, in the same order.\n"
        "- Preserve every interpolation placeholder EXACTLY as written and untranslated: "
        "curly-brace tokens like {count}, {name}, {0}; printf tokens like %s, %d; and "
        "linked-message tokens like @:common.name. Never translate, reorder, or remove them.\n"
        "- Keep any HTML tags, markdown, and URLs intact.\n"
        "- Do not translate the product name 'OpenObserve' or other proper nouns/brand names.\n"
        "- Preserve leading/trailing whitespace and terminal punctuation.\n"
        "- Produce natural, concise wording appropriate for buttons, labels, and short UI messages.\n"
        "- Do not add explanations, notes, or any text outside the JSON object."
    )


def translate_batch(texts, locale, max_retries=3):
    """
    Translate a list of strings via DeepSeek in a single API call.

    Returns a list aligned to `texts`; each element is the translated string, or
    None if that item could not be translated (backend failure or the response
    was missing/malformed for that index). A None item is left un-advanced by the
    caller so it retries on the next run.
    """
    if not texts:
        return []

    payload = json.dumps({"strings": texts}, ensure_ascii=False)
    last_err = None
    for attempt in range(max_retries):
        try:
            resp = _get_client().chat.completions.create(
                model=_model(),
                messages=[
                    {"role": "system", "content": _system_prompt(locale)},
                    {"role": "user", "content": payload},
                ],
                stream=False,
                temperature=0,
                response_format={"type": "json_object"},
            )
            content = resp.choices[0].message.content
            data = json.loads(content)
            out = data.get("translations")
            if not isinstance(out, list) or len(out) != len(texts):
                raise TranslationError(
                    f"expected {len(texts)} translations, got "
                    f"{len(out) if isinstance(out, list) else type(out).__name__}"
                )
            return [x if isinstance(x, str) else None for x in out]
        except (json.JSONDecodeError, TranslationError, KeyError, IndexError) as e:
            # Malformed response — retry without backoff; the model may comply next time.
            last_err = e
        except Exception as e:  # noqa: BLE001 — network / API / rate-limit errors
            last_err = e
            time.sleep(2 * (attempt + 1))

    print(f"  ! batch translation failed for [{locale}]: {last_err}")
    return [None] * len(texts)


def _src_text(value):
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def _needs_translation(has_existing, prev_hash, cur_hash):
    """
    Whether a leaf must be (re)translated.

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


def collect_pending_leaves(source, existing, state, path=()):
    """Return a list of (path_tuple, source_text) for every leaf needing translation."""
    pending = []
    for key, value in source.items():
        cur_path = path + (key,)
        if isinstance(value, dict):
            child_existing = existing.get(key) if isinstance(existing.get(key), dict) else {}
            child_state = state.get(key) if isinstance(state.get(key), dict) else {}
            pending.extend(
                collect_pending_leaves(value, child_existing, child_state, cur_path)
            )
            continue

        text = _src_text(value)
        if not text.strip():
            continue  # empty source, never translated

        cur_hash = _hash(text)
        prev_hash = state.get(key) if isinstance(state.get(key), str) else None
        has_existing = key in existing and not isinstance(existing.get(key), dict)

        if _needs_translation(has_existing, prev_hash, cur_hash):
            pending.append((cur_path, text))
    return pending


def build_locale(source, existing, state, translated, counters, path=()):
    """
    Build the target subtree for one locale from precomputed translations.

    `translated` maps a leaf's path-tuple to its translated string (only pending
    leaves that succeeded are present). Keys absent from `source` are pruned. A
    pending leaf with no successful translation is counted as failed and its path
    recorded in `counters['failed_paths']` so shared state is not advanced for it.
    """
    target = {}
    for key, value in source.items():
        cur_path = path + (key,)
        if isinstance(value, dict):
            child_existing = existing.get(key) if isinstance(existing.get(key), dict) else {}
            child_state = state.get(key) if isinstance(state.get(key), dict) else {}
            target[key] = build_locale(
                value, child_existing, child_state, translated, counters, cur_path
            )
            continue

        text = _src_text(value)
        cur_hash = _hash(text)
        prev_hash = state.get(key) if isinstance(state.get(key), str) else None
        has_existing = key in existing and not isinstance(existing.get(key), dict)

        if not text.strip():
            target[key] = value  # empty source, never translated
            counters["kept"] += 1
            continue

        if not _needs_translation(has_existing, prev_hash, cur_hash):
            target[key] = existing[key]
            counters["kept"] += 1
            continue

        counters["pending"] += 1
        if cur_path in translated:
            target[key] = translated[cur_path]
            counters["translated"] += 1
        else:
            # No successful translation this run — keep a stale value if we have
            # one, otherwise leave English as a visible placeholder. State is NOT
            # advanced -> retried next run.
            counters["failed"] += 1
            counters["failed_paths"].add(cur_path)
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


def translate_pending(pending, locale, counters):
    """
    Translate all pending leaves for a locale in batches.

    Returns a dict {path_tuple: translated_text} for leaves that translated
    successfully AND preserved every interpolation placeholder. Items that fail
    validation or the backend are omitted (left to retry next run).
    """
    batch_size = int(os.environ.get("TRANSLATION_BATCH_SIZE", "50"))
    translated = {}
    total = len(pending)
    done = 0
    for start in range(0, total, batch_size):
        chunk = pending[start : start + batch_size]
        results = translate_batch([text for _, text in chunk], locale)
        for (cur_path, src_text), out in zip(chunk, results):
            if out is None:
                continue
            if _placeholders(src_text) != _placeholders(out):
                # Placeholder set changed — unsafe, reject and retry next run.
                print(
                    f"  ! placeholder mismatch, skipping {'/'.join(cur_path)} "
                    f"[{locale}]"
                )
                continue
            translated[cur_path] = out
        done += len(chunk)
        print(f"    {locale}: {done}/{total} translated")
    return translated
