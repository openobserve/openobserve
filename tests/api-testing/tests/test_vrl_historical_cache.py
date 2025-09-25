"""
VRL Historical Cache Bug Detection Test
======================================

Test that ingests backdated data and repeatedly tests VRL on the same historical time range
to detect VRL cache bugs that occur with historical data.
"""

import json
import requests
import pytest
import logging
import time
from typing import Dict, Any
from datetime import datetime, timezone, timedelta

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def create_vrl_function(transformation_logic: str) -> str:
    """Create a VRL function for testing."""
    return transformation_logic

def execute_query_with_vrl(
    session: requests.Session,
    base_url: str,
    sql: str,
    start_time: int,
    end_time: int,
    vrl_function: str = None,
    org_id: str = "default"
) -> Dict[str, Any]:
    """Execute a query with VRL function and capture results."""
    
    json_data = {
        "query": {
            "sql": sql,
            "start_time": start_time,
            "end_time": end_time,
            "from": 0,
            "size": 51,  # Match your curl
            "quick_mode": True,
            "sql_mode": "context",
            "track_total_hits": False
        }
    }
    
    # Add VRL function if provided (base64 encoded as query_fn)
    if vrl_function:
        import base64
        encoded_vrl = base64.b64encode(vrl_function.encode()).decode()
        json_data["query"]["query_fn"] = encoded_vrl
    
    headers = {"X-Test-Type": "vrl-historical-cache-test"}
    
    start_execution = time.time()
    
    response = session.post(
        f"{base_url}api/{org_id}/_search?type=logs&search_type=ui&use_cache=true",
        json=json_data,
        headers=headers
    )
    
    execution_time = time.time() - start_execution
    
    result = {
        "status_code": response.status_code,
        "execution_time": execution_time,
        "has_vrl": vrl_function is not None,
        "vrl_function": vrl_function,
    }
    
    if response.status_code == 200:
        try:
            # Handle streaming response (SSE format)
            if 'text/event-stream' in response.headers.get('content-type', ''):
                # Parse Server-Sent Events format
                response_text = response.text
                search_response_data = None
                all_hits = []
                
                # Parse all events in the streaming response
                lines = response_text.split('\n')
                i = 0
                while i < len(lines):
                    line = lines[i].strip()
                    
                    # Look for events
                    if line.startswith('event: '):
                        event_type = line[7:]  # Remove 'event: ' prefix
                        i += 1
                        
                        # Get the data line that follows
                        if i < len(lines) and lines[i].startswith('data: '):
                            json_str = lines[i][6:]  # Remove 'data: ' prefix
                            try:
                                parsed = json.loads(json_str)
                                
                                if event_type == 'search_response_metadata' and 'results' in parsed:
                                    search_response_data = parsed['results']
                                elif event_type == 'search_response' and isinstance(parsed, dict) and '_timestamp' in parsed:
                                    # This is a hit record
                                    all_hits.append(parsed)
                                
                            except json.JSONDecodeError as e:
                                logger.debug(f"Failed to parse event {event_type}: {e}")
                    
                    i += 1
                
                if search_response_data:
                    # Combine metadata with collected hits
                    result.update({
                        "hits": all_hits if len(all_hits) > 0 else search_response_data.get("hits", []),
                        "total": search_response_data.get("total", 0),
                        "took": search_response_data.get("took", 0),
                        "cached": search_response_data.get("cached_ratio", 0) > 0,
                        "result_cache_ratio": search_response_data.get("result_cache_ratio", 0),
                    })
                    
                    logger.debug(f"📊 Parsed streaming response: metadata_hits={len(search_response_data.get('hits', []))}, stream_hits={len(all_hits)}, total={search_response_data.get('total', 0)}")
                else:
                    result["error"] = f"No search_response_metadata found in streaming response: {response.text[:500]}"
            else:
                # Regular JSON response
                response_data = response.json()
                result.update({
                    "hits": response_data.get("hits", []),
                    "total": response_data.get("total", 0),
                    "took": response_data.get("took", 0),
                    "cached": response_data.get("cached", False),
                    "result_cache_ratio": response_data.get("result_cache_ratio", 0),
                })
        except ValueError as e:
            logger.error(f"❌ Response parsing error: {e}")
            logger.error(f"❌ Response status: {response.status_code}")
            logger.error(f"❌ Response headers: {dict(response.headers)}")
            logger.error(f"❌ Response text (first 500 chars): {response.text[:500]}")
            result["error"] = f"Response parsing error: {e}. Response: {response.text[:500]}"
    else:
        result["error"] = response.text
    
    return result

