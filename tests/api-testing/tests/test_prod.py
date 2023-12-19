import json
import requests
import pytest


pytestmark = pytest.mark.parametrize(
    "base_url", ["https://alpha1-api.dev.zinclabs.dev/"]
)


def test_e2e_getusertoken(base_url):
    """Running an E2E test for get user token."""

    if base_url.startswith("https://alpha"):
        pytest.skip("alpha1 is unsupported")
    headers = {
        "Authorization": "Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjI0MjAwMTE1NzgwMTY1ODc2OSIsInR5cCI6IkpXVCJ9.eyJhbXIiOlsicGFzc3dvcmQiLCJwd2QiXSwiYXRfaGFzaCI6IjJ3Nnc2UWpZRWRYcUU0c1Q5cGlWUVEiLCJhdWQiOlsiMjMxODE2MDY0OTA2OTQ1NjU3QG9wZW5vYnNlcnZlIiwiMjMxODE2NDA1ODAzMTk3NTYxQG9wZW5vYnNlcnZlIiwiMjMxODE1Njc0NTg0OTQ5ODgxIl0sImF1dGhfdGltZSI6MTcwMDc0MDA2MCwiYXpwIjoiMjMxODE2MDY0OTA2OTQ1NjU3QG9wZW5vYnNlcnZlIiwiY19oYXNoIjoibEJHUm9BZnVTbzJNVWJ0czZSRTBydyIsImNsaWVudF9pZCI6IjIzMTgxNjA2NDkwNjk0NTY1N0BvcGVub2JzZXJ2ZSIsImVtYWlsIjoibmVoYSsxNDQ0MkBvcGVub2JzZXJ2ZS5haSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJleHAiOjE3MDA3ODMyNzMsImZhbWlseV9uYW1lIjoidGFya2FzZSIsImdlbmRlciI6Im1hbGUiLCJnaXZlbl9uYW1lIjoib3ZydHR0IiwiaWF0IjoxNzAwNzQwMDYzLCJpc3MiOiJodHRwczovL2FscGhhLXRncWF0YS56aXRhZGVsLmNsb3VkIiwibG9jYWxlIjoiZW4iLCJuYW1lIjoib3ZydHR0IHRhcmthc2UiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJuZWhhKzE0NDQyQG9wZW5vYnNlcnZlLmFpIiwic3ViIjoiMjMzNTc1NDg3ODkxMzM4NjAxIiwidXBkYXRlZF9hdCI6MTY5NTcyNDQxNSwidXJuOnppdGFkZWw6aWFtOm9yZzppZCI6IjIzMTgxNDUyMTkzOTg3OTAzMyIsInVybjp6aXRhZGVsOmlhbTp1c2VyOnJlc291cmNlb3duZXI6aWQiOiIyMzE4MTQ1MjE5Mzk4NzkwMzMiLCJ1cm46eml0YWRlbDppYW06dXNlcjpyZXNvdXJjZW93bmVyOm5hbWUiOiJPcGVuT2JzZXJ2ZSIsInVybjp6aXRhZGVsOmlhbTp1c2VyOnJlc291cmNlb3duZXI6cHJpbWFyeV9kb21haW4iOiJvcGVub2JzZXJ2ZS56aXRhZGVsLmNsb3VkIn0.eFjeY6RhwBk9F1kViVRj4x0h38ie1YGdTurJK7pZ3XbKDgOpymrpAHkyXVvxmwrVETdRDvgGyl0AYFP78gvOP_bOev-2X4HfVQjWKgre004AfAm1rneQ_rIsRkWpT4Oh6SrjXK6WC5QvPJV8319eOGAjSAh0jqPC-3X8e7K3pTyhMlt0LEW69werh-N0BNb3seegwcq4fEFrQsS5JHvVn33mAw8AORRWFFV_yeYL2GdfschVTdz0nLtaY_ksd8-gDo_61sEVKg4nUGS5Fw401h_1wzJpeBvcRmW5OAJvUlSI2ulO8CnfE-Jmy3p3Eod-6AabmsvitEeu02f6P3zAlw"
    }
    resp_get_rumtoken = requests.get(f"{base_url}api/usertoken", headers=headers)

    # get rumtoken
    print(resp_get_rumtoken.content)
    assert (
        resp_get_rumtoken.status_code == 200
    ), f"Get usertoken 200, but got {resp_get_rumtoken.status_code} {resp_get_rumtoken.content}"


