import tink
import base64
import random
import json
import os
from tink import daead
from tink import secret_key_access
from pathlib import Path

# root directory of the project
root_dir = Path(__file__).parent.parent.parent


# number of total log entries to be ingested
LOG_COUNT = 1000
# keyset json. For simple type key, you still need to give the tink json from which you generated the key
KS = r"""{"primaryKeyId":2939429116,"key":[{"keyData":{"typeUrl":"type.googleapis.com/google.crypto.tink.AesSivKey","value":"EkDqH9D86ii0QPF8EBhcZI1PkBKKdDGMPDS2wFITqqfjQ77RQbDROhhAXI8m5qUcYNbflns8Xo//BORbgtX0msbf","keyMaterialType":"SYMMETRIC"},"status":"ENABLED","keyId":2939429116,"outputPrefixType":"TINK"}]}"""

# openobserve base url
BASE_URL = os.environ["ZO_BASE_URL"]


# values can be tink or simple, depending on the key you are using in OO
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
  return base64.b64encode(ciphertext[5:]).decode('utf-8')

# uses tink lib to encrypt
def encrypt_tink(s):
  keyset_handle = tink.json_proto_keyset_format.parse(
    KS, secret_key_access.TOKEN
  )
  primitive = keyset_handle.primitive(daead.DeterministicAead)
  ciphertext = primitive.encrypt_deterministically(bytes(s,'utf-8'), b'')
  return base64.b64encode(ciphertext).decode('utf-8')

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
    return resp.status_code == 200

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
        cipher_name = f"cipher_{random.randint(1000, 9999)}"
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
                    "local": "GNf6McCq0Sm7LCrnnPr4ge+6TG4V1XOGRqXW8m7s5cL50xq4oQEQFDFHevng2UQ8LYUnqwZDPCivlpenqJtpMw=="
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
                "local": "6h/Q/OootEDxfBAYXGSNT5ASinQxjDw0tsBSE6qn40O+0UGw0ToYQFyPJualHGDW35Z7PF6P/wTkW4LV9JrG3w=="
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



    resp_delete_cipher_simpleOO = session.delete(
            f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
        )
    
    print(resp_delete_cipher_simpleOO.content)
    
    assert (
            resp_delete_cipher_simpleOO.status_code == 200
        ), f"Expected 200, but got {resp_delete_cipher_simpleOO.status_code} {resp_delete_cipher_simpleOO.content}"

    # Verify deleted cipher key
    resp_ver_cipher_simpleOO = session.get(
        f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    )
    print(resp_ver_cipher_simpleOO.content)

    assert (
        resp_ver_cipher_simpleOO.status_code == 404
    ), f"Expected 404, but got {resp_ver_cipher_simpleOO.status_code} {resp_ver_cipher_simpleOO.content}"


def test_cipher_tinkOO(create_session, base_url):
    """Running an E2E test for create, update and delete cipher_key with Tink OO cipher."""
    session = create_session
    org_id = "default"

    # Create a unique cipher name
    while True:
        cipher_name = f"cipher_{random.randint(1000, 9999)}"
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



    resp_delete_cipher_tinkOO = session.delete(
            f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
        )
    
    print(resp_delete_cipher_tinkOO.content)
    
    assert (
            resp_delete_cipher_tinkOO.status_code == 200
        ), f"Expected 200, but got {resp_delete_cipher_tinkOO.status_code} {resp_delete_cipher_tinkOO.content}"

    # Verify deleted cipher key
    resp_ver_cipher_tinkOO = session.get(
        f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    )
    print(resp_ver_cipher_tinkOO.content)

    assert (
        resp_ver_cipher_tinkOO.status_code == 404
    ), f"Expected 404, but got {resp_ver_cipher_tinkOO.status_code} {resp_ver_cipher_tinkOO.content}"

def test_cipher_staticAkeyless(create_session, base_url):
    """Running an E2E test for create, update and delete cipher_keys with static Akeyless cipher."""
    session = create_session
    org_id = "default"

    # Create a unique cipher name
    while True:
        cipher_name = f"cipher_{random.randint(1000, 9999)}"
        payload_staticAkeyless = {
            "name": cipher_name,
            "key": {
                "store": {
                    "type": "akeyless",
                    "akeyless": {
                        "base_url": "https://api.akeyless.io",
                        "access_id": "p-c7k3ogiwk1z9am",
                        "auth": {
                            "type": "access_key",
                            "access_key": "tT5/Q0SrSyL80E3g7tU7PSymsG2m24s3EaYiCRl5VFc=",
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
                    "base_url": "https://api.akeyless.io",
                    "access_id": "p-************am",
                    "auth": {
                        "type": "access_key",
                        "access_key": "tT5/Q**********************************5VFc=",
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



    resp_delete_cipher_staticAkeyless = session.delete(
            f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
        )
    
    print(resp_delete_cipher_staticAkeyless.content)
    
    assert (
            resp_delete_cipher_staticAkeyless.status_code == 200
        ), f"Expected 200, but got {resp_delete_cipher_staticAkeyless.status_code} {resp_delete_cipher_staticAkeyless.content}"

    # Verify deleted cipher key
    resp_ver_cipher_staticAkeyless = session.get(
        f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    )
    print(resp_ver_cipher_staticAkeyless.content)

    assert (
        resp_ver_cipher_staticAkeyless.status_code == 404
    ), f"Expected 404, but got {resp_ver_cipher_staticAkeyless.status_code} {resp_ver_cipher_staticAkeyless.content}"


def test_cipher_staticAkeylessTink(create_session, base_url):
    """Running an E2E test for create, update and delete cipher_keys with static Akeyless Tink cipher."""
    session = create_session
    org_id = "default"

    # Create a unique cipher name
    while True:
        cipher_name = f"cipher_{random.randint(1000, 9999)}"
        payload_staticAkeylessTink = {
            "name": cipher_name,
            "key": {
                "store": {
                    "type": "akeyless",
                    "akeyless": {
                        "base_url": "https://api.akeyless.io",
                        "access_id": "p-c7k3ogiwk1z9am",
                        "auth": {
                            "type": "access_key",
                            "access_key": "tT5/Q0SrSyL80E3g7tU7PSymsG2m24s3EaYiCRl5VFc=",
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
                    "base_url": "https://api.akeyless.io",
                    "access_id": "p-************am",
                    "auth": {
                        "type": "access_key",
                        "access_key": "tT5/Q**********************************5VFc=",
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



    resp_delete_cipher_staticAkeylessTink = session.delete(
            f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
        )
    
    print(resp_delete_cipher_staticAkeylessTink.content)
    
    assert (
            resp_delete_cipher_staticAkeylessTink.status_code == 200
        ), f"Expected 200, but got {resp_delete_cipher_staticAkeylessTink.status_code} {resp_delete_cipher_staticAkeylessTink.content}"

    # Verify deleted cipher key
    resp_ver_cipher_staticAkeylessTink = session.get(
        f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    )
    print(resp_ver_cipher_staticAkeylessTink.content)

    assert (
        resp_ver_cipher_staticAkeylessTink.status_code == 404
    ), f"Expected 404, but got {resp_ver_cipher_staticAkeylessTink.status_code} {resp_ver_cipher_staticAkeylessTink.content}"



