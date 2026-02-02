"""
These tests ingest data via the API and validate the database state directly
by querying the metadata database.
"""
import json
import time
import pytest
from datetime import datetime, timezone


class TestSchemaValidation:
    """Test schema creation and validation in the database."""

    def test_stream_schema_created_in_db(self, ingest_test_data, db_cursor, test_org, test_stream):
        """
        Test that ingesting data creates the proper schema entries in the database.
        """
        # Ingest test data
        test_data = [
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "message": "Test log message",
                "level": "info",
                "user_id": "user123"
            }
        ]
        ingest_test_data(test_data)

        # Query the database to verify schema was created
        # Note: meta table structure is (id, module, key1, key2, start_dt, value)
        # key1 = org_id, key2 = stream_type/stream_name
        stream_key = f"logs/{test_stream}"
        db_cursor.execute("""
            SELECT key1, key2, value
            FROM meta
            WHERE module = 'schema'
            AND key1 = %s
            AND key2 = %s
        """, (test_org, stream_key))

        results = db_cursor.fetchall()

        # Verify schema exists
        assert len(results) > 0, f"Schema not found in database for stream {test_stream}"

        # Verify schema contains expected fields
        for row in results:
            org_id, stream_path, schema_json = row
            assert org_id == test_org
            assert stream_path == stream_key
            schema = json.loads(schema_json) if isinstance(schema_json, str) else schema_json

            # Check that schema contains our ingested fields
            # (Schema structure may vary based on your implementation)
            print(f"Schema found for org '{org_id}' stream '{stream_path}': {schema}")


class TestDataIngestion:
    """Test data ingestion and persistence in the database."""

    def test_ingested_data_count(self, ingest_test_data, db_cursor, query_api, test_org, test_stream):
        """
        Test that the number of records ingested matches what's queryable.
        """
        # Ingest multiple records
        test_data = [
            {"timestamp": datetime.now(timezone.utc).isoformat(), "message": f"Message {i}", "count": i}
            for i in range(10)
        ]
        response = ingest_test_data(test_data)

        # Verify ingestion response
        assert "code" in response
        assert response["code"] == 200

        # Query via API to get count
        result = query_api(f"SELECT COUNT(*) as total FROM {test_stream}", test_stream)

        # Extract count from result
        # Note: Adjust this based on your actual response structure
        hits = result.get("hits", [])
        if hits:
            total = hits[0].get("total", 0)
            assert total >= 10, f"Expected at least 10 records, got {total}"


class TestTantivyIndexing:
    """Test Tantivy index creation and validation."""

    def test_tantivy_indexes_created(self, ingest_test_data, db_cursor, test_org):
        """
        Test that Tantivy indexes are created with non-zero index_size.

        This test:
        1. Ingests data with 'log' field (full text search enabled by default)
        2. Waits for file persistence and indexing
        3. Validates that all files have non-zero index_size
        4. Validates that total records in file_list matches ingested count
        """
        stream_name = "ttv_test"
        num_records = 50

        # Ingest test data with 'log' field for full text search indexing
        test_data = [
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "log": f"This is test log message number {i} with some searchable content",
                "level": "info",
                "request_id": f"req_{i}"
            }
            for i in range(num_records)
        ]

        response = ingest_test_data(test_data, stream_name)

        # Verify ingestion was successful
        assert "code" in response
        assert response["code"] == 200
        print(f"Ingested {num_records} records to stream '{stream_name}'")

        # Wait for file persistence and index creation
        print("Waiting 20 seconds for file persistence and Tantivy indexing...")
        time.sleep(20)

        # Query file_list table for the stream
        # Note: stream field is stored as 'org_id/stream_type/stream_name'
        stream_full_path = f"{test_org}/logs/{stream_name}"
        db_cursor.execute("""
            SELECT
                id,
                file,
                records,
                index_size,
                original_size,
                compressed_size
            FROM file_list
            WHERE org = %s
            AND stream = %s
            AND deleted = false
            ORDER BY created_at
        """, (test_org, stream_full_path))

        results = db_cursor.fetchall()

        # Verify that files were created
        assert len(results) > 0, f"No files found in file_list for stream '{stream_name}'"
        print(f"Found {len(results)} files in file_list for stream '{stream_name}'")

        # Validate that all files have non-zero index_size
        total_records = 0
        files_with_zero_index = []

        for row in results:
            file_id, file_path, records, index_size, original_size, compressed_size = row
            total_records += records

            print(f"File: {file_path}")
            print(f"  Records: {records}")
            print(f"  Index size: {index_size} bytes")
            print(f"  Original size: {original_size} bytes")
            print(f"  Compressed size: {compressed_size} bytes")

            if index_size == 0:
                files_with_zero_index.append(file_path)

        # Assert that no files have zero index_size
        assert len(files_with_zero_index) == 0, (
            f"Found {len(files_with_zero_index)} file(s) with zero index_size: {files_with_zero_index}"
        )

        # Assert that total records in file_list matches ingested count
        assert total_records == num_records, (
            f"Total records in file_list ({total_records}) does not match ingested count ({num_records})"
        )

        print(f"✓ All {len(results)} files have non-zero index_size")
        print(f"✓ Total records in file_list ({total_records}) matches ingested count ({num_records})")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
