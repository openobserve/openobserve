package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.17.0"
)

// Config holds the configuration for metrics ingestion
type Config struct {
	Endpoint    string
	Username    string
	Password    string
	OrgID       string
	Iterations  int
	Continuous  bool
	Duration    int
	Interval    int
	Environment string
}

// MetricsGenerator generates sample metrics
type MetricsGenerator struct {
	meter  metric.Meter
	config *Config
	rand   *rand.Rand
}

// NewMetricsGenerator creates a new metrics generator
func NewMetricsGenerator(config *Config) *MetricsGenerator {
	return &MetricsGenerator{
		config: config,
		rand:   rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

// setupOTLPExporter sets up the OTLP metrics exporter
func (mg *MetricsGenerator) setupOTLPExporter(ctx context.Context) (*sdkmetric.MeterProvider, error) {
	// Build the endpoint URL
	endpoint := mg.config.Endpoint
	if endpoint == "" {
		endpoint = "localhost:5080"
	}

	// Configure headers for authentication
	headers := map[string]string{
		"Authorization":        fmt.Sprintf("Basic %s", basicAuth(mg.config.Username, mg.config.Password)),
		"stream-name":          "default",
	}

	// Determine if we should use TLS based on endpoint
	useTLS := strings.HasPrefix(endpoint, "https://") || strings.Contains(endpoint, "zinclabs.dev")

	// Remove https:// prefix if present for OTLP endpoint configuration
	endpoint = strings.TrimPrefix(endpoint, "https://")
	endpoint = strings.TrimPrefix(endpoint, "http://")

	// Create OTLP HTTP exporter with appropriate security settings
	var exporterOpts []otlpmetrichttp.Option
	exporterOpts = append(exporterOpts,
		otlpmetrichttp.WithEndpoint(endpoint),
		otlpmetrichttp.WithURLPath("/api/"+mg.config.OrgID+"/v1/metrics"),
		otlpmetrichttp.WithHeaders(headers),
	)

	if !useTLS {
		exporterOpts = append(exporterOpts, otlpmetrichttp.WithInsecure())
	}

	exporter, err := otlpmetrichttp.New(ctx, exporterOpts...)
	if err != nil {
		return nil, fmt.Errorf("failed to create OTLP exporter: %w", err)
	}

	// Create resource with service information
	res := resource.NewWithAttributes(
		semconv.SchemaURL,
		semconv.ServiceName("metrics-generator"),
		semconv.ServiceVersion("1.0.0"),
		semconv.DeploymentEnvironment(mg.config.Environment),
	)

	// Create meter provider with the exporter
	meterProvider := sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(exporter,
			sdkmetric.WithInterval(time.Duration(mg.config.Interval)*time.Millisecond))),
		sdkmetric.WithResource(res),
	)

	return meterProvider, nil
}

// getRegionForCountry returns the region for a given country code
func (mg *MetricsGenerator) getRegionForCountry(code string) string {
	regions := map[string]string{
		"US": "North America",
		"CA": "North America",
		"GB": "Europe",
		"DE": "Europe",
		"FR": "Europe",
		"JP": "Asia Pacific",
		"CN": "Asia Pacific",
		"IN": "Asia Pacific",
		"AU": "Asia Pacific",
		"BR": "South America",
	}
	if region, ok := regions[code]; ok {
		return region
	}
	return "Unknown"
}

