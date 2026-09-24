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
import re
import sys
import tempfile

from package_monthly_booking_evidence import PackageError, months_between, parse_month, validate_file

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
    ("active_booking_cards_ui", "future-booking-cards-extra.jsonl", "future-booking-cards-extra-manifest.json",
     "future-booking-cards-extra.jsonl", "raw_jsonl"),
    ("booking_pages_ui", "booking-ui-pages.jsonl", "booking-ui-pages-manifest.json",
     "booking-ui-pages.jsonl", "raw_jsonl"),
    ("booking_pages_ui", "booking-ui-months-combined.jsonl", "booking-ui-months-combined-manifest.json",
     "booking-ui-months-combined.jsonl", "raw_jsonl"),
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


def booking_page_scope(path: pathlib.Path) -> tuple[set[int], set[str]]:
    pages: set[int] = set()
    booking_ids: set[str] = set()
    with path.open("rb") as stream:
        for line in stream:
            row = json.loads(line)
            page = row.get("page")
            href = row.get("href")
            if type(page) is not int or page < 1 or not isinstance(href, str) or not href:
                raise CoverageError("BOOKING_PAGE_SCOPE_INVALID")
            pages.add(page)
            if href in booking_ids:
                raise CoverageError("DUPLICATE_BOOKING_ID")
            booking_ids.add(href)
    return pages, booking_ids


def booking_card_scope(path: pathlib.Path) -> tuple[set[str], dict[str, int]]:
    ids: set[str] = set()
    statuses: dict[str, int] = {}
    with path.open("rb") as stream:
        for line in stream:
            row = json.loads(line)
            href, status = row.get("href"), row.get("status")
            if not isinstance(href, str) or not re.fullmatch(r"/event_calendars/\d+", href) or \
               href in ids or not isinstance(status, str) or not status.strip() or \
               not isinstance(row.get("info"), str) or not isinstance(row.get("history"), str):
                raise CoverageError("BOOKING_CARD_SCOPE_INVALID")
            ids.add(href)
            statuses[status] = statuses.get(status, 0) + 1
    return ids, statuses


def booking_month_scope(private_dir: pathlib.Path, combined: pathlib.Path) -> tuple[list[str], set[str]]:
    qa = read_json(private_dir / "booking-ui-months-combined-qa.json")
    if qa.get("format") != "keycalendar-private-monthly-booking-qa-v1" or \
       qa.get("combined_file") != combined.name or qa.get("combined_sha256") != digest(combined) or \
       qa.get("manifest_file") != "booking-ui-months-combined-manifest.json" or \
       qa.get("reconciliation_complete") is not False or qa.get("live_entity_count_claimed") != 0:
        raise CoverageError("MONTHLY_QA_INVALID")
    try:
        months = months_between(parse_month(qa.get("first_month")), parse_month(qa.get("last_month")))
    except (PackageError, TypeError):
        raise CoverageError("MONTHLY_QA_RANGE_INVALID") from None
    if qa.get("month_count") != len(months) or not isinstance(qa.get("sources"), list) or \
       len(qa["sources"]) != len(months):
        raise CoverageError("MONTHLY_QA_COUNT_INVALID")
    ids: set[str] = set()
    collected = bytearray()
    for month, expected in zip(months, qa["sources"]):
        path = private_dir / f"booking-ui-month-{month}.jsonl"
        try:
            lines, observed = validate_file(path, month, ids)
        except PackageError:
            raise CoverageError("MONTHLY_SOURCE_INVALID") from None
        if expected != observed:
            raise CoverageError("MONTHLY_QA_SOURCE_MISMATCH")
        collected.extend(b"".join(lines))
    if digest(combined) != hashlib.sha256(collected).hexdigest() or \
       qa.get("row_count") != len(ids) or qa.get("unique_booking_ids") != len(ids):
        raise CoverageError("MONTHLY_COMBINED_MISMATCH")
    return months, ids


