# Use a lightweight Python base image
FROM python:3.9-slim

# Set the working directory in the container
WORKDIR /app

# Install required Python libraries
RUN pip install --no-cache-dir \
    opentelemetry-api \
    opentelemetry-sdk \
    opentelemetry-exporter-otlp \
    opentelemetry-instrumentation \
    opentelemetry-semantic-conventions

# Copy the base Python logic that initializes OpenTelemetry
COPY otel_logging.py /app/otel_logging.py

# Set the default command to run user-provided logic
ENTRYPOINT ["python", "-u", "/app/runtime.py"]