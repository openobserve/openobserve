# Copyright 2026 OpenObserve Inc.
"""
Incremental translation engine for OpenObserve (DeepSeek-backed).

Cost model: translation is done by an LLM (DeepSeek) via its OpenAI-compatible
API. To keep cost and latency minimal we only ever send a string for translation
when it is genuinely new or its English source has changed. This is tracked with
a committed state file (`.translation_state.json`) that mirrors en-US.json and
stores, for each key, a hash of the English source that has been successfully
propagated to every supported language.

Decision per key (per locale):
  * source unchanged AND already translated -> keep existing value (no API call)
  * English source changed since last run    -> re-translate (label edits covered)
  * key new / missing in target              -> translate
  * key removed from en-US.json               -> pruned from the target file

Pending leaves are translated in batches (many strings per API call) to keep the
request count and cost low, and several batches are in flight at once so a large
backlog finishes in minutes rather than hours. Each string travels with its i18n
key path, and the prompt carries the TERMS glossary (English senses plus optional
per-locale pinned renderings) and the locale's own module names (mined from its
committed `menu.*` translations), so short ambiguous labels resolve to the right
sense and reuse the established vocabulary instead of being translated blind.
Each item is validated
independently — a string whose translation drops/alters an interpolation
placeholder (e.g. `{count}`) is rejected and left un-advanced so it retries on the
next run, exactly like a hard API failure.

Environment:
    DEEPSEEK_API_KEY   Required. API key for https://api.deepseek.com.
    DEEPSEEK_MODEL     Model id (default "deepseek-v4-flash").
    DEEPSEEK_BASE_URL  API base URL (default "https://api.deepseek.com").
    TRANSLATION_BATCH_SIZE  Strings per API call (default 50).
    TRANSLATION_CONCURRENCY Batches in flight per locale (default 4; 1 = serial).
"""

import json
import os
import re
import hashlib
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

# `openai` is imported inside _get_client(), not here: the change-detection half of
# this module (collect_pending_leaves, load_state, …) is pure file comparison, and
# `main.py --check` runs it with no dependencies installed and no API key — which is
# what lets the merge-queue gate be free.

STATE_FILENAME = ".translation_state.json"

# Source locale: filename stem of the English source (web/.../languages/en-US.json).
SOURCE_LOCALE = "en-US"

# Human-readable target names used in the translation prompt, keyed by the target
# locale's filename stem (BCP-47 style, matching web/src/locales/languages/*.json).
LANGUAGE_NAMES = {
    "ar-SA": "Arabic",
    "tr-TR": "Turkish",
    "zh-CN": "Simplified Chinese",
    "fr-FR": "French",
    "es-ES": "Spanish",
    "de-DE": "German",
    "it-IT": "Italian",
    "pt-PT": "Portuguese",
    "ja-JP": "Japanese",
    "ko-KR": "Korean",
    "nl-NL": "Dutch",
    "zh-TW": "Traditional Chinese",
    "ru-RU": "Russian",
    "pl-PL": "Polish",
    "vi-VN": "Vietnamese",
}

