import os
import sys
from opentelemetry import logs
from opentelemetry.sdk.logs import LogEmitterProvider, BatchLogProcessor
from opentelemetry.exporter.otlp.proto.grpc.logs_exporter import OTLPLogExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.semconv.resource import ResourceAttributes

# Initialize OpenTelemetry Logging
def init_otel_logging():
    resource = Resource.create({
        ResourceAttributes.SERVICE_NAME: "user-script-service",
        ResourceAttributes.SERVICE_INSTANCE_ID: os.getenv("POD_NAME", "unknown-pod"),
    })

    log_emitter_provider = LogEmitterProvider(resource=resource)
    logs.set_log_emitter_provider(log_emitter_provider)

    # Configure the OTLP exporter
    otlp_exporter = OTLPLogExporter(endpoint="http://otel-collector:4317", insecure=True)
    log_processor = BatchLogProcessor(otlp_exporter)

    log_emitter_provider.add_log_processor(log_processor)

    logger = logs.get_logger(__name__)
    logger.info("OpenTelemetry logging initialized.")
    return logger

# Main function to run the user script
def run_user_script(logger):
    try:
        # Get the user script content from the environment variable
        user_script = os.getenv("USER_SCRIPT", None)

        if not user_script:
            logger.error("No user script provided in the USER_SCRIPT environment variable.")
            sys.exit(1)

        logger.info("Executing user script from environment variable.")
        exec(user_script)

    except Exception as e:
        logger.error(f"An error occurred during script execution: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    # Initialize OpenTelemetry logging
    logger = init_otel_logging()

    # Execute the user-provided script
    run_user_script(logger)