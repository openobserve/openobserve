"""
Sourcemap Test Helpers for Pytest

Utility functions for sourcemap API testing.
"""

import os
import subprocess
import time
import signal
import logging
import json
from pathlib import Path

logger = logging.getLogger(__name__)

# Path to static fixtures (pre-built sourcemaps)
FIXTURES_DIR = Path(__file__).parent.parent / "fixtures" / "sourcemaps"

# Path to test app (deprecated - tests now use static fixtures)
TEST_APP_DIR = Path(__file__).parent.parent.parent / "ui-testing" / "MD_Files" / "Sourcemaps" / "o2-sourcemap-test-app"


def load_static_sourcemaps(config=None):
    """
    Load pre-built sourcemaps from fixtures directory.

    This replaces the dynamic build approach - tests use static sourcemaps
    committed to the repository instead of building the test app.

    Args:
        config (dict): Configuration options (service, env, version, org)

    Returns:
        dict: Build result compatible with test expectations
    """
    # Default config
    if config is None:
        config = {}

    service = config.get('service', 'o2-sourcemap-test-app')
    env = config.get('env', 'testing')
    version = config.get('version', '1.0.0-static')
    org = config.get('org', 'default')

    logger.info(f"Loading static sourcemaps: service={service}, env={env}, version={version}")

    # Load hashes from JSON
    hashes_file = FIXTURES_DIR / "hashes.json"
    if not hashes_file.exists():
        raise FileNotFoundError(f"Hashes file not found: {hashes_file}")

    with open(hashes_file, 'r') as f:
        hashes = json.load(f)

    logger.info(f"Loaded content hashes: {hashes}")

    # Path to sourcemaps ZIP
    sourcemaps_zip = FIXTURES_DIR / "sourcemaps.zip"
    if not sourcemaps_zip.exists():
        raise FileNotFoundError(f"Sourcemaps ZIP not found: {sourcemaps_zip}")

    logger.info(f"Using sourcemaps ZIP: {sourcemaps_zip}")

    return {
        'app_dir': str(FIXTURES_DIR),
        'dist_path': str(FIXTURES_DIR),
        'hashes': hashes,
        'sourcemaps_zip': str(sourcemaps_zip),
        'config': {'service': service, 'env': env, 'version': version, 'org': org}
    }


def build_test_app(rum_token, config=None):
    """
    Build the sourcemap test app with updated RUM SDK configuration.

    Args:
        rum_token (str): RUM token from API
        config (dict): Build configuration options

    Returns:
        dict: Build result with hashes and paths
    """
    if config is None:
        config = {}

    site = config.get('site', 'localhost:5080')
    insecure_http = config.get('insecureHTTP', True)
    service = config.get('service', 'o2-sourcemap-test-app')
    env = config.get('env', 'testing')
    version = config.get('version', '1.0.0-api-test')
    org = config.get('org', 'default')

    logger.info(f"Building test app: service={service}, env={env}, version={version}")

    # Path to config file
    config_path = TEST_APP_DIR / "src" / "index.js"

    # Read current config
    with open(config_path, 'r') as f:
        config_content = f.read()

    # Update SDK config
    import re
    config_content = re.sub(r"clientToken:\s*['\"][^'\"]*['\"]", f"clientToken: '{rum_token}'", config_content)
    config_content = re.sub(r"site:\s*['\"][^'\"]*['\"]", f"site: '{site}'", config_content)
    config_content = re.sub(r"insecureHTTP:\s*(?:true|false)", f"insecureHTTP: {str(insecure_http).lower()}", config_content)
    config_content = re.sub(r"service:\s*['\"][^'\"]*['\"]", f"service: '{service}'", config_content)
    config_content = re.sub(r"env:\s*['\"][^'\"]*['\"]", f"env: '{env}'", config_content)
    config_content = re.sub(r"version:\s*['\"][^'\"]*['\"]", f"version: '{version}'", config_content)
    config_content = re.sub(r"organizationIdentifier:\s*['\"][^'\"]*['\"]", f"organizationIdentifier: '{org}'", config_content)

    # Write updated config
    with open(config_path, 'w') as f:
        f.write(config_content)

    logger.info("Updated SDK configuration")

    # Build app
    logger.info("Running npm run build...")
    result = subprocess.run(
        ['npm', 'run', 'build'],
        cwd=TEST_APP_DIR,
        capture_output=True,
        text=True,
        timeout=60
    )

    if result.returncode != 0:
        logger.error(f"Build failed: {result.stderr}")
        raise Exception(f"Build failed: {result.stderr}")

    logger.info("Build completed successfully")

    # Extract content hashes
    dist_path = TEST_APP_DIR / "dist"
    dist_files = os.listdir(dist_path)

    hashes = {
        'main': extract_hash(dist_files, 'main', '.js'),
        'lazy_module': extract_hash(dist_files, 'lazy-module', '.js'),
        'profiler': extract_hash(dist_files, 'profiler', '.js'),
        'recorder': extract_hash(dist_files, 'recorder', '.js')
    }

    logger.info(f"Extracted hashes: {hashes}")

    # Create sourcemaps ZIP
    sourcemaps_zip = dist_path / "sourcemaps.zip"

    # Remove old ZIP if exists
    if sourcemaps_zip.exists():
        sourcemaps_zip.unlink()

    subprocess.run(
        ['zip', 'sourcemaps.zip'] + [f for f in dist_files if f.endswith('.map')],
        cwd=dist_path,
        check=True,
        capture_output=True
    )

    logger.info(f"Created sourcemaps ZIP at {sourcemaps_zip}")

    return {
        'app_dir': str(TEST_APP_DIR),
        'dist_path': str(dist_path),
        'hashes': hashes,
        'sourcemaps_zip': str(sourcemaps_zip),
        'config': {'service': service, 'env': env, 'version': version, 'org': org}
    }