def test_e2e_sendusertokenprod(base_url):
    """Running an E2E test for get user token."""
    if base_url.startswith("https://alpha"):
        pytest.skip("alpha1 is unsupported")

    headers = {
        "Authorization": "Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjI0MjAwMTE1NzgwMTY1ODc2OSIsInR5cCI6IkpXVCJ9.eyJhbXIiOlsicGFzc3dvcmQiLCJwd2QiXSwiYXRfaGFzaCI6IjJ3Nnc2UWpZRWRYcUU0c1Q5cGlWUVEiLCJhdWQiOlsiMjMxODE2MDY0OTA2OTQ1NjU3QG9wZW5vYnNlcnZlIiwiMjMxODE2NDA1ODAzMTk3NTYxQG9wZW5vYnNlcnZlIiwiMjMxODE1Njc0NTg0OTQ5ODgxIl0sImF1dGhfdGltZSI6MTcwMDc0MDA2MCwiYXpwIjoiMjMxODE2MDY0OTA2OTQ1NjU3QG9wZW5vYnNlcnZlIiwiY19oYXNoIjoibEJHUm9BZnVTbzJNVWJ0czZSRTBydyIsImNsaWVudF9pZCI6IjIzMTgxNjA2NDkwNjk0NTY1N0BvcGVub2JzZXJ2ZSIsImVtYWlsIjoibmVoYSsxNDQ0MkBvcGVub2JzZXJ2ZS5haSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJleHAiOjE3MDA3ODMyNzMsImZhbWlseV9uYW1lIjoidGFya2FzZSIsImdlbmRlciI6Im1hbGUiLCJnaXZlbl9uYW1lIjoib3ZydHR0IiwiaWF0IjoxNzAwNzQwMDYzLCJpc3MiOiJodHRwczovL2FscGhhLXRncWF0YS56aXRhZGVsLmNsb3VkIiwibG9jYWxlIjoiZW4iLCJuYW1lIjoib3ZydHR0IHRhcmthc2UiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJuZWhhKzE0NDQyQG9wZW5vYnNlcnZlLmFpIiwic3ViIjoiMjMzNTc1NDg3ODkxMzM4NjAxIiwidXBkYXRlZF9hdCI6MTY5NTcyNDQxNSwidXJuOnppdGFkZWw6aWFtOm9yZzppZCI6IjIzMTgxNDUyMTkzOTg3OTAzMyIsInVybjp6aXRhZGVsOmlhbTp1c2VyOnJlc291cmNlb3duZXI6aWQiOiIyMzE4MTQ1MjE5Mzk4NzkwMzMiLCJ1cm46eml0YWRlbDppYW06dXNlcjpyZXNvdXJjZW93bmVyOm5hbWUiOiJPcGVuT2JzZXJ2ZSIsInVybjp6aXRhZGVsOmlhbTp1c2VyOnJlc291cmNlb3duZXI6cHJpbWFyeV9kb21haW4iOiJvcGVub2JzZXJ2ZS56aXRhZGVsLmNsb3VkIn0.eFjeY6RhwBk9F1kViVRj4x0h38ie1YGdTurJK7pZ3XbKDgOpymrpAHkyXVvxmwrVETdRDvgGyl0AYFP78gvOP_bOev-2X4HfVQjWKgre004AfAm1rneQ_rIsRkWpT4Oh6SrjXK6WC5QvPJV8319eOGAjSAh0jqPC-3X8e7K3pTyhMlt0LEW69werh-N0BNb3seegwcq4fEFrQsS5JHvVn33mAw8AORRWFFV_yeYL2GdfschVTdz0nLtaY_ksd8-gDo_61sEVKg4nUGS5Fw401h_1wzJpeBvcRmW5OAJvUlSI2ulO8CnfE-Jmy3p3Eod-6AabmsvitEeu02f6P3zAlw"
    }

    payload = {
        "id": "",
        "api_name": "",
        "org_identifier": ["ovrttt_organization_62_WnHDzFbSKW0lS79"],
    }

    resp_get_usertoken = requests.post(
        f"{base_url}api/usertoken", json=payload, headers=headers
    )

    # get rumtoken
    print(resp_get_usertoken.content)
    assert (
        resp_get_usertoken.status_code == 400
    ), f"Get usertoken 200, but got {resp_get_usertoken.status_code} {resp_get_usertoken.content}"
    resp_get_rumtoken = requests.get(f"{base_url}api/usertoken", headers=headers)


