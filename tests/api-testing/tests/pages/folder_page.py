import os
import pytest
import random
import uuid
import json
from pathlib import Path
import base64
import requests
import io
import time
import tink
from tink import daead
from tink import secret_key_access
from datetime import datetime, timezone, timedelta

class FolderPage:
    # Make Unique_value_destination a class variable
    Unique_value_folder = f"uFolder_{random.randint(100000, 999999)}"

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id

    def create_folder(self, session, base_url, org_id, folder_name):
        """Create a folder."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}

        payload = {
            "description": folder_name,
            "folderId": "",
            "name": folder_name
        }

        response = session.post(f"{base_url}api/{org_id}/folders", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create folder: {response.content}"
        folder_id = response.json()["folderId"]
        return folder_id