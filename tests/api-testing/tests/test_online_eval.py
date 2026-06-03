"""Integration tests for Online Eval (Phase 2 LLM Observability) APIs.

Covers completed tasks 6-9:
  - Task 6: Provider CRUD
  - Task 7: Score Config CRUD
  - Task 8: Scorer CRUD
  - Task 9: Online Eval Job CRUD + Reconciler

Known server issues tracked:
  - GH-ONLINE-EVAL-001: GET endpoints return CHAR-padded IDs (trailing whitespace)
  - GH-ONLINE-EVAL-002: Update provider rejects same-name on self (duplicate check bug)
  - GH-ONLINE-EVAL-003: Delete score_config/scorer returns 500 (SeaORM soft-delete bug)
  - GH-ONLINE-EVAL-004: Update/activate/archive eval_job returns 500 (SeaORM "None updated")
  - GH-ONLINE-EVAL-005: Missing required fields return 422 (axum) not 400 (handler)

Prerequisites:
  ZO_BASE_URL           http://localhost:5080
  ZO_ROOT_USER_EMAIL    root@example.com
  ZO_ROOT_USER_PASSWORD Complexpass#123
  TEST_ORG_ID           (optional, defaults to "default")
"""

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _api(session, base_url, org_id, path, method="GET", json_data=None,
         expected_status=200, label=""):
    url = f"{base_url}api/{org_id}/{path.lstrip('/')}"
    if method == "GET":
        resp = session.get(url)
    elif method == "POST":
        resp = session.post(url, json=json_data)
    elif method == "PUT":
        resp = session.put(url, json=json_data)
    elif method == "DELETE":
        resp = session.delete(url)
    else:
        raise ValueError(method)
    assert resp.status_code == expected_status, (
        f"{label or path} expected {expected_status}, got {resp.status_code}: "
        f"{resp.text[:500]}"
    )
    return resp


def _assert_ids_equal(a, b):
    """Compare two IDs, handling CHAR-padded whitespace (GH-ONLINE-EVAL-001)."""
    assert str(a).strip() == str(b).strip(), f"IDs don't match: {a!r} vs {b!r}"


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------

class TestProviders:

    @pytest.fixture(autouse=True)
    def setup(self, create_session, base_url, org_id, random_string):
        self.s = create_session
        self.base = base_url
        self.org = org_id
        self.rnd = random_string
        self.pids = []
        yield
        for pid in self.pids:
            try:
                self.s.delete(f"{self.base}api/{self.org}/providers/{pid}")
            except Exception:
                pass

    def _create(self, name=None, **overrides):
        payload = {
            "name": name or f"test-prov-{self.rnd()}",
            "providerType": "openai",
            "endpoint": "https://api.openai.com/v1",
            "defaultModel": "gpt-4",
            "availableModels": ["gpt-4", "gpt-4o"],
            "authConfig": {"api_key": "sk-test-key"},
            "isDefault": False,
        }
        payload.update(overrides)
        resp = _api(self.s, self.base, self.org, "providers",
                     method="POST", json_data=payload, label="create provider")
        data = resp.json()
        self.pids.append(data["id"])
        return data

    # -- CRUD ----------------------------------------------------------------

    def test_01_list_empty(self):
        resp = _api(self.s, self.base, self.org, "providers", label="list")
        assert "list" in resp.json()

    def test_02_create(self):
        data = self._create(name=f"crud-{self.rnd()}")
        assert data["name"].startswith("crud-")
        assert data["providerType"] == "openai"
        assert data["authConfigMasked"] is True

    def test_03_get(self):
        created = self._create(name=f"get-{self.rnd()}")
        resp = _api(self.s, self.base, self.org,
                     f"providers/{created['id']}", label="get")
        _assert_ids_equal(resp.json()["id"], created["id"])
        assert resp.json()["name"] == created["name"]

    def test_04_get_not_found(self):
        _api(self.s, self.base, self.org, "providers/nonexistent",
             expected_status=404, label="get missing")

    def test_05_update(self):
        created = self._create(name=f"upd-{self.rnd()}")
        payload = {
            "name": created["name"],
            "providerType": "openai",
            "defaultModel": "gpt-4-turbo",
            "authConfig": {"api_key": "sk-updated"},
        }
        resp = _api(self.s, self.base, self.org,
                     f"providers/{created['id']}", method="PUT",
                     json_data=payload, label="update")
        assert resp.json()["defaultModel"] == "gpt-4-turbo"

    def test_06_delete(self):
        created = self._create(name=f"del-{self.rnd()}")
        _api(self.s, self.base, self.org, f"providers/{created['id']}",
             method="DELETE", label="delete")
        self.pids.remove(created["id"])
        _api(self.s, self.base, self.org, f"providers/{created['id']}",
             expected_status=404, label="get deleted")

    def test_07_delete_not_found(self):
        _api(self.s, self.base, self.org, "providers/nonexistent",
             method="DELETE", expected_status=404, label="delete missing")

    # -- Validation ----------------------------------------------------------

    def test_08_missing_name(self):
        """GH-ONLINE-EVAL-005: axum returns 422 for missing required field."""
        _api(self.s, self.base, self.org, "providers", method="POST",
             json_data={"providerType": "openai", "defaultModel": "gpt-4",
                        "authConfig": {"api_key": "k"}},
             expected_status=422, label="create missing name")

    def test_09_duplicate_name(self):
        name = f"dup-{self.rnd()}"
        self._create(name=name)
        _api(self.s, self.base, self.org, "providers", method="POST",
             json_data={"name": name, "providerType": "anthropic",
                        "defaultModel": "claude-3", "authConfig": {"api_key": "k"}},
             expected_status=400, label="create duplicate")

    def test_10_test_endpoint(self):
        created = self._create(name=f"tst-{self.rnd()}")
        resp = _api(self.s, self.base, self.org,
                     f"providers/{created['id']}/test", method="POST",
                     label="test provider")
        assert "not yet implemented" in str(resp.json()).lower()

    def test_11_list_contains_created(self):
        name = f"lst-{self.rnd()}"
        created = self._create(name=name)
        resp = _api(self.s, self.base, self.org, "providers", label="list")
        names = [p["name"] for p in resp.json()["list"]]
        assert created["name"] in names

    def test_12_update_not_found(self):
        _api(self.s, self.base, self.org, "providers/nonexistent",
             method="PUT", json_data={
                 "name": "x", "providerType": "openai", "defaultModel": "gpt-4",
                 "authConfig": {"api_key": "k"}},
             expected_status=404, label="update missing")