def test_e2e_sendusertoken(base_url):
    """Running an E2E test for get user token."""
    if base_url.startswith("https://alpha"):
        pytest.skip("alpha1 is unsupported")

    headers = {
        "Authorization": "Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjI0MjAwMTE1NzgwMTY1ODc2OSIsInR5cCI6IkpXVCJ9.eyJhbXIiOlsicGFzc3dvcmQiLCJwd2QiXSwiYXRfaGFzaCI6IjJ3Nnc2UWpZRWRYcUU0c1Q5cGlWUVEiLCJhdWQiOlsiMjMxODE2MDY0OTA2OTQ1NjU3QG9wZW5vYnNlcnZlIiwiMjMxODE2NDA1ODAzMTk3NTYxQG9wZW5vYnNlcnZlIiwiMjMxODE1Njc0NTg0OTQ5ODgxIl0sImF1dGhfdGltZSI6MTcwMDc0MDA2MCwiYXpwIjoiMjMxODE2MDY0OTA2OTQ1NjU3QG9wZW5vYnNlcnZlIiwiY19oYXNoIjoibEJHUm9BZnVTbzJNVWJ0czZSRTBydyIsImNsaWVudF9pZCI6IjIzMTgxNjA2NDkwNjk0NTY1N0BvcGVub2JzZXJ2ZSIsImVtYWlsIjoibmVoYSsxNDQ0MkBvcGVub2JzZXJ2ZS5haSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJleHAiOjE3MDA3ODMyNzMsImZhbWlseV9uYW1lIjoidGFya2FzZSIsImdlbmRlciI6Im1hbGUiLCJnaXZlbl9uYW1lIjoib3ZydHR0IiwiaWF0IjoxNzAwNzQwMDYzLCJpc3MiOiJodHRwczovL2FscGhhLXRncWF0YS56aXRhZGVsLmNsb3VkIiwibG9jYWxlIjoiZW4iLCJuYW1lIjoib3ZydHR0IHRhcmthc2UiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJuZWhhKzE0NDQyQG9wZW5vYnNlcnZlLmFpIiwic3ViIjoiMjMzNTc1NDg3ODkxMzM4NjAxIiwidXBkYXRlZF9hdCI6MTY5NTcyNDQxNSwidXJuOnppdGFkZWw6aWFtOm9yZzppZCI6IjIzMTgxNDUyMTkzOTg3OTAzMyIsInVybjp6aXRhZGVsOmlhbTp1c2VyOnJlc291cmNlb3duZXI6aWQiOiIyMzE4MTQ1MjE5Mzk4NzkwMzMiLCJ1cm46eml0YWRlbDppYW06dXNlcjpyZXNvdXJjZW93bmVyOm5hbWUiOiJPcGVuT2JzZXJ2ZSIsInVybjp6aXRhZGVsOmlhbTp1c2VyOnJlc291cmNlb3duZXI6cHJpbWFyeV9kb21haW4iOiJvcGVub2JzZXJ2ZS56aXRhZGVsLmNsb3VkIn0.eFjeY6RhwBk9F1kViVRj4x0h38ie1YGdTurJK7pZ3XbKDgOpymrpAHkyXVvxmwrVETdRDvgGyl0AYFP78gvOP_bOev-2X4HfVQjWKgre004AfAm1rneQ_rIsRkWpT4Oh6SrjXK6WC5QvPJV8319eOGAjSAh0jqPC-3X8e7K3pTyhMlt0LEW69werh-N0BNb3seegwcq4fEFrQsS5JHvVn33mAw8AORRWFFV_yeYL2GdfschVTdz0nLtaY_ksd8-gDo_61sEVKg4nUGS5Fw401h_1wzJpeBvcRmW5OAJvUlSI2ulO8CnfE-Jmy3p3Eod-6AabmsvitEeu02f6P3zAlw"
    }

    payload = {
        "id": "",
        "api_name": "userkeytest",
        "org_identifier": ["ovrttt_organization_62_WnHDzFbSKW0lS79"],
    }

    resp_get_usertoken = requests.post(
        f"{base_url}api/usertoken", json=payload, headers=headers
    )

    # get rumtoken
    print(resp_get_usertoken.content)
    assert (
        resp_get_usertoken.status_code == 200
    ), f"Get usertoken 200, but got {resp_get_usertoken.status_code} {resp_get_usertoken.content}"
    resp_get_rumtoken = requests.get(f"{base_url}api/usertoken", headers=headers)


