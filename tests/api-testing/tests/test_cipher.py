import tink
import base64
import random
import json
import os
from tink import daead
from tink import secret_key_access
from pathlib import Path
from datetime import datetime, timezone, timedelta
import time

# root directory of the project
root_dir = Path(__file__).parent.parent.parent

# Variables to be used in the tests
now = datetime.now(timezone.utc)
end_time = int(now.timestamp() * 1000000)
one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 100000)
simpleKeys = "GNf6McCq0Sm7LCrnnPr4ge+6TG4V1XOGRqXW8m7s5cL50xq4oQEQFDFHevng2UQ8LYUnqwZDPCivlpenqJtpMw=="
simpleKeysUp = "6h/Q/OootEDxfBAYXGSNT5ASinQxjDw0tsBSE6qn40O+0UGw0ToYQFyPJualHGDW35Z7PF6P/wTkW4LV9JrG3w=="
akeylessurl = "https://api.akeyless.io"
akeylessAccessID = "p-c7k3ogiwk1z9am"
akeylessUpAccessID = "p-************am" 
akeylessAccessKey = "tT5/Q0SrSyL80E3g7tU7PSymsG2m24s3EaYiCRl5VFc="
akeylessUpAccessKey = "tT5/Q**********************************5VFc="


# number of total log entries to be ingested
LOG_COUNT = 1000
KS = r"""{"primaryKeyId":2855908267,"key":[{"keyData":{"typeUrl":"type.googleapis.com/google.crypto.tink.AesSivKey","value":"EkDTckeHdeuaE1IM+RLq0LnZsfraoIQf0AlkcGNhsPfemV9MVrqsGC9f9ZAuUJDSwbIXzz8+xA0eXFkwsL07B8bR","keyMaterialType":"SYMMETRIC"},"status":"ENABLED","keyId":2855908267,"outputPrefixType":"TINK"}]}"""

# openobserve base url
BASE_URL = os.environ["ZO_BASE_URL"]

# values can be tink or simple, depending on the key we are using in OO
KEY_TYPE = "tink"

# fake = Faker()
daead.register()

# normal aead encrypted value
def encrypt_simple(s):
  keyset_handle = tink.json_proto_keyset_format.parse(
    KS, secret_key_access.TOKEN
  )
  primitive = keyset_handle.primitive(daead.DeterministicAead)
  ciphertext = primitive.encrypt_deterministically(bytes(s,'utf-8'), b'')
  assert base64.b64encode(ciphertext[5:]).decode('utf-8')

# uses tink lib to encrypt
def encrypt_tink(s):
  keyset_handle = tink.json_proto_keyset_format.parse(
    KS, secret_key_access.TOKEN
  )
  primitive = keyset_handle.primitive(daead.DeterministicAead)
  ciphertext = primitive.encrypt_deterministically(bytes(s,'utf-8'), b'')
  assert base64.b64encode(ciphertext).decode('utf-8')

def test_cipher_data(create_session, base_url):
    """Ingest data into the openobserve running instance."""
    efn = None
    
    # depending on type of key, change the encryption fn
    if KEY_TYPE == "tink":
        efn = encrypt_tink
    else:
        efn = encrypt_simple

    session = create_session
    # Open the json data file and read it
    with open(root_dir / "test-data/logs_data.json") as f:
        data = f.read()
    
    temp = json.loads(data)
    for t in temp:
        if t["log"] is not None:
            t["log"] = efn(t["log"])

    stream_name = "default"
    org = "default"
    url = f"{BASE_URL}api/{org}/{stream_name}/_json"
    resp = session.post(url, json=temp, headers={"Content-Type": "application/json"})
    print("Data ingested successfully, status code: ", resp.status_code)
    assert resp.status_code == 200
    

def test_get_cipher(create_session, base_url):
    """Running an E2E test for all cipher_keys."""

    session = create_session
    org_id = "default"

    resp_get_cipher_keys = session.get(f"{base_url}api/{org_id}/cipher_keys")

    print(resp_get_cipher_keys.content)
    assert (
        resp_get_cipher_keys.status_code == 200
    ), f"Get all cipher_keys list 200, but got {resp_get_cipher_keys.status_code} {resp_get_cipher_keys.content}"

def test_blank_org(create_session, base_url):
    """Running an E2E test for all cipher_keys for blank org"""

    session = create_session
    org_id = ""

    resp_get_blank_org = session.get(f"{base_url}api/{org_id}/cipher_keys")

    print(resp_get_blank_org.content)
    assert (
        resp_get_blank_org.status_code == 404
    ), f"Get all cipher_keys list 404 for blank org, but got {resp_get_blank_org.status_code} {resp_get_blank_org.content}"



