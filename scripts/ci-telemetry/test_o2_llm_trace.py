# Copyright 2026 OpenObserve Inc.
import datetime
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import claude_otel_env  # noqa: E402
import o2_llm_trace as t  # noqa: E402

DEEPSEEK_RESPONSE = {
    "id": "chatcmpl-123",
    "model": "deepseek-v4-flash",
    "choices": [{"index": 0, "finish_reason": "stop", "message": {"content": "{}"}}],
    "usage": {
        "prompt_tokens": 1000,
        "completion_tokens": 300,
        "total_tokens": 1300,
        "prompt_cache_hit_tokens": 800,
        "prompt_cache_miss_tokens": 200,
        "completion_tokens_details": {"reasoning_tokens": 120},
    },
}


def utc(*args):
    return datetime.datetime(*args, tzinfo=datetime.timezone.utc).timestamp()


def attr_map(span):
    out = {}
    for item in span["attributes"]:
        value = item["value"]
        out[item["key"]] = next(iter(value.values()))
    return out


class FakeCompletions:
    def __init__(self, result):
        self.result = result

    def create(self, **kwargs):
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class FakeClient:
    def __init__(self, result):
        self.chat = mock.Mock(completions=FakeCompletions(result))


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
        self.assertEqual(
            t.trace_endpoint({"O2_TRACE_INGEST_URL": "https://o2.example/"}),
            "https://o2.example/api/default/v1/traces",
        )

    def test_missing_url_disables(self):
        self.assertEqual(t.trace_endpoint({}), "")

    def test_auth_header_variants(self):
        self.assertEqual(t.auth_header({"O2_TRACE_AUTH": "abc="}), "Basic abc=")
        self.assertEqual(t.auth_header({"O2_TRACE_AUTH": "Basic abc="}), "Basic abc=")
        self.assertEqual(
            t.auth_header({"O2_TRACE_USERNAME": "u", "O2_TRACE_PASSWORD": "p"}), "Basic dTpw"
        )
        self.assertEqual(t.auth_header({"O2_TRACE_USERNAME": "u"}), "")

    def test_stream_and_timeout_defaults(self):
        self.assertEqual(t.stream_name({}), "github_actions_ai_traces")
        self.assertEqual(t.export_timeout_s({}), 10.0)
        self.assertEqual(t.export_timeout_s({"O2_TRACE_EXPORT_TIMEOUT_MS": "2500"}), 2.5)
        self.assertEqual(t.export_timeout_s({"O2_TRACE_EXPORT_TIMEOUT_MS": "junk"}), 10.0)

    def test_trace_id_from_env(self):
        good = "0123456789abcdef0123456789abcdef"
        self.assertEqual(t.trace_id_from_env({"O2_TRACE_ID": good.upper()}), good)
        self.assertNotEqual(t.trace_id_from_env({"O2_TRACE_ID": "0" * 32}), "0" * 32)
        self.assertEqual(len(t.trace_id_from_env({})), 32)


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
    def test_deepseek_usage_fields(self):
        usage = t.usage_from_response(DEEPSEEK_RESPONSE)
        self.assertEqual(
            usage, {"input": 1000, "cache_read": 800, "output": 300, "reasoning": 120, "total": 1300}
        )
        attrs = t.usage_attributes(usage)
        self.assertEqual(attrs["gen_ai.usage.input_tokens"], 1000)
        self.assertEqual(attrs["gen_ai.usage.cache_read.input_tokens"], 800)
        self.assertEqual(attrs["gen_ai.usage.output_tokens"], 300)
        self.assertEqual(attrs["ai.usage.reasoning_tokens"], 120)

    def test_openai_cached_tokens_fallback(self):
        usage = t.usage_from_response({"usage": {"prompt_tokens": 10, "prompt_tokens_details": {"cached_tokens": 4}}})
        self.assertEqual(usage["cache_read"], 4)
        self.assertIsNone(usage["output"])

    def test_missing_usage(self):
        self.assertEqual(set(t.usage_from_response({}).values()), {None})