def test_e2e_useremail(base_url):
    """Running an E2E test for get user token."""
    if base_url.startswith("https://alpha"):
        pytest.skip("alpha1 is unsupported")

    headers = {
        "Authorization": "Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjI0MjAwMTE1NzgwMTY1ODc2OSIsInR5cCI6IkpXVCJ9.eyJhbXIiOlsicGFzc3dvcmQiLCJwd2QiXSwiYXRfaGFzaCI6IjJ3Nnc2UWpZRWRYcUU0c1Q5cGlWUVEiLCJhdWQiOlsiMjMxODE2MDY0OTA2OTQ1NjU3QG9wZW5vYnNlcnZlIiwiMjMxODE2NDA1ODAzMTk3NTYxQG9wZW5vYnNlcnZlIiwiMjMxODE1Njc0NTg0OTQ5ODgxIl0sImF1dGhfdGltZSI6MTcwMDc0MDA2MCwiYXpwIjoiMjMxODE2MDY0OTA2OTQ1NjU3QG9wZW5vYnNlcnZlIiwiY19oYXNoIjoibEJHUm9BZnVTbzJNVWJ0czZSRTBydyIsImNsaWVudF9pZCI6IjIzMTgxNjA2NDkwNjk0NTY1N0BvcGVub2JzZXJ2ZSIsImVtYWlsIjoibmVoYSsxNDQ0MkBvcGVub2JzZXJ2ZS5haSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJleHAiOjE3MDA3ODMyNzMsImZhbWlseV9uYW1lIjoidGFya2FzZSIsImdlbmRlciI6Im1hbGUiLCJnaXZlbl9uYW1lIjoib3ZydHR0IiwiaWF0IjoxNzAwNzQwMDYzLCJpc3MiOiJodHRwczovL2FscGhhLXRncWF0YS56aXRhZGVsLmNsb3VkIiwibG9jYWxlIjoiZW4iLCJuYW1lIjoib3ZydHR0IHRhcmthc2UiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJuZWhhKzE0NDQyQG9wZW5vYnNlcnZlLmFpIiwic3ViIjoiMjMzNTc1NDg3ODkxMzM4NjAxIiwidXBkYXRlZF9hdCI6MTY5NTcyNDQxNSwidXJuOnppdGFkZWw6aWFtOm9yZzppZCI6IjIzMTgxNDUyMTkzOTg3OTAzMyIsInVybjp6aXRhZGVsOmlhbTp1c2VyOnJlc291cmNlb3duZXI6aWQiOiIyMzE4MTQ1MjE5Mzk4NzkwMzMiLCJ1cm46eml0YWRlbDppYW06dXNlcjpyZXNvdXJjZW93bmVyOm5hbWUiOiJPcGVuT2JzZXJ2ZSIsInVybjp6aXRhZGVsOmlhbTp1c2VyOnJlc291cmNlb3duZXI6cHJpbWFyeV9kb21haW4iOiJvcGVub2JzZXJ2ZS56aXRhZGVsLmNsb3VkIn0.eFjeY6RhwBk9F1kViVRj4x0h38ie1YGdTurJK7pZ3XbKDgOpymrpAHkyXVvxmwrVETdRDvgGyl0AYFP78gvOP_bOev-2X4HfVQjWKgre004AfAm1rneQ_rIsRkWpT4Oh6SrjXK6WC5QvPJV8319eOGAjSAh0jqPC-3X8e7K3pTyhMlt0LEW69werh-N0BNb3seegwcq4fEFrQsS5JHvVn33mAw8AORRWFFV_yeYL2GdfschVTdz0nLtaY_ksd8-gDo_61sEVKg4nUGS5Fw401h_1wzJpeBvcRmW5OAJvUlSI2ulO8CnfE-Jmy3p3Eod-6AabmsvitEeu02f6P3zAlw"
    }
    resp_get_rumtoken = requests.get(
        f"{base_url}api/users/verifyuser/neha+14442@openobserve.ai", headers=headers
    )

    # get rumtoken
    print(resp_get_rumtoken.content)
    assert (
        resp_get_rumtoken.status_code == 200
    ), f"Get usertoken 200, but got {resp_get_rumtoken.status_code} {resp_get_rumtoken.content}"


