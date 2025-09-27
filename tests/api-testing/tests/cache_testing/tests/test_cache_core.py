"""
Core Cache Tests - DRY Implementation
Main cache testing using the unified DRY architecture.
"""
import pytest
import os
from typing import Dict, Any, List

from ..core.cache_client import create_cache_client, CacheTestScenarios
from ..core.cache_validator import create_cache_validator
from ..core.cache_analyzer import create_cache_analyzer
from ..mock.cache_mock import create_cache_mock, MockCacheConfig


class TestCacheCore:
    """Core cache tests using DRY architecture."""
    
    @pytest.fixture(autouse=True)
    def setup_test_environment(self, cache_session, cache_config):
        """Setup test environment for each test."""
        self.client = create_cache_client(cache_session, cache_config["base_url"], cache_config["org"])
        self.validator = create_cache_validator(strict_mode=False)
        self.analyzer = create_cache_analyzer()
        self.mock = create_cache_mock()
        
        # Determine if we're in mock mode
        self.use_mock = os.getenv('MOCK_CACHE_TESTS', 'true').lower() == 'true'
        
    def test_basic_cache_progression(self, test_stream_with_data):
        """Test basic cache progression with multiple queries."""
        stream_name = test_stream_with_data
        sql = "SELECT COUNT(*) as total FROM \\\"{stream}\\\""
        
        print(f"\\n🔍 Testing cache progression for stream: {stream_name}")
        print(f"   Query: {sql.replace('{stream}', stream_name)}")
        print(f"   Mode: {'MOCK' if self.use_mock else 'REAL'}")
        
        if self.use_mock:
            # Use mock for consistent CI/CD testing
            results = []
            for i in range(3):
                mock_response = self.mock.mock_cache_response(
                    stream=stream_name,
                    sql=sql,
                    start_time=1640995200000000,  # 2022-01-01
                    end_time=1641081600000000,    # 2022-01-02
                    use_cache=True,
                    iteration=i + 1
                )
                results.append(mock_response)
        else:
            # Use real cache for local testing
            results = self.client.execute_cache_progression_test(
                stream=stream_name,
                sql=sql.format(stream=stream_name),
                time_range_hours=4,
                iterations=3
            )
        
        # Print detailed metrics
        print(f"\\n📊 Cache Progression Results:")
        for i, result in enumerate(results, 1):
            print(f"   Query {i}:")
            print(f"     • result_cache_ratio: {result.get('result_cache_ratio', 0)}%")
            print(f"     • cached_ratio (file): {result.get('cached_ratio', 0)}%") 
            print(f"     • took: {result.get('took', 0)}ms")
            print(f"     • total records: {result.get('total', 0)}")
            print(f"     • scan_size: {result.get('scan_size', 0)} bytes")
            print(f"     • client_time: {result.get('client_time_ms', 0)}ms")
        
        # Validate results
        for result in results:
            validation = self.validator.validate_response_structure(result)
            assert validation.passed, f"Response validation failed: {validation.errors}"
        
        # Analyze progression
        analysis = self.analyzer.analyze_cache_progression(results, "basic_cache_progression")
        
        # Print analysis summary
        print(f"\\n📈 Cache Analysis Summary:")
        print(f"   • Cache effectiveness: {analysis.cache_effectiveness}")
        print(f"   • Performance improvement: {analysis.performance_improvement:.1%}")
        print(f"   • Max result cache: {analysis.detailed_metrics['max_result_cache']}%")
        print(f"   • Max file cache: {analysis.detailed_metrics['max_file_cache']}%")
        print(f"   • Avg response time: {analysis.detailed_metrics['avg_response_time']:.0f}ms")
        print(f"   • Cache stability: {analysis.detailed_metrics['cache_stability']}")
        print(f"   • Test duration: {analysis.duration_seconds:.2f}s")
        if analysis.recommendations:
            print(f"   📝 Recommendations: {len(analysis.recommendations)} found")
            for rec in analysis.recommendations[:2]:  # Show first 2
                print(f"     - {rec}")
        
        # Assertions based on test mode
        if self.use_mock:
            assert analysis.success, "Mock cache progression should succeed"
            assert analysis.cache_effectiveness != "no_cache_activity"
            assert analysis.detailed_metrics['max_file_cache'] > 0
        else:
            # Real cache may or may not show activity depending on data
            assert len(results) == 3, "Should execute 3 queries"
            assert all(r['success'] for r in results), "All queries should succeed"
    
    def test_cache_types_validation(self, test_stream_with_data):
        """Test validation of both result cache and file cache types."""
        stream_name = test_stream_with_data
        sql = "SELECT level, COUNT(*) as count FROM \\\"{stream}\\\" GROUP BY level"
        
        if self.use_mock:
            # Mock response with both cache types active
            result = self.mock.mock_cache_response(
                stream=stream_name,
                sql=sql,
                start_time=1640995200000000,
                end_time=1641081600000000,
                use_cache=True,
                iteration=3  # Later iteration for better cache
            )
        else:
            result = self.client.execute_query(
                stream=stream_name,
                sql=sql.format(stream=stream_name),
                start_time=1640995200000000,
                end_time=1641081600000000
            )
        
        # Validate cache types
        validation = self.validator.validate_cache_types(result)
        
        assert validation.passed, f"Cache type validation failed: {validation.errors}"
        assert 'cache_efficiency' in validation.details
        
        # Check that response contains cache fields
        assert 'result_cache_ratio' in result
        assert 'cached_ratio' in result
        assert isinstance(result['result_cache_ratio'], int)
        assert isinstance(result['cached_ratio'], int)
    
    def test_cache_scenario_comparison(self, test_stream_with_data):
        """Test comparison of multiple cache scenarios."""
        stream_name = test_stream_with_data
        scenarios = CacheTestScenarios.get_basic_scenarios()
        
        scenario_results = {}
        
        for scenario in scenarios[:2]:  # Test first 2 scenarios
            if self.use_mock:
                # Generate mock results for scenario
                results = []
                for i in range(2):
                    mock_result = self.mock.mock_cache_response(
                        stream=stream_name,
                        sql=scenario['sql'],
                        start_time=1640995200000000,
                        end_time=1641081600000000,
                        use_cache=True,
                        iteration=i + 1
                    )
                    results.append(mock_result)
            else:
                results = self.client.execute_cache_progression_test(
                    stream=stream_name,
                    sql=scenario['sql'].format(stream=stream_name),
                    time_range_hours=scenario['time_range_hours'],
                    iterations=2
                )
            
            scenario_results[scenario['name']] = results
        
        # Compare scenarios
        comparison = self.analyzer.compare_cache_scenarios(scenario_results)
        
        assert 'scenario_comparisons' in comparison
        assert 'best_performing_scenario' in comparison
        assert comparison['total_scenarios_tested'] == len(scenario_results)
        assert comparison['successful_scenarios'] >= 0
    
    def test_production_cache_simulation(self):
        """Test production-like cache behavior."""
        if self.use_mock:
            # Use mock production response
            result = self.mock.mock_production_cache_response("otlp-production")
        else:
            # Skip production test in real mode if no production stream
            pytest.skip("Production cache test requires production stream")
        
        # Validate production response
        validation = self.validator.validate_response_structure(result)
        assert validation.passed, f"Production response validation failed: {validation.errors}"
        
        # Analyze production cache behavior
        analysis = self.analyzer.analyze_cache_progression([result], "production_simulation")
        
        # Production should show file cache activity
        assert result['cached_ratio'] >= 50, "Production should show significant file cache activity"
        assert result['success'], "Production query should succeed"
        assert result['took'] < 1000, "Production with cache should be fast"
    
    def test_cache_performance_correlation(self, test_stream_with_data):
        """Test correlation between cache effectiveness and performance."""
        stream_name = test_stream_with_data
        sql = "SELECT COUNT(*) as total FROM \\\"{stream}\\\""
        
        print(f"\\n⚡ Testing cache performance correlation for stream: {stream_name}")
        
        if self.use_mock:
            # Generate progression showing performance improvement
            results = []
            response_times = [2000, 1200, 600, 300, 200]  # Improving performance
            result_cache_ratios = [0, 35, 65, 80, 90]     # Strong result cache progression
            file_cache_ratios = [0, 50, 75, 90, 95]       # File cache progression
            
            for i, (time_ms, result_cache, file_cache) in enumerate(zip(response_times, result_cache_ratios, file_cache_ratios)):
                mock_result = self.mock.mock_cache_response(
                    stream=stream_name,
                    sql=sql,
                    start_time=1640995200000000,
                    end_time=1641081600000000,
                    use_cache=True,
                    iteration=i + 1
                )
                # Override with specific values for correlation test
                mock_result.update({
                    'took': time_ms,
                    'result_cache_ratio': result_cache,
                    'cached_ratio': file_cache
                })
                results.append(mock_result)
        else:
            results = self.client.execute_cache_progression_test(
                stream=stream_name,
                sql=sql.format(stream=stream_name),
                iterations=5
            )
        
        # Analyze performance correlation
        analysis = self.analyzer.analyze_cache_progression(results, "performance_correlation")
        
        # Print performance metrics
        print(f"\\n🚀 Performance Correlation Results:")
        print(f"   Response time progression: {analysis.detailed_metrics['response_time_progression']}")
        print(f"   Result cache progression: {analysis.detailed_metrics['result_cache_progression']}")
        print(f"   File cache progression: {analysis.detailed_metrics['file_cache_progression']}")
        print(f"   Performance improvement: {analysis.performance_improvement:.1%}")
        print(f"   First query: {analysis.detailed_metrics['first_query_time']}ms → Last query: {analysis.detailed_metrics['last_query_time']}ms")
        
        if self.use_mock:
            # With mock data, we should see clear correlation
            assert analysis.performance_improvement > 0.5, "Should show significant improvement"
            # Check that first query was slower than last query
            assert analysis.detailed_metrics['first_query_time'] > analysis.detailed_metrics['last_query_time'], "Performance should improve"
        
        # General assertions for both modes
        assert len(results) >= 3, "Should have multiple data points for correlation"
        assert len(analysis.detailed_metrics['response_time_progression']) == len(results)
    
    def test_cache_error_handling(self):
        """Test cache behavior with error conditions."""
        if self.use_mock:
            # Create mock error response
            from ..mock.response_builder import create_response_builder
            builder = create_response_builder()
            error_response = builder.build_error_response(500, "Mock server error")
            
            # Validate error response structure
            validation = self.validator.validate_response_structure(error_response)
            assert not validation.passed, "Error response should fail validation"
            assert len(validation.errors) > 0, "Should have validation errors"
            # Check that it properly detects the error status
            assert error_response['status_code'] == 500, "Should have error status code"
        else:
            # Test with invalid stream name
            result = self.client.execute_query(
                stream="non_existent_stream",
                sql="SELECT COUNT(*) FROM non_existent_stream",
                start_time=1640995200000000,
                end_time=1641081600000000
            )
            
            # Should handle error gracefully
            assert 'status_code' in result
            assert not result.get('success', True) or result['status_code'] != 200
    
    def test_cache_configuration_impact(self, test_stream_with_data):
        """Test impact of cache configuration on behavior."""
        stream_name = test_stream_with_data
        sql = "SELECT COUNT(*) as total FROM \\\"{stream}\\\""
        
        # Test with cache enabled
        if self.use_mock:
            result_with_cache = self.mock.mock_cache_response(
                stream=stream_name, sql=sql,
                start_time=1640995200000000, end_time=1641081600000000,
                use_cache=True, iteration=3
            )
            result_without_cache = self.mock.mock_cache_response(
                stream=stream_name, sql=sql,
                start_time=1640995200000000, end_time=1641081600000000,
                use_cache=False
            )
        else:
            result_with_cache = self.client.execute_query(
                stream=stream_name, sql=sql.format(stream=stream_name),
                start_time=1640995200000000, end_time=1641081600000000,
                use_cache=True
            )
            result_without_cache = self.client.execute_query(
                stream=stream_name, sql=sql.format(stream=stream_name),
                start_time=1640995200000000, end_time=1641081600000000,
                use_cache=False
            )
        
        # Validate both responses
        validation_with = self.validator.validate_response_structure(result_with_cache)
        validation_without = self.validator.validate_response_structure(result_without_cache)
        
        assert validation_with.passed, "Cache-enabled query should be valid"
        assert validation_without.passed, "Cache-disabled query should be valid"
        
        if self.use_mock:
            # Mock should show clear difference
            assert result_with_cache['cached_ratio'] > result_without_cache['cached_ratio']
            assert result_with_cache['took'] < result_without_cache['took']