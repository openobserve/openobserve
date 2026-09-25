"""A sourcemap ZIP with no valid pairs must error  [regression #12951].

Uploading a ZIP that contained no usable source-map files reported success, so
an operator believed their maps were in place while error stack traces stayed
unminified. PR #12962 makes the upload fail instead.

The valid-ZIP control is what stops a build that rejects every upload from
passing: the error must be specific to there being nothing usable inside.
"""

import io
import logging
import os
import uuid
import zipfile

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")


def _zip(entries: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, body in entries.items():
            zf.writestr(name, body)
    return buf.getvalue()


def _upload(session, base_url, data: bytes, filename: str):
    return session.post(
        f"{base_url}api/{ORG_ID}/sourcemaps",
        files={"file": (filename, data, "application/zip")},
    )


def test_zip_without_any_sourcemap_is_rejected(create_session, base_url):
    session = create_session
    data = _zip({"README.txt": "no maps here", "notes/other.md": "# nothing"})
    resp = _upload(session, base_url, data, f"nomaps_{uuid.uuid4().hex[:6]}.zip")
    logger.info("no-sourcemap ZIP answered %s: %s", resp.status_code, resp.text[:160])

    # Reporting success for a ZIP with nothing usable inside was the defect.
    assert resp.status_code >= 400, \
        f"a ZIP with no sourcemap must be rejected, got {resp.status_code}: {resp.text[:300]}"


def test_zip_with_a_valid_sourcemap_is_accepted(create_session, base_url):
    """Control: the rejection must be about the contents, not all uploads."""
    session = create_session
    smap = (
        '{"version":3,"file":"app.min.js","sources":["app.js"],'
        '"names":[],"mappings":"AAAA","sourcesContent":["console.log(1)"]}'
    )
    data = _zip({"app.min.js.map": smap, "app.min.js": "console.log(1)\n"})
    resp = _upload(session, base_url, data, f"withmap_{uuid.uuid4().hex[:6]}.zip")
    logger.info("valid ZIP answered %s: %s", resp.status_code, resp.text[:160])

    assert resp.status_code < 400, \
        f"a ZIP containing a real sourcemap must be accepted, got {resp.status_code}: {resp.text[:300]}"