def test_e2e_userinvalidemail(base_url):
    """Running an E2E test for get user token."""
    if base_url.startswith("https://alpha"):
        pytest.skip("alpha1 is unsupported")

    headers = {
        "Authorization": "Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjI0MjAwMTE1NzgwMTY1ODc2OSIsInR5cCI6IkpXVCJ9.eyJhbXIiOlsicGFzc3dvcmQiLCJwd2QiXSwiYXRfaGFzaCI6IjJ3Nnc2UWpZRWRYcUU0c1Q5cGlWUVEiLCJhdWQiOlsiMjMxODE2MDY0OTA2OTQ1NjU3QG9wZW5vYnNlcnZlIiwiMjMxODE2NDA1ODAzMTk3NTYxQG9wZW5vYnNlcnZlIiwiMjMxODE1Njc0NTg0OTQ5ODgxIl0sImF1dGhfdGltZSI6MTcwMDc0MDA2MCwiYXpwIjoiMjMxODE2MDY0OTA2OTQ1NjU3QG9wZW5vYnNlcnZlIiwiY19oYXNoIjoibEJHUm9BZnVTbzJNVWJ0czZSRTBydyIsImNsaWVudF9pZCI6IjIzMTgxNjA2NDkwNjk0NTY1N0BvcGVub2JzZXJ2ZSIsImVtYWlsIjoibmVoYSsxNDQ0MkBvcGVub2JzZXJ2ZS5haSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJleHAiOjE3MDA3ODMyNzMsImZhbWlseV9uYW1lIjoidGFya2FzZSIsImdlbmRlciI6Im1hbGUiLCJnaXZlbl9uYW1lIjoib3ZydHR0IiwiaWF0IjoxNzAwNzQwMDYzLCJpc3MiOiJodHRwczovL2FscGhhLXRncWF0YS56aXRhZGVsLmNsb3VkIiwibG9jYWxlIjoiZW4iLCJuYW1lIjoib3ZydHR0IHRhcmthc2UiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJuZWhhKzE0NDQyQG9wZW5vYnNlcnZlLmFpIiwic3ViIjoiMjMzNTc1NDg3ODkxMzM4NjAxIiwidXBkYXRlZF9hdCI6MTY5NTcyNDQxNSwidXJuOnppdGFkZWw6aWFtOm9yZzppZCI6IjIzMTgxNDUyMTkzOTg3OTAzMyIsInVybjp6aXRhZGVsOmlhbTp1c2VyOnJlc291cmNlb3duZXI6aWQiOiIyMzE4MTQ1MjE5Mzk4NzkwMzMiLCJ1cm46eml0YWRlbDppYW06dXNlcjpyZXNvdXJjZW93bmVyOm5hbWUiOiJPcGVuT2JzZXJ2ZSIsInVybjp6aXRhZGVsOmlhbTp1c2VyOnJlc291cmNlb3duZXI6cHJpbWFyeV9kb21haW4iOiJvcGVub2JzZXJ2ZS56aXRhZGVsLmNsb3VkIn0.eFjeY6RhwBk9F1kViVRj4x0h38ie1YGdTurJK7pZ3XbKDgOpymrpAHkyXVvxmwrVETdRDvgGyl0AYFP78gvOP_bOev-2X4HfVQjWKgre004AfAm1rneQ_rIsRkWpT4Oh6SrjXK6WC5QvPJV8319eOGAjSAh0jqPC-3X8e7K3pTyhMlt0LEW69werh-N0BNb3seegwcq4fEFrQsS5JHvVn33mAw8AORRWFFV_yeYL2GdfschVTdz0nLtaY_ksd8-gDo_61sEVKg4nUGS5Fw401h_1wzJpeBvcRmW5OAJvUlSI2ulO8CnfE-Jmy3p3Eod-6AabmsvitEeu02f6P3zAlw"
    }
    resp_get_rumtoken = requests.get(
        f"{base_url}api/users/verifyuser/neha+1", headers=headers
    )

    # get rumtoken
    print(resp_get_rumtoken.content)
    assert (
        resp_get_rumtoken.status_code == 400
    ), f"Get usertoken 400, but got {resp_get_rumtoken.status_code} {resp_get_rumtoken.content}"


def test_e2e_userinviteemail(base_url):
    """Running an E2E test for get user token."""
    if base_url.startswith("https://alpha"):
        pytest.skip("alpha1 is unsupported")

    headers = {
        "Authorization": "Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjI0MjAwMTE1NzgwMTY1ODc2OSIsInR5cCI6IkpXVCJ9.eyJhbXIiOlsicGFzc3dvcmQiLCJwd2QiXSwiYXRfaGFzaCI6IjJ3Nnc2UWpZRWRYcUU0c1Q5cGlWUVEiLCJhdWQiOlsiMjMxODE2MDY0OTA2OTQ1NjU3QG9wZW5vYnNlcnZlIiwiMjMxODE2NDA1ODAzMTk3NTYxQG9wZW5vYnNlcnZlIiwiMjMxODE1Njc0NTg0OTQ5ODgxIl0sImF1dGhfdGltZSI6MTcwMDc0MDA2MCwiYXpwIjoiMjMxODE2MDY0OTA2OTQ1NjU3QG9wZW5vYnNlcnZlIiwiY19oYXNoIjoibEJHUm9BZnVTbzJNVWJ0czZSRTBydyIsImNsaWVudF9pZCI6IjIzMTgxNjA2NDkwNjk0NTY1N0BvcGVub2JzZXJ2ZSIsImVtYWlsIjoibmVoYSsxNDQ0MkBvcGVub2JzZXJ2ZS5haSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJleHAiOjE3MDA3ODMyNzMsImZhbWlseV9uYW1lIjoidGFya2FzZSIsImdlbmRlciI6Im1hbGUiLCJnaXZlbl9uYW1lIjoib3ZydHR0IiwiaWF0IjoxNzAwNzQwMDYzLCJpc3MiOiJodHRwczovL2FscGhhLXRncWF0YS56aXRhZGVsLmNsb3VkIiwibG9jYWxlIjoiZW4iLCJuYW1lIjoib3ZydHR0IHRhcmthc2UiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJuZWhhKzE0NDQyQG9wZW5vYnNlcnZlLmFpIiwic3ViIjoiMjMzNTc1NDg3ODkxMzM4NjAxIiwidXBkYXRlZF9hdCI6MTY5NTcyNDQxNSwidXJuOnppdGFkZWw6aWFtOm9yZzppZCI6IjIzMTgxNDUyMTkzOTg3OTAzMyIsInVybjp6aXRhZGVsOmlhbTp1c2VyOnJlc291cmNlb3duZXI6aWQiOiIyMzE4MTQ1MjE5Mzk4NzkwMzMiLCJ1cm46eml0YWRlbDppYW06dXNlcjpyZXNvdXJjZW93bmVyOm5hbWUiOiJPcGVuT2JzZXJ2ZSIsInVybjp6aXRhZGVsOmlhbTp1c2VyOnJlc291cmNlb3duZXI6cHJpbWFyeV9kb21haW4iOiJvcGVub2JzZXJ2ZS56aXRhZGVsLmNsb3VkIn0.eFjeY6RhwBk9F1kViVRj4x0h38ie1YGdTurJK7pZ3XbKDgOpymrpAHkyXVvxmwrVETdRDvgGyl0AYFP78gvOP_bOev-2X4HfVQjWKgre004AfAm1rneQ_rIsRkWpT4Oh6SrjXK6WC5QvPJV8319eOGAjSAh0jqPC-3X8e7K3pTyhMlt0LEW69werh-N0BNb3seegwcq4fEFrQsS5JHvVn33mAw8AORRWFFV_yeYL2GdfschVTdz0nLtaY_ksd8-gDo_61sEVKg4nUGS5Fw401h_1wzJpeBvcRmW5OAJvUlSI2ulO8CnfE-Jmy3p3Eod-6AabmsvitEeu02f6P3zAlw"
    }
    resp_get_rumtoken = requests.get(
        f"{base_url}api/organizations/member_subscription/wrongemail", headers=headers
    )

    # get rumtoken
    print(resp_get_rumtoken.content)
    assert (
        resp_get_rumtoken.status_code == 400
    ), f"Get usertoken 400, but got {resp_get_rumtoken.status_code} {resp_get_rumtoken.content}"