class TracerTest(unittest.TestCase):
    def env(self, **extra):
        env = {
            "O2_TRACE_INGEST_URL": "https://o2.example",
            "O2_TRACE_AUTH": "abc",
            "GITHUB_REPOSITORY": "openobserve/openobserve",
            "GITHUB_RUN_ID": "42",
        }
        env.update(extra)
        return env

    def test_disabled_without_config_records_nothing(self):
        with mock.patch("atexit.register") as register, mock.patch("builtins.print"):
            tracer = t.Tracer("github-actions.test", env={})
        register.assert_not_called()
        tracer.chat_completion(FakeClient(DEEPSEEK_RESPONSE), model="deepseek-v4-flash")
        self.assertEqual(tracer._spans, [])
        with mock.patch("urllib.request.urlopen") as urlopen:
            tracer.flush()
        urlopen.assert_not_called()

    def test_success_and_failure_spans_are_exported_once(self):
        with mock.patch("atexit.register"):
            tracer = t.Tracer("github-actions.test", root_name="test", env=self.env())
        tracer.chat_completion(
            FakeClient(DEEPSEEK_RESPONSE), attributes={"ai.locale": "fr-FR"}, model="deepseek-v4-flash"
        )
        with self.assertRaises(RuntimeError):
            tracer.chat_completion(FakeClient(RuntimeError("boom")), model="deepseek-v4-flash")

        sent = []

        def fake_urlopen(request, timeout):
            sent.append((request, timeout))
            return mock.MagicMock()

        with mock.patch("urllib.request.urlopen", side_effect=fake_urlopen), mock.patch("builtins.print"):
            tracer.flush()
            tracer.flush()

        self.assertEqual(len(sent), 1)
        request, timeout = sent[0]
        self.assertEqual(timeout, 10.0)
        self.assertEqual(request.full_url, "https://o2.example/api/default/v1/traces")
        self.assertEqual(request.get_header("Authorization"), "Basic abc")
        self.assertEqual(request.get_header("Stream-name"), "github_actions_ai_traces")

        body = json.loads(request.data)
        resource = attr_map(body["resourceSpans"][0]["resource"])
        self.assertEqual(resource["service.name"], "github-actions.test")
        self.assertEqual(
            resource["github.workflow.run_url"],
            "https://github.com/openobserve/openobserve/actions/runs/42",
        )
        root, ok, failed = body["resourceSpans"][0]["scopeSpans"][0]["spans"]
        self.assertEqual(root["name"], "test")
        self.assertEqual(attr_map(root)["ai.llm.calls"], "2")
        self.assertEqual(ok["parentSpanId"], root["spanId"])

        ok_attrs = attr_map(ok)
        self.assertEqual(ok_attrs["gen_ai.operation.name"], "chat")
        self.assertEqual(ok_attrs["gen_ai.provider.name"], "deepseek")
        self.assertEqual(ok_attrs["gen_ai.response.id"], "chatcmpl-123")
        self.assertEqual(ok_attrs["gen_ai.usage.input_tokens"], "1000")
        self.assertEqual(ok_attrs["ai.locale"], "fr-FR")
        self.assertIn("gen_ai.usage.cost", ok_attrs)
        self.assertEqual(ok["status"]["code"], t.STATUS_OK)

        failed_attrs = attr_map(failed)
        self.assertEqual(failed["status"]["code"], t.STATUS_ERROR)
        self.assertEqual(failed_attrs["error.type"], "RuntimeError")
        self.assertEqual(failed_attrs["gen_ai.request.model"], "deepseek-v4-flash")
        self.assertNotIn("gen_ai.usage.input_tokens", failed_attrs)
        self.assertNotIn("gen_ai.usage.cost", failed_attrs)

    def test_export_failure_never_raises(self):
        with mock.patch("atexit.register"):
            tracer = t.Tracer("github-actions.test", env=self.env())
        with mock.patch("urllib.request.urlopen", side_effect=OSError("down")), mock.patch(
            "builtins.print"
        ) as printed:
            tracer.flush()
        self.assertTrue(any("::warning::" in str(c) for c in printed.call_args_list))

    def test_pr_number_from_event(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump({"pull_request": {"number": 77}}, fh)
        try:
            self.assertEqual(t.pr_number({"GITHUB_EVENT_PATH": fh.name}), 77)
        finally:
            os.unlink(fh.name)
        self.assertEqual(t.pr_number({"PR_NUMBER": "12"}), 12)
        self.assertIsNone(t.pr_number({}))


class ClaudeOtelEnvTest(unittest.TestCase):
    def test_incomplete_config_disables(self):
        self.assertEqual(claude_otel_env.otel_env("svc", {"O2_TRACE_INGEST_URL": "https://o2.example"}), {})

    def test_env_values(self):
        env = {
            "O2_TRACE_INGEST_URL": "https://o2.example/api/acme",
            "O2_TRACE_AUTH": "dTpw==",
            "O2_TRACE_STREAM": "ai",
            "GITHUB_WORKFLOW": "Claude Code",
            "GITHUB_REPOSITORY": "openobserve/openobserve",
        }
        out = claude_otel_env.otel_env("github-actions.claude-code-action", env)
        self.assertEqual(out["CLAUDE_CODE_ENABLE_TELEMETRY"], "1")
        self.assertEqual(out["CLAUDE_CODE_ENHANCED_TELEMETRY_BETA"], "1")
        self.assertEqual(out["OTEL_EXPORTER_OTLP_ENDPOINT"], "https://o2.example/api/acme")
        self.assertEqual(out["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"], "https://o2.example/api/acme/v1/traces")
        self.assertEqual(out["OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"], "https://o2.example/api/acme/v1/logs")
        self.assertEqual(out["OTEL_TRACES_EXPORTER"], "otlp")
        self.assertEqual(out["OTEL_EXPORTER_OTLP_PROTOCOL"], "http/json")
        self.assertEqual(
            out["OTEL_EXPORTER_OTLP_HEADERS"], "Authorization=Basic%20dTpw%3D%3D,stream-name=ai"
        )
        resource = out["OTEL_RESOURCE_ATTRIBUTES"]
        self.assertIn("service.name=github-actions.claude-code-action", resource)
        self.assertIn("github.workflow=Claude%20Code", resource)
        self.assertIn("github.repository=openobserve/openobserve", resource)


if __name__ == "__main__":
    unittest.main()