def test_cipher_simpleOO(create_session, base_url):
    """Running an E2E test for create, update and delete cipher_keys with simple OO cipher."""
    session = create_session
    org_id = "default"

    # Create a unique cipher name
    while True:
        cipher_name = f"sim_{random.randint(1000, 9999)}"
        payload_simpleOO = {
            "name": cipher_name,
            "key": {
                "store": {
                    "type": "local",
                    "akeyless": {
                        "base_url": "",
                        "access_id": "",
                        "auth": {
                            "type": "access_key",
                            "access_key": "",
                            "ldap": {"username": "", "password": ""}
                        },
                        "store": {
                            "type": "static_secret",
                            "static_secret": "",
                            "dfc": {"name": "", "iv": "", "encrypted_data": ""}
                        }
                    },
                    "local": simpleKeys
                },
                "mechanism": {"type": "simple", "simple_algorithm": "aes-256-siv"}
            },
            "isUpdate": False
        }

    # Attempt to create the cipher key
        resp_create_cipher_simpleOO = session.post(
            f"{base_url}api/{org_id}/cipher_keys", json=payload_simpleOO
        )
        print(resp_create_cipher_simpleOO.content)

        if resp_create_cipher_simpleOO.status_code == 200:
            break  # Exit the loop if the key is created successfully
        elif resp_create_cipher_simpleOO.status_code == 400:
            continue  # Key already exists, try again
        else:
            assert False, f"Unexpected error: {resp_create_cipher_simpleOO.status_code} {resp_create_cipher_simpleOO.content}"

    # Get created cipher key
    resp_get_cipher_simpleOO = session.get(
        f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    )
    print(resp_get_cipher_simpleOO.content)

    assert (
        resp_get_cipher_simpleOO.status_code == 200
    ), f"Expected 200, but got {resp_get_cipher_simpleOO.status_code} {resp_get_cipher_simpleOO.content}"

    # Update created cipher key
    payload_up_simpleOO = {
        "name": cipher_name,
        "key": {
            "store": {
                "type": "local",
                "akeyless": {
                    "base_url": "",
                    "access_id": "",
                    "auth": {
                        "type": "access_key",
                        "access_key": "",
                        "ldap": {"username": "", "password": ""}
                    },
                    "store": {
                        "type": "static_secret",
                        "static_secret": "",
                        "dfc": {"name": "", "iv": "", "encrypted_data": ""}
                    }
                },
                "local": simpleKeysUp
            },
            "mechanism": {"type": "simple", "simple_algorithm": "aes-256-siv"}
        },
        "isUpdate": True
    }

    # Update the cipher key using the correct URL
    resp_update_cipher_simpleOO = session.put(
        f"{base_url}api/{org_id}/cipher_keys/{cipher_name}", json=payload_up_simpleOO
    )
    print(resp_update_cipher_simpleOO.content)

    assert (
        resp_update_cipher_simpleOO.status_code == 200
    ), f"Expected 200, but got {resp_update_cipher_simpleOO.status_code} {resp_update_cipher_simpleOO.content}"



    # resp_delete_cipher_simpleOO = session.delete(
    #         f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    #     )
    
    # print(resp_delete_cipher_simpleOO.content)
    
    # assert (
    #         resp_delete_cipher_simpleOO.status_code == 200
    #     ), f"Expected 200, but got {resp_delete_cipher_simpleOO.status_code} {resp_delete_cipher_simpleOO.content}"

    # # Verify deleted cipher key
    # resp_ver_cipher_simpleOO = session.get(
    #     f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    # )
    # print(resp_ver_cipher_simpleOO.content)

    # assert (
    #     resp_ver_cipher_simpleOO.status_code == 404
    # ), f"Expected 404, but got {resp_ver_cipher_simpleOO.status_code} {resp_ver_cipher_simpleOO.content}"


