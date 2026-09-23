"""Run against an enterprise test server with ZO_BASE_URL and root credentials."""

import base64
import json
import os
import unittest
import uuid
from urllib.error import HTTPError
from urllib.request import Request, urlopen


class PromptDefaultFolderTests(unittest.TestCase):
    def setUp(self):
        required = ("ZO_BASE_URL", "ZO_ROOT_USER_EMAIL", "ZO_ROOT_USER_PASSWORD")
        if not all(os.environ.get(key) for key in required):
            self.skipTest("Set ZO_BASE_URL and root credentials for an enterprise test server")
        self.base_url = os.environ["ZO_BASE_URL"].rstrip("/")
        credentials = ":".join(os.environ[key] for key in required[1:])
        self.authorization = "Basic " + base64.b64encode(credentials.encode()).decode()
        self.prompt_ids = []
        status, body = self.request(
            "POST", "/api/organizations", {"name": "prompt_folder_test_" + uuid.uuid4().hex}
        )
        self.assertEqual(status, 200, body)
        self.org_id = body["identifier"]
        self.prompts = f"/api/{self.org_id}/prompts"
        self.folders = f"/api/v2/{self.org_id}/folders/prompts"

    def tearDown(self):
        for entity_id in self.prompt_ids:
            status, body = self.request("POST", f"{self.prompts}/{entity_id}/archive")
            self.assertEqual(status, 200, body)

    def request(self, method, path, body=None):
        request = Request(
            self.base_url + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Authorization": self.authorization, "Content-Type": "application/json"},
            method=method,
        )
        try:
            response = urlopen(request, timeout=30)
        except HTTPError as error:
            response = error
        with response:
            raw_body = response.read().decode()
            try:
                result = json.loads(raw_body)
            except json.JSONDecodeError:
                result = raw_body
            return response.status, result

    def assert_no_prompt_folders(self):
        status, body = self.request("GET", self.folders)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["list"], [])

    def test_explicit_default_initializes_folder_on_first_create(self):
        self.assert_no_prompt_folders()
        payload = {
            "name": "first-prompt",
            "folderId": "default",
            "type": "text",
            "payload": "You are an assistant.",
            "config": {},
            "commitMessage": "Initial version",
        }
        status, body = self.request("POST", self.prompts, payload)
        self.assertEqual(status, 200, body)
        entity_id = body["prompt"]["entityId"]
        self.prompt_ids.append(entity_id)
        self.assertEqual(body["prompt"]["folderId"], "default")
        self.assertEqual(body["version"]["version"], 1)

        status, body = self.request("GET", self.prompts + "?folderId=default")
        self.assertEqual(status, 200, body)
        self.assertEqual([prompt["entityId"] for prompt in body["list"]], [entity_id])

        status, body = self.request("GET", self.folders)
        self.assertEqual(status, 200, body)
        self.assertEqual([folder["folderId"] for folder in body["list"]], ["default"])

        payload.update(name="missing-folder", folderId="does-not-exist")
        status, body = self.request("POST", self.prompts, payload)
        self.assertEqual(status, 404, body)
        self.assertEqual(body["code"], "folder_not_found")

    def test_unused_default_lists_empty_without_creating_a_folder(self):
        self.assert_no_prompt_folders()
        status, body = self.request("GET", self.prompts + "?folderId=default")
        self.assertEqual(status, 200, body)
        self.assertEqual(body["list"], [])
        self.assert_no_prompt_folders()

        status, body = self.request("GET", self.prompts + "?folderId=does-not-exist")
        self.assertEqual(status, 404, body)
        self.assertEqual(body["code"], "folder_not_found")


if __name__ == "__main__":
    unittest.main()