def property_scope(path: pathlib.Path) -> tuple[set[str], int]:
    lot_ids: set[str] = set()
    photos = 0
    with path.open("rb") as stream:
        for line in stream:
            row = json.loads(line)
            lot_id = row.get("lot_id")
            sections = row.get("sections")
            if not isinstance(lot_id, str) or not lot_id.isdecimal() or lot_id in lot_ids or \
               not isinstance(sections, list) or len(sections) != 8:
                raise CoverageError("PROPERTY_SCOPE_INVALID")
            gallery = [section.get("gallery") for section in sections
                       if isinstance(section, dict) and section.get("section") == "photos"]
            if len(gallery) != 1 or not isinstance(gallery[0], list) or not gallery[0] or \
               sum(item.get("main") is True for item in gallery[0]
                   if isinstance(item, dict)) != 1:
                raise CoverageError("PROPERTY_GALLERY_INVALID")
            lot_ids.add(lot_id)
            photos += len(gallery[0])
    return lot_ids, photos


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
    parser.add_argument("--expected-booking-pages", type=int)
    parser.add_argument("--expected-properties", type=int)
    args = parser.parse_args()
    if (args.expected_booking_pages is not None and not 1 <= args.expected_booking_pages <= 10_000) or \
       (args.expected_properties is not None and not 1 <= args.expected_properties <= 10_000):
        raise CoverageError("INVALID_EXPECTED_SCOPE")
    private_dir = pathlib.Path(args.private_dir).resolve(strict=True)
    output = pathlib.Path(args.output).resolve()
    if not private_dir.is_dir() or output.parent != private_dir:
        raise CoverageError("OUTPUT_MUST_STAY_IN_PRIVATE_SOURCE_DIRECTORY")
    entries = []
    total = 0
    missing = []
    sources = list(SOURCES)
    for path in sorted(private_dir.glob("booking-ui-page-*.jsonl")):
        if not re.fullmatch(r"booking-ui-page-\d{3}\.jsonl", path.name):
            raise CoverageError("BOOKING_PAGE_FILE_NAME_INVALID")
        sources.append(("booking_pages_ui", path.name,
                        path.stem + "-manifest.json", path.name, "raw_jsonl"))
    booking_pages: set[int] = set()
    booking_ids: set[str] = set()
    monthly_months: list[str] = []
    monthly_ids: set[str] = set()
    card_ids: set[str] = set()
    card_statuses: dict[str, int] = {}
    property_count: int | None = None
    photo_count: int | None = None
    for dataset, original_name, manifest_name, evidence_name, mode in sources:
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
        if dataset == "booking_pages_ui":
            if original_name == "booking-ui-months-combined.jsonl":
                monthly_months, monthly_ids = booking_month_scope(private_dir, evidence)
                if len(monthly_ids) != len(numbers):
                    raise CoverageError("MONTHLY_SCOPE_COUNT_MISMATCH")
            else:
                observed_pages, observed_ids = booking_page_scope(evidence)
                if booking_ids.intersection(observed_ids):
                    raise CoverageError("DUPLICATE_BOOKING_ID_ACROSS_PAGE_SNAPSHOTS")
                booking_pages.update(observed_pages)
                booking_ids.update(observed_ids)
        if dataset == "active_booking_cards_ui":
            observed_cards, observed_statuses = booking_card_scope(evidence)
            if card_ids.intersection(observed_cards):
                raise CoverageError("DUPLICATE_BOOKING_CARD_ID")
            card_ids.update(observed_cards)
            for status, count in observed_statuses.items():
                card_statuses[status] = card_statuses.get(status, 0) + count
        if dataset == "properties_full_ui":
            property_ids, photo_count = property_scope(evidence)
            property_count = len(property_ids)
            if property_count != len(numbers):
                raise CoverageError("PROPERTY_SCOPE_INVALID")
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
    missing_booking_pages = (sorted(set(range(1, args.expected_booking_pages + 1)) - booking_pages)
                             if args.expected_booking_pages is not None else [])
    # The monthly date-filtered list and original unfiltered pages overlap by design.
    # Neither list confirms a booking's status or resolves the Excel mismatch.
    overlap_ids = booking_ids & monthly_ids
    if not card_ids.issubset(monthly_ids):
        raise CoverageError("BOOKING_CARD_ID_NOT_IN_MONTHLY_LIST")
    complete = False
    matrix = {"format": "keycalendar-private-stage0-coverage-v2", "batch_count": len(entries),
              "evidence_row_count": total, "live_entity_count_claimed": 0,
              "complete": complete, "missing_datasets": missing,
              "completion_review_pending": ["booking_excel_discrepancies", "booking_statuses",
                                            "property_timezones", "finance_semantics"],
              "booking_pages_observed": sorted(booking_pages),
              "booking_pages_expected": args.expected_booking_pages,
              "booking_pages_missing": missing_booking_pages,
              "booking_page_ids_observed": len(booking_ids),
              "booking_months_observed": monthly_months,
              "booking_month_ids_observed": len(monthly_ids),
              "booking_ids_overlap_page_and_month": len(overlap_ids),
              "booking_ids_only_in_page_snapshots": len(booking_ids - monthly_ids),
              "booking_ids_only_in_month_snapshots": len(monthly_ids - booking_ids),
              "booking_ids_observed": len(booking_ids | monthly_ids),
              "booking_future_cards_observed": len(card_ids),
              "booking_future_card_status_counts": card_statuses,
              "properties_expected": args.expected_properties,
              "properties_observed": property_count,
              "property_photo_thumbnails_observed": photo_count, "batches": entries}
    content = json.dumps(matrix, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8")
    write_private(output, content)
    print(json.dumps({"batch_count": len(entries), "evidence_rows": total,
                      "complete": complete, "booking_pages_observed": len(booking_pages),
                      "booking_months_observed": len(monthly_months),
                      "booking_ids_observed": len(booking_ids | monthly_ids),
                      "coverage": "source_verified_evidence_only"}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, CoverageError) else "COVERAGE_FAILED"
        print(f"Evidence coverage failed: {code}", file=sys.stderr)
        sys.exit(1)