def test_cipher_tinkOO(create_session, base_url):
    """Running an E2E test for create, update and delete cipher_key with Tink OO cipher."""
    session = create_session
    org_id = "default"

    # Create a unique cipher name
    while True:
        cipher_name = f"tink_{random.randint(1000, 9999)}"
        payload_tinkOO = {
            "name": cipher_name,
            "key": {
                "store": {
                    "type": "local",
                    "akeyless": {
                        "base_url": "",
                        "access_id": "",
                        "auth": {
                            "type": "access_key",
                            "access_key": "",
                            "ldap": {"username": "", "password": ""}
                        },
                        "store": {
                            "type": "static_secret",
                            "static_secret": "",
                            "dfc": {"name": "", "iv": "", "encrypted_data": ""}
                        }
                    },
                    "local": "{\"primaryKeyId\":2736465847,\"key\":[{\"keyData\":{\"typeUrl\":\"type.googleapis.com/google.crypto.tink.AesSivKey\",\"value\":\"EkATbqipZ/Ki/pWbVP/13iabG5tGrWoWZ65FQ/sNdiAShyWgw9La/pPJ1CKVOEvH29U/KAWBaCQ0dq0PkVopgSfc\",\"keyMaterialType\":\"SYMMETRIC\"},\"status\":\"ENABLED\",\"keyId\":2736465847,\"outputPrefixType\":\"TINK\"}]}"
                },
                "mechanism": {"type": "tink_keyset", "simple_algorithm": "aes-256-siv"}
            },
            "isUpdate": False
        }

    # Attempt to create the cipher key
        resp_create_cipher_tinkOO = session.post(
            f"{base_url}api/{org_id}/cipher_keys", json=payload_tinkOO
        )
        print(resp_create_cipher_tinkOO.content)

        if resp_create_cipher_tinkOO.status_code == 200:
            break  # Exit the loop if the key is created successfully
        elif resp_create_cipher_tinkOO.status_code == 400:
            continue  # Key already exists, try again
        else:
            assert False, f"Unexpected error: {resp_create_cipher_tinkOO.status_code} {resp_create_cipher_tinkOO.content}"

    # Get created cipher key
    resp_get_cipher_tinkOO = session.get(
        f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    )
    print(resp_get_cipher_tinkOO.content)

    assert (
        resp_get_cipher_tinkOO.status_code == 200
    ), f"Expected 200, but got {resp_get_cipher_tinkOO.status_code} {resp_get_cipher_tinkOO.content}"

    # Update created cipher key
    payload_up_tinkOO = {
        "name": cipher_name,
        "key": {
            "store": {
                "type": "local",
                "akeyless": {
                    "base_url": "",
                    "access_id": "",
                    "auth": {
                        "type": "access_key",
                        "access_key": "",
                        "ldap": {"username": "", "password": ""}
                    },
                    "store": {
                        "type": "static_secret",
                        "static_secret": "",
                        "dfc": {"name": "", "iv": "", "encrypted_data": ""}
                    }
                },
                "local": """{
                "primaryKeyId": 2855908267,
                "key": [
                {
                "keyData": {
                "typeUrl": "type.googleapis.com/google.crypto.tink.AesSivKey",
                "value": "EkDTckeHdeuaE1IM+RLq0LnZsfraoIQf0AlkcGNhsPfemV9MVrqsGC9f9ZAuUJDSwbIXzz8+xA0eXFkwsL07B8bR",
                "keyMaterialType": "SYMMETRIC"
                },
                "status": "ENABLED",
                "keyId": 2855908267,
                "outputPrefixType": "TINK"
                 }
                 ]
                }"""
            },
            "mechanism": {"type": "tink_keyset", "simple_algorithm": "aes-256-siv"}
        },
        "isUpdate": True
    }

    # Update the cipher key using the correct URL
    resp_update_cipher_tinkOO = session.put(
        f"{base_url}api/{org_id}/cipher_keys/{cipher_name}", json=payload_up_tinkOO
    )
    print(resp_update_cipher_tinkOO.content)

    assert (
        resp_update_cipher_tinkOO.status_code == 200
    ), f"Expected 200, but got {resp_update_cipher_tinkOO.status_code} {resp_update_cipher_tinkOO.content}"

    time.sleep(10)
    print("Create Cipher Response:", resp_create_cipher_tinkOO.content)
    print("Get Cipher Response:", resp_get_cipher_tinkOO.content)
    print("Update Cipher Response:", resp_update_cipher_tinkOO.content)

    print(f"Trying to decrypt with cipher name: {cipher_name}")

    # Get the cipher key using the correct URL
    resp_tinkOO = session.get(
        f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    )
    print(resp_tinkOO.content)

    # Parse the response JSON
    response_json_tinkOO = resp_tinkOO.json()

    # Check if the response is a dictionary (which it seems to be)
    if isinstance(response_json_tinkOO, dict):
        tinkOO_updated = response_json_tinkOO.get("name", None)
    else:
        raise ValueError("Unexpected response format: Expected a dictionary")


    # Decrypt the data search
      
    print(f"Trying to decrypt with cipher name: {tinkOO_updated}")

    sql_query = f"SELECT decrypt(log, '{tinkOO_updated}') FROM default"
    print(f"SQL Query: {sql_query}")

    # Search Partition decrypted the cipher key
    json_partition = {
            "sql": sql_query,
            "start_time": one_min_ago,
            "end_time": end_time,
            "sql_mode": "full"    
    }

    print("JSON Payload:", json_partition)  # Print the entire JSON payload for debugging

    resp_partition_tinkOO = session.post(f"{base_url}api/{org_id}/_search_partition?type=logs", json=json_partition)

    assert (
    resp_partition_tinkOO.status_code == 200
    ), f"Expected 200, but got {resp_partition_tinkOO.status_code} {resp_partition_tinkOO.content}"


    # Search decrypted the cipher key
    json_search = {
    "query": {
        "sql": sql_query,
        "start_time": one_min_ago,
        "end_time": end_time,
        "sql_mode": "full",
        "from":0,
        "size":100,
        "quick_mode":False,
        "sql_mode":"full"
        },
        "regions":[],
        "clusters":[]
   
    }


    resp_search_tinkOO = session.post(f"{base_url}api/{org_id}/_search?type=logs&search_type=UI&use_cache=true", json=json_search)

    assert (
    resp_search_tinkOO.status_code == 200
    ), f"Expected 200, but got {resp_search_tinkOO.status_code} {resp_search_tinkOO.content}"



    # resp_delete_cipher_tinkOO = session.delete(
    #         f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    #     )
    
    # print(resp_delete_cipher_tinkOO.content)
    
    # assert (
    #         resp_delete_cipher_tinkOO.status_code == 200
    #     ), f"Expected 200, but got {resp_delete_cipher_tinkOO.status_code} {resp_delete_cipher_tinkOO.content}"

    # # Verify deleted cipher key
    # resp_ver_cipher_tinkOO = session.get(
    #     f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    # )
    # print(resp_ver_cipher_tinkOO.content)

    # assert (
    #     resp_ver_cipher_tinkOO.status_code == 404
    # ), f"Expected 404, but got {resp_ver_cipher_tinkOO.status_code} {resp_ver_cipher_tinkOO.content}"