# The term table injected into every prompt. Strings reach the model as isolated
# UI fragments, so without the `sense` lines an "event" is a party, a "stream" is
# a brook and "live" is a broadcast — exactly the mistranslations a zh-CN audit
# found. A sense steers every target language at once; an optional per-locale key
# pins one language's rendering, because the same audit found the same word coined
# differently across batches (stream = 流/数据流, trace = 追踪/跟踪). Keeping both
# in one table means a pinned rendering can never lose its sense definition.
TERMS = {
    "stream": {
        "sense": "a named dataset of ingested telemetry (logs, metrics, or traces) "
        "— the data-stream sense, never a brook/creek and never audio/video streaming",
        "zh-CN": "数据流",
        "zh-TW": "串流",
    },
    "alert": {
        "sense": "a monitoring alert: an alerting rule or the notification it "
        "sends — the alarm sense, not a browser dialog",
        "zh-CN": "告警",
        "zh-TW": "警示",
    },
    "filter": {
        "sense": "a condition that narrows query or list results",
        "zh-CN": "过滤器",
    },
    "event": {
        "sense": "a recorded occurrence in the system (log event, alert event) — "
        "the record/incident sense, never a social activity or gathering",
        "zh-CN": "事件",
        "zh-TW": "事件",
    },
    "live": {
        "sense": "updating in real time (live tail, live data) — the real-time "
        "sense, never a live broadcast or livestream",
        "zh-CN": "实时",
        "zh-TW": "即時",
    },
    "trace": {
        "sense": "a distributed trace: one request's recorded path through services",
        "zh-CN": "追踪",
        "zh-TW": "追蹤",
    },
    "span": {
        "sense": "a single operation inside a distributed trace — the APM term of "
        "art; keep 'Span' when the language has no established equivalent",
        "zh-CN": "Span",
        "zh-TW": "Span",
    },
    "function": {
        "sense": "a user-defined data-transformation function (VRL) — the "
        "programming sense",
    },
    "pipeline": {
        "sense": "a data-processing pipeline that routes and transforms ingested "
        "records",
        "zh-CN": "流水线",
        "zh-TW": "管線",
    },
    "destination": {
        "sense": "a configured endpoint that alerts or pipeline output are "
        "delivered to",
        "zh-CN": "目标",
        "zh-TW": "目標",
    },
    "organization": {
        "sense": "a tenant/workspace that groups users and data — the account sense",
    },
    "firing": {
        "sense": "the state of an alert that is currently triggered",
        "zh-CN": "触发中",
        "zh-TW": "觸發中",
    },
    "open": {
        "sense": "as an incident/issue status: still unresolved — not the verb "
        "'to open'",
    },
    "top": {
        "sense": "in rankings (Top N, Top Queries): highest-ranked; in layout "
        "and position labels it is the ordinary spatial top",
    },
    "value": {
        "sense": "the data value of a field or metric — never worth/merit",
        "zh-CN": "值",
        "zh-TW": "值",
    },
    "breakdown": {
        "sense": "splitting a chart or metric by a dimension — never a failure "
        "or collapse",
    },
    "report": {
        "sense": "a scheduled or exported dashboard report document",
        "zh-CN": "报表",
        "zh-TW": "報表",
    },
}

# Subtrees of en-US.json whose leaves are canonical module names; their committed
# translations are mined per locale into the prompt's fixed-renderings table.
MODULE_NAME_SUBTREES = ("menu",)

# printf / linked-message tokens that MUST survive translation unchanged.
# Brace tokens are handled by _scan_tokens, which a regex cannot do: `{'}'}` is a
# single literal-escape token whose body contains the very character a regex like
# `{[^{}]*}` stops at.
_PRINTF = re.compile(r"%[sd]")
# `@` always starts a linked message in vue-i18n — `@:key` or `@.modifier:key`.
# A bare `@` (even inside a word, e.g. an email address) is a compile error; the
# locale files spell it `{'@'}` for that reason.
_LINKED = re.compile(r"@(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?:[\w.]+")

# A vue-i18n named placeholder is a JS-style identifier; a list placeholder is an
# index. Anything else — most importantly a name the model helpfully translated,
# `{标识符}` for `{identifier}` — is INVALID_TOKEN_IN_PLACEHOLDER, and vue-i18n
# compiles messages just-in-time, so it *throws* at render time and blanks the
# page that used the string.
_NAMED = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*\Z")
_LIST = re.compile(r"\d+\Z")

_client = None
# Batches are translated concurrently (see translate_pending), so the lazy client
# construction below must be race-free.
_client_lock = threading.Lock()


class TranslationError(Exception):
    """Raised when the translation backend fails for a batch."""


def _script_dir():
    return os.path.dirname(os.path.abspath(__file__))


def get_language_file_path(locale):
    """Absolute path to a language file (e.g. fr-FR.json)."""
    languages_dir = os.path.join(
        _script_dir(), "..", "..", "web", "src", "locales", "languages"
    )
    return os.path.join(languages_dir, f"{locale}.json")


def get_state_file_path():
    """Absolute path to the translation state (source-hash) file."""
    return os.path.join(_script_dir(), STATE_FILENAME)


def get_supported_languages():
    """Returns the list of auto-translated language codes.

    Derived from LANGUAGE_NAMES so the code list and the prompt's language names
    are a single source of truth (dict preserves insertion order).
    """
    return list(LANGUAGE_NAMES.keys())