// generateMetrics generates sample metrics data
func (mg *MetricsGenerator) generateMetrics(ctx context.Context, meter metric.Meter) error {
	// Create metrics
	upGauge, err := meter.Float64ObservableGauge("up",
		metric.WithDescription("Service up status"),
		metric.WithUnit("1"))
	if err != nil {
		return err
	}

	cpuGauge, err := meter.Float64ObservableGauge("cpu_usage",
		metric.WithDescription("CPU usage percentage"),
		metric.WithUnit("%"))
	if err != nil {
		return err
	}

	memoryGauge, err := meter.Float64ObservableGauge("memory_usage",
		metric.WithDescription("Memory usage in MB"),
		metric.WithUnit("MB"))
	if err != nil {
		return err
	}

	requestCountGauge, err := meter.Float64ObservableGauge("request_count",
		metric.WithDescription("Total number of requests"),
		metric.WithUnit("count"))
	if err != nil {
		return err
	}

	requestDurationGauge, err := meter.Float64ObservableGauge("request_duration",
		metric.WithDescription("Request duration in milliseconds"),
		metric.WithUnit("ms"))
	if err != nil {
		return err
	}

	// Geographic location metric with lat/long
	geoLocationGauge, err := meter.Float64ObservableGauge("geo_location_latency",
		metric.WithDescription("Latency by geographic location"),
		metric.WithUnit("ms"))
	if err != nil {
		return err
	}

	// Country-based traffic metric
	countryTrafficGauge, err := meter.Float64ObservableGauge("country_traffic",
		metric.WithDescription("Traffic volume by country"),
		metric.WithUnit("requests"))
	if err != nil {
		return err
	}

	// Register callbacks for observable gauges
	_, err = meter.RegisterCallback(func(_ context.Context, o metric.Observer) error {
		// Generate random values
		o.ObserveFloat64(upGauge, 1.0,
			metric.WithAttributes(
				semconv.ServiceName("test-service"),
				semconv.ServiceInstanceID(fmt.Sprintf("instance-%d", mg.rand.Intn(3)+1)),
			))

		o.ObserveFloat64(cpuGauge, float64(25+mg.rand.Intn(50)),
			metric.WithAttributes(
				semconv.ServiceName("test-service"),
				semconv.HostName(fmt.Sprintf("host-%d", mg.rand.Intn(3)+1)),
			))

		o.ObserveFloat64(memoryGauge, float64(4096+mg.rand.Intn(4096)),
			metric.WithAttributes(
				semconv.ServiceName("test-service"),
				semconv.HostName(fmt.Sprintf("host-%d", mg.rand.Intn(3)+1)),
			))

		o.ObserveFloat64(requestCountGauge, float64(100+mg.rand.Intn(900)),
			metric.WithAttributes(
				semconv.ServiceName("test-service"),
				semconv.HostName(fmt.Sprintf("host-%d", mg.rand.Intn(3)+1)),
			))

		o.ObserveFloat64(requestDurationGauge, float64(50+mg.rand.Intn(450)),
			metric.WithAttributes(
				semconv.ServiceName("test-service"),
				semconv.HostName(fmt.Sprintf("host-%d", mg.rand.Intn(3)+1)),
			))

		// Geographic locations with lat/long (major cities)
		locations := []struct {
			city     string
			lat      float64
			long     float64
			latency  float64
		}{
			{"New York", 40.7128, -74.0060, float64(20 + mg.rand.Intn(30))},
			{"London", 51.5074, -0.1278, float64(35 + mg.rand.Intn(40))},
			{"Tokyo", 35.6762, 139.6503, float64(80 + mg.rand.Intn(50))},
			{"Sydney", -33.8688, 151.2093, float64(120 + mg.rand.Intn(60))},
			{"Mumbai", 19.0760, 72.8777, float64(65 + mg.rand.Intn(45))},
			{"São Paulo", -23.5505, -46.6333, float64(95 + mg.rand.Intn(55))},
			{"Singapore", 1.3521, 103.8198, float64(70 + mg.rand.Intn(40))},
			{"Dubai", 25.2048, 55.2708, float64(55 + mg.rand.Intn(35))},
		}

		// Observe geo location metrics
		for _, loc := range locations {
			o.ObserveFloat64(geoLocationGauge, loc.latency,
				metric.WithAttributes(
					semconv.ServiceName("test-service"),
					attribute.String("city", loc.city),
					attribute.Float64("latitude", loc.lat),
					attribute.Float64("longitude", loc.long),
				))
		}

		// Country traffic data
		countries := []struct {
			country string
			code    string
			traffic float64
		}{
			{"United States", "US", float64(15000 + mg.rand.Intn(5000))},
			{"United Kingdom", "GB", float64(8000 + mg.rand.Intn(3000))},
			{"Germany", "DE", float64(7500 + mg.rand.Intn(2500))},
			{"France", "FR", float64(6500 + mg.rand.Intn(2000))},
			{"Japan", "JP", float64(9000 + mg.rand.Intn(3500))},
			{"China", "CN", float64(12000 + mg.rand.Intn(4000))},
			{"India", "IN", float64(11000 + mg.rand.Intn(4500))},
			{"Brazil", "BR", float64(5500 + mg.rand.Intn(2000))},
			{"Canada", "CA", float64(4500 + mg.rand.Intn(1500))},
			{"Australia", "AU", float64(3500 + mg.rand.Intn(1000))},
		}

		// Observe country traffic metrics
		for _, country := range countries {
			o.ObserveFloat64(countryTrafficGauge, country.traffic,
				metric.WithAttributes(
					semconv.ServiceName("test-service"),
					attribute.String("country", country.country),
					attribute.String("country_code", country.code),
					attribute.String("region", mg.getRegionForCountry(country.code)),
				))
		}

		return nil
	}, upGauge, cpuGauge, memoryGauge, requestCountGauge, requestDurationGauge, geoLocationGauge, countryTrafficGauge)
	if err != nil {
		return err
	}

	return nil
}