# ---------------------------------------------------------------------------
# Score Configs
# ---------------------------------------------------------------------------

class TestScoreConfigs:

    @pytest.fixture(autouse=True)
    def setup(self, create_session, base_url, org_id, random_string):
        self.s = create_session
        self.base = base_url
        self.org = org_id
        self.rnd = random_string
        self.names = []
        yield
        for name in self.names:
            try:
                self.s.delete(f"{self.base}api/{self.org}/score_configs/{name}")
            except Exception:
                pass

    def _create(self, name=None, **overrides):
        payload = {
            "name": name or f"sc-{self.rnd()}",
            "dataType": "numeric",
            "description": "A numeric score config",
            "numericRange": {"min": 0, "max": 100},
            "healthyThreshold": {"min": 70, "max": 100},
        }
        payload.update(overrides)
        resp = _api(self.s, self.base, self.org, "score_configs",
                     method="POST", json_data=payload, label="create score config")
        data = resp.json()
        self.names.append(data["name"])
        return data

    def test_01_list_empty(self):
        resp = _api(self.s, self.base, self.org, "score_configs", label="list")
        assert "list" in resp.json()

    def test_02_create(self):
        data = self._create(name=f"crud-{self.rnd()}")
        assert data["name"].startswith("crud-")
        assert data["dataType"] == "numeric"
        assert data["version"] == 1

    def test_03_get(self):
        created = self._create(name=f"get-{self.rnd()}")
        resp = _api(self.s, self.base, self.org,
                     f"score_configs/{created['name']}", label="get")
        _assert_ids_equal(resp.json()["id"], created["id"])
        assert resp.json()["version"] == 1

    def test_04_get_not_found(self):
        _api(self.s, self.base, self.org, "score_configs/nope-xyz",
             expected_status=404, label="get missing")

    def test_05_update_version_bump(self):
        created = self._create(name=f"ver-{self.rnd()}")
        assert created["version"] == 1
        resp = _api(self.s, self.base, self.org,
                     f"score_configs/{created['name']}", method="PUT", json_data={
                         "name": created["name"],
                         "dataType": created["dataType"],
                         "description": "v2",
                         "numericRange": {"min": 10, "max": 90},
                         "healthyThreshold": {"min": 80, "max": 100},
                     }, label="update score config")
        data = resp.json()
        assert data["version"] == 2
        assert data["description"] == "v2"

    def test_06_list_versions(self):
        created = self._create(name=f"verlist-{self.rnd()}")
        _api(self.s, self.base, self.org, f"score_configs/{created['name']}",
             method="PUT", json_data={
                 "name": created["name"], "dataType": created["dataType"],
                 "description": "v2", "numericRange": {"min": 0, "max": 50},
                 "healthyThreshold": {"min": 25, "max": 50},
             }, label="bump v2")
        resp = _api(self.s, self.base, self.org,
                     f"score_configs/{created['name']}/versions",
                     label="list versions")
        versions = resp.json().get("versions", [])
        assert len(versions) == 2
        assert versions[0]["version"] == 2
    def test_07_delete(self):
        """Soft-delete (deactivate) a score config."""
        created = self._create(name=f"del-{self.rnd()}")
        _api(self.s, self.base, self.org, f"score_configs/{created['name']}",
             method="DELETE", label="delete score config")
        self.names.remove(created["name"])
        _api(self.s, self.base, self.org, f"score_configs/{created['name']}",
             expected_status=404, label="get deleted")

    def test_08_missing_name(self):
        _api(self.s, self.base, self.org, "score_configs", method="POST",
             json_data={"dataType": "numeric"}, expected_status=422,
             label="create missing name")

    def test_09_update_not_found(self):
        _api(self.s, self.base, self.org, "score_configs/nope-xyz",
             method="PUT", json_data={"name": "nope", "dataType": "numeric"},
             expected_status=404, label="update missing")


