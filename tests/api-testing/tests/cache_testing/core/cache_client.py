"""
Unified Cache Client - DRY Implementation
Single source of truth for all cache operations and queries.
"""
import time
import hashlib
from typing import Dict, Any, List, Optional, Tuple, Union
import requests


class CacheClient:
    """Unified client for all cache testing operations."""
    
    def __init__(self, session: requests.Session, base_url: str, org: str = "default"):
        self.session = session
        self.base_url = base_url.rstrip('/')
        self.org = org
        self.query_history = []
        
    def execute_query(self, stream: str, sql: str, start_time: int, end_time: int, 
                     use_cache: bool = True, endpoint_type: str = "search") -> Dict[str, Any]:
        """
        Execute a cache query with unified interface.
        
        Args:
            stream: Stream name to query
            sql: SQL query string
            start_time: Start time in microseconds
            end_time: End time in microseconds
            use_cache: Whether to enable caching
            endpoint_type: "search" or "search_stream"
            
        Returns:
            Unified response with cache metrics
        """
        # Build query data
        query_data = {
            "query": {
                "sql": sql,
                "start_time": start_time,
                "end_time": end_time,
                "from": 0,
                "size": 150,
                "use_cache": use_cache
            }
        }
        
        # Select endpoint
        if endpoint_type == "search_stream":
            url = f"{self.base_url}/api/{self.org}/_search_stream?type=logs&search_type=ui&use_cache={str(use_cache).lower()}"
        else:
            url = f"{self.base_url}/api/{self.org}/_search?type=logs"
        
        # Execute query
        start = time.time()
        resp = self.session.post(url, json=query_data)
        end = time.time()
        
        # Process response
        if resp.status_code == 200:
            if endpoint_type == "search_stream":
                return self._parse_streaming_response(resp, end - start)
            else:
                return self._parse_json_response(resp, end - start)
        else:
            return self._create_error_response(resp, end - start)
    
    def execute_cache_progression_test(self, stream: str, sql: str, time_range_hours: int = 4, 
                                     iterations: int = 3) -> List[Dict[str, Any]]:
        """
        Execute a complete cache progression test (DRY).
        
        Args:
            stream: Stream to test
            sql: SQL query template  
            time_range_hours: Hours back from current time
            iterations: Number of queries to run
            
        Returns:
            List of query results showing cache progression
        """
        # Generate time range
        current_time_us = int(time.time() * 1000000)
        start_time = current_time_us - (time_range_hours * 3600 * 1000000)
        end_time = current_time_us - (1 * 3600 * 1000000)  # 1 hour ago to avoid cache delay
        
        # Format SQL with stream name if needed
        if "{stream}" in sql:
            sql = sql.format(stream=stream)
        
        results = []
        
        for i in range(iterations):
            result = self.execute_query(stream, sql, start_time, end_time, use_cache=True)
            result['iteration'] = i + 1
            results.append(result)
            
            # Add delay between queries (except last one)
            if i < iterations - 1:
                time.sleep(2)
                
        return results
    
    def get_query_hash(self, sql: str, start_time: int, end_time: int, stream: str) -> str:
        """Generate consistent query hash for cache tracking."""
        hash_input = f"{sql}_{start_time}_{end_time}_{stream}_{self.org}"
        return hashlib.md5(hash_input.encode()).hexdigest()[:16]
    
    def _parse_json_response(self, resp: requests.Response, client_time: float) -> Dict[str, Any]:
        """Parse JSON response and extract cache metrics."""
        data = resp.json()
        return {
            'status_code': resp.status_code,
            'success': True,
            'result_cache_ratio': data.get('result_cache_ratio', 0),
            'cached_ratio': data.get('cached_ratio', 0),
            'took': data.get('took', 0),
            'total': data.get('total', 0),
            'hits': data.get('hits', []),
            'scan_size': data.get('scan_size', 0),
            'scan_records': data.get('scan_records', 0),
            'took_detail': data.get('took_detail', {}),
            'client_time_ms': int(client_time * 1000),
            'endpoint_type': 'json'
        }
    
    def _parse_streaming_response(self, resp: requests.Response, client_time: float) -> Dict[str, Any]:
        """Parse streaming response and extract cache metrics."""
        import re
        import json
        
        response_text = resp.text
        cache_data = {}
        
        # Extract cache metrics from streaming response
        if 'result_cache_ratio' in response_text:
            lines = response_text.split('\n')
            for line in lines:
                if line.startswith('data: {') and 'result_cache_ratio' in line:
                    try:
                        json_str = line[6:]  # Remove 'data: '
                        data = json.loads(json_str)  # SECURITY FIX: Use json.loads instead of eval
                        cache_data.update(data)
                        break
                    except json.JSONDecodeError:
                        # Fallback regex extraction for malformed JSON
                        patterns = {
                            'result_cache_ratio': r'result_cache_ratio[\"\']*:\s*(\d+)',
                            'cached_ratio': r'cached_ratio[\"\']*:\s*(\d+)',
                            'took': r'took[\"\']*:\s*(\d+)',
                            'total': r'total[\"\']*:\s*(\d+)'
                        }
                        for key, pattern in patterns.items():
                            match = re.search(pattern, line)
                            if match:
                                cache_data[key] = int(match.group(1))
        
        return {
            'status_code': resp.status_code,
            'success': True,
            'result_cache_ratio': cache_data.get('result_cache_ratio', 0),
            'cached_ratio': cache_data.get('cached_ratio', 0),
            'took': cache_data.get('took', 0),
            'total': cache_data.get('total', 0),
            'hits': [],  # Streaming doesn't return hits in same format
            'scan_size': cache_data.get('scan_size', 0),
            'scan_records': cache_data.get('scan_records', 0),
            'took_detail': cache_data.get('took_detail', {}),
            'client_time_ms': int(client_time * 1000),
            'endpoint_type': 'streaming',
            'response_size': len(response_text)
        }
    
    def _create_error_response(self, resp: requests.Response, client_time: float) -> Dict[str, Any]:
        """Create standardized error response."""
        return {
            'status_code': resp.status_code,
            'success': False,
            'error': resp.text[:200],
            'result_cache_ratio': 0,
            'cached_ratio': 0,
            'took': 0,
            'total': 0,
            'hits': [],
            'client_time_ms': int(client_time * 1000),
            'endpoint_type': 'error'
        }


