"""Verify private source snapshots and write an evidence-only coverage matrix.

No source values, file hashes or paths are printed to stdout. Output must stay
beside the private inputs, outside the repository.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import sys
import tempfile

MAX_FILE_BYTES = 256 * 1024 * 1024
MAX_LINE_BYTES = 256 * 1024
MAX_ROWS = 200_000

# Dataset, original, manifest, evidence, source format.
SOURCES = (
    ("bookings", "bookings.xls", "manifest.json", "bookings-staging.jsonl", "staged_jsonl"),
    ("clients", "clients.xlsx", "clients-evidence-manifest.json", "clients-evidence.jsonl", "staged_jsonl"),
    ("expenses", "expenses.xlsx", "expenses-evidence-manifest.json", "expenses-evidence.jsonl", "staged_jsonl"),
    *(("payments_ui", f"payments-{year}.jsonl", f"payments-{year}-manifest.json",
       f"payments-{year}.jsonl", "raw_jsonl") for year in range(2023, 2027)),
    ("inventory_ui", "inventory-ui.json", "inventory-ui-manifest.json", "inventory-ui.json", "inventory_json"),
    ("deposits_ui", "deposits-ui.json", "deposits-ui-manifest.json", "deposits-ui.json", "deposits_json"),
    ("settings_ui", "settings-ui.jsonl", "settings-ui-manifest.json", "settings-ui.jsonl", "raw_jsonl"),
    ("active_booking_cards_ui", "active-booking-cards.jsonl", "active-booking-cards-manifest.json",
     "active-booking-cards.jsonl", "raw_jsonl"),
    ("booking_pages_ui", "booking-ui-pages.jsonl", "booking-ui-pages-manifest.json",
     "booking-ui-pages.jsonl", "raw_jsonl"),
    ("property_edit_links_ui", "property-edit-links.jsonl", "property-edit-links-manifest.json",
     "property-edit-links.jsonl", "raw_jsonl"),
    ("properties_full_ui", "properties-full-ui.jsonl", "properties-full-ui-manifest.json",
     "properties-full-ui.jsonl", "raw_jsonl"),
)


class CoverageError(Exception):
    pass


def digest(path: pathlib.Path) -> str:
    if not path.is_file() or path.stat().st_size > MAX_FILE_BYTES:
        raise CoverageError("SOURCE_SIZE_OR_TYPE")
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def read_json(path: pathlib.Path) -> dict:
    if not path.is_file() or path.stat().st_size > MAX_FILE_BYTES:
        raise CoverageError("JSON_SIZE_OR_TYPE")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise CoverageError("INVALID_JSON") from None
    if not isinstance(value, dict):
        raise CoverageError("INVALID_JSON_SHAPE")
    return value


def physical_numbers(path: pathlib.Path, mode: str, source_sha: str, worksheet: str) -> list[int]:
    if mode in ("staged_jsonl", "raw_jsonl"):
        numbers: list[int] = []
        with path.open("rb") as stream:
            for physical_line, line in enumerate(stream, start=1):
                if not line.strip() or len(line) > MAX_LINE_BYTES:
                    raise CoverageError("ROW_EMPTY_OR_OVERSIZE")
                try:
                    row = json.loads(line)
                except (ValueError, UnicodeDecodeError):
                    raise CoverageError("ROW_INVALID_JSON") from None
                if not isinstance(row, dict):
                    raise CoverageError("ROW_INVALID_SHAPE")
                if mode == "staged_jsonl":
                    number = row.get("source_row_number")
                    if row.get("source_file_sha256") != source_sha:
                        raise CoverageError("ROW_SOURCE_HASH_MISMATCH")
                    if "source_worksheet" in row and row["source_worksheet"] != worksheet:
                        raise CoverageError("ROW_WORKSHEET_MISMATCH")
                else:
                    number = physical_line
                if type(number) is not int or number < 1:
                    raise CoverageError("ROW_INVALID_NUMBER")
                numbers.append(number)
                if len(numbers) > MAX_ROWS:
                    raise CoverageError("ROW_COUNT_LIMIT")
        return numbers

    document = read_json(path)
    if mode == "inventory_json":
        objects = document.get("objects")
        if not isinstance(objects, list):
            raise CoverageError("INVENTORY_INVALID_SHAPE")
        count = len(objects)
    elif mode == "deposits_json":
        sections = document.get("sections")
        if not isinstance(sections, list):
            raise CoverageError("DEPOSITS_INVALID_SHAPE")
        count = 0
        for section in sections:
            if not isinstance(section, dict) or not isinstance(section.get("rows"), list):
                raise CoverageError("DEPOSITS_INVALID_SHAPE")
            count += len(section["rows"])
    else:
        raise CoverageError("UNKNOWN_SOURCE_FORMAT")
    if count > MAX_ROWS:
        raise CoverageError("ROW_COUNT_LIMIT")
    return list(range(1, count + 1))


def write_private(path: pathlib.Path, content: bytes) -> None:
    if path.exists():
        if hashlib.sha256(path.read_bytes()).digest() != hashlib.sha256(content).digest():
            raise CoverageError("COVERAGE_ALREADY_EXISTS_DIFFERENT")
        return
    descriptor, temporary = tempfile.mkstemp(prefix=".kc-coverage-", dir=path.parent)
    try:
        os.chmod(temporary, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--private-dir", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--allow-missing-properties", action="store_true")
    args = parser.parse_args()
    private_dir = pathlib.Path(args.private_dir).resolve(strict=True)
    output = pathlib.Path(args.output).resolve()
    if not private_dir.is_dir() or output.parent != private_dir:
        raise CoverageError("OUTPUT_MUST_STAY_IN_PRIVATE_SOURCE_DIRECTORY")
    entries = []
    total = 0
    missing = []
    for dataset, original_name, manifest_name, evidence_name, mode in SOURCES:
        original = private_dir / original_name
        manifest_path = private_dir / manifest_name
        evidence = private_dir / evidence_name
        if not all(path.is_file() for path in (original, manifest_path, evidence)):
            if dataset == "properties_full_ui" and args.allow_missing_properties and not manifest_path.exists():
                missing.append(dataset)
                continue
            raise CoverageError("REQUIRED_DATASET_MISSING")
        manifest = read_json(manifest_path)
        source_sha = digest(original)
        if source_sha != manifest.get("sha256"):
            raise CoverageError("MANIFEST_SOURCE_HASH_MISMATCH")
        names = manifest.get("worksheet_names")
        if names is None and dataset == "bookings":
            worksheet = "source-sheet-1"
        elif isinstance(names, list) and len(names) == 1 and isinstance(names[0], str):
            worksheet = names[0]
        else:
            raise CoverageError("MANIFEST_WORKSHEET_MISMATCH")
        expected = manifest.get("row_count_by_sheet", {}).get(worksheet)
        if expected is None and dataset == "bookings":
            expected = manifest.get("data_row_count")
        numbers = physical_numbers(evidence, mode, source_sha, worksheet)
        if type(expected) is not int or expected != len(numbers) or not numbers:
            raise CoverageError("MANIFEST_ROW_COUNT_MISMATCH")
        if len(set(numbers)) != len(numbers):
            raise CoverageError("DUPLICATE_PHYSICAL_INDEX")
        index_digest = hashlib.sha256(",".join(str(number) for number in numbers).encode()).hexdigest()
        entry = {
            "dataset": dataset,
            "original_file": original_name,
            "manifest_file": manifest_name,
            "evidence_file": evidence_name,
            "source_sha256": source_sha,
            "evidence_sha256": digest(evidence),
            "worksheet_or_partition": worksheet,
            "physical_locator": "SHA256(source_sha256 + NUL + worksheet + NUL + source_row_number)",
            "physical_index_source": "source_row_number" if mode == "staged_jsonl" else
                ("jsonl_line_number" if mode == "raw_jsonl" else "document_order_flattened"),
            "physical_indices": numbers,
            "physical_index_min": min(numbers),
            "physical_index_max": max(numbers),
            "physical_index_sha256": index_digest,
            "physical_index_gaps": max(numbers) - min(numbers) + 1 - len(numbers),
            "row_count": len(numbers),
            "state": "source_verified_evidence_only",
        }
        entries.append(entry)
        total += len(numbers)
    matrix = {"format": "keycalendar-private-stage0-coverage-v1", "batch_count": len(entries),
              "evidence_row_count": total, "live_entity_count_claimed": 0,
              "complete": not missing, "missing_datasets": missing, "batches": entries}
    content = json.dumps(matrix, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8")
    write_private(output, content)
    print(json.dumps({"batch_count": len(entries), "evidence_rows": total,
                      "complete": not missing, "coverage": "source_verified_evidence_only"}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, CoverageError) else "COVERAGE_FAILED"
        print(f"Evidence coverage failed: {code}", file=sys.stderr)
        sys.exit(1)