def extract_hash(files, prefix, ext):
    """Extract content hash from filename."""
    import re
    pattern = re.compile(f"{prefix}\\.(.*?)\\{ext}")

    for file in files:
        if file.startswith(prefix) and file.endswith(ext) and not file.endswith('.map'):
            match = pattern.search(file)
            if match:
                return match.group(1)

    raise Exception(f"Could not find file matching {prefix}*{ext}")


def serve_test_app(dist_path, port=8089):
    """
    Start HTTP server to serve test app.

    Args:
        dist_path (str): Path to dist directory
        port (int): Port number

    Returns:
        dict: Server process info
    """
    logger.info(f"Starting HTTP server on port {port}...")

    # Start Python HTTP server
    process = subprocess.Popen(
        ['python3', '-m', 'http.server', str(port)],
        cwd=dist_path,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        preexec_fn=os.setsid  # Create new process group
    )

    # Wait for server to be ready
    time.sleep(2)

    logger.info(f"HTTP server started (PID: {process.pid})")

    return {
        'process': process,
        'pid': process.pid,
        'port': port,
        'url': f'http://localhost:{port}'
    }


def stop_test_app_server(server_info):
    """Stop the HTTP server."""
    if not server_info or 'pid' not in server_info:
        logger.warning("No server PID provided, skipping stop")
        return

    pid = server_info['pid']
    logger.info(f"Stopping HTTP server (PID: {pid})...")

    try:
        # Kill process group
        os.killpg(os.getpgid(pid), signal.SIGTERM)
        logger.info("HTTP server stopped")
    except Exception as e:
        logger.warning(f"Failed to stop server: {e}")
        try:
            # Try direct kill
            os.kill(pid, signal.SIGKILL)
        except:
            pass

    # Also kill any processes on the port
    port = server_info.get('port', 8089)
    try:
        # Use list-based args to avoid shell injection
        result = subprocess.run(
            ['lsof', '-ti', f':{port}'],
            capture_output=True,
            text=True,
            check=False
        )
        if result.stdout.strip():
            pids = result.stdout.strip().split('\n')
            for pid in pids:
                try:
                    os.kill(int(pid), signal.SIGKILL)
                except (ValueError, ProcessLookupError):
                    pass
    except Exception:
        pass


def upload_sourcemaps(session, base_url, org_id, zip_path, service, env, version):
    """Upload sourcemaps to OpenObserve."""
    logger.info(f"Uploading sourcemaps: service={service}, env={env}, version={version}")

    with open(zip_path, 'rb') as f:
        files = {'file': ('sourcemaps.zip', f, 'application/zip')}
        data = {
            'service': service,
            'env': env,
            'version': version
        }

        response = session.post(
            f"{base_url}api/{org_id}/sourcemaps",
            files=files,
            data=data
        )

    logger.info(f"Upload response: {response.status_code}")

    if response.status_code not in [200, 201]:
        logger.error(f"Upload failed: {response.text}")
        raise Exception(f"Upload failed: {response.status_code} - {response.text}")

    return response


