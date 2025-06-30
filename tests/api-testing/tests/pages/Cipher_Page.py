import os
import random
import json
import time
from requests.auth import HTTPBasicAuth



simpleKeys = os.environ["SIMPLE_KEYS"]
simpleKeysUp = os.environ["SIMPLE_KEYS_UP"]

# Retrieve the primary key ID 
primary_key_id_tink = os.environ.get("PRIMARY_KEY_ID", 0)  # Default to 0 if not set
primary_key_id_tink_val = os.environ["PRIMARY_KEY_ID_VAL"]   
primary_key_id_tink_up = os.environ.get("PRIMARY_KEY_ID_UP", 0)  # Default to 0 if not set
primary_key_id_tink_val_up = os.environ["PRIMARY_KEY_ID_VAL_UP"]   


class CipherPage:
    # Make Unique_value_cipher a class variable
    Unique_value_cipher = f"uCipher_{random.randint(100000, 999999)}"

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id




    def create_cipher_simpleOO(self, session, base_url, USER_EMAIL, USER_PASSWORD, org_id, cipher_name_simpleOO):
        """Running an E2E test for creating cipher_keys with simple OO cipher."""
        session.auth = HTTPBasicAuth(USER_EMAIL, USER_PASSWORD) 
        # Create a unique cipher name
        while True:
            payload_simpleOO = {
                "name": cipher_name_simpleOO,
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

            if resp_create_cipher_simpleOO.status_code == 200:
                break  # Exit the loop if the key is created successfully
            elif resp_create_cipher_simpleOO.status_code == 400:
                continue  # Key already exists, try again
            else:
                raise AssertionError(f"Unexpected error: {resp_create_cipher_simpleOO.status_code} {resp_create_cipher_simpleOO.content}")

    def create_cipher_tinkOO(self, session, base_url, USER_EMAIL, USER_PASSWORD, org_id, cipher_name_tinkOO):
        """Running an E2E test for create cipher_key with Tink OO cipher.""" 
        session.auth = HTTPBasicAuth(USER_EMAIL, USER_PASSWORD) 
        # Create a unique cipher name
        while True:
            payload_tinkOO = {
                "name": cipher_name_tinkOO,
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
                    "local": json.dumps({  # Use json.dumps to create a valid JSON string
                    "primaryKeyId": int(primary_key_id_tink),  # Ensure this is an integer
                    "key": [
                        {
                            "keyData": {
                                "typeUrl": "type.googleapis.com/google.crypto.tink.AesSivKey",
                                "value": primary_key_id_tink_val,
                                "keyMaterialType": "SYMMETRIC"
                            },
                            "status": "ENABLED",
                            "keyId": int(primary_key_id_tink),  # Ensure this is an integer
                            "outputPrefixType": "TINK"
                        }
                    ]
                })
                },
                    "mechanism": {"type": "tink_keyset", "simple_algorithm": "aes-256-siv"}
                },
                "isUpdate": False
            }

        # Attempt to create the cipher key
            resp_create_cipher_tinkOO = session.post(
                f"{base_url}api/{org_id}/cipher_keys", json=payload_tinkOO
            )


            if resp_create_cipher_tinkOO.status_code == 200:
                break  # Exit the loop if the key is created successfully
            elif resp_create_cipher_tinkOO.status_code == 400:
                continue  # Key already exists, try again
            else:
                raise AssertionError(f"Unexpected error: {resp_create_cipher_tinkOO.status_code} {resp_create_cipher_tinkOO.content}")


    def retrieve_cipherKeys_simpleOO(self, session, base_url, USER_EMAIL, USER_PASSWORD, org_id):
        """Retrieve a cipher key."""
        session.auth = HTTPBasicAuth(USER_EMAIL, USER_PASSWORD) 
        response = session.get(f"{base_url}api/{org_id}/cipher_keys")
        assert response.status_code == 200, f"Failed to retrieve cipher key: {response.content}"

        cipher_keys = response.json().get("keys", [])

        # Assert that the response contains keys
        assert len(cipher_keys) > 0, "No cipher keys found"

        # Filter keys that start with "sim_ABC"
        sim_keys = [key for key in cipher_keys if key['name'].startswith(f"sim_{CipherPage.Unique_value_cipher}")]

        # Assert that there are keys starting with "sim_ABC"
        assert len(sim_keys) > 0, f"No keys found starting with 'sim_{CipherPage.Unique_value_cipher}'"



        # Return the filtered keys and the first key's name
        return {
            "count": len(sim_keys),
            "keys": sim_keys
        }

    def retrieve_cipher_simpleOO(self, session, base_url, USER_EMAIL, USER_PASSWORD, org_id, cipher_name_simpleOO):
        """Retrieve a cipher key and assert local value starts with 'GNf6Mc'."""
        session.auth = HTTPBasicAuth(USER_EMAIL, USER_PASSWORD) 
        response = session.get(f"{base_url}api/{org_id}/cipher_keys/{cipher_name_simpleOO}")
        assert response.status_code == 200, f"Failed to retrieve cipher key: {response.content}"

        cipher_key = response.json()

        # Assert that the response contains the expected structure
        assert "key" in cipher_key, "Key not found in response"
        assert "store" in cipher_key["key"], "Store not found in key"
        assert "local" in cipher_key["key"]["store"], "Local not found in store"

        # Extract the local value
        local_value = cipher_key["key"]["store"]["local"]


        # Return the cipher key and local value for further use
        return {
            "name": cipher_key["name"],
            "local": local_value
        }




    def retrieve_cipherKeys_tinkOO(self, session, base_url, USER_EMAIL, USER_PASSWORD, org_id):
        """Retrieve Tink cipher keys that start with a specific prefix."""
        session.auth = HTTPBasicAuth(USER_EMAIL, USER_PASSWORD) 
        response = session.get(f"{base_url}api/{org_id}/cipher_keys")
        assert response.status_code == 200, f"Failed to retrieve cipher keys: {response.content}"

        # Parse the JSON response
        cipher_keys = response.json().get("keys", [])

        # Assert that the response contains keys
        assert len(cipher_keys) > 0, "No cipher keys found"

        # Filter keys that start with "tink_ABC"
        tink_keys = [key for key in cipher_keys if key['name'].startswith(f"tink_{CipherPage.Unique_value_cipher}")]

        # Assert that there are keys starting with "tink_ABC"
        assert len(tink_keys) > 0, f"No keys found starting with 'tink_{CipherPage.Unique_value_cipher}'"



        # Return the cipher key name and local JSON for further use
        return {
            "count": len(tink_keys),
            "keys": tink_keys
        }



    def retrieve_cipher_tinkOO(self, session, base_url, USER_EMAIL, USER_PASSWORD, org_id, cipher_name_tinkOO):
        """Retrieve a Tink cipher key and assert that the local field contains the expected string format for primaryKeyId."""
        session.auth = HTTPBasicAuth(USER_EMAIL, USER_PASSWORD) 
        response = session.get(f"{base_url}api/{org_id}/cipher_keys/{cipher_name_tinkOO}")
        assert response.status_code == 200, f"Failed to retrieve cipher key: {response.content}"

        cipher_key = response.json()

        # Assert that the response contains the expected structure
        assert "key" in cipher_key, "Key not found in response"
        assert "store" in cipher_key["key"], "Store not found in key"
        assert "local" in cipher_key["key"]["store"], "Local not found in store"

        # Extract the local value
        local_value = cipher_key["key"]["store"]["local"]


        # Check for the expected string format
        expected_string = '"primaryKeyId": '
        if expected_string not in local_value:
            raise AssertionError(f"Expected string '{expected_string}' not found in local value: {local_value}")

        # Extract primaryKeyId from the local_value string
        try:
            # Find the start position of the primaryKeyId
            start_index = local_value.index(expected_string) + len(expected_string)
            end_index = local_value.index(',', start_index) if ',' in local_value[start_index:] else local_value.index('}', start_index)
            primary_key_id = local_value[start_index:end_index].strip()

        except ValueError as e:
            raise AssertionError(f"Could not extract primaryKeyId from local value: {local_value}. Error: {str(e)}")

        # Return the cipher key name and the extracted primaryKeyId
        return {
            "name": cipher_key["name"],
            "primaryKeyId": primary_key_id  # Return the extracted primaryKeyId
        }

    def update_cipher_simpleOO(self, session, base_url, USER_EMAIL, USER_PASSWORD, org_id, cipher_name_simpleOO):
        """Running an E2E test for updating cipher_keys with simple OO cipher."""
        session.auth = HTTPBasicAuth(USER_EMAIL, USER_PASSWORD) 
        # Create a unique cipher name
        while True:
            payload_up_simpleOO = {
                "name": cipher_name_simpleOO,
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

        # Attempt to update the cipher key
            resp_update_cipher_simpleOO = session.put(
                f"{base_url}api/{org_id}/cipher_keys/{cipher_name_simpleOO}", json=payload_up_simpleOO
        )

            if resp_update_cipher_simpleOO.status_code == 200:
                break  # Exit the loop if the key is created successfully
            elif resp_update_cipher_simpleOO.status_code == 400:
                continue  # Key already exists, try again
            else:
                raise AssertionError(f"Unexpected error: {resp_update_cipher_simpleOO.status_code} {resp_update_cipher_simpleOO.content}")

    def update_cipher_tinkOO(self, session, base_url, USER_EMAIL, USER_PASSWORD, org_id, cipher_name_tinkOO):
        """Running an E2E test for updating cipher_keys with Tink OO cipher."""
        session.auth = HTTPBasicAuth(USER_EMAIL, USER_PASSWORD) 
        # Create a unique cipher name
        payload_up_tinkOO = {
            "name": cipher_name_tinkOO,
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
                    "local": json.dumps({  # Use json.dumps to create a valid JSON string
                    "primaryKeyId": int(primary_key_id_tink_up),  # Ensure this is an integer
                    "key": [
                        {
                            "keyData": {
                                "typeUrl": "type.googleapis.com/google.crypto.tink.AesSivKey",
                                "value": primary_key_id_tink_val_up,
                                "keyMaterialType": "SYMMETRIC"
                            },
                            "status": "ENABLED",
                            "keyId": int(primary_key_id_tink_up),  # Ensure this is an integer
                            "outputPrefixType": "TINK"
                        }
                    ]
                })
                },
                "mechanism": {"type": "tink_keyset", "simple_algorithm": "aes-256-siv"}
            },
            "isUpdate": True
        }

        # Update the cipher key using the correct URL
        resp_update_cipher_tinkOO = session.put(
            f"{base_url}api/{org_id}/cipher_keys/{cipher_name_tinkOO}", json=payload_up_tinkOO
        )

        assert (
            resp_update_cipher_tinkOO.status_code == 200
        ), f"Expected 200, but got {resp_update_cipher_tinkOO.status_code} {resp_update_cipher_tinkOO.content}"

        return resp_update_cipher_tinkOO


    def delete_cipher(self, session, base_url, USER_EMAIL, USER_PASSWORD, org_id, cipher_name):
        """Running an E2E test for deleting cipher_keys with cipher type."""
        session.auth = HTTPBasicAuth(USER_EMAIL, USER_PASSWORD) 

        resp_delete_cipher = session.delete(f"{base_url}api/{org_id}/cipher_keys/{cipher_name}")
        assert resp_delete_cipher.status_code == 200, f"Failed to delete {cipher_name}: {resp_delete_cipher.content}"

            # Wait for a few seconds to allow the data to be ingested
        time.sleep(10)  # Increase this time if necessary

            # Verify deletion
        resp_ver_cipher = session.get(f"{base_url}api/{org_id}/cipher_keys/{cipher_name}")
        assert resp_ver_cipher.status_code == 404, f"Expected 404 for {cipher_name}, but got {resp_ver_cipher.status_code}"

        return resp_ver_cipher  # Return the list of deleted cipher keys for verification if needed


    def validate_deleted_cipher_simpleOO(self, session, base_url, USER_EMAIL, USER_PASSWORD, org_id, cipher_name_simpleOO): 
        """Running an E2E test for validating deleted cipher in SC."""
        session.auth = HTTPBasicAuth(USER_EMAIL, USER_PASSWORD)         
        # Retrieve all cipher keys
        response = session.get(f"{base_url}api/{org_id}/cipher_keys")
        assert response.status_code == 200, f"Failed to retrieve cipher keys: {response.content}"

        cipher_keys = response.json().get("keys", [])

        # Filter keys that start with "sim_u_659404"
        cipher_type_keys = [key for key in cipher_keys if key['name'].startswith(f"sim_{CipherPage.Unique_value_cipher}")]

        # Check if any sim keys exist
        if len(cipher_type_keys) == 0:
            print(f"No keys found of {cipher_name_simpleOO}")
            # Optionally, you can choose to skip the assertion or handle it differently
        else:
            assert len(cipher_type_keys) > 0, f"keys found of {cipher_name_simpleOO}"
            print(f"Keys found of {cipher_name_simpleOO}")

        return cipher_type_keys

    def validate_deleted_cipher_tinkOO(self, session, base_url, USER_EMAIL, USER_PASSWORD, org_id, cipher_name_tinkOO): 
        """Running an E2E test for validating deleted cipher in SC."""
        session.auth = HTTPBasicAuth(USER_EMAIL, USER_PASSWORD)         
        # Retrieve all cipher keys
        response = session.get(f"{base_url}api/{org_id}/cipher_keys")
        assert response.status_code == 200, f"Failed to retrieve cipher keys: {response.content}"

        cipher_keys = response.json().get("keys", [])

        # Filter keys that start with "sim_u_659404"
        cipher_type_keys = [key for key in cipher_keys if key['name'].startswith(f"tink_{CipherPage.Unique_value_cipher}")]

        # Check if any sim keys exist
        if len(cipher_type_keys) == 0:
            print(f"No keys found of {cipher_name_tinkOO}")
            # Optionally, you can choose to skip the assertion or handle it differently
        else:
            assert len(cipher_type_keys) > 0, f"keys found of {cipher_name_tinkOO}"
            print(f"Keys found of {cipher_name_tinkOO}")

        return cipher_type_keys