def test_cipher_staticAkeyless(create_session, base_url):
    """Running an E2E test for create, update and delete cipher_keys with static Akeyless cipher."""
    session = create_session
    org_id = "default"

    # Create a unique cipher name
    while True:
        cipher_name = f"s_ak_{random.randint(1000, 9999)}"
        payload_staticAkeyless = {
            "name": cipher_name,
            "key": {
                "store": {
                    "type": "akeyless",
                    "akeyless": {
                        "base_url": akeylessurl,
                        "access_id": akeylessAccessID,
                        "auth": {
                            "type": "access_key",
                            "access_key": akeylessAccessKey,
                            "ldap": {"username": "", "password": ""}
                        },
                        "store": {
                            "type": "static_secret",
                            "static_secret": "SimpleOO",
                            "dfc": {"name": "", "iv": "", "encrypted_data": ""}
                        }
                    },
                    "local": ""
                },
                "mechanism": {"type": "simple", "simple_algorithm": "aes-256-siv"}
            },
            "isUpdate": False
        }

    # Attempt to create the cipher key
        resp_create_cipher_staticAkeyless = session.post(
            f"{base_url}api/{org_id}/cipher_keys", json=payload_staticAkeyless
        )
        print(resp_create_cipher_staticAkeyless.content)

        if resp_create_cipher_staticAkeyless.status_code == 200:
            break  # Exit the loop if the key is created successfully
        elif resp_create_cipher_staticAkeyless.status_code == 400:
            continue  # Key already exists, try again
        else:
            assert False, f"Unexpected error: {resp_create_cipher_staticAkeyless.status_code} {resp_create_cipher_staticAkeyless.content}"

    # Get created cipher key
    resp_get_cipher_staticAkeyless = session.get(
        f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    )
    print(resp_get_cipher_staticAkeyless.content)

    assert (
        resp_get_cipher_staticAkeyless.status_code == 200
    ), f"Expected 200, but got {resp_get_cipher_staticAkeyless.status_code} {resp_get_cipher_staticAkeyless.content}"

    # Update created cipher key
    payload_up_staticAkeyless = {
        "name": cipher_name,
        "key": {
            "store": {
                "type": "akeyless",
                "akeyless": {
                    "base_url": akeylessurl,
                    "access_id": akeylessUpAccessID,
                    "auth": {
                        "type": "access_key",
                        "access_key": akeylessUpAccessKey,
                        "ldap": {"username": "", "password": ""}
                    },
                    "store": {
                        "type": "static_secret",
                        "static_secret": "SimpleUp",
                        "dfc": {"name": "", "iv": "", "encrypted_data": ""}
                    }
                },
                "local": ""
            },
            "mechanism": {"type": "simple", "simple_algorithm": "aes-256-siv"}
        },
        "isUpdate": True
    }

    # Update the cipher key using the correct URL
    resp_update_cipher_staticAkeyless = session.put(
        f"{base_url}api/{org_id}/cipher_keys/{cipher_name}", json=payload_up_staticAkeyless
    )
    print(resp_update_cipher_staticAkeyless.content)

    assert (
        resp_update_cipher_staticAkeyless.status_code == 200
    ), f"Expected 200, but got {resp_update_cipher_staticAkeyless.status_code} {resp_update_cipher_staticAkeyless.content}"



    # resp_delete_cipher_staticAkeyless = session.delete(
    #         f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    #     )
    
    # print(resp_delete_cipher_staticAkeyless.content)
    
    # assert (
    #         resp_delete_cipher_staticAkeyless.status_code == 200
    #     ), f"Expected 200, but got {resp_delete_cipher_staticAkeyless.status_code} {resp_delete_cipher_staticAkeyless.content}"

    # # Verify deleted cipher key
    # resp_ver_cipher_staticAkeyless = session.get(
    #     f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    # )
    # print(resp_ver_cipher_staticAkeyless.content)

    # assert (
    #     resp_ver_cipher_staticAkeyless.status_code == 404
    # ), f"Expected 404, but got {resp_ver_cipher_staticAkeyless.status_code} {resp_ver_cipher_staticAkeyless.content}"