class CacheTestScenarios:
    """Predefined cache testing scenarios (DRY)."""
    
    @staticmethod
    def get_basic_scenarios() -> List[Dict[str, Any]]:
        """Get basic cache testing scenarios."""
        return [
            {
                "name": "count_query",
                "description": "Basic COUNT query for cache validation",
                "sql": "SELECT COUNT(*) as total FROM \"{stream}\"",
                "time_range_hours": 4,
                "expected_behavior": "should_cache_with_sufficient_data"
            },
            {
                "name": "select_query",
                "description": "SELECT query with specific fields",
                "sql": "SELECT _timestamp, level, message FROM \"{stream}\" ORDER BY _timestamp DESC LIMIT 10",
                "time_range_hours": 6,
                "expected_behavior": "should_cache_with_data_volume"
            },
            {
                "name": "aggregation_query",
                "description": "Aggregation query for cache testing",
                "sql": "SELECT level, COUNT(*) as count FROM \"{stream}\" GROUP BY level",
                "time_range_hours": 2,
                "expected_behavior": "should_cache_with_histogram_alignment"
            }
        ]
    
    @staticmethod
    def get_performance_scenarios() -> List[Dict[str, Any]]:
        """Get performance testing scenarios."""
        return [
            {
                "name": "lightweight_query",
                "description": "Fast query for performance testing",
                "sql": "SELECT COUNT(*) as total FROM \"{stream}\"",
                "time_range_hours": 1,
                "expected_time_ms": 100
            },
            {
                "name": "medium_query",
                "description": "Medium complexity query",
                "sql": "SELECT _timestamp, message FROM \"{stream}\" LIMIT 50",
                "time_range_hours": 2,
                "expected_time_ms": 500
            },
            {
                "name": "complex_query",
                "description": "Complex query for performance testing",
                "sql": "SELECT level, COUNT(*) as count, AVG(LENGTH(message)) as avg_len FROM \"{stream}\" GROUP BY level ORDER BY count DESC",
                "time_range_hours": 4,
                "expected_time_ms": 1000
            }
        ]


def create_cache_client(session: requests.Session, base_url: str, org: str = "default") -> CacheClient:
    """Factory function to create cache client."""
    return CacheClient(session, base_url, org)