def test_e2e_userinvitevalidemail(base_url):
    """Running an E2E test for get user token."""

    if base_url.startswith("https://alpha"):
        pytest.skip("alpha1 is unsupported")
    headers = {
        "Authorization": "Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjI0MjAwMTE1NzgwMTY1ODc2OSIsInR5cCI6IkpXVCJ9.eyJhbXIiOlsicGFzc3dvcmQiLCJwd2QiXSwiYXRfaGFzaCI6IjJ3Nnc2UWpZRWRYcUU0c1Q5cGlWUVEiLCJhdWQiOlsiMjMxODE2MDY0OTA2OTQ1NjU3QG9wZW5vYnNlcnZlIiwiMjMxODE2NDA1ODAzMTk3NTYxQG9wZW5vYnNlcnZlIiwiMjMxODE1Njc0NTg0OTQ5ODgxIl0sImF1dGhfdGltZSI6MTcwMDc0MDA2MCwiYXpwIjoiMjMxODE2MDY0OTA2OTQ1NjU3QG9wZW5vYnNlcnZlIiwiY19oYXNoIjoibEJHUm9BZnVTbzJNVWJ0czZSRTBydyIsImNsaWVudF9pZCI6IjIzMTgxNjA2NDkwNjk0NTY1N0BvcGVub2JzZXJ2ZSIsImVtYWlsIjoibmVoYSsxNDQ0MkBvcGVub2JzZXJ2ZS5haSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJleHAiOjE3MDA3ODMyNzMsImZhbWlseV9uYW1lIjoidGFya2FzZSIsImdlbmRlciI6Im1hbGUiLCJnaXZlbl9uYW1lIjoib3ZydHR0IiwiaWF0IjoxNzAwNzQwMDYzLCJpc3MiOiJodHRwczovL2FscGhhLXRncWF0YS56aXRhZGVsLmNsb3VkIiwibG9jYWxlIjoiZW4iLCJuYW1lIjoib3ZydHR0IHRhcmthc2UiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJuZWhhKzE0NDQyQG9wZW5vYnNlcnZlLmFpIiwic3ViIjoiMjMzNTc1NDg3ODkxMzM4NjAxIiwidXBkYXRlZF9hdCI6MTY5NTcyNDQxNSwidXJuOnppdGFkZWw6aWFtOm9yZzppZCI6IjIzMTgxNDUyMTkzOTg3OTAzMyIsInVybjp6aXRhZGVsOmlhbTp1c2VyOnJlc291cmNlb3duZXI6aWQiOiIyMzE4MTQ1MjE5Mzk4NzkwMzMiLCJ1cm46eml0YWRlbDppYW06dXNlcjpyZXNvdXJjZW93bmVyOm5hbWUiOiJPcGVuT2JzZXJ2ZSIsInVybjp6aXRhZGVsOmlhbTp1c2VyOnJlc291cmNlb3duZXI6cHJpbWFyeV9kb21haW4iOiJvcGVub2JzZXJ2ZS56aXRhZGVsLmNsb3VkIn0.eFjeY6RhwBk9F1kViVRj4x0h38ie1YGdTurJK7pZ3XbKDgOpymrpAHkyXVvxmwrVETdRDvgGyl0AYFP78gvOP_bOev-2X4HfVQjWKgre004AfAm1rneQ_rIsRkWpT4Oh6SrjXK6WC5QvPJV8319eOGAjSAh0jqPC-3X8e7K3pTyhMlt0LEW69werh-N0BNb3seegwcq4fEFrQsS5JHvVn33mAw8AORRWFFV_yeYL2GdfschVTdz0nLtaY_ksd8-gDo_61sEVKg4nUGS5Fw401h_1wzJpeBvcRmW5OAJvUlSI2ulO8CnfE-Jmy3p3Eod-6AabmsvitEeu02f6P3zAlw"
    }
    payload = {"member_lists": ["nehapawar@g.com"], "role": "admin"}
    resp_get_rumtoken = requests.post(
        f"{base_url}api/ovrttt_organization_62_WnHDzFbSKW0lS79/organizations/members",
        json=payload,
        headers=headers,
    )

    # get rumtoken
    print(resp_get_rumtoken.content)
    assert (
        resp_get_rumtoken.status_code == 200
    ), f"Get usertoken 200, but got {resp_get_rumtoken.status_code} {resp_get_rumtoken.content}"