def test_cipher_staticAkeylessTink(create_session, base_url):
    """Running an E2E test for create, update and delete cipher_keys with static Akeyless Tink cipher."""
    session = create_session
    org_id = "default"

    # Create a unique cipher name
    while True:
        cipher_name = f"st_Ak_t{random.randint(1000, 9999)}"
        payload_staticAkeylessTink = {
            "name": cipher_name,
            "key": {
                "store": {
                    "type": "akeyless",
                    "akeyless": {
                        "base_url": akeylessurl,
                        "access_id": akeylessAccessID,
                        "auth": {
                            "type": "access_key",
                            "access_key": akeylessAccessKey,
                            "ldap": {"username": "", "password": ""}
                        },
                        "store": {
                            "type": "static_secret",
                            "static_secret": "Test",
                            "dfc": {"name": "", "iv": "", "encrypted_data": ""}
                        }
                    },
                    "local": ""
                },
                "mechanism": {"type": "tink_keyset", "simple_algorithm": "aes-256-siv"}
            },
            "isUpdate": False
        }

    # Attempt to create the cipher key
        resp_create_cipher_staticAkeylessTink = session.post(
            f"{base_url}api/{org_id}/cipher_keys", json=payload_staticAkeylessTink
        )
        print(resp_create_cipher_staticAkeylessTink.content)

        if resp_create_cipher_staticAkeylessTink.status_code == 200:
            break  # Exit the loop if the key is created successfully
        elif resp_create_cipher_staticAkeylessTink.status_code == 400:
            continue  # Key already exists, try again
        else:
            assert False, f"Unexpected error: {resp_create_cipher_staticAkeylessTink.status_code} {resp_create_cipher_staticAkeylessTink.content}"

    # Get created cipher key
    resp_get_cipher_staticAkeylessTink = session.get(
        f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    )
    print(resp_get_cipher_staticAkeylessTink.content)

    assert (
        resp_get_cipher_staticAkeylessTink.status_code == 200
    ), f"Expected 200, but got {resp_get_cipher_staticAkeylessTink.status_code} {resp_get_cipher_staticAkeylessTink.content}"

    # Update created cipher key
    payload_up_staticAkeylessTink = {
        "name": cipher_name,
        "key": {
            "store": {
                "type": "akeyless",
                "akeyless": {
                    "base_url": akeylessurl,
                    "access_id": akeylessUpAccessID,
                    "auth": {
                        "type": "access_key",
                        "access_key": akeylessUpAccessKey,
                        "ldap": {"username": "", "password": ""}
                    },
                    "store": {
                        "type": "static_secret",
                        "static_secret": "Testj",
                        "dfc": {"name": "", "iv": "", "encrypted_data": ""}
                    }
                },
                "local": ""
            },
            "mechanism": {"type": "tink_keyset", "simple_algorithm": "aes-256-siv"}
        },
        "isUpdate": True
    }

    # Update the cipher key using the correct URL
    resp_update_cipher_staticAkeylessTink = session.put(
        f"{base_url}api/{org_id}/cipher_keys/{cipher_name}", json=payload_up_staticAkeylessTink
    )
    print(resp_update_cipher_staticAkeylessTink.content)

    assert (
        resp_update_cipher_staticAkeylessTink.status_code == 200
    ), f"Expected 200, but got {resp_update_cipher_staticAkeylessTink.status_code} {resp_update_cipher_staticAkeylessTink.content}"



    # resp_delete_cipher_staticAkeylessTink = session.delete(
    #         f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    #     )
    
    # print(resp_delete_cipher_staticAkeylessTink.content)
    
    # assert (
    #         resp_delete_cipher_staticAkeylessTink.status_code == 200
    #     ), f"Expected 200, but got {resp_delete_cipher_staticAkeylessTink.status_code} {resp_delete_cipher_staticAkeylessTink.content}"

    # # Verify deleted cipher key
    # resp_ver_cipher_staticAkeylessTink = session.get(
    #     f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    # )
    # print(resp_ver_cipher_staticAkeylessTink.content)

    # assert (
    #     resp_ver_cipher_staticAkeylessTink.status_code == 404
    # ), f"Expected 404, but got {resp_ver_cipher_staticAkeylessTink.status_code} {resp_ver_cipher_staticAkeylessTink.content}"


