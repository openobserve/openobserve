# Copyright 2026 OpenObserve Inc.
import datetime
import hashlib
import http.server
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import o2_llm_trace as t  # noqa: E402

DEEPSEEK_RESPONSE = {
    "id": "chatcmpl-123",
    "model": "deepseek-flash",
    "choices": [{"index": 0, "finish_reason": "stop", "message": {"content": '{"translations": ["Bonjour"]}'}}],
    "usage": {
        "prompt_tokens": 1000,
        "completion_tokens": 300,
        "total_tokens": 1300,
        "prompt_cache_hit_tokens": 800,
        "prompt_cache_miss_tokens": 200,
        "completion_tokens_details": {"reasoning_tokens": 120},
    },
}
RESOURCE_KEYS = {
    "service.name",
    "service.version",
    "telemetry.sdk.language",
    "telemetry.sdk.name",
    "ci.provider.name",
    "github.repository",
    "github.workflow",
    "github.run_id",
    "github.run_number",
    "github.run_attempt",
    "github.job",
    "github.actor",
    "github.event_name",
    "github.ref",
    "github.sha",
    "github.workflow.run_url",
    "workflow.trace_id",
}
TRACE_ID = "0123456789abcdef0123456789abcdef"


def utc(*args):
    return datetime.datetime(*args, tzinfo=datetime.timezone.utc).timestamp()


def attr_map(attributes):
    out = {}
    for item in attributes:
        value = item["value"]
        if "arrayValue" in value:
            out[item["key"]] = [next(iter(v.values())) for v in value["arrayValue"]["values"]]
        else:
            out[item["key"]] = next(iter(value.values()))
    return out


def github_env(**extra):
    env = {
        "O2_TRACE_INGEST_URL": "https://o2.example",
        "O2_TRACE_AUTH": "abc",
        "O2_TRACE_ID": TRACE_ID,
        "GITHUB_REPOSITORY": "openobserve/openobserve",
        "GITHUB_WORKFLOW": "Update Translations",
        "GITHUB_RUN_ID": "42",
        "GITHUB_RUN_NUMBER": "7",
        "GITHUB_RUN_ATTEMPT": "1",
        "GITHUB_JOB": "update-translations",
        "GITHUB_ACTOR": "octocat",
        "GITHUB_EVENT_NAME": "pull_request",
        "GITHUB_REF": "refs/pull/77/merge",
        "GITHUB_SHA": "deadbeef",
        "DEEPSEEK_API_KEY": "sk-not-a-real-key-0123456789",
    }
    env.update(extra)
    return env


class FakeCompletions:
    def __init__(self, results):
        self.results = list(results)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


class FakeClient:
    def __init__(self, *results):
        self.chat = mock.Mock(completions=FakeCompletions(results))


class Recorder:
    """Captures POSTed OTLP payloads in place of urlopen."""

    def __init__(self):
        self.requests = []

    def __call__(self, request, timeout):
        self.requests.append(request)
        return mock.MagicMock()

    def spans(self):
        out = []
        for request in self.requests:
            body = json.loads(request.data)
            for rs in body["resourceSpans"]:
                for ss in rs["scopeSpans"]:
                    out.extend(ss["spans"])
        return out

    def resource(self):
        return attr_map(json.loads(self.requests[0].data)["resourceSpans"][0]["resource"]["attributes"])


def make_tracer(env=None, **kwargs):
    with mock.patch("atexit.register"), mock.patch("builtins.print"):
        return t.Tracer("github-actions.test", "github.workflow.test", env=github_env() if env is None else env, **kwargs)


def shutdown(tracer, recorder):
    with mock.patch("urllib.request.urlopen", side_effect=recorder), mock.patch("builtins.print"):
        tracer.shutdown()


