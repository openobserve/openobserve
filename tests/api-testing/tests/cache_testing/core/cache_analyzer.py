"""
Cache Analyzer - DRY Analysis and Reporting
Centralized analysis logic for cache testing results.
"""
import time
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass


@dataclass
class CacheAnalysisReport:
    """Comprehensive cache analysis report."""
    test_name: str
    duration_seconds: float
    total_queries: int
    cache_effectiveness: str
    performance_improvement: float
    detailed_metrics: Dict[str, Any]
    recommendations: List[str]
    success: bool


class CacheAnalyzer:
    """Unified cache analysis and reporting."""
    
    def __init__(self):
        self.analysis_history = []
    
    def analyze_cache_progression(self, results: List[Dict[str, Any]], 
                                test_name: str = "cache_test") -> CacheAnalysisReport:
        """
        Analyze cache progression across multiple queries.
        
        Args:
            results: List of query results from CacheClient
            test_name: Name of the test for reporting
            
        Returns:
            Comprehensive analysis report
        """
        if not results:
            return self._create_empty_report(test_name, "No results to analyze")
        
        start_time = time.time()
        
        # Extract metrics
        result_ratios = [r.get('result_cache_ratio', 0) for r in results]
        file_ratios = [r.get('cached_ratio', 0) for r in results]
        response_times = [r.get('took', 0) for r in results]
        client_times = [r.get('client_time_ms', 0) for r in results]
        
        # Calculate improvements
        performance_improvement = self._calculate_performance_improvement(response_times)
        cache_effectiveness = self._determine_cache_effectiveness(result_ratios, file_ratios)
        
        # Generate recommendations
        recommendations = self._generate_recommendations(results, result_ratios, file_ratios, response_times)
        
        # Detailed metrics
        detailed_metrics = {
            'result_cache_progression': result_ratios,
            'file_cache_progression': file_ratios,
            'response_time_progression': response_times,
            'client_time_progression': client_times,
            'avg_result_cache': sum(result_ratios) / len(result_ratios),
            'avg_file_cache': sum(file_ratios) / len(file_ratios),
            'avg_response_time': sum(response_times) / len(response_times),
            'max_result_cache': max(result_ratios),
            'max_file_cache': max(file_ratios),
            'min_response_time': min(response_times),
            'cache_stability': self._calculate_cache_stability(result_ratios, file_ratios),
            'first_query_time': response_times[0] if response_times else 0,
            'last_query_time': response_times[-1] if response_times else 0,
            'total_data_scanned': sum(r.get('scan_size', 0) for r in results),
            'total_records_scanned': sum(r.get('scan_records', 0) for r in results)
        }
        
        # Determine success
        success = (
            max(result_ratios) > 0 or max(file_ratios) > 0 or  # Some cache activity
            performance_improvement > 0.1  # Or performance improvement
        )
        
        analysis_time = time.time() - start_time
        
        report = CacheAnalysisReport(
            test_name=test_name,
            duration_seconds=analysis_time,
            total_queries=len(results),
            cache_effectiveness=cache_effectiveness,
            performance_improvement=performance_improvement,
            detailed_metrics=detailed_metrics,
            recommendations=recommendations,
            success=success
        )
        
        self.analysis_history.append(report)
        return report
    
    def compare_cache_scenarios(self, scenario_results: Dict[str, List[Dict[str, Any]]]) -> Dict[str, Any]:
        """
        Compare multiple cache testing scenarios.
        
        Args:
            scenario_results: Dictionary mapping scenario names to their results
            
        Returns:
            Comparative analysis
        """
        comparisons = {}
        
        for scenario_name, results in scenario_results.items():
            analysis = self.analyze_cache_progression(results, scenario_name)
            comparisons[scenario_name] = {
                'cache_effectiveness': analysis.cache_effectiveness,
                'performance_improvement': analysis.performance_improvement,
                'avg_result_cache': analysis.detailed_metrics['avg_result_cache'],
                'avg_file_cache': analysis.detailed_metrics['avg_file_cache'],
                'avg_response_time': analysis.detailed_metrics['avg_response_time'],
                'success': analysis.success
            }
        
        # Find best performing scenario
        best_scenario = max(comparisons.items(), 
                          key=lambda x: x[1]['performance_improvement'])
        
        return {
            'scenario_comparisons': comparisons,
            'best_performing_scenario': best_scenario[0],
            'best_performance_improvement': best_scenario[1]['performance_improvement'],
            'total_scenarios_tested': len(scenario_results),
            'successful_scenarios': sum(1 for comp in comparisons.values() if comp['success'])
        }
    
    def _calculate_performance_improvement(self, response_times: List[int]) -> float:
        """Calculate performance improvement percentage."""
        if len(response_times) < 2:
            return 0.0
        
        first_time = response_times[0]
        last_time = response_times[-1]
        
        if first_time == 0:
            return 0.0
        
        improvement = (first_time - last_time) / first_time
        return max(0.0, improvement)  # Don't return negative improvements
    
    def _determine_cache_effectiveness(self, result_ratios: List[int], 
                                     file_ratios: List[int]) -> str:
        """Determine overall cache effectiveness level."""
        max_result = max(result_ratios) if result_ratios else 0
        max_file = max(file_ratios) if file_ratios else 0
        avg_result = sum(result_ratios) / len(result_ratios) if result_ratios else 0
        avg_file = sum(file_ratios) / len(file_ratios) if file_ratios else 0
        
        # Prioritize result cache effectiveness
        if avg_result >= 80:
            return "excellent_result_cache"
        elif avg_file >= 80:
            return "excellent_file_cache"
        elif avg_result >= 50:
            return "good_result_cache"
        elif avg_file >= 50:
            return "good_file_cache"
        elif max_result > 10 or max_file > 10:
            return "partial_cache_activity"
        elif max_result > 0 or max_file > 0:
            return "minimal_cache_activity"
        else:
            return "no_cache_activity"
    
    def _calculate_cache_stability(self, result_ratios: List[int], 
                                 file_ratios: List[int]) -> str:
        """Calculate cache stability across queries."""
        if len(result_ratios) < 2:
            return "insufficient_data"
        
        # Calculate variance in cache ratios (excluding first query)
        stable_result_ratios = result_ratios[1:]  # Skip first query
        stable_file_ratios = file_ratios[1:]
        
        if not stable_result_ratios:
            return "insufficient_data"
        
        result_variance = len(set(stable_result_ratios))
        file_variance = len(set(stable_file_ratios))
        
        # Low variance indicates stable cache
        if result_variance <= 2 and file_variance <= 2:
            return "highly_stable"
        elif result_variance <= 3 and file_variance <= 3:
            return "moderately_stable"
        else:
            return "variable"
    
    def _generate_recommendations(self, results: List[Dict[str, Any]], 
                                result_ratios: List[int], file_ratios: List[int],
                                response_times: List[int]) -> List[str]:
        """Generate actionable recommendations based on analysis."""
        recommendations = []
        
        max_result_cache = max(result_ratios) if result_ratios else 0
        max_file_cache = max(file_ratios) if file_ratios else 0
        avg_response_time = sum(response_times) / len(response_times) if response_times else 0
        
        # Cache activity recommendations
        if max_result_cache == 0 and max_file_cache == 0:
            recommendations.extend([
                "No cache activity detected - check data volume and query patterns",
                "Verify cache configuration is enabled in OpenObserve",
                "Consider testing with larger datasets or historical data"
            ])
        elif max_file_cache > 0 and max_result_cache == 0:
            recommendations.extend([
                "File cache is working but result cache is not active",
                "This is normal behavior - result cache requires specific conditions",
                "File cache provides good performance benefits"
            ])
        
        # Performance recommendations
        if avg_response_time > 1000:  # > 1 second
            recommendations.append("Consider optimizing queries or increasing cache effectiveness")
        elif avg_response_time > 500:  # > 500ms
            recommendations.append("Response times are acceptable but could be improved with better cache hits")
        
        # Data volume recommendations
        total_records = sum(r.get('total', 0) for r in results)
        if total_records < 1000:
            recommendations.append("Low data volume may limit cache effectiveness - consider testing with more data")
        
        # Query pattern recommendations
        if len(results) >= 3:
            time_variance = len(set(response_times[1:]))  # Exclude first query
            if time_variance > 3:
                recommendations.append("High response time variance - cache behavior may be inconsistent")
        
        return recommendations
    
    def _create_empty_report(self, test_name: str, reason: str) -> CacheAnalysisReport:
        """Create empty analysis report for error cases."""
        return CacheAnalysisReport(
            test_name=test_name,
            duration_seconds=0.0,
            total_queries=0,
            cache_effectiveness="no_data",
            performance_improvement=0.0,
            detailed_metrics={},
            recommendations=[f"Analysis failed: {reason}"],
            success=False
        )
    
    def get_analysis_summary(self) -> Dict[str, Any]:
        """Get summary of all analyses performed."""
        if not self.analysis_history:
            return {"total_analyses": 0, "message": "No analyses performed yet"}
        
        successful_analyses = [a for a in self.analysis_history if a.success]
        
        return {
            "total_analyses": len(self.analysis_history),
            "successful_analyses": len(successful_analyses),
            "success_rate": len(successful_analyses) / len(self.analysis_history),
            "avg_performance_improvement": sum(a.performance_improvement for a in successful_analyses) / len(successful_analyses) if successful_analyses else 0,
            "most_recent_test": self.analysis_history[-1].test_name,
            "cache_effectiveness_distribution": self._get_effectiveness_distribution()
        }
    
    def _get_effectiveness_distribution(self) -> Dict[str, int]:
        """Get distribution of cache effectiveness levels."""
        distribution = {}
        for analysis in self.analysis_history:
            effectiveness = analysis.cache_effectiveness
            distribution[effectiveness] = distribution.get(effectiveness, 0) + 1
        return distribution


def create_cache_analyzer() -> CacheAnalyzer:
    """Factory function to create cache analyzer."""
    return CacheAnalyzer()