def test_cipher_dfcAkeyless(create_session, base_url):
    """Running an E2E test for create, update and delete cipher_keys with DFC Akeyless cipher."""
    session = create_session
    org_id = "default"

    # Create a unique cipher name
    while True:
        cipher_name = f"d_ak_{random.randint(1000, 9999)}"
        payload_dfcAkeyless = {
            "name": cipher_name,
            "key": {
                "store": {
                    "type": "akeyless",
                    "akeyless": {
                        "base_url": akeylessurl,
                        "access_id": akeylessAccessID,
                        "auth": {
                            "type": "access_key",
                            "access_key": akeylessAccessKey,
                            "ldap": {"username": "", "password": ""}
                        },
                        "store": {
                            "type": "dfc",
                            "static_secret": "",
                            "dfc": {"name": "SimpleD", "iv": "", "encrypted_data": "AQAAAAEIA/91MOt1+9F2zKvm7aav7CcMIAJRjiRXWp5nG4KbqByWjqUZIqbtQYtZjs+I0CcftLfoc/Vn/1knPUVXZ+KTv/O4IvnjmMFk6r9zBTaSUEAW/QtO8Ap6RCnGLGVeyh8YS/4ugm3YOwM2G9Xw/FyQWVCbrMD6JN0FetyJ4IPd+11E"}
                        }
                    },
                    "local": ""
                },
                "mechanism": {"type": "simple", "simple_algorithm": "aes-256-siv"}
            },
            "isUpdate": False
        }

    # Attempt to create the cipher key
        resp_create_cipher_dfcAkeyless = session.post(
            f"{base_url}api/{org_id}/cipher_keys", json=payload_dfcAkeyless
        )
        print(resp_create_cipher_dfcAkeyless.content)

        if resp_create_cipher_dfcAkeyless.status_code == 200:
            break  # Exit the loop if the key is created successfully
        elif resp_create_cipher_dfcAkeyless.status_code == 400:
            continue  # Key already exists, try again
        else:
            assert False, f"Unexpected error: {resp_create_cipher_dfcAkeyless.status_code} {resp_create_cipher_dfcAkeyless.content}"

    # Get created cipher key
    resp_get_cipher_dfcAkeyless = session.get(
        f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    )
    print(resp_get_cipher_dfcAkeyless.content)

    assert (
        resp_get_cipher_dfcAkeyless.status_code == 200
    ), f"Expected 200, but got {resp_get_cipher_dfcAkeyless.status_code} {resp_get_cipher_dfcAkeyless.content}"

    # Update created cipher key
    payload_up_dfcAkeyless = {
        "name": cipher_name,
        "key": {
            "store": {
                "type": "akeyless",
                "akeyless": {
                    "base_url": akeylessurl,
                    "access_id": akeylessUpAccessID,
                    "auth": {
                        "type": "access_key",
                        "access_key": akeylessUpAccessKey,
                        "ldap": {"username": "", "password": ""}
                    },
                    "store": {
                        "type": "dfc",
                        "static_secret": "",
                        "dfc": {"name": "SimpleUpdatedDFC", "iv": "", "encrypted_data": "AQAAAAEIAbJfEaOmJpfW+2SUcfjA1sNItdO03NbtFGY+R2wMWVndCSh61yUrauCW+7KX8L1m5PZX538Yk1ME8olTCb5lauz01jJzMa8eI5fWtTMcR8GMN5NqW6/Cm6xODSWr3n6rpPaMChNDPdj6Ek+5mLjFQhsyz7Dp17fGMC7bSbA="}
                    }
                },
                "local": ""
            },
            "mechanism": {"type": "simple", "simple_algorithm": "aes-256-siv"}
        },
        "isUpdate": True
    }

    # Update the cipher key using the correct URL
    resp_update_cipher_dfcAkeyless = session.put(
        f"{base_url}api/{org_id}/cipher_keys/{cipher_name}", json=payload_up_dfcAkeyless
    )
    print(resp_update_cipher_dfcAkeyless.content)

    assert (
        resp_update_cipher_dfcAkeyless.status_code == 200
    ), f"Expected 200, but got {resp_update_cipher_dfcAkeyless.status_code} {resp_update_cipher_dfcAkeyless.content}"



    # resp_delete_cipher_dfcAkeyless = session.delete(
    #         f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    #     )
    
    # print(resp_delete_cipher_dfcAkeyless.content)
    
    # assert (
    #         resp_delete_cipher_dfcAkeyless.status_code == 200
    #     ), f"Expected 200, but got {resp_delete_cipher_dfcAkeyless.status_code} {resp_delete_cipher_dfcAkeyless.content}"

    # # Verify deleted cipher key
    # resp_ver_cipher_dfcAkeyless = session.get(
    #     f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    # )
    # print(resp_ver_cipher_dfcAkeyless.content)

    # assert (
    #     resp_ver_cipher_dfcAkeyless.status_code == 404
    # ), f"Expected 404, but got {resp_ver_cipher_dfcAkeyless.status_code} {resp_ver_cipher_dfcAkeyless.content}"

