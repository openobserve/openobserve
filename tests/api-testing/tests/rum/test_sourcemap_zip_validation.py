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


def _upload(session, base_url, data: bytes, filename: str, service: str):
    """Upload under an explicit service so the group can be deleted afterwards."""
    return session.post(
        f"{base_url}api/{ORG_ID}/sourcemaps",
        files={"file": (filename, data, "application/zip")},
        data={"service": service, "env": "pytest", "version": "1.0.0"},
    )


def _delete_group(session, base_url, service: str):
    return session.delete(
        f"{base_url}api/{ORG_ID}/sourcemaps",
        params={"service": service, "env": "pytest", "version": "1.0.0"},
    )


def _listed_count(session, base_url) -> int:
    r = session.get(f"{base_url}api/{ORG_ID}/sourcemaps")
    if r.status_code != 200:
        return -1
    body = r.json()
    rows = body if isinstance(body, list) else body.get("data", body.get("list", []))
    return len(rows) if isinstance(rows, list) else -1


def test_zip_without_any_sourcemap_is_rejected(create_session, base_url):
    session = create_session
    data = _zip({"README.txt": "no maps here", "notes/other.md": "# nothing"})
    service = f"pytest_nomaps_{uuid.uuid4().hex[:6]}"
    before = _listed_count(session, base_url)
    resp = _upload(session, base_url, data, "nomaps.zip", service)
    logger.info("no-sourcemap ZIP answered %s: %s", resp.status_code, resp.text[:160])

    # Reporting success for a ZIP with nothing usable inside was the defect.
    assert resp.status_code >= 400, \
        f"a ZIP with no sourcemap must be rejected, got {resp.status_code}: {resp.text[:300]}"
    assert "sourcemap" in resp.text.lower(), \
        f"the error should say what was missing, got {resp.text[:300]}"

    # A status alone would not catch a build that errored yet still stored something.
    after = _listed_count(session, base_url)
    assert after == before, \
        f"a rejected upload must store nothing: sourcemap count went {before} -> {after}"


def test_zip_with_a_valid_sourcemap_is_accepted(create_session, base_url):
    """Control: the rejection must be about the contents, not all uploads."""
    session = create_session
    smap = (
        '{"version":3,"file":"app.min.js","sources":["app.js"],'
        '"names":[],"mappings":"AAAA","sourcesContent":["console.log(1)"]}'
    )
    data = _zip({"app.min.js.map": smap, "app.min.js": "console.log(1)\n"})
    service = f"pytest_withmap_{uuid.uuid4().hex[:6]}"
    before = _listed_count(session, base_url)
    try:
        resp = _upload(session, base_url, data, "withmap.zip", service)
        logger.info("valid ZIP answered %s: %s", resp.status_code, resp.text[:160])

        assert resp.status_code < 400, \
            f"a ZIP containing a real sourcemap must be accepted, got {resp.status_code}: {resp.text[:300]}"

        # Accepting and then storing nothing would be the same failure wearing a 2xx.
        after = _listed_count(session, base_url)
        assert after > before, \
            f"an accepted upload must store the map: sourcemap count went {before} -> {after}"
    finally:
        # This test is the only one here that stores anything, so it reaps its own group.
        _delete_group(session, base_url, service)