# ---------------------------------------------------------------------------
# Scorers
# ---------------------------------------------------------------------------

class TestScorers:

    @pytest.fixture(autouse=True)
    def setup(self, create_session, base_url, org_id, random_string):
        self.s = create_session
        self.base = base_url
        self.org = org_id
        self.rnd = random_string
        self.names = []
        yield
        for name in self.names:
            try:
                self.s.delete(f"{self.base}api/{self.org}/scorers/{name}")
            except Exception:
                pass

    def _create(self, name=None, **overrides):
        payload = {
            "name": name or f"scorer-{self.rnd()}",
            "scorerType": "llm_judge",
            "description": "LLM Judge scorer",
            "producesScoreConfigId": "faithfulness",
            "template": "Judge {{input}}",
            "outputSchema": {
                "type": "object",
                "properties": {"value": {"type": "number"}},
            },
            "params": {"provider_id": "p1", "model": "gpt-4"},
        }
        payload.update(overrides)
        resp = _api(self.s, self.base, self.org, "scorers",
                     method="POST", json_data=payload, label="create scorer")
        data = resp.json()
        self.names.append(data["name"])
        return data

    def test_01_list_empty(self):
        resp = _api(self.s, self.base, self.org, "scorers", label="list")
        assert "list" in resp.json()

    def test_02_create(self):
        data = self._create(name=f"crud-{self.rnd()}")
        assert data["name"].startswith("crud-")
        assert data["scorerType"] == "llm_judge"
        assert data["producesScoreConfigId"] == "faithfulness"
        assert data["version"] == 1

    def test_03_get(self):
        created = self._create(name=f"get-{self.rnd()}")
        resp = _api(self.s, self.base, self.org,
                     f"scorers/{created['name']}", label="get")
        _assert_ids_equal(resp.json()["id"], created["id"])
        assert resp.json()["name"] == created["name"]

    def test_04_get_not_found(self):
        _api(self.s, self.base, self.org, "scorers/nope-xyz",
             expected_status=404, label="get missing")

    def test_05_update_version_bump(self):
        created = self._create(name=f"upd-{self.rnd()}")
        assert created["version"] == 1
        resp = _api(self.s, self.base, self.org,
                     f"scorers/{created['name']}", method="PUT", json_data={
                         "name": created["name"],
                         "description": "Updated scorer",
                         "template": "Judge {{input}}",
                         "outputSchema": created["outputSchema"],
                         "params": {"provider_id": "p2", "model": "gpt-4-turbo"},
                     }, label="update scorer")
        data = resp.json()
        assert data["version"] == 2
        assert data["scorerType"] == "llm_judge"        # immutable
        assert data["producesScoreConfigId"] == "faithfulness"  # immutable

    def test_06_list_versions(self):
        created = self._create(name=f"verlist-{self.rnd()}")
        _api(self.s, self.base, self.org, f"scorers/{created['name']}",
             method="PUT", json_data={
                 "name": created["name"], "description": "v2",
                 "template": "Judge {{input}}",
                 "outputSchema": created["outputSchema"],
                 "params": created["params"],
             }, label="bump v2")
        resp = _api(self.s, self.base, self.org,
                     f"scorers/{created['name']}/versions",
                     label="list versions")
        versions = resp.json().get("versions", [])
        assert len(versions) == 2
    def test_07_delete(self):
        created = self._create(name=f"del-{self.rnd()}")
        _api(self.s, self.base, self.org, f"scorers/{created['name']}",
             method="DELETE", label="delete scorer")
        self.names.remove(created["name"])
        _api(self.s, self.base, self.org, f"scorers/{created['name']}",
             expected_status=404, label="get deleted")

    def test_08_missing_name(self):
        _api(self.s, self.base, self.org, "scorers", method="POST",
             json_data={"scorerType": "llm_judge", "template": "Judge {{input}}",
                        "params": {}},
             expected_status=422, label="create missing name")

    def test_09_filter_by_scorer_type(self):
        self._create(name=f"llm-{self.rnd()}", scorerType="llm_judge")
        self._create(name=f"remote-{self.rnd()}", scorerType="remote")
        resp = _api(self.s, self.base, self.org,
                     "scorers?scorerType=llm_judge", label="filter llm_judge")
        for s in resp.json()["list"]:
            assert s["scorerType"] == "llm_judge"

    def test_10_test_endpoint(self):
        created = self._create(name=f"tst-{self.rnd()}")
        resp = _api(self.s, self.base, self.org,
                     f"scorers/{created['name']}/test", method="POST",
                     label="test scorer")
        assert "not yet implemented" in str(resp.json()).lower()