class EndpointTest(unittest.TestCase):
    def test_full_traces_url_is_kept(self):
        env = {"O2_TRACE_INGEST_URL": "https://o2.example/api/acme/v1/traces/"}
        self.assertEqual(t.trace_endpoint(env), "https://o2.example/api/acme/v1/traces")

    def test_org_url_gets_traces_suffix(self):
        env = {"O2_TRACE_INGEST_URL": "https://o2.example/api/acme"}
        self.assertEqual(t.trace_endpoint(env), "https://o2.example/api/acme/v1/traces")

    def test_base_url_uses_org_or_default(self):
        self.assertEqual(
            t.trace_endpoint({"O2_TRACE_INGEST_URL": "https://o2.example", "O2_TRACE_ORG": "acme"}),
            "https://o2.example/api/acme/v1/traces",
        )
        self.assertEqual(t.trace_endpoint({"O2_TRACE_INGEST_URL": "https://o2.example/"}), "https://o2.example/api/default/v1/traces")
        self.assertEqual(t.trace_endpoint({}), "")

    def test_auth_header_variants(self):
        self.assertEqual(t.auth_header({"O2_TRACE_AUTH": "abc="}), "Basic abc=")
        self.assertEqual(t.auth_header({"O2_TRACE_AUTH": "Basic abc="}), "Basic abc=")
        self.assertEqual(t.auth_header({"O2_TRACE_USERNAME": "u", "O2_TRACE_PASSWORD": "p"}), "Basic dTpw")
        self.assertEqual(t.auth_header({"O2_TRACE_USERNAME": "u"}), "")

    def test_stream_timeout_and_batch_defaults(self):
        self.assertEqual(t.stream_name({}), "github_actions_ai_traces")
        self.assertEqual(t.export_timeout_s({}), 10.0)
        self.assertEqual(t.export_timeout_s({"O2_TRACE_EXPORT_TIMEOUT_MS": "2500"}), 2.5)
        self.assertEqual(t.export_timeout_s({"O2_TRACE_EXPORT_TIMEOUT_MS": "junk"}), 10.0)
        self.assertEqual(t.export_batch_size({}), 1)
        self.assertEqual(t.export_batch_size({"O2_TRACE_EXPORT_BATCH_SIZE": "20"}), 20)
        self.assertEqual(t.export_batch_size({"O2_TRACE_EXPORT_BATCH_SIZE": "0"}), 1)

    def test_trace_id_validation_matches_workflow_trace_id(self):
        self.assertEqual(t.trace_id_from_env({"O2_TRACE_ID": TRACE_ID.upper()}), TRACE_ID)
        self.assertNotEqual(t.trace_id_from_env({"O2_TRACE_ID": "0" * 32}), "0" * 32)
        self.assertNotEqual(t.trace_id_from_env({"O2_TRACE_ID": "xyz"}), "xyz")
        self.assertEqual(len(t.trace_id_from_env({})), 32)

    def test_pr_number_sources(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump({"issue": {"number": 88, "pull_request": {}}}, fh)
        try:
            self.assertEqual(t.pr_number({"GITHUB_EVENT_PATH": fh.name}), 88)
        finally:
            os.unlink(fh.name)
        self.assertEqual(t.pr_number({"PR_NUMBER": "12"}), 12)
        self.assertEqual(t.pr_number({"GITHUB_REF": "refs/pull/77/merge"}), 77)
        self.assertIsNone(t.pr_number({}))


class PricingTest(unittest.TestCase):
    def test_peak_windows(self):
        self.assertTrue(t.is_peak(utc(2026, 10, 28, 1, 0)))
        self.assertTrue(t.is_peak(utc(2026, 10, 28, 9, 59)))
        self.assertFalse(t.is_peak(utc(2026, 10, 28, 4, 0)))
        self.assertFalse(t.is_peak(utc(2026, 10, 28, 10, 0)))
        self.assertFalse(t.is_peak(utc(2026, 10, 31, 7, 0)))

    def test_flash_peak_and_off_peak(self):
        usage = t.usage_from_response(DEEPSEEK_RESPONSE)
        peak = (800 * 0.006 + 200 * 0.30 + 300 * 1.20) / 1e6
        self.assertAlmostEqual(t.estimate_cost("deepseek-v4-flash", usage, utc(2026, 10, 28, 7)), peak)
        self.assertAlmostEqual(t.estimate_cost("deepseek-flash", usage, utc(2026, 10, 28, 12)), peak / 2)

    def test_pro_price_and_unknown_model(self):
        usage = {"input": 1_000_000, "cache_read": 0, "output": 1_000_000}
        self.assertAlmostEqual(t.estimate_cost("deepseek-v4-pro", usage, utc(2026, 10, 28, 7)), 5.28)
        self.assertIsNone(t.estimate_cost("gpt-x", usage, utc(2026, 10, 28, 7)))
        self.assertIsNone(t.estimate_cost("deepseek-flash", {"input": None, "output": None}, 0))


class UsageTest(unittest.TestCase):
    def test_deepseek_usage_uses_dotted_cache_names(self):
        attrs = t.usage_attributes(t.usage_from_response(DEEPSEEK_RESPONSE))
        self.assertEqual(attrs["gen_ai.usage.input_tokens"], 1000)
        self.assertEqual(attrs["gen_ai.usage.cache_read.input_tokens"], 800)
        self.assertEqual(attrs["gen_ai.usage.output_tokens"], 300)
        self.assertEqual(attrs["gen_ai.usage.total_tokens"], 1300)
        self.assertEqual(attrs["ai.llm.usage.reasoning_tokens"], 120)
        self.assertNotIn("gen_ai.usage.cache_read_input_tokens", attrs)

    def test_openai_cached_tokens_fallback(self):
        usage = t.usage_from_response({"usage": {"prompt_tokens": 10, "prompt_tokens_details": {"cached_tokens": 4}}})
        self.assertEqual(usage["cache_read"], 4)
        self.assertIsNone(usage["output"])


class ContentTest(unittest.TestCase):
    def test_request_attributes_shape_truncation_and_sha(self):
        system = "s" * (t.MAX_SYSTEM_CHARS + 10)
        user = "u" * (t.MAX_USER_CHARS + 10)
        attrs = t.request_attributes([{"role": "system", "content": system}, {"role": "user", "content": user}], "ai.llm", [])
        self.assertEqual(json.loads(attrs["gen_ai.system_instructions"]), [{"type": "text", "content": system[: t.MAX_SYSTEM_CHARS]}])
        self.assertEqual(
            json.loads(attrs["gen_ai.input.messages"]),
            [{"role": "user", "parts": [{"type": "text", "content": user[: t.MAX_USER_CHARS]}]}],
        )
        self.assertEqual(attrs["ai.llm.system_instructions.chars"], 100_000)
        self.assertEqual(attrs["ai.llm.input.chars"], 150_000)
        self.assertEqual(attrs["ai.llm.system_instructions.sha256"], hashlib.sha256(system[:100_000].encode()).hexdigest())
        self.assertEqual(attrs["ai.llm.input.sha256"], hashlib.sha256(user[:150_000].encode()).hexdigest())

    def test_images_are_never_recorded(self):
        attrs = t.request_attributes(
            [{"role": "user", "content": [{"type": "text", "text": "look"}, {"type": "image_url", "image_url": {"url": "data:..."}}]}],
            "ai.llm",
            [],
        )
        self.assertEqual(json.loads(attrs["gen_ai.input.messages"])[0]["parts"], [{"type": "text", "content": "look"}, {"type": "image_url"}])

    def test_secrets_are_scrubbed(self):
        env = {"DEEPSEEK_API_KEY": "supersecretvalue", "PATH": "/usr/bin"}
        text = "key=supersecretvalue token ghp_" + "a" * 30 + "\nAuthorization: Basic xyz"
        out = t.scrub(text, t.secret_values(env))
        self.assertNotIn("supersecretvalue", out)
        self.assertNotIn("ghp_", out)
        self.assertNotIn("xyz", out)


class TracerTest(unittest.TestCase):
    def test_no_op_without_secrets(self):
        tracer = make_tracer(env={})
        self.assertFalse(tracer.enabled)
        client = FakeClient(DEEPSEEK_RESPONSE)
        with mock.patch("urllib.request.urlopen") as urlopen:
            self.assertIs(tracer.chat(client, model="deepseek-flash", messages=[]), DEEPSEEK_RESPONSE)
            tracer.shutdown()
        urlopen.assert_not_called()
        self.assertIsNone(tracer.start_span("x"))

    def test_spans_resource_root_and_chat_attributes(self):
        tracer = make_tracer(root_attributes={"ai.purpose": "test"})
        locale = tracer.start_span("translations.locale", {"ai.translations.locale": "fr-FR"})
        client = FakeClient(RuntimeError("rate limited"), DEEPSEEK_RESPONSE)
        messages = [{"role": "system", "content": "be terse"}, {"role": "user", "content": "hi"}]
        with tracer.llm_call("deepseek-flash", messages, parent=locale, agent_name="translator", agent_key="fr-FR") as call:
            with self.assertRaises(RuntimeError):
                call.create(client, model="deepseek-flash", messages=messages, temperature=0.0, max_tokens=512)
            call.create(client, model="deepseek-flash", messages=messages, temperature=0.3, max_tokens=512)
        tracer.end_span(locale)
        tracer.set_outcome("success", attributes={"process.exit_code": 0})
        recorder = Recorder()
        shutdown(tracer, recorder)

        self.assertEqual(set(recorder.resource()), RESOURCE_KEYS)
        self.assertEqual(recorder.resource()["service.version"], "1.0.0")
        self.assertEqual(recorder.resource()["workflow.trace_id"], TRACE_ID)
        self.assertEqual(recorder.requests[0].get_header("Stream-name"), "github_actions_ai_traces")
        spans = {s["name"]: s for s in recorder.spans()}
        root, loc, chat = spans["github.workflow.test"], spans["translations.locale"], spans["gen_ai.chat"]
        self.assertTrue(all(s["traceId"] == TRACE_ID for s in spans.values()))
        self.assertNotIn("parentSpanId", root)
        self.assertEqual(loc["parentSpanId"], root["spanId"])
        self.assertEqual(chat["parentSpanId"], loc["spanId"])
        self.assertEqual(chat["kind"], t.SPAN_KIND_CLIENT)
        root_attrs = attr_map(root["attributes"])
        self.assertEqual(root_attrs["workflow.trace_id"], TRACE_ID)
        self.assertEqual(root_attrs["github.pr.number"], "77")
        self.assertEqual(root_attrs["workflow.outcome"], "success")
        self.assertEqual(root_attrs["ai.purpose"], "test")

        a = attr_map(chat["attributes"])
        self.assertEqual(chat["status"]["code"], t.STATUS_OK)
        self.assertEqual(a["ai.llm.attempts"], "2")
        for key, value in {
            "gen_ai.operation.name": "chat",
            "gen_ai.provider.name": "deepseek",
            "gen_ai.request.model": "deepseek-flash",
            "gen_ai.request.reasoning_effort": "default",
            "gen_ai.agent.name": "translator",
            "ai.agent.key": "fr-FR",
            "ai.agent.name": "translator",
            "gen_ai.request.max_tokens": "512",
            "gen_ai.request.temperature": 0.3,
            "gen_ai.response.id": "chatcmpl-123",
            "gen_ai.response.model": "deepseek-flash",
            "gen_ai.response.finish_reasons": ["stop"],
            "gen_ai.usage.input_tokens": "1000",
            "gen_ai.usage.output_tokens": "300",
            "gen_ai.usage.total_tokens": "1300",
            "gen_ai.usage.cache_read.input_tokens": "800",
            "ai.llm.usage.reasoning_tokens": "120",
        }.items():
            self.assertEqual(a[key], value, key)
        self.assertIn("gen_ai.usage.cost", a)
        self.assertEqual(json.loads(a["gen_ai.system_instructions"]), [{"type": "text", "content": "be terse"}])
        self.assertEqual(json.loads(a["gen_ai.output.messages"])[0]["parts"][0]["content"], '{"translations": ["Bonjour"]}')
        self.assertEqual(a["ai.llm.output.sha256"], hashlib.sha256(b'{"translations": ["Bonjour"]}').hexdigest())
        self.assertEqual(a["ai.llm.input.chars"], "2")

    def test_failed_call_has_error_status_and_exception_event(self):
        tracer = make_tracer()
        with self.assertRaises(RuntimeError):
            tracer.chat(FakeClient(RuntimeError("boom")), model="deepseek-flash", messages=[])
        recorder = Recorder()
        shutdown(tracer, recorder)
        chat = next(s for s in recorder.spans() if s["name"] == "gen_ai.chat")
        a = attr_map(chat["attributes"])
        self.assertEqual(chat["status"]["code"], t.STATUS_ERROR)
        self.assertEqual(a["error.type"], "RuntimeError")
        self.assertEqual(a["error.message"], "boom")
        self.assertEqual(a["ai.llm.attempts"], "1")
        self.assertNotIn("gen_ai.usage.cost", a)
        event = chat["events"][0]
        self.assertEqual(event["name"], "exception")
        self.assertEqual(attr_map(event["attributes"]), {"exception.type": "RuntimeError", "exception.message": "boom"})

    def test_retries_sum_usage_and_cost(self):
        tracer = make_tracer()
        messages = [{"role": "user", "content": "x"}]
        with tracer.llm_call("deepseek-flash", messages) as call:
            client = FakeClient(DEEPSEEK_RESPONSE, DEEPSEEK_RESPONSE)
            call.create(client, model="deepseek-flash", messages=messages)
            call.reject(ValueError("bad shape"))
            call.create(client, model="deepseek-flash", messages=messages)
        recorder = Recorder()
        shutdown(tracer, recorder)
        a = attr_map(next(s for s in recorder.spans() if s["name"] == "gen_ai.chat")["attributes"])
        self.assertEqual(a["gen_ai.usage.input_tokens"], "2000")
        self.assertEqual(a["gen_ai.usage.output_tokens"], "600")
        self.assertEqual(a["ai.llm.attempts"], "2")
        self.assertNotIn("error.type", a)

    def test_export_failure_never_raises(self):
        tracer = make_tracer()
        tracer.end_span(tracer.start_span("x"))
        with mock.patch("urllib.request.urlopen", side_effect=OSError("down")), mock.patch("builtins.print") as printed:
            tracer.shutdown()
        self.assertTrue(any("::warning::" in str(c) for c in printed.call_args_list))
        self.assertGreater(tracer.failed, 0)


class ProgressiveExportTest(unittest.TestCase):
    def test_ended_span_is_posted_before_shutdown(self):
        received = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                received.append((self.path, self.headers.get("stream-name"), json.loads(body)))
                self.send_response(200)
                self.end_headers()

            def log_message(self, *args):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            env = github_env(O2_TRACE_INGEST_URL=f"http://127.0.0.1:{server.server_port}", O2_TRACE_STREAM="ci_stream")
            tracer = make_tracer(env=env)
            tracer.end_span(tracer.start_span("stage.done"))
            deadline = time.time() + 5
            while not received and time.time() < deadline:
                time.sleep(0.05)
            # No shutdown(): this is the state a cancelled job leaves behind.
            self.assertEqual(len(received), 1)
            path, stream, body = received[0]
            self.assertEqual(path, "/api/default/v1/traces")
            self.assertEqual(stream, "ci_stream")
            self.assertEqual(body["resourceSpans"][0]["scopeSpans"][0]["spans"][0]["name"], "stage.done")
            tracer._stop.set()
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