def _hash(text):
    """Short, stable hash of an English source string."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def load_json(path, default=None):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {} if default is None else default


def find_duplicate_keys(path):
    """Return the key names duplicated within a single object in `path`.

    json.load keeps the LAST of a duplicated pair, so a locale file carrying two
    "announcements" blocks parses, validates and compares as up-to-date while the
    earlier block is silently dead. Nothing this module writes can produce one —
    it dumps Python dicts — but git can: line-merging two locale files that each
    added the same block at a different offset keeps both and reports no conflict.
    Only a pairs hook sees them, which is why this is checked rather than assumed.
    """
    found = []

    def hook(pairs):
        seen = set()
        for key, _ in pairs:
            if key in seen:
                found.append(key)
            seen.add(key)
        return dict(pairs)

    with open(path, "r", encoding="utf-8") as f:
        json.load(f, object_pairs_hook=hook)
    return sorted(set(found))


def load_source():
    """Load the English source (en-US.json)."""
    return load_json(get_language_file_path(SOURCE_LOCALE), {})


def load_state():
    """Load the shared source-hash state tree."""
    return load_json(get_state_file_path(), {})


def write_json(path, data, sort_keys=False):
    """Write `data` as pretty JSON to `path` atomically.

    Written to a sibling temp file and renamed, so an interrupted run (the job is
    cancellable mid-write, and CI now commits whatever progress exists) can never
    leave a truncated / half-written locale file behind to be committed.
    """
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=sort_keys) + "\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def save_state(state):
    write_json(get_state_file_path(), state, sort_keys=True)


def new_counters():
    return {"pending": 0, "kept": 0, "translated": 0, "failed": 0, "failed_paths": set()}


def _scan_tokens(text):
    """
    Return (tokens, compilable) for one message.

    `tokens` is the multiset of interpolation tokens vue-i18n would see —
    placeholders (`{count}`, `{0}`), literal escapes (`{'{'}`, `{'@'}`), printf
    tokens and linked-message references — normalised so that incidental
    whitespace inside braces does not count as a difference.

    `compilable` is False when the message is something vue-i18n's compiler would
    reject outright: a placeholder whose name is not an identifier, an unclosed
    or unbalanced brace, or an unterminated literal escape. Those are what turn a
    translation into a thrown SyntaxError at render time instead of a wrong-looking
    label, so they must never be written to a locale file.
    """
    tokens = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]

        if ch == "%":
            m = _PRINTF.match(text, i)
            if m:
                tokens.append(m.group(0))
                i = m.end()
                continue

        if ch == "@":
            m = _LINKED.match(text, i)
            if not m:
                return tokens, False  # bare @ — must be written {'@'}
            tokens.append(m.group(0))
            i = m.end()
            continue

        if ch == "}":
            return tokens, False  # closing brace with nothing open

        if ch != "{":
            i += 1
            continue

        j = i + 1
        while j < n and text[j].isspace():
            j += 1

        if j < n and text[j] == "'":
            # Literal escape: {'{'}, {'}'}, {'@'}, {'|'}. The body is quoted, so
            # scan to the closing quote rather than to the next brace.
            end = text.find("'", j + 1)
            if end == -1:
                return tokens, False
            k = end + 1
            while k < n and text[k].isspace():
                k += 1
            if k >= n or text[k] != "}":
                return tokens, False
            tokens.append("{'" + text[j + 1 : end] + "'}")
            i = k + 1
            continue

        end = text.find("}", j)
        if end == -1:
            return tokens, False
        name = text[j:end].strip()
        if not (_NAMED.match(name) or _LIST.match(name)):
            return tokens, False
        tokens.append("{" + name + "}")
        i = end + 1

    return tokens, True


def _placeholders(text):
    """Multiset of interpolation tokens in a string (order-independent)."""
    return sorted(_scan_tokens(text)[0])


def _get_client():
    """Lazily construct the DeepSeek (OpenAI-compatible) client.

    Constructed on first use so that dry passes / imports don't require the API
    key — or the `openai` package — to be present (e.g. when only counting pending
    work). The client itself is thread-safe and shared by every worker; only its
    construction is locked.
    """
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                from openai import OpenAI

                api_key = os.environ.get("DEEPSEEK_API_KEY")
                if not api_key:
                    raise TranslationError(
                        "DEEPSEEK_API_KEY is not set — cannot reach the translation service."
                    )
                _client = OpenAI(
                    api_key=api_key,
                    base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
                    # Cap per-request time so a single hung/slow call can't stall the
                    # whole run for the SDK's 600s default. Our own retry/split loop
                    # then recovers.
                    timeout=float(os.environ.get("DEEPSEEK_TIMEOUT", "60")),
                    max_retries=2,
                )
    return _client


def _model():
    return os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash")


def build_module_glossary(source, existing):
    """(English, translated) pairs for the app's module names.

    The MODULE_NAME_SUBTREES trees are where every major module's user-facing
    name lives (Alerts, Pipelines, Dashboards, Streams, …). Pulling the pairs
    from the locale's own committed translations means new strings reuse the
    established vocabulary (zh-CN: Alerts -> 告警, Pipelines -> 流水线) instead of
    each batch coining its own, with no per-language table to maintain. A pair
    kept in English (RUM -> RUM) is included on purpose: it tells the model
    "leave this as is". Sorted so the prompt is byte-stable per locale, which
    keeps provider-side prompt caching effective across batches.
    """
    terms = {}
    for subtree in MODULE_NAME_SUBTREES:
        src = source.get(subtree) if isinstance(source.get(subtree), dict) else {}
        dst = existing.get(subtree) if isinstance(existing.get(subtree), dict) else {}
        for key, en in src.items():
            tr = dst.get(key)
            if not isinstance(en, str) or not isinstance(tr, str):
                continue
            # Token-bearing entries (aria templates) are messages, not names.
            if _placeholders(en) or not en.strip() or not tr.strip():
                continue
            terms.setdefault(en, tr)
    return sorted(terms.items())


def _system_prompt(locale, module_terms):
    lang = LANGUAGE_NAMES.get(locale, locale)
    pinned = {term: entry[locale] for term, entry in TERMS.items() if locale in entry}
    # One renderings table, curated pinned terms winning over mined module names
    # (case/plural-insensitively), so the prompt can never mandate two different
    # renderings for the same word.
    renderings = {
        en: tr
        for en, tr in module_terms
        if en.lower() not in pinned and en.lower().removesuffix("s") not in pinned
    }
    renderings.update(pinned)
    parts = [
        f"You are a professional software localization engine. Translate UI strings "
        f"for OpenObserve from English into {lang}.\n"
        "Context: OpenObserve is an observability platform. Users ingest logs, "
        "metrics, and traces into streams, search them, chart them on dashboards, "
        "alert on them, and transform them with functions and pipelines. Every "
        "string is UI text from this product (buttons, labels, menu items, table "
        "headers, messages), so always prefer a word's technical/monitoring sense "
        "over its everyday sense.\n"
        'Each input item has "key" and "text". The key is the i18n key path — '
        "context that tells you where in the UI the text appears (for key "
        "alerts.incidents.statusOpen, 'Open' is an incident status meaning "
        "unresolved, not the verb). Use it to resolve ambiguity; translate only "
        "the text, and never echo the key in the output.\n"
        "Glossary — the sense these terms always carry in OpenObserve:\n"
    ]
    parts.extend(f"- {term}: {entry['sense']}\n" for term, entry in TERMS.items())
    if renderings:
        parts.append(
            f"Fixed {lang} renderings — always render these terms and module "
            "names exactly as shown:\n"
        )
        parts.extend(
            f"- {en} -> {tr}\n"
            for en, tr in sorted(renderings.items(), key=lambda kv: kv[0].lower())
        )
    parts.append(
        "Rules:\n"
        '- Reply with ONLY a JSON object of the form {\"translations\": [...]} '
        "containing exactly one translated string per input item, in the same order.\n"
        "- Preserve every interpolation placeholder EXACTLY as written and untranslated: "
        "curly-brace tokens like {count}, {name}, {0}; printf tokens like %s, %d; and "
        "linked-message tokens like @:common.name. Never translate, reorder, or remove them.\n"
        "- Preserve the EXACT number of '|' pipe separators — they are vue-i18n plural "
        "forms. Translate each segment. If the target language has no plural distinction, "
        "repeat the same translated form for every segment, keeping the '|' separators "
        "(e.g. '{n} Day | {n} Days' -> '{n} 天 | {n} 天').\n"
        "- Copy vue-i18n literal escapes verbatim: {'@'}, {'{'}, {'}'}, {'|'} — keep the "
        "quotes and braces exactly, never translate or unescape them.\n"
        "- Keep any HTML tags, markdown, and URLs intact.\n"
        "- Do not translate the product name 'OpenObserve' or other proper nouns/brand names.\n"
        "- Preserve leading/trailing whitespace and terminal punctuation.\n"
        "- Produce natural, concise wording appropriate for buttons, labels, and short UI messages.\n"
        "- Do not add explanations, notes, or any text outside the JSON object."
    )
    return "".join(parts)


def translate_batch(items, locale, prompt, max_retries=3, _depth=0):
    """
    Translate a list of (key, text) pairs via DeepSeek, index-aligned to `items`.

    `key` is the string's dotted i18n path, sent purely as disambiguating
    context. `prompt` is the locale's system prompt, built once per locale by
    translate_pending.

    Returns a list the same length as `items`; each element is the translated
    string, or None if that specific item could not be translated. A None item is
    left un-advanced by the caller so it retries on the next run.

    Robustness:
      * Length/shape mismatches do NOT discard the whole batch. If the model
        returns the wrong number of items, the batch is split in half and each
        half retried, isolating the single bad string as None while its neighbours
        still translate.
      * Retries perturb the temperature. The first request runs at temperature 0
        for determinism; because a deterministic retry of a deterministic failure
        is pointless, subsequent attempts raise the temperature so the model can
        actually produce a different (valid) response.
    """
    if not items:
        return []

    payload = json.dumps(
        {"strings": [{"key": key, "text": text} for key, text in items]},
        ensure_ascii=False,
    )
    temperature = 0.0
    last_err = None
    for attempt in range(max_retries):
        try:
            resp = _get_client().chat.completions.create(
                model=_model(),
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": payload},
                ],
                stream=False,
                temperature=temperature,
                response_format={"type": "json_object"},
            )
            content = resp.choices[0].message.content
            data = json.loads(content) if content else {}
            out = data.get("translations") if isinstance(data, dict) else None
            if not isinstance(out, list) or len(out) != len(items):
                raise TranslationError(
                    f"expected {len(items)} translations, got "
                    f"{len(out) if isinstance(out, list) else type(out).__name__}"
                )
            # An empty/whitespace/non-string element is a failed item, not a valid
            # translation — never write a blank label. Treat it like a shape
            # mismatch so it flows through perturb-retry and, if it persists, the
            # split below isolates just that index as None (retried next run).
            cleaned = [x if isinstance(x, str) and x.strip() else None for x in out]
            if all(c is not None for c in cleaned):
                return cleaned
            raise TranslationError(
                f"{cleaned.count(None)} of {len(items)} translations were empty/invalid"
            )
        except (json.JSONDecodeError, TranslationError, KeyError, IndexError, TypeError) as e:
            # Malformed / wrong-length response — perturb temperature and retry.
            last_err = e
            temperature = 0.3 if temperature == 0.0 else min(temperature + 0.2, 1.0)
        except Exception as e:  # noqa: BLE001 — network / API / rate-limit errors
            last_err = e
            time.sleep(2 * (attempt + 1))

    # Retries exhausted. Split to isolate the offending element so its neighbours
    # aren't lost with it. Recursion bottoms out naturally at a single string
    # (which returns [None]); the depth guard is only a stack backstop and must be
    # large enough to reach singletons for any batch size (log2(4096) = 12).
    if len(items) > 1 and _depth < 32:
        mid = len(items) // 2
        left = translate_batch(items[:mid], locale, prompt, max_retries, _depth + 1)
        right = translate_batch(items[mid:], locale, prompt, max_retries, _depth + 1)
        return left + right

    print(f"  ! translation failed for [{locale}] ({len(items)} item(s)): {last_err}")
    return [None] * len(items)


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
    """Return (path_tuple, value) for every leaf needing translation.

    `value` is the raw source value — a string, or a list of strings for an array
    leaf — so translate_pending can translate array elements and preserve the type.
    """
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
            # Keep the raw value (str or list) so translate_pending can handle
            # array leaves element-wise and preserve their type.
            pending.append((cur_path, value))
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


def _validate(src, out):
    """
    Return `out` if it safely preserves `src`'s structure, else None.

    Rejects a translation that is empty/whitespace-only (which would blank the
    label), that vue-i18n could not compile at all, that changes the
    interpolation-token multiset ({count}, {'{'}, %s, @:key), or that changes the
    vue-i18n pluralization pipe count (`|`).

    The compilability check is the one that matters most: a translated placeholder
    name or a mangled literal escape makes vue-i18n throw while rendering, which
    blanks every component on the page rather than just spoiling one label.
    """
    if not isinstance(out, str) or not out.strip():
        return None
    out_tokens, compilable = _scan_tokens(out)
    if not compilable:
        return None
    if _placeholders(src) != sorted(out_tokens):
        return None
    if src.count("|") != out.count("|"):
        return None
    return out


def translate_pending(pending, locale, module_terms):
    """
    Translate all pending leaves for a locale in batches.

    `pending` is a list of (path_tuple, value) where value is a string or a list
    of strings; `module_terms` is the locale's module-name glossary from
    build_module_glossary. Returns {path_tuple: translated_value} for leaves that
    translated successfully AND passed `_validate` for every string. String
    leaves map to a string; array leaves map to a list (translated element-wise,
    type preserved). A leaf with any failed/invalid string is omitted entirely
    (left to retry).
    """
    batch_size = int(os.environ.get("TRANSLATION_BATCH_SIZE", "50"))
    prompt = _system_prompt(locale, module_terms)

    # Flatten every translatable string across all leaves into one work list so
    # array elements share batches with plain strings. `slots` holds the eventual
    # per-leaf output (translated strings, kept non-str/empty elements, or None).
    units = []  # [path, kind, slots]
    flat = []   # [(unit_idx, elem_idx, (dotted_key, source_string))]
    for path, value in pending:
        dotted = ".".join(path)
        if isinstance(value, list):
            slots = [None] * len(value)
            uidx = len(units)
            units.append([path, "list", slots])
            for i, el in enumerate(value):
                if isinstance(el, str) and el.strip():
                    flat.append((uidx, i, (f"{dotted}.{i}", el)))
                else:
                    slots[i] = el  # non-string / empty — keep as-is, never billed
        else:
            uidx = len(units)
            units.append([path, "str", [None]])
            flat.append((uidx, 0, (dotted, value)))

    total = len(flat)
    chunks = [flat[start : start + batch_size] for start in range(0, total, batch_size)]

    # Batches are independent, so translate several concurrently. Sequentially a
    # backlog run is ~880 API calls and takes hours — longer than the gap between
    # two en-US.json merges to main, so the run was always superseded before it
    # could open a PR. Concurrency is what lets a full run actually land.
    workers = max(1, int(os.environ.get("TRANSLATION_CONCURRENCY", "4")))
    batch_results = [None] * len(chunks)
    done = 0

    if workers == 1 or len(chunks) <= 1:
        for i, chunk in enumerate(chunks):
            batch_results[i] = translate_batch([item for _, _, item in chunk], locale, prompt)
            done += len(chunk)
            print(f"    {locale}: {done}/{total} strings translated", flush=True)
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(
                    translate_batch, [item for _, _, item in chunk], locale, prompt
                ): i
                for i, chunk in enumerate(chunks)
            }
            # Results are stored by index, so out-of-order completion cannot
            # misalign a translation with its source string.
            for fut in as_completed(futures):
                i = futures[fut]
                batch_results[i] = fut.result()
                done += len(chunks[i])
                print(f"    {locale}: {done}/{total} strings translated", flush=True)

    for chunk, results in zip(chunks, batch_results):
        for (uidx, eidx, (_key, src)), out in zip(chunk, results):
            units[uidx][2][eidx] = _validate(src, out)  # None on failure/mismatch

    translated = {}
    for path, kind, slots in units:
        if any(s is None for s in slots):
            # At least one string failed or changed structure — skip the whole
            # leaf so its state hash is not advanced and it retries next run.
            print(f"  ! skipping {'/'.join(path)} [{locale}] — unsafe/failed translation")
            continue
        translated[path] = slots[0] if kind == "str" else slots
    return translated