def test_e2e_userinvitenovalidemail(base_url):
    """Running an E2E test for get user token."""
    if base_url.startswith("https://alpha"):
        pytest.skip("alpha1 is unsupported")

    headers = {
        "Authorization": "Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjI0MjAwMTE1NzgwMTY1ODc2OSIsInR5cCI6IkpXVCJ9.eyJhbXIiOlsicGFzc3dvcmQiLCJwd2QiXSwiYXRfaGFzaCI6IjJ3Nnc2UWpZRWRYcUU0c1Q5cGlWUVEiLCJhdWQiOlsiMjMxODE2MDY0OTA2OTQ1NjU3QG9wZW5vYnNlcnZlIiwiMjMxODE2NDA1ODAzMTk3NTYxQG9wZW5vYnNlcnZlIiwiMjMxODE1Njc0NTg0OTQ5ODgxIl0sImF1dGhfdGltZSI6MTcwMDc0MDA2MCwiYXpwIjoiMjMxODE2MDY0OTA2OTQ1NjU3QG9wZW5vYnNlcnZlIiwiY19oYXNoIjoibEJHUm9BZnVTbzJNVWJ0czZSRTBydyIsImNsaWVudF9pZCI6IjIzMTgxNjA2NDkwNjk0NTY1N0BvcGVub2JzZXJ2ZSIsImVtYWlsIjoibmVoYSsxNDQ0MkBvcGVub2JzZXJ2ZS5haSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJleHAiOjE3MDA3ODMyNzMsImZhbWlseV9uYW1lIjoidGFya2FzZSIsImdlbmRlciI6Im1hbGUiLCJnaXZlbl9uYW1lIjoib3ZydHR0IiwiaWF0IjoxNzAwNzQwMDYzLCJpc3MiOiJodHRwczovL2FscGhhLXRncWF0YS56aXRhZGVsLmNsb3VkIiwibG9jYWxlIjoiZW4iLCJuYW1lIjoib3ZydHR0IHRhcmthc2UiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJuZWhhKzE0NDQyQG9wZW5vYnNlcnZlLmFpIiwic3ViIjoiMjMzNTc1NDg3ODkxMzM4NjAxIiwidXBkYXRlZF9hdCI6MTY5NTcyNDQxNSwidXJuOnppdGFkZWw6aWFtOm9yZzppZCI6IjIzMTgxNDUyMTkzOTg3OTAzMyIsInVybjp6aXRhZGVsOmlhbTp1c2VyOnJlc291cmNlb3duZXI6aWQiOiIyMzE4MTQ1MjE5Mzk4NzkwMzMiLCJ1cm46eml0YWRlbDppYW06dXNlcjpyZXNvdXJjZW93bmVyOm5hbWUiOiJPcGVuT2JzZXJ2ZSIsInVybjp6aXRhZGVsOmlhbTp1c2VyOnJlc291cmNlb3duZXI6cHJpbWFyeV9kb21haW4iOiJvcGVub2JzZXJ2ZS56aXRhZGVsLmNsb3VkIn0.eFjeY6RhwBk9F1kViVRj4x0h38ie1YGdTurJK7pZ3XbKDgOpymrpAHkyXVvxmwrVETdRDvgGyl0AYFP78gvOP_bOev-2X4HfVQjWKgre004AfAm1rneQ_rIsRkWpT4Oh6SrjXK6WC5QvPJV8319eOGAjSAh0jqPC-3X8e7K3pTyhMlt0LEW69werh-N0BNb3seegwcq4fEFrQsS5JHvVn33mAw8AORRWFFV_yeYL2GdfschVTdz0nLtaY_ksd8-gDo_61sEVKg4nUGS5Fw401h_1wzJpeBvcRmW5OAJvUlSI2ulO8CnfE-Jmy3p3Eod-6AabmsvitEeu02f6P3zAlw"
    }
    payload = {"member_lists": ["donotadd"], "role": "admin"}
    resp_get_rumtoken = requests.post(
        f"{base_url}api/ovrttt_organization_62_WnHDzFbSKW0lS79/organizations/members",
        json=payload,
        headers=headers,
    )

    # get rumtoken
    print(resp_get_rumtoken.content)
    assert (
        resp_get_rumtoken.status_code == 200
    ), f"Get usertoken 200, but got {resp_get_rumtoken.status_code} {resp_get_rumtoken.content}"