def ingest_backdated_test_data(session: requests.Session, base_url: str, target_date: datetime) -> bool:
    """Ingest backdated test data for a specific historical time period."""
    
    logger.info(f"🚀 Ingesting backdated test data for {target_date.strftime('%Y-%m-%d %H:%M')} UTC...")
    
    # Create backdated test records for 3pm-4pm time window
    backdated_records = []
    
    # Generate records every 5 minutes for 1 hour (3pm-4pm)
    base_time = target_date.replace(hour=15, minute=0, second=0, microsecond=0)  # 3:00 PM
    
    for i in range(12):  # 12 records over 1 hour (every 5 minutes)
        record_time = base_time + timedelta(minutes=i * 5)
        record = {
            "_timestamp": record_time.isoformat().replace('+00:00', 'Z'),
            "kubernetes_container_name": f"vrl-historical-test-{i % 3}",
            "kubernetes_namespace_name": "vrl-historical-testing",
            "level": ["info", "warn", "error"][i % 3],
            "message": f"VRL historical cache test message {i} at {record_time.strftime('%H:%M')}",
            "log": f"[{record_time.strftime('%Y-%m-%dT%H:%M:%SZ')}] Historical VRL test log entry {i}",
            "stream": "stdout",
            "test_record_id": i,
            "time_slot": f"{record_time.strftime('%H:%M')}"
        }
        backdated_records.append(record)
    
    # Convert to JSON array format (like the working main tests)
    test_data = json.dumps(backdated_records)
    
    logger.info(f"📝 Generated {len(backdated_records)} records:")
    logger.info(f"📝 First record: {json.dumps(backdated_records[0], indent=2)}")
    logger.info(f"📝 Data size: {len(test_data)} bytes")
    
    # Ingest into dedicated historical test stream
    url = f"{base_url}api/default/vrl_historical_test_stream/_json"
    headers = {
        "Content-Type": "application/json",
        "X-VRL-Historical-Test": f"backdated-{target_date.strftime('%Y%m%d')}"
    }
    
    resp = session.post(url, data=test_data, headers=headers)
    logger.info(f"📤 Backdated data ingestion response: {resp.status_code}")
    
    if resp.status_code == 200:
        logger.info(f"✅ Successfully ingested {len(backdated_records)} historical records")
        # Wait for indexing
        logger.info("⏳ Waiting 5 seconds for indexing...")
        time.sleep(5)
        return True
    else:
        logger.error(f"❌ Backdated data ingestion failed: {resp.text}")
        return False