// ingestBatch performs batch ingestion
func (mg *MetricsGenerator) ingestBatch(ctx context.Context) error {
	fmt.Printf("Starting batch ingestion: %d iterations\n", mg.config.Iterations)
	fmt.Printf("Target: %s\n", mg.config.Endpoint)
	fmt.Printf("Organization: %s\n", mg.config.OrgID)
	fmt.Printf("Environment: %s\n", mg.config.Environment)
	fmt.Println("============================================")

	// Setup OTLP exporter
	meterProvider, err := mg.setupOTLPExporter(ctx)
	if err != nil {
		return fmt.Errorf("failed to setup OTLP exporter: %w", err)
	}
	defer func() {
		if err := meterProvider.Shutdown(ctx); err != nil {
			log.Printf("Error shutting down meter provider: %v", err)
		}
	}()

	// Get meter
	meter := meterProvider.Meter("metrics-generator")
	mg.meter = meter

	// Generate metrics
	if err := mg.generateMetrics(ctx, meter); err != nil {
		return fmt.Errorf("failed to generate metrics: %w", err)
	}

	// Run for specified iterations
	successCount := 0
	for i := 0; i < mg.config.Iterations; i++ {
		if i%10 == 0 || i == mg.config.Iterations-1 {
			fmt.Printf("Sending metrics batch %d of %d\n", i+1, mg.config.Iterations)
		}

		// Force flush to send metrics
		if err := meterProvider.ForceFlush(ctx); err != nil {
			log.Printf("Failed to flush metrics batch %d: %v", i+1, err)
		} else {
			successCount++
		}

		time.Sleep(100 * time.Millisecond)
	}

	fmt.Println("============================================")
	fmt.Printf("Batch ingestion completed: %d/%d successful\n", successCount, mg.config.Iterations)
	fmt.Printf("Success rate: %.1f%%\n", float64(successCount)/float64(mg.config.Iterations)*100)

	return nil
}