def test_e2e_userinviteinvalidemail(base_url):
    """Running an E2E test for get user token."""
    if base_url.startswith("https://alpha"):
        pytest.skip("alpha1 is unsupported")

    headers = {
        "Authorization": "Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjI0MjAwMTE1NzgwMTY1ODc2OSIsInR5cCI6IkpXVCJ9.eyJhbXIiOlsicGFzc3dvcmQiLCJwd2QiXSwiYXRfaGFzaCI6IjJ3Nnc2UWpZRWRYcUU0c1Q5cGlWUVEiLCJhdWQiOlsiMjMxODE2MDY0OTA2OTQ1NjU3QG9wZW5vYnNlcnZlIiwiMjMxODE2NDA1ODAzMTk3NTYxQG9wZW5vYnNlcnZlIiwiMjMxODE1Njc0NTg0OTQ5ODgxIl0sImF1dGhfdGltZSI6MTcwMDc0MDA2MCwiYXpwIjoiMjMxODE2MDY0OTA2OTQ1NjU3QG9wZW5vYnNlcnZlIiwiY19oYXNoIjoibEJHUm9BZnVTbzJNVWJ0czZSRTBydyIsImNsaWVudF9pZCI6IjIzMTgxNjA2NDkwNjk0NTY1N0BvcGVub2JzZXJ2ZSIsImVtYWlsIjoibmVoYSsxNDQ0MkBvcGVub2JzZXJ2ZS5haSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJleHAiOjE3MDA3ODMyNzMsImZhbWlseV9uYW1lIjoidGFya2FzZSIsImdlbmRlciI6Im1hbGUiLCJnaXZlbl9uYW1lIjoib3ZydHR0IiwiaWF0IjoxNzAwNzQwMDYzLCJpc3MiOiJodHRwczovL2FscGhhLXRncWF0YS56aXRhZGVsLmNsb3VkIiwibG9jYWxlIjoiZW4iLCJuYW1lIjoib3ZydHR0IHRhcmthc2UiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJuZWhhKzE0NDQyQG9wZW5vYnNlcnZlLmFpIiwic3ViIjoiMjMzNTc1NDg3ODkxMzM4NjAxIiwidXBkYXRlZF9hdCI6MTY5NTcyNDQxNSwidXJuOnppdGFkZWw6aWFtOm9yZzppZCI6IjIzMTgxNDUyMTkzOTg3OTAzMyIsInVybjp6aXRhZGVsOmlhbTp1c2VyOnJlc291cmNlb3duZXI6aWQiOiIyMzE4MTQ1MjE5Mzk4NzkwMzMiLCJ1cm46eml0YWRlbDppYW06dXNlcjpyZXNvdXJjZW93bmVyOm5hbWUiOiJPcGVuT2JzZXJ2ZSIsInVybjp6aXRhZGVsOmlhbTp1c2VyOnJlc291cmNlb3duZXI6cHJpbWFyeV9kb21haW4iOiJvcGVub2JzZXJ2ZS56aXRhZGVsLmNsb3VkIn0.eFjeY6RhwBk9F1kViVRj4x0h38ie1YGdTurJK7pZ3XbKDgOpymrpAHkyXVvxmwrVETdRDvgGyl0AYFP78gvOP_bOev-2X4HfVQjWKgre004AfAm1rneQ_rIsRkWpT4Oh6SrjXK6WC5QvPJV8319eOGAjSAh0jqPC-3X8e7K3pTyhMlt0LEW69werh-N0BNb3seegwcq4fEFrQsS5JHvVn33mAw8AORRWFFV_yeYL2GdfschVTdz0nLtaY_ksd8-gDo_61sEVKg4nUGS5Fw401h_1wzJpeBvcRmW5OAJvUlSI2ulO8CnfE-Jmy3p3Eod-6AabmsvitEeu02f6P3zAlw"
    }
    payload = {"member_lists": ["aaW @@@@g.com"], "role": "admin"}
    resp_get_rumtoken = requests.post(
        f"{base_url}api/ovrttt_organization_62_WnHDzFbSKW0lS79/organizations/members",
        json=payload,
        headers=headers,
    )

    # get rumtoken
    print(resp_get_rumtoken.content)
    assert (
        resp_get_rumtoken.status_code == 200
    ), f"Get usertoken 200, but got {resp_get_rumtoken.status_code} {resp_get_rumtoken.content}"