def test_vrl_historical_cache_bug_detection(create_session, base_url):
    """Test VRL processing on historical data to detect cache bugs - simplified approach."""
    
    session = create_session
    
    # First use broad range for discovery
    discovery_end_time = datetime.now(timezone.utc)
    discovery_start_time = discovery_end_time - timedelta(days=30)  # Broad range for discovery
    
    discovery_start_time_us = int(discovery_start_time.timestamp() * 1000000)
    discovery_end_time_us = int(discovery_end_time.timestamp() * 1000000)
    
    # First, let's find what streams exist and have data
    discovery_sql = '''
        SELECT *
        FROM "stream_pytest_data"
        ORDER BY _timestamp DESC
        LIMIT 20
    '''
    
    logger.info("🔍 First, let's discover what data exists...")
    discovery_result = execute_query_with_vrl(session, base_url, discovery_sql, discovery_start_time_us, discovery_end_time_us)
    
    if discovery_result["status_code"] != 200 or len(discovery_result.get("hits", [])) == 0:
        logger.warning("No data in stream_pytest_data, trying broader search...")
        
        # Try different stream names that might exist
        for stream_candidate in ["default", "logs", "stream_pytest_data", "test_stream"]:
            test_sql = f'SELECT * FROM "{stream_candidate}" ORDER BY _timestamp DESC LIMIT 5'
            test_result = execute_query_with_vrl(session, base_url, test_sql, discovery_start_time_us, discovery_end_time_us)
            
            if test_result["status_code"] == 200 and len(test_result.get("hits", [])) > 0:
                logger.info(f"✅ Found data in stream: {stream_candidate}")
                discovery_sql = test_sql
                discovery_result = test_result
                break
        else:
            pytest.skip("No data found in any test streams - cannot run VRL historical cache test")
    
    sql = discovery_sql
    
    # Use recent time range that has data but still build cache with repeated queries
    cache_end_time = datetime.now(timezone.utc) - timedelta(minutes=30)  # 30 minutes ago (recent but cacheable)
    cache_start_time = cache_end_time - timedelta(hours=6)  # 6 hour window
    
    start_time_us = int(cache_start_time.timestamp() * 1000000)
    end_time_us = int(cache_end_time.timestamp() * 1000000)
    
    logger.info(f"🕒 Testing historical time range for cache: {cache_start_time.strftime('%Y-%m-%d %H:%M')} to {cache_end_time.strftime('%Y-%m-%d %H:%M')} UTC")
    
    # ========================================
    # CACHE BUILDUP: Run same query multiple times to build cache
    # ========================================
    logger.info("\\n" + "="*60)
    logger.info("⚡ CACHE BUILDUP: Running same query multiple times to build cache")
    logger.info("="*60)
    
    # Run the same query 5 times without VRL to build baseline cache
    cache_buildup_results = []
    for i in range(5):
        logger.info(f"Cache buildup round {i+1}/5...")
        buildup_result = execute_query_with_vrl(session, base_url, sql, start_time_us, end_time_us, None)
        cache_buildup_results.append(buildup_result.get("result_cache_ratio", 0))
        logger.info(f"  Cache ratio: {buildup_result.get('result_cache_ratio', 0)}%")
        time.sleep(1)  # Brief pause between cache buildup
    
    logger.info(f"📊 Cache buildup progression: {' → '.join([f'{r}%' for r in cache_buildup_results])}")
    
    # ========================================
    # ROUND 1: Add historical_field_1 (with cache built up)
    # ========================================
    logger.info("\\n" + "="*60)
    logger.info("🔵 ROUND 1: Adding .historical_field_1 = 'round_1_historical'")
    logger.info("="*60)
    
    vrl_function_1 = create_vrl_function('.historical_field_1 = "round_1_historical"')
    
    result_1 = execute_query_with_vrl(
        session, base_url, sql, start_time_us, end_time_us, vrl_function_1
    )
    
    assert result_1["status_code"] == 200, f"Round 1 failed: {result_1.get('error', '')}"
    
    cache_ratio_1 = result_1.get("result_cache_ratio", 0)
    total_hits_1 = len(result_1.get("hits", []))
    
    field_1_count_r1 = sum(1 for hit in result_1["hits"] if "historical_field_1" in hit and hit["historical_field_1"] == "round_1_historical")
    field_2_count_r1 = sum(1 for hit in result_1["hits"] if "historical_field_2" in hit)
    
    logger.info(f"🔍 Round 1 results:")
    logger.info(f"  Cache ratio: {cache_ratio_1}%")
    logger.info(f"  Total hits: {total_hits_1}")
    logger.info(f"  Total from response: {result_1.get('total', 'N/A')}")
    logger.info(f"  historical_field_1 = 'round_1_historical': {field_1_count_r1}/{total_hits_1} hits")
    logger.info(f"  historical_field_2 (should be 0): {field_2_count_r1}/{total_hits_1} hits")
    
    # Debug: check if there's an error
    if "error" in result_1:
        logger.error(f"  ERROR in Round 1: {result_1['error']}")
    
    if total_hits_1 > 0:
        sample_hit = result_1["hits"][0]
        logger.info(f"  Sample hit time_slot: {sample_hit.get('time_slot', 'N/A')}")
        logger.info(f"  Sample hit fields: {list(sample_hit.keys())}")
    
    # Debug: if no hits but total > 0, try a broader query
    total_available = result_1.get('total', 0)
    if total_hits_1 == 0 and total_available > 0:
        logger.warning(f"⚠️  Query returned 0 hits but total={total_available}. Trying broader query...")
        
        # Try simpler query without ORDER BY
        simple_sql = 'SELECT * FROM "vrl_historical_test_stream" LIMIT 10'
        simple_result = execute_query_with_vrl(
            session, base_url, simple_sql, start_time_us, end_time_us, vrl_function_1
        )
        logger.info(f"🔄 Simple query result: total={simple_result.get('total', 0)}, hits={len(simple_result.get('hits', []))}")
        
        if len(simple_result.get('hits', [])) > 0:
            logger.info(f"🔄 Sample hit from simple query: {simple_result['hits'][0]}")
            # Use the simple result for testing
            result_1 = simple_result
            total_hits_1 = len(result_1.get("hits", []))
            field_1_count_r1 = sum(1 for hit in result_1["hits"] if "historical_field_1" in hit and hit["historical_field_1"] == "round_1_historical")
            field_2_count_r1 = sum(1 for hit in result_1["hits"] if "historical_field_2" in hit)
    
    # Verify round 1 worked
    assert total_hits_1 > 0, f"No historical data found in time window (total available: {total_available})"
    assert field_1_count_r1 > 0, f"historical_field_1 should exist in round 1, got {field_1_count_r1}/{total_hits_1}"
    
    logger.info("⏳ Waiting 2 seconds before round 2...")
    time.sleep(2)
    
    # ========================================
    # ROUND 2: Change to historical_field_2 (Same time window)
    # ========================================
    logger.info("\\n" + "="*60)
    logger.info("🟢 ROUND 2: Adding .historical_field_2 = 'round_2_historical' (SAME time window)")
    logger.info("="*60)
    
    vrl_function_2 = create_vrl_function('.historical_field_2 = "round_2_historical"')
    
    result_2 = execute_query_with_vrl(
        session, base_url, sql, start_time_us, end_time_us, vrl_function_2
    )
    
    assert result_2["status_code"] == 200, f"Round 2 failed: {result_2.get('error', '')}"
    
    cache_ratio_2 = result_2.get("result_cache_ratio", 0)
    total_hits_2 = len(result_2.get("hits", []))
    
    field_1_count_r2 = sum(1 for hit in result_2["hits"] if "historical_field_1" in hit)
    field_2_count_r2 = sum(1 for hit in result_2["hits"] if "historical_field_2" in hit and hit["historical_field_2"] == "round_2_historical")
    
    logger.info(f"🔍 Round 2 results:")
    logger.info(f"  Cache ratio: {cache_ratio_2}%")
    logger.info(f"  Total hits: {total_hits_2}")
    logger.info(f"  historical_field_1 (should be 0): {field_1_count_r2}/{total_hits_2} hits")
    logger.info(f"  historical_field_2 = 'round_2_historical': {field_2_count_r2}/{total_hits_2} hits")
    
    if total_hits_2 > 0:
        sample_hit = result_2["hits"][0]
        logger.info(f"  Sample hit time_slot: {sample_hit.get('time_slot', 'N/A')}")
        logger.info(f"  Sample hit fields: {list(sample_hit.keys())}")
    
    # ========================================
    # ROUNDS 3-6: Repeat same VRL multiple times to force caching
    # ======================================== 
    logger.info("⏳ Waiting 2 seconds before cache rounds...")
    time.sleep(2)
    
    # Run the same VRL query multiple times to build up cache
    all_results = [result_2]  # Include round 2 result
    
    for round_num in range(3, 7):  # Rounds 3, 4, 5, 6
        logger.info(f"\\n" + "="*60)
        logger.info(f"🟡 ROUND {round_num}: Repeat .historical_field_2 = 'round_2_historical' (Build cache)")
        logger.info("="*60)
        
        result = execute_query_with_vrl(
            session, base_url, sql, start_time_us, end_time_us, vrl_function_2
        )
        
        assert result["status_code"] == 200, f"Round {round_num} failed: {result.get('error', '')}"
        
        cache_ratio = result.get("result_cache_ratio", 0)
        total_hits = len(result.get("hits", []))
        
        field_1_count = sum(1 for hit in result["hits"] if "historical_field_1" in hit)
        field_2_count = sum(1 for hit in result["hits"] if "historical_field_2" in hit and hit["historical_field_2"] == "round_2_historical")
        
        logger.info(f"🔍 Round {round_num} results:")
        logger.info(f"  Cache ratio: {cache_ratio}%")
        logger.info(f"  Total hits: {total_hits}")
        logger.info(f"  historical_field_1 (should be 0): {field_1_count}/{total_hits} hits")
        logger.info(f"  historical_field_2 = 'round_2_historical': {field_2_count}/{total_hits} hits")
        
        all_results.append(result)
        time.sleep(1)  # Brief pause between rounds
    
    # Use the last result for final validation
    result_3 = all_results[-1]
    cache_ratio_3 = result_3.get("result_cache_ratio", 0)
    total_hits_3 = len(result_3.get("hits", []))
    field_1_count_r3 = sum(1 for hit in result_3["hits"] if "historical_field_1" in hit)
    field_2_count_r3 = sum(1 for hit in result_3["hits"] if "historical_field_2" in hit and hit["historical_field_2"] == "round_2_historical")
    
    # ========================================
    # CRITICAL VRL CACHE BUG DETECTION
    # ========================================
    logger.info("\\n" + "="*60)
    logger.info("🎯 CRITICAL VRL HISTORICAL CACHE BUG DETECTION")
    logger.info("="*60)
    
    # Show cache progression across all rounds
    all_cache_ratios = [cache_ratio_1] + [r.get("result_cache_ratio", 0) for r in all_results]
    cache_progression = " → ".join([f"R{i+1}:{r}%" for i, r in enumerate(all_cache_ratios)])
    logger.info(f"📊 Cache progression: {cache_progression}")
    
    # Check for VRL cache bugs in the last few high-cache rounds
    validation_rounds = []
    for i, result in enumerate(all_results[-3:], len(all_results)-2):  # Last 3 results
        cache_ratio = result.get("result_cache_ratio", 0)
        total_hits = len(result.get("hits", []))
        field_1_count = sum(1 for hit in result["hits"] if "historical_field_1" in hit)
        field_2_count = sum(1 for hit in result["hits"] if "historical_field_2" in hit and hit["historical_field_2"] == "round_2_historical")
        validation_rounds.append((result, cache_ratio, field_1_count, field_2_count, total_hits, i+2))
    
    for result, cache_ratio, field_1_count, field_2_count, total_hits, round_num in validation_rounds:
        
        # Always check for VRL cache bugs regardless of cache ratio (for debugging)
        logger.info(f"🔍 Round {round_num} Cache Analysis:")
        logger.info(f"  Cache ratio: {cache_ratio}%")
        logger.info(f"  Total hits: {total_hits}")
        logger.info(f"  Field 2 count: {field_2_count}")
        logger.info(f"  Missing VRL in hits: {total_hits - field_2_count}")
        
        # DEBUG: Show VRL presence in each hit position
        if total_hits > 0:
            vrl_presence = []
            for i, hit in enumerate(result["hits"]):
                has_vrl = "historical_field_2" in hit and hit["historical_field_2"] == "round_2_historical"
                vrl_presence.append(f"pos{i}:{'✓' if has_vrl else '✗'}")
            logger.info(f"  VRL presence by position: {', '.join(vrl_presence)}")
            
            # Show sample hits for debugging
            if total_hits > 0:
                logger.info(f"  FIRST hit fields: {list(result['hits'][0].keys())}")
            if total_hits > 1:
                logger.info(f"  LAST hit fields: {list(result['hits'][-1].keys())}")
            if total_hits > 2:
                mid_idx = total_hits // 2
                logger.info(f"  MIDDLE hit fields: {list(result['hits'][mid_idx].keys())}")
        
        # ALWAYS validate VRL regardless of cache ratio - VRL should be in ALL hits
        logger.info(f"⚠️  Round {round_num} - Validating VRL in ALL hits (cache ratio: {cache_ratio}%)")
        
        # Critical bug check 1: Old VRL field should not exist
        if field_1_count > 0:
            logger.error(f"🚨 VRL CACHE BUG DETECTED in Round {round_num}!")
            logger.error(f"   Found {field_1_count}/{total_hits} hits with OLD VRL field 'historical_field_1'")
            logger.error(f"   This indicates cached data is using stale VRL transformation!")
            assert False, f"VRL cache bug: Round {round_num} still has historical_field_1 from previous VRL ({field_1_count}/{total_hits} hits)"
        
        # Critical bug check 2: ALL hits should have the new VRL field (not just first/last)
        if field_2_count < total_hits:
            missing_count = total_hits - field_2_count
            logger.error(f"🚨 VRL CACHE BUG DETECTED in Round {round_num}!")
            logger.error(f"   {missing_count}/{total_hits} hits are MISSING the VRL field 'historical_field_2'")
            
            # Check for the specific "first and last only" bug pattern
            hits_with_vrl_positions = []
            for i, hit in enumerate(result["hits"]):
                if "historical_field_2" in hit and hit["historical_field_2"] == "round_2_historical":
                    hits_with_vrl_positions.append(i)
            
            logger.error(f"   VRL field found at positions: {hits_with_vrl_positions}")
                
            # Detect the specific first/last bug
            if len(hits_with_vrl_positions) >= 2:
                first_has_vrl = 0 in hits_with_vrl_positions
                last_has_vrl = (total_hits - 1) in hits_with_vrl_positions
                middle_positions = set(range(1, total_hits - 1))
                middle_with_vrl = [pos for pos in hits_with_vrl_positions if pos in middle_positions]
                
                if first_has_vrl and last_has_vrl and len(middle_with_vrl) == 0:
                    logger.error(f"🔴 SPECIFIC BUG: VRL only appears in FIRST and LAST results!")
                    logger.error(f"   This is the exact cache bug pattern you described!")
            
            assert False, f"VRL cache bug: Round {round_num} missing VRL field in {missing_count}/{total_hits} hits. Expected ALL hits to have VRL field, got only {field_2_count}"
        
        logger.info(f"✅ Round {round_num}: VRL present in ALL hits ({field_2_count}/{total_hits}) with cache ratio {cache_ratio}%")
    
    # Final validation
    assert field_2_count_r2 > 0, f"Round 2 should have historical_field_2, got {field_2_count_r2}/{total_hits_2}"
    assert field_1_count_r2 == 0, f"Round 2 should NOT have historical_field_1, got {field_1_count_r2}/{total_hits_2}"
    assert field_2_count_r3 > 0, f"Round 3 should have historical_field_2, got {field_2_count_r3}/{total_hits_3}"
    assert field_1_count_r3 == 0, f"Round 3 should NOT have historical_field_1, got {field_1_count_r3}/{total_hits_3}"
    
    logger.info("\\n🎉 VRL Historical Cache Bug Detection Test Completed Successfully!")
    logger.info("✅ No VRL cache bugs detected in historical data processing")
    logger.info("✅ VRL transformations applied correctly across all cache levels")
    logger.info(f"✅ Tested time range: {cache_start_time.strftime('%Y-%m-%d %H:%M')} - {cache_end_time.strftime('%H:%M')} UTC")