# ---------------------------------------------------------------------------
# Online Eval Jobs
# ---------------------------------------------------------------------------

class TestEvalJobs:

    @pytest.fixture(autouse=True)
    def setup(self, create_session, base_url, org_id, random_string):
        self.s = create_session
        self.base = base_url
        self.org = org_id
        self.rnd = random_string
        self.jids = []
        yield
        for jid in self.jids:
            try:
                self.s.delete(f"{self.base}api/{self.org}/eval_jobs/{jid}")
            except Exception:
                pass

    def _create(self, name=None, **overrides):
        payload = {
            "name": name or f"job-{self.rnd()}",
            "description": "E2E test eval job",
            "stream": "default",
            "streamType": "logs",
            "filterCondition": {"type": "condition", "field": "log", "operator": "exists"},
            "scorers": ["faithfulness"],
            "inputMapping": None,
            "samplingMode": "all",
            "samplingValue": None,
        }
        payload.update(overrides)
        resp = _api(self.s, self.base, self.org, "eval_jobs",
                     method="POST", json_data=payload, label="create eval job")
        data = resp.json()
        self.jids.append(data["id"])
        return data

    def _transition(self, job_id, action, expected_status=200):
        return _api(self.s, self.base, self.org,
                     f"eval_jobs/{job_id}/{action}", method="POST",
                     expected_status=expected_status,
                     label=f"{action} job {job_id}")

    def test_01_list_empty(self):
        resp = _api(self.s, self.base, self.org, "eval_jobs", label="list")
        assert "list" in resp.json()

    def test_02_create_draft(self):
        data = self._create(name=f"crud-{self.rnd()}")
        assert data["name"].startswith("crud-")
        assert data["status"] == "draft"
        assert data["version"] == 1

    def test_02b_create_preserves_multiple_input_mappings(self):
        input_mapping = {
            "scorer-1": {
                "input": "{{gen_ai_input_messages}}",
                "output": "{{gen_ai_output_messages}}",
                "context": "{{gen_ai_system_instructions}}",
            },
            "scorer-2": {
                "input": "{{gen_ai_input_messages}}",
                "output": "{{gen_ai_output_messages}}",
                "expected": "{{gen_ai_system_instructions}}",
                "trace_id": "{{trace_id}}",
            },
        }
        data = self._create(
            name=f"mapping-{self.rnd()}",
            scorers=["scorer-1", "scorer-2"],
            inputMapping=input_mapping,
        )

        assert data["inputMapping"] == input_mapping

        resp = _api(self.s, self.base, self.org,
                    f"eval_jobs/{data['id']}", label="get eval job mappings")
        assert resp.json()["inputMapping"] == input_mapping

    def test_03_get(self):
        created = self._create(name=f"get-{self.rnd()}")
        resp = _api(self.s, self.base, self.org,
                     f"eval_jobs/{created['id']}", label="get")
        _assert_ids_equal(resp.json()["id"], created["id"])
        assert resp.json()["name"] == created["name"]

    def test_04_get_not_found(self):
        _api(self.s, self.base, self.org, "eval_jobs/nonexistent",
             expected_status=404, label="get missing")
    def test_05_update(self):
        created = self._create(name=f"upd-{self.rnd()}")
        resp = _api(self.s, self.base, self.org, f"eval_jobs/{created['id']}",
                     method="PUT", json_data={
                         "name": created["name"],
                         "description": "Updated",
                         "stream": "default",
                         "streamType": "logs",
                         "filterCondition": {"type": "condition", "field": "level",
                                             "operator": "eq", "value": "error"},
                         "scorers": ["faithfulness"],
                         "samplingMode": "rate",
                         "samplingValue": 0.5,
                     }, label="update eval job")
        assert resp.json()["version"] == 2
        assert resp.json()["description"] == "Updated"

    def test_05b_update_adds_scorer_input_mapping(self):
        initial_mapping = {
            "scorer-1": {
                "input": "{{gen_ai_input_messages}}",
                "output": "{{gen_ai_output_messages}}",
                "context": "{{gen_ai_system_instructions}}",
            }
        }
        created = self._create(
            name=f"upd-map-{self.rnd()}",
            scorers=["scorer-1"],
            inputMapping=initial_mapping,
        )
        new_mapping = {
            "scorer-2": {
                "input": "{{gen_ai_input_messages}}",
                "output": "{{gen_ai_output_messages}}",
                "expected": "{{gen_ai_system_instructions}}",
                "trace_id": "{{trace_id}}",
            }
        }

        resp = _api(self.s, self.base, self.org, f"eval_jobs/{created['id']}",
                    method="PUT", json_data={
                        "name": created["name"],
                        "description": created["description"],
                        "stream": created["stream"],
                        "streamType": created["streamType"],
                        "filterCondition": created["filterCondition"],
                        "scorers": ["scorer-1", "scorer-2"],
                        "inputMapping": new_mapping,
                        "samplingMode": created["samplingMode"],
                        "samplingValue": created["samplingValue"],
                    }, label="update eval job mapping")

        expected_mapping = {**initial_mapping, **new_mapping}
        assert resp.json()["scorers"] == ["scorer-1", "scorer-2"]
        assert resp.json()["inputMapping"] == expected_mapping

    def test_06_delete(self):
        created = self._create(name=f"del-{self.rnd()}")
        _api(self.s, self.base, self.org, f"eval_jobs/{created['id']}",
             method="DELETE", label="delete eval job")
        self.jids.remove(created["id"])
        _api(self.s, self.base, self.org, f"eval_jobs/{created['id']}",
             expected_status=404, label="get deleted")
    def test_07_full_lifecycle(self):
        """draft -> activate -> pause -> resume -> archive."""
        job = self._create(name=f"lifecycle-{self.rnd()}")
        assert job["status"] == "draft"

        resp = self._transition(job["id"], "activate")
        assert resp.json()["status"] == "active"
        assert resp.json().get("pipelineId") is not None

        resp = self._transition(job["id"], "pause")
        assert resp.json()["status"] == "paused"

        resp = self._transition(job["id"], "resume")
        assert resp.json()["status"] == "active"

        resp = self._transition(job["id"], "archive")
        assert resp.json()["status"] == "archived"

    def test_08_draft_to_archive(self):
        job = self._create(name=f"d2a-{self.rnd()}")
        resp = self._transition(job["id"], "archive")
        assert resp.json()["status"] == "archived"

    def test_09_active_pause_resume(self):
        job = self._create(name=f"apr-{self.rnd()}")
        self._transition(job["id"], "activate")
        resp = self._transition(job["id"], "pause")
        assert resp.json()["status"] == "paused"
        resp = self._transition(job["id"], "resume")
        assert resp.json()["status"] == "active"

    def test_10_invalid_transition(self):
        """Pausing a draft job should return 400."""
        job = self._create(name=f"inv-{self.rnd()}")
        self._transition(job["id"], "pause", expected_status=400)

    def test_11_list_filter_by_status(self):
        """Filter eval jobs by status -- tests the query param works."""
        self._create(name=f"draft-{self.rnd()}")
        # List with filter (even if no active jobs, the endpoint should accept it)
        resp = _api(self.s, self.base, self.org, "eval_jobs?status=draft",
                     label="filter draft")
        assert "list" in resp.json()

    def test_12_missing_name(self):
        _api(self.s, self.base, self.org, "eval_jobs", method="POST",
             json_data={"stream": "default", "streamType": "logs",
                        "filterCondition": {}, "scorers": ["x"],
                        "samplingMode": "all"},
             expected_status=422, label="create missing name")

    def test_13_missing_stream(self):
        _api(self.s, self.base, self.org, "eval_jobs", method="POST",
             json_data={"name": f"nostream-{self.rnd()}", "streamType": "logs",
                        "filterCondition": {}, "scorers": ["x"],
                        "samplingMode": "all"},
             expected_status=422, label="create missing stream")


