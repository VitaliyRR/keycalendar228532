"""Create a private checksum/count manifest for read-only UI captures.

The original JSON/JSONL stays unchanged. No row values, links or hashes are printed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import sys
import tempfile

MAX_SOURCE_BYTES = 256 * 1024 * 1024
MAX_ROW_BYTES = 256 * 1024
MAX_ROWS = 200_000


class ManifestError(Exception):
    pass


def source_hash(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_private(path: pathlib.Path, content: bytes) -> None:
    if path.exists():
        if hashlib.sha256(path.read_bytes()).digest() != hashlib.sha256(content).digest():
            raise ManifestError("MANIFEST_ALREADY_EXISTS_DIFFERENT")
        return
    descriptor, temporary = tempfile.mkstemp(prefix=".kc-manifest-", dir=path.parent)
    try:
        os.chmod(temporary, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        if path.exists():
            raise ManifestError("MANIFEST_ALREADY_EXISTS_DIFFERENT")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def jsonl_count(path: pathlib.Path, dataset: str) -> int:
    count = 0
    with path.open("rb") as stream:
        for line in stream:
            if len(line) > MAX_ROW_BYTES or not line.strip():
                raise ManifestError("ROW_SIZE_OR_EMPTY")
            try:
                row = json.loads(line)
            except (ValueError, UnicodeDecodeError):
                raise ManifestError("ROW_INVALID_JSON") from None
            if not isinstance(row, dict):
                raise ManifestError("ROW_INVALID_SHAPE")
            if dataset == "payments_ui" and (
                not isinstance(row.get("row_index"), int) or
                not isinstance(row.get("approved"), bool) or
                (row.get("booking_href") is not None and not isinstance(row.get("booking_href"), str)) or
                not isinstance(row.get("cells"), list) or len(row["cells"]) != 7 or
                any(not isinstance(cell, str) for cell in row["cells"])
            ):
                raise ManifestError("ROW_INVALID_SHAPE")
            if dataset == "settings_ui" and (
                not isinstance(row.get("route"), str) or
                not isinstance(row.get("label"), str) or
                not isinstance(row.get("snapshot"), str)
            ):
                raise ManifestError("ROW_INVALID_SHAPE")
            if dataset == "properties_full_ui" and (
                not isinstance(row.get("lot_id"), str) or
                not isinstance(row.get("label"), str) or
                not isinstance(row.get("sections"), list) or len(row["sections"]) != 8 or
                any(not isinstance(section, dict) or
                    not isinstance(section.get("section"), str) or
                    not isinstance(section.get("snapshot"), str) or
                    ("images" in section and not isinstance(section["images"], list))
                    for section in row["sections"])
            ):
                raise ManifestError("ROW_INVALID_SHAPE")
            if dataset in ("active_booking_cards_ui", "booking_pages_ui") and (
                type(row.get("page")) is not int or type(row.get("index")) is not int or
                not isinstance(row.get("href"), str) or
                not isinstance(row.get("cells"), list) or len(row["cells"]) != 9 or
                any(not isinstance(cell, str) for cell in row["cells"])
            ):
                raise ManifestError("ROW_INVALID_SHAPE")
            if dataset == "active_booking_cards_ui" and (
                not isinstance(row.get("status"), str) or
                not isinstance(row.get("info"), str) or
                not isinstance(row.get("history"), str)
            ):
                raise ManifestError("ROW_INVALID_SHAPE")
            if dataset == "property_edit_links_ui" and (
                type(row.get("index")) is not int or
                not isinstance(row.get("label"), str) or
                (row.get("href") is not None and not isinstance(row.get("href"), str))
            ):
                raise ManifestError("ROW_INVALID_SHAPE")
            count += 1
            if count > MAX_ROWS:
                raise ManifestError("ROW_COUNT_LIMIT")
    return count


def document_count(path: pathlib.Path, dataset: str) -> int:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise ManifestError("SOURCE_INVALID_JSON") from None
    if not isinstance(document, dict):
        raise ManifestError("SOURCE_INVALID_SHAPE")
    if dataset == "inventory_ui":
        rows = document.get("objects")
        if not isinstance(rows, list) or len(rows) > MAX_ROWS or any(not isinstance(row, dict) or
          not {"source_lot_id", "display_name", "channels"}.issubset(row) for row in rows):
            raise ManifestError("INVENTORY_INVALID_SHAPE")
        return len(rows)
    sections = document.get("sections")
    if not isinstance(sections, list):
        raise ManifestError("DEPOSITS_INVALID_SHAPE")
    count = 0
    for section in sections:
        if not isinstance(section, dict) or not isinstance(section.get("rows"), list):
            raise ManifestError("DEPOSITS_INVALID_SHAPE")
        for row in section["rows"]:
            if not isinstance(row, dict) or not isinstance(row.get("row_index"), int) or \
              not isinstance(row.get("cells"), list) or len(row["cells"]) != 4 or \
              any(not isinstance(cell, str) for cell in row["cells"]):
                raise ManifestError("DEPOSITS_INVALID_SHAPE")
            count += 1
            if count > MAX_ROWS:
                raise ManifestError("ROW_COUNT_LIMIT")
    return count


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True,
      choices=("payments_ui", "inventory_ui", "deposits_ui", "settings_ui", "properties_full_ui",
               "active_booking_cards_ui", "booking_pages_ui", "property_edit_links_ui"))
    parser.add_argument("--input", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--year", type=int)
    parser.add_argument("--expected-rows", required=True, type=int)
    args = parser.parse_args()
    source = pathlib.Path(args.input).resolve(strict=True)
    output = pathlib.Path(args.manifest).resolve()
    if not source.is_file() or source.stat().st_size > MAX_SOURCE_BYTES or source == output or source.parent != output.parent:
        raise ManifestError("SOURCE_OR_OUTPUT_PATH_INVALID")
    if args.dataset == "payments_ui":
        if args.year is None or not 2000 <= args.year <= 2100:
            raise ManifestError("YEAR_REQUIRED")
        count = jsonl_count(source, args.dataset)
        sheet = f"year-{args.year}"
    else:
        if args.year is not None:
            raise ManifestError("YEAR_NOT_APPLICABLE")
        count = jsonl_count(source, args.dataset) if args.dataset in (
            "settings_ui", "properties_full_ui", "active_booking_cards_ui", "booking_pages_ui",
            "property_edit_links_ui") else document_count(source, args.dataset)
        sheet = {"inventory_ui": "inventory-ui", "deposits_ui": "deposits-ui", "settings_ui": "settings-ui",
                 "properties_full_ui": "properties-full-ui", "active_booking_cards_ui": "active-booking-cards-ui",
                 "booking_pages_ui": "booking-pages-ui", "property_edit_links_ui": "property-edit-links-ui"}[args.dataset]
    if count != args.expected_rows:
        raise ManifestError("ROW_COUNT_MISMATCH")
    manifest = {
        "dataset": f"realtycalendar-{args.dataset.replace('_', '-')}-v1",
        "sha256": source_hash(source),
        "worksheet_names": [sheet],
        "row_count_by_sheet": {sheet: count},
        "parser_version": "create_json_evidence_manifest_v1",
    }
    if args.dataset == "payments_ui":
        manifest["column_count_by_sheet"] = {sheet: 7}
    if args.dataset == "deposits_ui":
        manifest["column_count_by_sheet"] = {sheet: 4}
    if args.dataset in ("active_booking_cards_ui", "booking_pages_ui"):
        manifest["column_count_by_sheet"] = {sheet: 9}
    write_private(output, json.dumps(manifest, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    print(json.dumps({"dataset": args.dataset, "rows": count}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # A parser exception could contain a guest value. Log only stable codes.
        code = str(error) if isinstance(error, ManifestError) else "MANIFEST_FAILED"
        print(f"Evidence manifest failed: {code}", file=sys.stderr)
        sys.exit(1)