def list_sourcemaps(session, base_url, org_id, service=None, env=None, version=None):
    """List sourcemaps from OpenObserve."""
    params = {}
    if service:
        params['service'] = service
    if env:
        params['env'] = env
    if version:
        params['version'] = version

    response = session.get(
        f"{base_url}api/{org_id}/sourcemaps",
        params=params
    )

    if response.status_code != 200:
        logger.error(f"List failed: {response.text}")
        raise Exception(f"List failed: {response.status_code}")

    return response.json()


def delete_sourcemaps(session, base_url, org_id, service, env, version):
    """Delete sourcemaps from OpenObserve."""
    logger.info(f"Deleting sourcemaps: service={service}, env={env}, version={version}")

    params = {
        'service': service,
        'env': env,
        'version': version
    }

    response = session.delete(
        f"{base_url}api/{org_id}/sourcemaps",
        params=params
    )

    logger.info(f"Delete response: {response.status_code}")

    return response


def resolve_stacktrace(session, base_url, org_id, service, env, version, stacktrace):
    """Resolve minified stacktrace via sourcemap API."""
    logger.info(f"Resolving stacktrace for {service}:{version}")

    payload = {
        'service': service,
        'env': env,
        'version': version,
        'stacktrace': stacktrace
    }

    response = session.post(
        f"{base_url}api/{org_id}/sourcemaps/stacktrace",
        json=payload
    )

    if response.status_code != 200:
        logger.error(f"Resolution failed: {response.text}")
        raise Exception(f"Resolution failed: {response.status_code}")

    return response.json()


def get_expected_stacktrace(error_type, hashes):
    """Generate expected stacktrace with actual content hashes."""
    templates = {
        'type_error': f"""TypeError: Cannot read properties of undefined (reading 'profile')
    at Ht @ http://localhost:8089/main.{hashes['main']}.js:1:186484
    at http://localhost:8089/main.{hashes['main']}.js:1:186818""",

        'reference_error': f"""ReferenceError: undeclaredVariableThatDoesNotExist is not defined
    at Zt @ http://localhost:8089/main.{hashes['main']}.js:1:186511""",

        'range_error': f"""RangeError: Invalid array length
    at Kt @ http://localhost:8089/main.{hashes['main']}.js:1:186576""",

        'custom_error': f"""PaymentError: Insufficient funds in account
    at Jt @ http://localhost:8089/main.{hashes['main']}.js:1:186730""",

        'cross_chunk': f"""TypeError: Cannot read properties of null (reading 'timestamp')
    at u @ http://localhost:8089/lazy-module.{hashes['lazy_module']}.js:1:131
    at http://localhost:8089/main.{hashes['main']}.js:1:186963"""
    }

    if error_type not in templates:
        raise ValueError(f"Unknown error type: {error_type}")

    return templates[error_type]


def get_rum_token(session, base_url, org_id):
    """Get RUM token from OpenObserve."""
    logger.info("Fetching RUM token...")

    response = session.get(f"{base_url}api/{org_id}/rumtoken")

    if response.status_code != 200:
        logger.error(f"Failed to get RUM token: {response.text}")
        raise Exception(f"Failed to get RUM token: {response.status_code}")

    data = response.json()
    # Use same pattern as ingest_rum_errors.py to handle nested response structure
    token = data.get('data', {}).get('rum_token') or data.get('rum_token')

    if not token:
        logger.error(f"RUM token is empty in response: {data}")
        raise Exception("RUM token not found in response")

    logger.info(f"RUM token retrieved: {token}")

    return token


# Expected resolution results for validation
EXPECTED_RESOLUTIONS = {
    'type_error': {
        'file': 'src/errors/sync-errors.js',
        'line': 10,
        'column': 15,
        'function': 'profile',
        'contains': 'return user.profile.name'
    },
    'reference_error': {
        'file': 'src/errors/sync-errors.js',
        'line': 16,
        'contains': 'undeclaredVariableThatDoesNotExist'
    },
    'range_error': {
        'file': 'src/errors/sync-errors.js',
        'line': 22,
        'contains': 'new Array(-1)'
    },
    'custom_error': {
        'file': 'src/errors/sync-errors.js',
        'line': 36,
        'contains': 'PaymentError'
    },
    'cross_chunk': {
        'file': 'src/errors/lazy-module.js',
        'line': 20,
        'function': 'triggerLazyModuleError'
    }
}
