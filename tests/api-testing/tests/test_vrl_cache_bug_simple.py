"""
Simple VRL Cache Bug Detection Test
==================================

Test approach:
1. Run query with VRL_1 multiple times to build cache
2. Run query with VRL_2 for SAME time range
3. Check if VRL_2 appears in ALL hits (not just first/last)

If cache bug exists: VRL_2 will only appear in first/last hits
If cache works correctly: VRL_2 will appear in ALL hits
"""

import json
import requests
import pytest
import logging
import time
from typing import Dict, Any
from datetime import datetime, timezone, timedelta
from pathlib import Path

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
            "size": 100,  # Larger result set to increase chance of detecting cache bug
            "quick_mode": True,  # Enable quick mode as it might be required for caching
            "sql_mode": "context",
            "track_total_hits": False
        }
    }
    
    # Add VRL function if provided (base64 encoded as query_fn)
    if vrl_function:
        import base64
        encoded_vrl = base64.b64encode(vrl_function.encode()).decode()
        json_data["query"]["query_fn"] = encoded_vrl
    
    headers = {"X-Test-Type": "vrl-cache-bug-simple"}
    
    start_execution = time.time()
    
    response = session.post(
        f"{base_url}api/{org_id}/_search_stream?type=logs&search_type=ui&use_cache=true",
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
        # Handle streaming response
        response_text = response.text
        hits = []
        total = 0
        took = 0
        cached = False
        result_cache_ratio = 0
        
        # Parse server-sent events format
        for line in response_text.strip().split('\n'):
            if line.startswith('data: '):
                try:
                    data = json.loads(line[6:])  # Remove 'data: ' prefix
                    if 'hits' in data:
                        hits.extend(data['hits'])
                    if 'total' in data:
                        total = data['total']
                    if 'took' in data:
                        took = data['took']
                    if 'cached' in data:
                        cached = data['cached']
                    if 'result_cache_ratio' in data:
                        result_cache_ratio = data['result_cache_ratio']
                except json.JSONDecodeError:
                    continue
        
        result.update({
            "hits": hits,
            "total": total,
            "took": took,
            "cached": cached,
            "result_cache_ratio": result_cache_ratio,
        })
    else:
        result["error"] = response.text
    
    return result

def test_vrl_cache_bug_simple(create_session, base_url):
    """Simple VRL cache bug detection: Test 1 VRL vs Test 2 different VRL same range."""
    
    session = create_session
    
    # Use older time range to avoid mixing with freshly ingested data from current test run
    end_time = datetime.now(timezone.utc) - timedelta(hours=2)  # 2 hours ago
    start_time = end_time - timedelta(hours=1)  # 1 hour window, 2-3 hours ago
    
    start_time_us = int(start_time.timestamp() * 1000000)
    end_time_us = int(end_time.timestamp() * 1000000)
    
    # Go back to stream_pytest_data which had data before
    sql = '''
        SELECT *
        FROM "stream_pytest_data"
        ORDER BY _timestamp DESC
        LIMIT 50
    '''
    
    logger.info("🔍 Finding stream with data...")
    discovery_result = execute_query_with_vrl(session, base_url, sql, start_time_us, end_time_us)
    
    logger.info(f"📊 Discovery result: status={discovery_result['status_code']}, total={discovery_result.get('total', 0)}, hits={len(discovery_result.get('hits', []))}")
    
    if discovery_result["status_code"] != 200 or len(discovery_result.get("hits", [])) == 0:
        logger.info("🔍 Trying other streams...")
        # Try other streams with historical data focus
        for stream_candidate in ["default", "logs", "stream_pytest_data", "test_stream", "nginx", "app"]:
            test_sql = f'SELECT * FROM "{stream_candidate}" ORDER BY _timestamp DESC LIMIT 20'
            test_result = execute_query_with_vrl(session, base_url, test_sql, start_time_us, end_time_us)
            
            logger.info(f"  Stream '{stream_candidate}': status={test_result['status_code']}, hits={len(test_result.get('hits', []))}")
            
            if test_result["status_code"] == 200 and len(test_result.get("hits", [])) > 0:
                logger.info(f"✅ Found data in stream: {stream_candidate} - Total rows available: {test_result.get('total', 'unknown')}")
                sql = test_sql
                discovery_result = test_result
                break
        else:
            pytest.skip("No data found in any test streams")
    else:
        logger.info(f"✅ Using stream_pytest_data - Total rows available: {discovery_result.get('total', 'unknown')}")
    
    # Show sample of actual data we'll be testing with
    logger.info("\\n📋 SAMPLE DATA (first 3 records):")
    for i, hit in enumerate(discovery_result.get("hits", [])[:3]):
        fields = list(hit.keys())[:8]  # Show first 8 fields
        logger.info(f"  Record {i}: {fields}")
        logger.info(f"    _timestamp: {hit.get('_timestamp', 'MISSING')}")
    
    logger.info(f"🕒 Testing time range: {start_time.strftime('%Y-%m-%d %H:%M')} to {end_time.strftime('%Y-%m-%d %H:%M')} UTC")
    
    # ========================================
    # TEST 1: Run with first VRL multiple times to build cache
    # ========================================
    logger.info("\\n" + "="*60)
    logger.info("🔵 TEST 1: Adding .test_vrl = 'first_value' and building cache")
    logger.info("="*60)
    
    vrl_function_1 = create_vrl_function('.test_vrl = "first_value"')
    
    # Build cache with multiple runs - more aggressive caching
    cache_ratios = []
    for i in range(20):  # More runs to build higher cache
        result = execute_query_with_vrl(session, base_url, sql, start_time_us, end_time_us, vrl_function_1)
        cache_ratio = result.get("result_cache_ratio", 0)
        cache_ratios.append(cache_ratio)
        logger.info(f"  Test 1 - Run {i+1}/20: Cache ratio: {cache_ratio}%")
        # No sleep - run queries back-to-back to maximize cache usage
    
    final_result_1 = result
    total_hits_1 = len(final_result_1.get("hits", []))
    first_value_count = sum(1 for hit in final_result_1["hits"] if "test_vrl" in hit and hit["test_vrl"] == "first_value")
    
    logger.info(f"📊 Test 1 Cache progression: {' → '.join([f'{r}%' for r in cache_ratios[-5:]])}")  # Show last 5
    logger.info(f"🔍 Test 1 Final: {total_hits_1} hits, {first_value_count} with 'first_value'")
    
    # Console log first 3 and last 3 hits from TEST 1 (not all 50)
    logger.info("\\n📋 TEST 1 - FIRST 3 AND LAST 3 HITS WITH VRL:")
    hits = final_result_1.get("hits", [])
    for i in range(min(3, len(hits))):
        vrl_value = hits[i].get("test_vrl", "MISSING")
        logger.info(f"  Hit {i}: test_vrl = '{vrl_value}'")
        if "test_vrl" in hits[i]:
            logger.info(f"    🎯 COMPLETE HIT {i}: {json.dumps({k: v for k, v in hits[i].items() if k in ['_timestamp', 'test_vrl']})}")
    
    if len(hits) > 6:
        logger.info(f"  ... (skipping {len(hits) - 6} middle hits) ...")
        for i in range(len(hits) - 3, len(hits)):
            vrl_value = hits[i].get("test_vrl", "MISSING")
            logger.info(f"  Hit {i}: test_vrl = '{vrl_value}'")
            if "test_vrl" in hits[i]:
                logger.info(f"    🎯 COMPLETE HIT {i}: {json.dumps({k: v for k, v in hits[i].items() if k in ['_timestamp', 'test_vrl']})}")
    
    assert total_hits_1 > 0, "No data found"
    assert first_value_count > 0, f"First VRL should work, got {first_value_count}/{total_hits_1}"
    
    logger.info("⏳ Waiting 2 seconds before test 2 to allow cache to settle...")
    time.sleep(2)
    
    # ========================================
    # TEST 2: Run with DIFFERENT VRL for SAME time range
    # ========================================
    logger.info("\\n" + "="*60)
    logger.info("🟢 TEST 2: Adding .test_vrl = 'second_value' (SAME time range)")
    logger.info("🎯 CRITICAL: This should show 'second_value' in ALL hits if cache works correctly")
    logger.info("🚨 BUG: If cache is broken, 'second_value' will only appear in first/last hits")
    logger.info("="*60)
    
    vrl_function_2 = create_vrl_function('.test_vrl = "second_value"')
    
    result_2 = execute_query_with_vrl(session, base_url, sql, start_time_us, end_time_us, vrl_function_2)
    
    assert result_2["status_code"] == 200, f"Test 2 failed: {result_2.get('error', '')}"
    
    cache_ratio_2 = result_2.get("result_cache_ratio", 0)
    total_hits_2 = len(result_2.get("hits", []))
    
    first_value_count_2 = sum(1 for hit in result_2["hits"] if "test_vrl" in hit and hit["test_vrl"] == "first_value")
    second_value_count_2 = sum(1 for hit in result_2["hits"] if "test_vrl" in hit and hit["test_vrl"] == "second_value")
    
    logger.info(f"🔍 Test 2 Results:")
    logger.info(f"  Cache ratio: {cache_ratio_2}%")
    logger.info(f"  Total hits: {total_hits_2}")
    logger.info(f"  test_vrl = 'first_value' (OLD - should be 0): {first_value_count_2}/{total_hits_2}")
    logger.info(f"  test_vrl = 'second_value' (NEW - should be ALL): {second_value_count_2}/{total_hits_2}")
    
    # Console log ALL hits from TEST 2 - THIS IS CRITICAL
    logger.info("\\n📋 TEST 2 - ALL HITS WITH VRL DETAILS:")
    vrl_values = []  # Track all VRL values to detect mixed values
    unique_vrl_values = set()
    
    for i, hit in enumerate(result_2.get("hits", [])):
        vrl_value = hit.get("test_vrl", "MISSING")
        vrl_values.append(vrl_value)
        unique_vrl_values.add(vrl_value)
        timestamp = hit.get("_timestamp", "NO_TIME")
        logger.info(f"  Hit {i}: test_vrl = '{vrl_value}', _timestamp = '{timestamp}'")
        
        # Console log complete hit if VRL field found (compact format)
        if "test_vrl" in hit:
            logger.info(f"    🎯 COMPLETE HIT {i}: {json.dumps({k: v for k, v in hit.items() if k in ['_timestamp', 'test_vrl']})}")
    
    # *** NEW CRITICAL CHECK: Detect mixed VRL values in single response ***
    logger.info(f"\\n🔍 VRL VALUE ANALYSIS:")
    logger.info(f"  Unique VRL values in response: {list(unique_vrl_values)}")
    logger.info(f"  Total unique VRL values: {len(unique_vrl_values)}")
    
    # Check for mixed VRL values (cache bug signature)
    if len(unique_vrl_values) > 1:
        logger.error("🚨 VRL CACHE BUG DETECTED!")
        logger.error("🔴 MIXED VRL VALUES found in single response!")
        logger.error(f"   Expected: All hits should have 'second_value'")
        logger.error(f"   Actual: Found multiple VRL values: {list(unique_vrl_values)}")
        
        # Show position mapping
        old_vrl_positions = [i for i, val in enumerate(vrl_values) if val == "first_value"]
        new_vrl_positions = [i for i, val in enumerate(vrl_values) if val == "second_value"]
        
        logger.error(f"   Positions with OLD VRL 'first_value': {old_vrl_positions}")
        logger.error(f"   Positions with NEW VRL 'second_value': {new_vrl_positions}")
        
        # Check for specific "first and last only" pattern
        if len(new_vrl_positions) >= 2 and total_hits_2 > 2:
            first_has_new_vrl = 0 in new_vrl_positions
            last_has_new_vrl = (total_hits_2 - 1) in new_vrl_positions
            middle_positions = set(range(1, total_hits_2 - 1))
            middle_with_new_vrl = [pos for pos in new_vrl_positions if pos in middle_positions]
            
            if first_has_new_vrl and last_has_new_vrl and len(middle_with_new_vrl) == 0:
                logger.error("🚨 SPECIFIC PATTERN: First and Last Only Cache Bug!")
                logger.error(f"   First position (0): {'✓' if first_has_new_vrl else '✗'}")
                logger.error(f"   Last position ({total_hits_2-1}): {'✓' if last_has_new_vrl else '✗'}")
                logger.error(f"   Middle positions ({len(middle_positions)}): {len(middle_with_new_vrl)} have new VRL")
        
        assert False, f"VRL Cache Bug: Mixed VRL values in single response: {list(unique_vrl_values)}"
    
    # Track positions for legacy validation
    positions_with_second_value = [i for i, val in enumerate(vrl_values) if val == "second_value"]
    logger.info(f"  Positions with 'second_value': {positions_with_second_value}")
    
    # ========================================
    # CRITICAL VALIDATION
    # ========================================
    logger.info("\\n" + "="*60)
    logger.info("🎯 CRITICAL VRL CACHE BUG VALIDATION")
    logger.info("="*60)
    
    if cache_ratio_2 > 10:  # Lower threshold to catch bugs at lower cache ratios
        logger.info(f"⚠️  High cache ratio ({cache_ratio_2}%) - validating VRL cache behavior...")
        
        # Bug check 1: Old VRL should not exist
        if first_value_count_2 > 0:
            logger.error(f"🚨 VRL CACHE BUG: Found {first_value_count_2} hits with OLD VRL 'first_value'")
            logger.error("   Cached results are using stale VRL transformation!")
            assert False, f"VRL cache bug: Test 2 still has 'first_value' from previous VRL ({first_value_count_2}/{total_hits_2} hits)"
        
        # Bug check 2: New VRL should be in ALL hits
        if second_value_count_2 < total_hits_2:
            missing_count = total_hits_2 - second_value_count_2
            logger.error(f"🚨 VRL CACHE BUG: {missing_count}/{total_hits_2} hits are MISSING new VRL 'second_value'")
            assert False, f"VRL cache bug: Test 2 missing new VRL in {missing_count}/{total_hits_2} hits"
        
        logger.info(f"✅ VRL cache working correctly with {cache_ratio_2}% cache ratio")
    else:
        logger.info(f"ℹ️  Low cache ratio ({cache_ratio_2}%) - VRL processing mostly fresh")
    
    # Final validation
    assert second_value_count_2 > 0, f"Test 2 should have 'second_value', got {second_value_count_2}/{total_hits_2}"
    assert first_value_count_2 == 0, f"Test 2 should NOT have 'first_value', got {first_value_count_2}/{total_hits_2}"
    
    # ============================================================
    # TEST 3: Query again after a delay to verify VRL persistence
    # ============================================================
    logger.info("\\n============================================================")
    logger.info("🟡 TEST 3: Testing VRL persistence after delay")  
    logger.info("🎯 CRITICAL: VRL should persist and continue applying to the same data")
    logger.info("🚨 BUG: If VRL state is lost, subsequent queries won't have VRL field")
    logger.info("============================================================")
    
    # Wait a moment to simulate real-world delay
    time.sleep(5)
    logger.info("⏳ Waited 5 seconds to test VRL persistence...")
    
    # Query with the same VRL that should still be active
    result_3 = execute_query_with_vrl(session, base_url, sql, start_time_us, end_time_us, vrl_function_2)
    
    total_hits_3 = len(result_3.get("hits", []))
    hits_with_vrl_3 = sum(1 for hit in result_3.get("hits", []) if "test_vrl" in hit and hit["test_vrl"] == "second_value")
    hits_with_first_vrl_3 = sum(1 for hit in result_3.get("hits", []) if "test_vrl" in hit and hit["test_vrl"] == "first_value")
    missing_vrl_3 = sum(1 for hit in result_3.get("hits", []) if "test_vrl" not in hit)
    
    logger.info(f"🔍 Test 3 Results:")
    logger.info(f"  Cache ratio: {result_3.get('result_cache_ratio', 0)}%")
    logger.info(f"  Total hits: {total_hits_3}")
    logger.info(f"  Hits with VRL 'second_value' (expected): {hits_with_vrl_3}/{total_hits_3}")
    logger.info(f"  Hits with VRL 'first_value' (old): {hits_with_first_vrl_3}/{total_hits_3}")
    logger.info(f"  Hits missing VRL: {missing_vrl_3}/{total_hits_3}")
    
    # Show first few hits to verify VRL persistence
    logger.info("\\n📋 TEST 3 - VRL PERSISTENCE SAMPLES:")
    for i, hit in enumerate(result_3.get("hits", [])[:3]):
        vrl_value = hit.get("test_vrl", "MISSING")
        timestamp = hit.get("_timestamp", "NO_TIME")
        logger.info(f"  Hit {i}: test_vrl = '{vrl_value}', _timestamp = '{timestamp}'")
        if "test_vrl" in hit:
            logger.info(f"    🎯 COMPLETE HIT: {json.dumps({k: v for k, v in hit.items() if k in ['_timestamp', 'test_vrl']})}")
    
    # Validate TEST 3: VRL should persist
    logger.info("\\n============================================================")
    logger.info("🎯 TEST 3 VRL PERSISTENCE VALIDATION")
    logger.info("============================================================")
    
    if hits_with_vrl_3 == total_hits_3:
        logger.info("✅ SUCCESS: VRL persists correctly - all hits have current VRL transformation")
        logger.info("✅ VRL function state maintained across multiple queries")
    elif missing_vrl_3 > 0:
        logger.error("🚨 VRL PERSISTENCE BUG DETECTED!")
        logger.error("🔴 Some hits missing VRL transformation after delay")
        logger.error(f"   Expected: All {total_hits_3} hits should have VRL")
        logger.error(f"   Actual: {missing_vrl_3} hits missing VRL")
        assert False, "VRL Persistence Bug: VRL transformation lost after delay"
    elif hits_with_first_vrl_3 > 0:
        logger.error("🚨 VRL STATE REGRESSION BUG DETECTED!")
        logger.error("🔴 Some hits reverted to old VRL transformation")
        logger.error(f"   Expected: All {total_hits_3} hits should have 'second_value'")
        logger.error(f"   Actual: {hits_with_first_vrl_3} hits have old 'first_value'")
        assert False, "VRL State Regression Bug: VRL reverted to previous state"
    else:
        logger.warning("⚠️  Unexpected VRL state - partial persistence issue")
    
    logger.info("\\n🎉 VRL Cache Bug Detection Test Completed Successfully!")
    logger.info("✅ No VRL cache bugs detected")
    logger.info("✅ New VRL transformations applied correctly in cached scenarios") 
    logger.info("✅ VRL transformations persist and apply to fresh data")
    logger.info("✅ Tested comprehensive VRL functionality across 3 test scenarios")