def test_cipher_dfcAkeylessTink(create_session, base_url):
    """Running an E2E test for create, update and delete cipher_keys with DFC Akeyless Tink cipher."""
    session = create_session
    org_id = "default"

    # Create a unique cipher name
    while True:
        cipher_name = f"d_Ak_t{random.randint(1000, 9999)}"
        payload_dfcAkeylessTink = {
            "name": cipher_name,
            "key": {
                "store": {
                    "type": "akeyless",
                    "akeyless": {
                        "base_url": akeylessurl,
                        "access_id": akeylessAccessID,
                        "auth": {
                            "type": "access_key",
                            "access_key": akeylessAccessKey,
                            "ldap": {"username": "", "password": ""}
                        },
                        "store": {
                            "type": "dfc",
                            "static_secret": "",
                            "dfc": {"name": "tinkdfc", "iv": "", "encrypted_data": "AQAAAAEIAXHhRTxldOCOdVHsr4KT8U4whBeTiU/fiBZNQrdB4EnkSz8veFm2zpxxghemMW7cTq38nxKFwmwwMQ/Q+uc/f+GgN6lJdmLYw5copxgrLaOxGy8suEll//mKDwVRp79LiL8SEn5/tOuqGTM7QNPQFiOaPbGm2VjGMV+p0laIf05/fkQVKhLB1zxZQU0aUHpbbise0m0Ew/0m5+i9QRuA4yxM35X30J79nY3WohP4B6zcGBYGSdqZ2aRJqY+CW27Uso4/5wZ0wM1OOMB0NFJ8b3kwZgF5AKOaD/v1dSjrwOiEJeCb1eqqoSMu+9Uh+GRmqHf6IiC70wYwb1RGHDk8G0o2ESEXSbht3eQUEIdl0JUfyDSKe11a81VkIka3BNx/X0Sl/P2W6Bh8i2hrsxDQSzJ/2pErqDak3r8Vc3COQZU6pix8EyBmU3af72Z+jKRv4epZaQ=="}
                        }
                    },
                    "local": ""
                },
                "mechanism": {"type": "tink_keyset", "simple_algorithm": "aes-256-siv"}
            },
            "isUpdate": False
        }

    # Attempt to create the cipher key
        resp_create_cipher_dfcAkeylessTink = session.post(
            f"{base_url}api/{org_id}/cipher_keys", json=payload_dfcAkeylessTink
        )
        print(resp_create_cipher_dfcAkeylessTink.content)

        if resp_create_cipher_dfcAkeylessTink.status_code == 200:
            break  # Exit the loop if the key is created successfully
        elif resp_create_cipher_dfcAkeylessTink.status_code == 400:
            continue  # Key already exists, try again
        else:
            assert False, f"Unexpected error: {resp_create_cipher_dfcAkeylessTink.status_code} {resp_create_cipher_dfcAkeylessTink.content}"

    # Get created cipher key
    resp_get_cipher_dfcAkeylessTink = session.get(
        f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    )
    print(resp_get_cipher_dfcAkeylessTink.content)

    assert (
        resp_get_cipher_dfcAkeylessTink.status_code == 200
    ), f"Expected 200, but got {resp_get_cipher_dfcAkeylessTink.status_code} {resp_get_cipher_dfcAkeylessTink.content}"

    # Update created cipher key
    payload_up_dfcAkeylessTink = {
        "name": cipher_name,
        "key": {
            "store": {
                "type": "akeyless",
                "akeyless": {
                    "base_url": akeylessurl,
                    "access_id": akeylessUpAccessID,
                    "auth": {
                        "type": "access_key",
                        "access_key": akeylessUpAccessKey,
                        "ldap": {"username": "", "password": ""}
                    },
                    "store": {
                        "type": "dfc",
                        "static_secret": "",
                        "dfc": {"name": "tinkUpDFC", "iv": "", "encrypted_data": "AQAAAAEIAYJ44b2lLPUHw8RwCfILD9wr/u6xDvBN7yaO65c0iUcJpxB4kepFpOq1ehqmxsZIyeeqy+n9CZXRqub6tTd1J33nxqP0LOi6n/pZT4fu2OcOE55ikgQRCxaRonwSF4GowD/49RphA8YqCjlAePRLa6xWbnOntfgkWQ+wZ1+dlAePIrY2sH43wREvMG301C+bTYgl8KnlPtf0hDqFt1CAj3/Mzd2XNEWxE+lLax6nNS+SVM2kz3DyE7kNgoropH/+rfAxUFyckDBgIQf32ud62LZhA3qaXvKowgmrxlSKPxmEiJ7hJgmJYWGcyf2EqZHcPjKXvP19lyYU64lNsRMDjna63YtrO8bsrnj6qdFWGKuUIdmOZq9pdnH50c9TpCE3CcmiBnpVOZd2jevIPe1Cn4G4ws35weNDbACDAPe7WODRUWjaWFJD1U/zRZ/Exc8mFFSvJA=="}
                    }
                },
                "local": ""
            },
            "mechanism": {"type": "tink_keyset", "simple_algorithm": "aes-256-siv"}
        },
        "isUpdate": True
    }

    # Update the cipher key using the correct URL
    resp_update_cipher_dfcAkeylessTink = session.put(
        f"{base_url}api/{org_id}/cipher_keys/{cipher_name}", json=payload_up_dfcAkeylessTink
    )
    print(resp_update_cipher_dfcAkeylessTink.content)

    assert (
        resp_update_cipher_dfcAkeylessTink.status_code == 200
    ), f"Expected 200, but got {resp_update_cipher_dfcAkeylessTink.status_code} {resp_update_cipher_dfcAkeylessTink.content}"



    # resp_delete_cipher_dfcAkeylessTink = session.delete(
    #         f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    #     )
    
    # print(resp_delete_cipher_dfcAkeylessTink.content)
    
    # assert (
    #         resp_delete_cipher_dfcAkeylessTink.status_code == 200
    #     ), f"Expected 200, but got {resp_delete_cipher_dfcAkeylessTink.status_code} {resp_delete_cipher_dfcAkeylessTink.content}"

    # # Verify deleted cipher key
    # resp_ver_cipher_dfcAkeylessTink = session.get(
    #     f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    # )
    # print(resp_ver_cipher_dfcAkeylessTink.content)

    # assert (
    #     resp_ver_cipher_dfcAkeylessTink.status_code == 404
    # ), f"Expected 404, but got {resp_ver_cipher_dfcAkeylessTink.status_code} {resp_ver_cipher_dfcAkeylessTink.content}"

