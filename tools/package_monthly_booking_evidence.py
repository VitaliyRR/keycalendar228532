"""Validate read-only monthly booking snapshots and freeze one private JSONL batch.

Source rows and their order are preserved byte for byte. No client values, source
hashes, or paths are printed. All outputs must stay beside the private inputs.
"""

from __future__ import annotations

import argparse
import calendar
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile

MAX_LINE_BYTES = 256 * 1024
MAX_SOURCE_BYTES = 256 * 1024 * 1024
MAX_ROWS = 200_000
MONTH_FILE = re.compile(r"booking-ui-month-(\d{4}-\d{2})\.jsonl\Z")
BOOKING_HREF = re.compile(r"/event_calendars/[1-9]\d*\Z")


class PackageError(Exception):
    pass


def parse_month(value: str) -> dt.date:
    if not re.fullmatch(r"\d{4}-\d{2}", value):
        raise PackageError("MONTH_INVALID")
    try:
        return dt.date.fromisoformat(value + "-01")
    except ValueError:
        raise PackageError("MONTH_INVALID") from None


def months_between(first: dt.date, last: dt.date) -> list[str]:
    if first > last or (last.year - first.year) * 12 + last.month - first.month > 119:
        raise PackageError("MONTH_RANGE_INVALID")
    result = []
    current = first
    while current <= last:
        result.append(current.strftime("%Y-%m"))
        current = dt.date(current.year + (current.month == 12), current.month % 12 + 1, 1)
    return result


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_immutable(path: pathlib.Path, data: bytes) -> None:
    if path.exists():
        if not path.is_file() or sha(path.read_bytes()) != sha(data):
            raise PackageError("OUTPUT_ALREADY_EXISTS_DIFFERENT")
        return
    descriptor, temporary = tempfile.mkstemp(prefix=".kc-monthly-", dir=path.parent)
    try:
        os.chmod(temporary, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if path.exists():
            raise PackageError("OUTPUT_ALREADY_EXISTS_DIFFERENT")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def validate_file(path: pathlib.Path, month: str, seen_ids: set[str]) -> tuple[list[bytes], dict]:
    if not path.is_file() or path.stat().st_size > MAX_SOURCE_BYTES:
        raise PackageError("SOURCE_SIZE_OR_TYPE")
    source_bytes = path.read_bytes()
    if not source_bytes or not source_bytes.endswith(b"\n"):
        raise PackageError("SOURCE_EMPTY_OR_UNTERMINATED")
    lines = source_bytes.splitlines(keepends=True)
    if len(lines) > MAX_ROWS:
        raise PackageError("SOURCE_ROW_LIMIT")
    year, month_number = map(int, month.split("-"))
    from_date = dt.date(year, month_number, 1)
    to_date = dt.date(year, month_number, calendar.monthrange(year, month_number)[1])
    page_indices: dict[int, set[int]] = {}
    ordered_positions: list[tuple[int, int]] = []
    for line in lines:
        if not line.strip() or len(line) > MAX_LINE_BYTES:
            raise PackageError("ROW_EMPTY_OR_OVERSIZE")
        try:
            row = json.loads(line)
        except (ValueError, UnicodeDecodeError):
            raise PackageError("ROW_INVALID_JSON") from None
        if not isinstance(row, dict) or row.get("month") != month or \
           row.get("filter_from") != from_date.strftime("%d.%m.%Y") or \
           row.get("filter_to") != to_date.strftime("%d.%m.%Y"):
            raise PackageError("ROW_MONTH_SCOPE_INVALID")
        page, index, href, cells = (row.get(key) for key in ("page", "index", "href", "cells"))
        if type(page) is not int or page < 1 or type(index) is not int or index < 1 or \
           not isinstance(href, str) or not BOOKING_HREF.fullmatch(href) or \
           not isinstance(cells, list) or len(cells) != 9 or \
           any(not isinstance(cell, str) for cell in cells):
            raise PackageError("ROW_BOOKING_SHAPE_INVALID")
        try:
            arrival = dt.datetime.strptime(cells[1], "%d.%m.%Y").date()
            departure = dt.datetime.strptime(cells[2], "%d.%m.%Y").date()
        except ValueError:
            raise PackageError("ROW_STAY_DATE_INVALID") from None
        if not from_date <= arrival <= to_date or departure <= arrival:
            raise PackageError("ROW_STAY_DATE_SCOPE_INVALID")
        if href in seen_ids:
            raise PackageError("DUPLICATE_BOOKING_ID")
        seen_ids.add(href)
        if index in page_indices.setdefault(page, set()):
            raise PackageError("DUPLICATE_PAGE_INDEX")
        page_indices[page].add(index)
        ordered_positions.append((page, index))
    pages = sorted(page_indices)
    if pages != list(range(1, len(pages) + 1)):
        raise PackageError("PAGE_SEQUENCE_GAP")
    for page in pages:
        indices = page_indices[page]
        if indices != set(range(1, len(indices) + 1)) or len(indices) > 25:
            raise PackageError("PAGE_INDEX_SEQUENCE_INVALID")
        if page != pages[-1] and len(indices) != 25:
            raise PackageError("PAGE_BEFORE_LAST_INCOMPLETE")
    if ordered_positions != sorted(ordered_positions):
        raise PackageError("PAGE_INDEX_ORDER_INVALID")
    return lines, {"month": month, "source_file": path.name,
                   "source_sha256": sha(source_bytes), "row_count": len(lines),
                   "pages": len(pages), "last_page_rows": len(page_indices[pages[-1]])}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--private-dir", required=True)
    parser.add_argument("--first-month", required=True)
    parser.add_argument("--last-month", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--qa", required=True)
    args = parser.parse_args()
    private_dir = pathlib.Path(args.private_dir).resolve(strict=True)
    output, manifest, qa = (pathlib.Path(value).resolve() for value in
                            (args.output, args.manifest, args.qa))
    if not private_dir.is_dir() or len({output, manifest, qa}) != 3 or \
       any(path.parent != private_dir for path in (output, manifest, qa)) or \
       output.suffix != ".jsonl" or manifest.suffix != ".json" or qa.suffix != ".json":
        raise PackageError("OUTPUT_PATH_INVALID")
    if (output.name, manifest.name, qa.name) != (
        "booking-ui-months-combined.jsonl", "booking-ui-months-combined-manifest.json",
        "booking-ui-months-combined-qa.json"):
        raise PackageError("OUTPUT_NAME_INVALID")
    months = months_between(parse_month(args.first_month), parse_month(args.last_month))
    observed = {}
    for path in private_dir.glob("booking-ui-month-*.jsonl"):
        match = MONTH_FILE.fullmatch(path.name)
        if not match:
            raise PackageError("MONTH_FILE_NAME_INVALID")
        if path.resolve(strict=True).parent != private_dir:
            raise PackageError("MONTH_SOURCE_OUTSIDE_PRIVATE_DIRECTORY")
        observed[match.group(1)] = path
    if set(observed) != set(months):
        raise PackageError("MONTH_FILE_SET_MISMATCH")
    seen_ids: set[str] = set()
    source_reports = []
    combined = bytearray()
    for month in months:
        lines, report = validate_file(observed[month], month, seen_ids)
        combined.extend(b"".join(lines))
        source_reports.append(report)
        if len(seen_ids) > MAX_ROWS or len(combined) > MAX_SOURCE_BYTES:
            raise PackageError("COMBINED_LIMIT")
    write_immutable(output, bytes(combined))
    result = subprocess.run([sys.executable,
                             str(pathlib.Path(__file__).with_name("create_json_evidence_manifest.py")),
                             "--dataset", "booking_pages_ui", "--input", str(output),
                             "--manifest", str(manifest), "--expected-rows", str(len(seen_ids))],
                            capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise PackageError("MANIFEST_CREATE_OR_VERIFY_FAILED")
    manifest_doc = json.loads(manifest.read_text(encoding="utf-8"))
    if manifest_doc.get("sha256") != sha(combined) or \
       manifest_doc.get("row_count_by_sheet", {}).get("booking-pages-ui") != len(seen_ids):
        raise PackageError("MANIFEST_MISMATCH")
    report = {"format": "keycalendar-private-monthly-booking-qa-v1",
              "first_month": months[0], "last_month": months[-1],
              "month_count": len(months), "row_count": len(seen_ids),
              "unique_booking_ids": len(seen_ids), "combined_file": output.name,
              "combined_sha256": sha(combined), "manifest_file": manifest.name,
              "sources": source_reports, "state": "source_verified_evidence_only",
              "reconciliation_complete": False, "live_entity_count_claimed": 0}
    write_immutable(qa, json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8"))
    print(json.dumps({"months": len(months), "rows": len(seen_ids),
                      "unique_booking_ids": len(seen_ids),
                      "state": "source_verified_evidence_only"}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, PackageError) else "MONTHLY_PACKAGE_FAILED"
        print(f"Monthly booking evidence failed: {code}", file=sys.stderr)
        sys.exit(1)