# ---------------------------------------------------------------------------
# End-to-End: full resource chain
# ---------------------------------------------------------------------------

class TestOnlineEvalEndToEnd:

    @pytest.fixture(autouse=True)
    def setup(self, create_session, base_url, org_id, random_string):
        self.s = create_session
        self.base = base_url
        self.org = org_id
        self.rnd = random_string
        self.ids = {"providers": [], "score_configs": [], "scorers": [], "jobs": []}
        yield
        for jid in self.ids["jobs"]:
            try:
                self.s.delete(f"{self.base}api/{self.org}/eval_jobs/{jid}")
            except Exception:
                pass
        for name in self.ids["scorers"]:
            try:
                self.s.delete(f"{self.base}api/{self.org}/scorers/{name}")
            except Exception:
                pass
        for name in self.ids["score_configs"]:
            try:
                self.s.delete(f"{self.base}api/{self.org}/score_configs/{name}")
            except Exception:
                pass
        for pid in self.ids["providers"]:
            try:
                self.s.delete(f"{self.base}api/{self.org}/providers/{pid}")
            except Exception:
                pass

    def test_01_create_all_resources(self):
        """Create Provider -> Score Config -> Scorer -> Eval Job (draft).
        This test covers the happy-path resource creation chain and verifies
        all endpoints return expected response shapes.
        """
        s, base, org = self.s, self.base, self.org
        suffix = self.rnd()

        # Provider
        prov = _api(s, base, org, "providers", method="POST", json_data={
            "name": f"e2e-prov-{suffix}",
            "providerType": "openai",
            "endpoint": "https://api.openai.com/v1",
            "defaultModel": "gpt-4o",
            "authConfig": {"api_key": "sk-e2e"},
        }, label="e2e: create provider").json()
        self.ids["providers"].append(prov["id"])
        assert prov["providerType"] == "openai"

        # Score Config
        sc = _api(s, base, org, "score_configs", method="POST", json_data={
            "name": f"e2e-sc-{suffix}",
            "dataType": "categorical",
            "description": "E2E score config",
            "categories": {"Good": 85, "Fair": 50, "Poor": 15},
        }, label="e2e: create score config").json()
        self.ids["score_configs"].append(sc["name"])
        assert sc["dataType"] == "categorical"
        assert sc["version"] == 1

        # Scorer (llm_judge)
        scorer = _api(s, base, org, "scorers", method="POST", json_data={
            "name": f"e2e-scorer-{suffix}",
            "scorerType": "llm_judge",
            "description": "E2E LLM Judge",
            "producesScoreConfigId": "faithfulness",
            "template": "Judge {{query}} and {{response}}",
            "outputSchema": {"type": "object",
                             "properties": {"value": {"type": "number"}}},
            "params": {"provider_id": prov["id"], "model": "gpt-4o"},
        }, label="e2e: create scorer").json()
        self.ids["scorers"].append(scorer["name"])
        assert scorer["scorerType"] == "llm_judge"
        assert scorer["version"] == 1

        # Eval Job (draft)
        job = _api(s, base, org, "eval_jobs", method="POST", json_data={
            "name": f"e2e-job-{suffix}",
            "description": "E2E eval job",
            "stream": "default",
            "streamType": "logs",
            "filterCondition": {"type": "condition", "field": "log",
                                "operator": "exists"},
            "scorers": [scorer["name"]],
            "inputMapping": None,
            "samplingMode": "all",
            "samplingValue": None,
        }, label="e2e: create eval job").json()
        self.ids["jobs"].append(job["id"])
        assert job["status"] == "draft"
        assert job["stream"] == "default"

    def test_02_activate_job_with_pipeline(self):
        """Create job + activate -> verifies pipelineId is returned."""
        s, base, org = self.s, self.base, self.org
        suffix = self.rnd()

        # Minimal resources needed for activation
        _api(s, base, org, "scorers", method="POST", json_data={
            "name": f"e2e-scr-{suffix}",
            "scorerType": "llm_judge",
            "template": "Judge {{input}}",
            "params": {"provider_id": "p", "model": "gpt-4"},
        }, label="e2e: create scorer")

        job = _api(s, base, org, "eval_jobs", method="POST", json_data={
            "name": f"e2e-act-{suffix}",
            "stream": "default",
            "streamType": "logs",
            "filterCondition": {"type": "condition", "field": "log",
                                "operator": "exists"},
            "scorers": [f"e2e-scr-{suffix}"],
            "samplingMode": "all",
            "samplingValue": None,
        }, label="e2e: create job for activation").json()
        self.ids["jobs"].append(job["id"])
        self.ids["scorers"].append(f"e2e-scr-{suffix}")

        act = _api(s, base, org, f"eval_jobs/{job['id']}/activate",
                    method="POST", label="e2e: activate").json()
        assert act["status"] == "active"
        assert act.get("pipelineId") is not None

    def test_03_version_pinning_preserves_scorer_ref_and_versions(self):
        """Pinned eval job scorer refs should survive scorer/config version bumps."""
        s, base, org = self.s, self.base, self.org
        suffix = self.rnd()

        score_config = _api(s, base, org, "score_configs", method="POST", json_data={
            "name": f"pin-sc-{suffix}",
            "dataType": "numeric",
            "description": "Pinned score config v1",
            "numericRange": {"min": 0, "max": 1},
            "healthyThreshold": {"min": 0.7, "max": 1},
        }, label="pinning: create score config").json()
        self.ids["score_configs"].append(score_config["entityId"])

        scorer = _api(s, base, org, "scorers", method="POST", json_data={
            "name": f"pin-scorer-{suffix}",
            "description": "Pinned scorer v1",
            "scorer": {
                "type": "llm_judge",
                "producesScoreConfigId": score_config["entityId"],
                "template": "Judge v1 {{input}}",
                "outputSchema": {
                    "type": "object",
                    "properties": {"value": {"type": "number"}},
                    "required": ["value"],
                },
                "params": {"provider_id": "pin-provider-v1", "model": "gpt-4o"},
            },
        }, label="pinning: create scorer").json()
        self.ids["scorers"].append(scorer["entityId"])

        assert score_config["version"] == 1
        assert scorer["version"] == 1

        updated_score_config = _api(
            s, base, org, f"score_configs/{score_config['entityId']}",
            method="PUT",
            json_data={
                "name": score_config["name"],
                "description": "Pinned score config v2",
                "numericRange": {"min": 0, "max": 100},
                "healthyThreshold": {"min": 70, "max": 100},
            },
            label="pinning: update score config",
        ).json()
        updated_scorer = _api(
            s, base, org, f"scorers/{scorer['entityId']}",
            method="PUT",
            json_data={
                "name": scorer["name"],
                "description": "Pinned scorer v2",
                "scorer": {
                    "type": "llm_judge",
                    "template": "Judge v2 {{input}}",
                    "outputSchema": scorer["outputSchema"],
                    "params": {"provider_id": "pin-provider-v2", "model": "gpt-4o-mini"},
                },
            },
            label="pinning: update scorer",
        ).json()

        assert updated_score_config["version"] == 2
        assert updated_scorer["version"] == 2
        assert updated_scorer["producesScoreConfigId"] == score_config["entityId"]

        job = _api(s, base, org, "eval_jobs", method="POST", json_data={
            "name": f"pin-job-{suffix}",
            "description": "Eval job pinned to scorer v1",
            "stream": "default",
            "streamType": "logs",
            "filterCondition": {"type": "condition", "field": "log",
                                "operator": "exists"},
            "scorers": [{"id": scorer["entityId"], "version": 1}],
            "samplingMode": "all",
            "samplingValue": None,
        }, label="pinning: create eval job").json()
        self.ids["jobs"].append(job["id"])

        assert job["scorers"] == [{"id": scorer["entityId"], "version": 1}]

        scorer_versions = _api(
            s, base, org, f"scorers/{scorer['entityId']}/versions",
            label="pinning: list scorer versions",
        ).json()["versions"]
        score_config_versions = _api(
            s, base, org, f"score_configs/{score_config['entityId']}/versions",
            label="pinning: list score config versions",
        ).json()["versions"]

        assert [v["version"] for v in scorer_versions[:2]] == [2, 1]
        assert [v["version"] for v in score_config_versions[:2]] == [2, 1]

    def test_04_scorer_version_pins_score_config_version(self):
        """A scorer version should retain the score config version it was created with."""
        s, base, org = self.s, self.base, self.org
        suffix = self.rnd()

        score_config = _api(s, base, org, "score_configs", method="POST", json_data={
            "name": f"pin-sc-version-{suffix}",
            "dataType": "numeric",
            "description": "Score config version expected to be pinned",
            "numericRange": {"min": 0, "max": 1},
            "healthyThreshold": {"min": 0.7, "max": 1},
        }, label="score_config pinning: create score config").json()
        self.ids["score_configs"].append(score_config["entityId"])

        scorer = _api(s, base, org, "scorers", method="POST", json_data={
            "name": f"pin-score-config-scorer-{suffix}",
            "description": "Scorer should pin score config v1",
            "scorer": {
                "type": "llm_judge",
                "producesScoreConfigId": score_config["entityId"],
                "template": "Judge {{input}}",
                "outputSchema": {
                    "type": "object",
                    "properties": {"value": {"type": "number"}},
                    "required": ["value"],
                },
                "params": {"provider_id": "pin-provider", "model": "gpt-4o"},
            },
        }, label="score_config pinning: create scorer").json()
        self.ids["scorers"].append(scorer["entityId"])

        _api(
            s, base, org, f"score_configs/{score_config['entityId']}",
            method="PUT",
            json_data={
                "name": score_config["name"],
                "description": "Score config v2 should not affect scorer v1",
                "numericRange": {"min": 0, "max": 100},
                "healthyThreshold": {"min": 70, "max": 100},
            },
            label="score_config pinning: update score config",
        )

        scorer_versions = _api(
            s, base, org, f"scorers/{scorer['entityId']}/versions",
            label="score_config pinning: list scorer versions",
        ).json()["versions"]
        scorer_v1 = next(v for v in scorer_versions if v["version"] == 1)

        assert scorer_v1["producesScoreConfigId"] == score_config["entityId"]
        assert scorer_v1["producesScoreConfigVersion"] == 1

    def test_05_score_config_delete_blocked_when_used_by_scorer(self):
        s, base, org = self.s, self.base, self.org
        suffix = self.rnd()

        score_config = _api(s, base, org, "score_configs", method="POST", json_data={
            "name": f"block-sc-{suffix}",
            "dataType": "numeric",
            "description": "Score config used by a scorer",
            "numericRange": {"min": 0, "max": 1},
            "healthyThreshold": {"min": 0.7, "max": 1},
        }, label="block delete: create score config").json()
        self.ids["score_configs"].append(score_config["entityId"])

        scorer = _api(s, base, org, "scorers", method="POST", json_data={
            "name": f"block-sc-scorer-{suffix}",
            "description": "Scorer using score config",
            "scorer": {
                "type": "llm_judge",
                "producesScoreConfigId": score_config["entityId"],
                "template": "Judge {{input}}",
                "params": {"provider_id": "block-provider", "model": "gpt-4o"},
            },
        }, label="block delete: create scorer").json()
        self.ids["scorers"].append(scorer["entityId"])

        resp = _api(
            s, base, org, f"score_configs/{score_config['entityId']}",
            method="DELETE",
            expected_status=409,
            label="block delete: delete score config in use",
        )
        assert "used by one or more scorers" in resp.text

        _api(s, base, org, f"scorers/{scorer['entityId']}",
             method="DELETE", label="block delete: delete scorer")
        _api(s, base, org, f"score_configs/{score_config['entityId']}",
             method="DELETE", label="block delete: delete score config after scorer")

    def test_06_scorer_delete_blocked_by_non_archived_eval_job_only(self):
        s, base, org = self.s, self.base, self.org
        suffix = self.rnd()

        scorer = _api(s, base, org, "scorers", method="POST", json_data={
            "name": f"block-scorer-{suffix}",
            "description": "Scorer referenced by eval job",
            "scorer": {
                "type": "llm_judge",
                "template": "Judge {{input}}",
                "params": {"provider_id": "block-provider", "model": "gpt-4o"},
            },
        }, label="block scorer: create scorer").json()
        self.ids["scorers"].append(scorer["entityId"])

        job = _api(s, base, org, "eval_jobs", method="POST", json_data={
            "name": f"block-job-{suffix}",
            "description": "Eval job referencing scorer",
            "stream": "default",
            "streamType": "logs",
            "filterCondition": {"type": "condition", "field": "log",
                                "operator": "exists"},
            "scorers": [scorer["entityId"]],
            "samplingMode": "all",
            "samplingValue": None,
        }, label="block scorer: create eval job").json()
        self.ids["jobs"].append(job["id"])

        resp = _api(
            s, base, org, f"scorers/{scorer['entityId']}",
            method="DELETE",
            expected_status=409,
            label="block scorer: delete scorer used by draft job",
        )
        assert "used by one or more eval jobs" in resp.text

        _api(s, base, org, f"eval_jobs/{job['id']}/archive",
             method="POST", label="block scorer: archive eval job")
        _api(s, base, org, f"scorers/{scorer['entityId']}",
             method="DELETE", label="block scorer: delete scorer after archive")