// ingestContinuous performs continuous ingestion
func (mg *MetricsGenerator) ingestContinuous(ctx context.Context) error {
	fmt.Printf("Starting continuous ingestion for %d seconds\n", mg.config.Duration)
	fmt.Printf("Target: %s\n", mg.config.Endpoint)
	fmt.Printf("Organization: %s\n", mg.config.OrgID)
	fmt.Printf("Environment: %s\n", mg.config.Environment)
	fmt.Printf("Interval: %dms\n", mg.config.Interval)
	fmt.Println("============================================")

	// Setup OTLP exporter
	meterProvider, err := mg.setupOTLPExporter(ctx)
	if err != nil {
		return fmt.Errorf("failed to setup OTLP exporter: %w", err)
	}
	defer func() {
		if err := meterProvider.Shutdown(ctx); err != nil {
			log.Printf("Error shutting down meter provider: %v", err)
		}
	}()

	// Get meter
	meter := meterProvider.Meter("metrics-generator")
	mg.meter = meter

	// Generate metrics
	if err := mg.generateMetrics(ctx, meter); err != nil {
		return fmt.Errorf("failed to generate metrics: %w", err)
	}

	// Run for specified duration
	timer := time.NewTimer(time.Duration(mg.config.Duration) * time.Second)
	ticker := time.NewTicker(time.Duration(mg.config.Interval) * time.Millisecond)
	defer ticker.Stop()

	batchCount := 0
	successCount := 0

	for {
		select {
		case <-timer.C:
			fmt.Println("============================================")
			fmt.Printf("Continuous ingestion completed: %d batches sent\n", batchCount)
			fmt.Printf("Successful batches: %d\n", successCount)
			fmt.Printf("Success rate: %.1f%%\n", float64(successCount)/float64(batchCount)*100)
			return nil
		case <-ticker.C:
			batchCount++
			if err := meterProvider.ForceFlush(ctx); err != nil {
				log.Printf("Failed to flush metrics batch %d: %v", batchCount, err)
			} else {
				successCount++
				if batchCount%10 == 0 {
					fmt.Printf("Sent %d batches successfully\n", batchCount)
				}
			}
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// basicAuth creates a basic auth string
func basicAuth(username, password string) string {
	auth := username + ":" + password
	return base64.StdEncoding.EncodeToString([]byte(auth))
}

// Alternative simple HTTP ingestion method (without OTLP SDK)
func (mg *MetricsGenerator) simpleHTTPIngest() error {
	fmt.Printf("Starting simple HTTP ingestion: %d iterations\n", mg.config.Iterations)

	// Determine protocol for display
	protocol := "http://"
	endpoint := mg.config.Endpoint
	if strings.Contains(endpoint, "zinclabs.dev") || strings.HasPrefix(endpoint, "https://") {
		protocol = "https://"
	}
	endpoint = strings.TrimPrefix(endpoint, "https://")
	endpoint = strings.TrimPrefix(endpoint, "http://")

	fmt.Printf("Target: %s%s\n", protocol, endpoint)
	fmt.Printf("Organization: %s\n", mg.config.OrgID)
	fmt.Printf("Environment: %s\n", mg.config.Environment)
	fmt.Println("============================================")

	client := &http.Client{Timeout: 10 * time.Second}
	successCount := 0

	for i := 0; i < mg.config.Iterations; i++ {
		if i%10 == 0 || i == mg.config.Iterations-1 {
			fmt.Printf("Sending metrics batch %d of %d\n", i+1, mg.config.Iterations)
		}

		// Generate metrics data
		metrics := mg.generateSimpleMetrics()

		// Send metrics
		if err := mg.sendSimpleMetrics(client, metrics); err != nil {
			log.Printf("Failed to send batch %d: %v", i+1, err)
		} else {
			successCount++
		}

		time.Sleep(100 * time.Millisecond)
	}

	fmt.Println("============================================")
	fmt.Printf("Ingestion completed: %d/%d successful\n", successCount, mg.config.Iterations)
	fmt.Printf("Success rate: %.1f%%\n", float64(successCount)/float64(mg.config.Iterations)*100)

	return nil
}

// generateSimpleMetrics generates metrics in OTLP JSON format
func (mg *MetricsGenerator) generateSimpleMetrics() map[string]interface{} {
	timestampNanos := time.Now().UnixNano()

	// Create OTLP JSON format for metrics
	return map[string]interface{}{
		"resourceMetrics": []map[string]interface{}{
			{
				"resource": map[string]interface{}{
					"attributes": []map[string]interface{}{
						{
							"key": "service.name",
							"value": map[string]interface{}{
								"stringValue": "metrics-generator",
							},
						},
						{
							"key": "deployment.environment",
							"value": map[string]interface{}{
								"stringValue": mg.config.Environment,
							},
						},
					},
				},
				"scopeMetrics": []map[string]interface{}{
					{
						"scope": map[string]interface{}{
							"name":    "metrics-generator",
							"version": "1.0.0",
						},
						"metrics": []map[string]interface{}{
							{
								"name":        "up",
								"description": "Service up status",
								"unit":        "1",
								"gauge": map[string]interface{}{
									"dataPoints": []map[string]interface{}{
										{
											"timeUnixNano": timestampNanos,
											"asDouble":     1.0,
											"attributes": []map[string]interface{}{
												{
													"key": "service",
													"value": map[string]interface{}{
														"stringValue": "test-service",
													},
												},
												{
													"key": "instance",
													"value": map[string]interface{}{
														"stringValue": fmt.Sprintf("instance-%d", mg.rand.Intn(3)+1),
													},
												},
											},
										},
									},
								},
							},
							{
								"name":        "cpu_usage",
								"description": "CPU usage percentage",
								"unit":        "%",
								"gauge": map[string]interface{}{
									"dataPoints": []map[string]interface{}{
										{
											"timeUnixNano": timestampNanos,
											"asDouble":     20.0 + mg.rand.Float64()*60.0,
											"attributes": []map[string]interface{}{
												{
													"key": "service",
													"value": map[string]interface{}{
														"stringValue": "test-service",
													},
												},
												{
													"key": "host",
													"value": map[string]interface{}{
														"stringValue": fmt.Sprintf("host-%d", mg.rand.Intn(3)+1),
													},
												},
											},
										},
									},
								},
							},
							{
								"name":        "memory_usage",
								"description": "Memory usage in MB",
								"unit":        "MB",
								"gauge": map[string]interface{}{
									"dataPoints": []map[string]interface{}{
										{
											"timeUnixNano": timestampNanos,
											"asDouble":     100.0 + mg.rand.Float64()*400.0,
											"attributes": []map[string]interface{}{
												{
													"key": "service",
													"value": map[string]interface{}{
														"stringValue": "test-service",
													},
												},
												{
													"key": "host",
													"value": map[string]interface{}{
														"stringValue": fmt.Sprintf("host-%d", mg.rand.Intn(3)+1),
													},
												},
											},
										},
									},
								},
							},
							{
								"name":        "request_count",
								"description": "Total number of requests",
								"unit":        "count",
								"gauge": map[string]interface{}{
									"dataPoints": []map[string]interface{}{
										{
											"timeUnixNano": timestampNanos,
											"asDouble":     float64(100 + mg.rand.Intn(900)),
											"attributes": []map[string]interface{}{
												{
													"key": "node",
													"value": map[string]interface{}{
														"stringValue": fmt.Sprintf("host-%d", mg.rand.Intn(3)+1),
													},
												},
												{
													"key": "service",
													"value": map[string]interface{}{
														"stringValue": "test-service",
													},
												},
												{
													"key": "region",
													"value": map[string]interface{}{
														"stringValue": fmt.Sprintf("us-%s-1", []string{"east", "west", "central"}[mg.rand.Intn(3)]),
													},
												},
											},
										},
									},
								},
							},
							{
								"name":        "request_duration",
								"description": "Request duration in milliseconds",
								"unit":        "ms",
								"gauge": map[string]interface{}{
									"dataPoints": []map[string]interface{}{
										{
											"timeUnixNano": timestampNanos,
											"asDouble":     float64(50 + mg.rand.Intn(450)),
											"attributes": []map[string]interface{}{
												{
													"key": "node",
													"value": map[string]interface{}{
														"stringValue": fmt.Sprintf("host-%d", mg.rand.Intn(3)+1),
													},
												},
												{
													"key": "instance",
													"value": map[string]interface{}{
														"stringValue": fmt.Sprintf("host-%d:8080", mg.rand.Intn(3)+1),
													},
												},
												{
													"key": "service",
													"value": map[string]interface{}{
														"stringValue": "test-service",
													},
												},
												{
													"key": "region",
													"value": map[string]interface{}{
														"stringValue": fmt.Sprintf("us-%s-1", []string{"east", "west", "central"}[mg.rand.Intn(3)]),
													},
												},
											},
										},
									},
								},
							},
							{
								"name":        "geo_location_latency",
								"description": "Latency by geographic location",
								"unit":        "ms",
								"gauge": map[string]interface{}{
									"dataPoints": []map[string]interface{}{
										{
											"timeUnixNano": timestampNanos,
											"asDouble":     float64(20 + mg.rand.Intn(100)),
											"attributes": []map[string]interface{}{
												{
													"key": "city",
													"value": map[string]interface{}{
														"stringValue": []string{"New York", "London", "Tokyo", "Sydney", "Mumbai"}[mg.rand.Intn(5)],
													},
												},
												{
													"key": "latitude",
													"value": map[string]interface{}{
														"doubleValue": []float64{40.7128, 51.5074, 35.6762, -33.8688, 19.0760}[mg.rand.Intn(5)],
													},
												},
												{
													"key": "longitude",
													"value": map[string]interface{}{
														"doubleValue": []float64{-74.0060, -0.1278, 139.6503, 151.2093, 72.8777}[mg.rand.Intn(5)],
													},
												},
												{
													"key": "service",
													"value": map[string]interface{}{
														"stringValue": "test-service",
													},
												},
											},
										},
									},
								},
							},
							{
								"name":        "country_traffic",
								"description": "Traffic volume by country",
								"unit":        "requests",
								"gauge": map[string]interface{}{
									"dataPoints": []map[string]interface{}{
										{
											"timeUnixNano": timestampNanos,
											"asDouble":     float64(5000 + mg.rand.Intn(15000)),
											"attributes": []map[string]interface{}{
												{
													"key": "country",
													"value": map[string]interface{}{
														"stringValue": []string{"United States", "United Kingdom", "Germany", "Japan", "India"}[mg.rand.Intn(5)],
													},
												},
												{
													"key": "country_code",
													"value": map[string]interface{}{
														"stringValue": []string{"US", "GB", "DE", "JP", "IN"}[mg.rand.Intn(5)],
													},
												},
												{
													"key": "region",
													"value": map[string]interface{}{
														"stringValue": []string{"North America", "Europe", "Asia Pacific"}[mg.rand.Intn(3)],
													},
												},
												{
													"key": "service",
													"value": map[string]interface{}{
														"stringValue": "test-service",
													},
												},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}
}

// sendSimpleMetrics sends metrics via HTTP POST
func (mg *MetricsGenerator) sendSimpleMetrics(client *http.Client, metrics map[string]interface{}) error {
	jsonData, err := json.Marshal(metrics)
	if err != nil {
		return fmt.Errorf("failed to marshal metrics: %w", err)
	}

	// Build URL with proper protocol
	endpoint := mg.config.Endpoint
	protocol := "http://"
	if strings.Contains(endpoint, "zinclabs.dev") || strings.HasPrefix(endpoint, "https://") {
		protocol = "https://"
	}
	endpoint = strings.TrimPrefix(endpoint, "https://")
	endpoint = strings.TrimPrefix(endpoint, "http://")

	// Use the correct endpoint for metrics ingestion
	url := fmt.Sprintf("%s%s/api/%s/v1/metrics", protocol, endpoint, mg.config.OrgID)
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.SetBasicAuth(mg.config.Username, mg.config.Password)

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	return nil
}

func main() {
	// Parse command line flags
	var config Config
	flag.StringVar(&config.Endpoint, "endpoint", "localhost:5080", "OpenObserve endpoint")
	flag.StringVar(&config.Username, "username", "root@example.com", "Username for authentication")
	flag.StringVar(&config.Password, "password", "Complexpass#123", "Password for authentication")
	flag.StringVar(&config.OrgID, "org", "default", "Organization ID")
	flag.StringVar(&config.Environment, "env", "development", "Environment name")
	flag.IntVar(&config.Iterations, "iterations", 10, "Number of iterations for batch mode")
	flag.BoolVar(&config.Continuous, "continuous", false, "Enable continuous mode")
	flag.IntVar(&config.Duration, "duration", 60, "Duration in seconds for continuous mode")
	flag.IntVar(&config.Interval, "interval", 5000, "Interval in milliseconds between metrics")
	useSimple := flag.Bool("simple", true, "Use simple HTTP ingestion instead of OTLP")
	flag.Parse()

	// Print configuration
	fmt.Println("============================================")
	fmt.Println("OpenObserve Metrics Ingestion Tool")
	fmt.Println("============================================")

	// Create context with cancellation
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigChan
		fmt.Println("\nReceived interrupt signal, shutting down...")
		cancel()
	}()

	// Create metrics generator
	generator := NewMetricsGenerator(&config)

	// Run ingestion
	var err error
	if *useSimple {
		// Use simple HTTP ingestion
		if config.Continuous {
			fmt.Println("Note: Simple mode doesn't support continuous ingestion, using batch mode")
			err = generator.simpleHTTPIngest()
		} else {
			err = generator.simpleHTTPIngest()
		}
	} else {
		// Use OTLP ingestion
		if config.Continuous {
			err = generator.ingestContinuous(ctx)
		} else {
			err = generator.ingestBatch(ctx)
		}
	}

	if err != nil {
		log.Fatalf("Ingestion failed: %v", err)
	}

	fmt.Println("\nMetrics ingestion completed successfully!")
	fmt.Println("View metrics in OpenObserve:")
	fmt.Println("  1. Navigate to Metrics page")
	fmt.Println("  2. Try these queries:")
	fmt.Println("     - up")
	fmt.Println("     - cpu_usage")
	fmt.Println("     - memory_usage")
	fmt.Println("     - request_count")
	fmt.Println("     - request_duration")
	fmt.Println("     - geo_location_latency (with lat/long data)")
	fmt.Println("     - country_traffic (with country data)")
}