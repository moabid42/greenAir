#!/usr/bin/env python3
"""Offline, bounded lookup into the original Green City research files."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent.parent
FIELDS = (
    "card", "name", "url", "kind", "record_granularity",
    "key_fields_or_contents", "update_frequency", "verification", "notes",
)
COMMON_SECTIONS = ("1", "2", "16", "17", "18", "19", "20", "appendix-a")
FOREIGN_SUFFIXES = ("_arnsberg", "_muenster", "_lauds_26", "_saopaulo")


@dataclass(frozen=True)
class Section:
    key: str
    title: str
    start: int  # Inclusive, one-based source lines.
    end: int


@dataclass(frozen=True)
class Endpoint:
    record: int  # CSV record number, including the header as record 1.
    start: int
    end: int
    fields: dict[str, str]


def read_sections(lines: list[str]) -> dict[str, Section]:
    """Index numbered headings and appendices, ignoring fenced code headings."""
    headings = []
    fence_char, fence_size = "", 0
    for number, line in enumerate(lines, 1):
        fence = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
        if fence_char:
            if (fence and fence[1][0] == fence_char
                    and len(fence[1]) >= fence_size and not fence[2].strip()):
                fence_char, fence_size = "", 0
            continue
        if fence:
            fence_char, fence_size = fence[1][0], len(fence[1])
            continue
        heading = re.match(r"^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$", line)
        if heading:
            headings.append((number, len(heading[1]), heading[2]))

    sections = {}
    for index, (start, level, title) in enumerate(headings):
        numbered = re.match(r"(\d+(?:\.\d+)*)(?:\.)?\s+", title)
        appendix = re.match(r"Appendix\s+([A-Z])(?:\.|\s|$)", title, re.I)
        if numbered:
            key = numbered[1]
        elif appendix:
            key = "appendix-" + appendix[1].lower()
        else:
            continue
        if key in sections:
            raise ValueError(f"Duplicate reference section: {key}")
        end = next((n - 1 for n, depth, _ in headings[index + 1:]
                    if depth <= level), len(lines))
        sections[key] = Section(key, title, start, end)
    return sections


def read_catalog(path: Path) -> list[Endpoint]:
    endpoints = []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle, strict=True)
        header = next(reader, None)
        if header != list(FIELDS):
            raise ValueError(f"Unexpected CSV columns in {path}: {header}")
        while True:
            start = reader.line_num + 1
            values = next(reader, None)
            if values is None:
                break
            if not values:
                continue
            if len(values) != len(FIELDS):
                raise ValueError(f"Malformed CSV record near line {start}")
            row = dict(zip(FIELDS, values))
            if any(not row[field].strip() for field in ("card", "name", "url", "verification")):
                raise ValueError(f"Missing endpoint identity/evidence near line {start}")
            address = urlsplit(row["url"])
            if address.scheme not in ("http", "https") or not address.netloc:
                raise ValueError(f"Invalid endpoint URL near line {start}: {row['url']}")
            endpoints.append(Endpoint(len(endpoints) + 2, start, reader.line_num, row))
    if not endpoints:
        raise ValueError("The endpoint catalog is empty")
    return endpoints


def is_foreign_layer(endpoint: Endpoint) -> bool:
    address = urlsplit(endpoint.fields["url"])
    return (address.hostname == "api.atrai.bike"
            and address.path.startswith("/collections/")
            and endpoint.fields["name"].endswith(FOREIGN_SUFFIXES))


def scope_guidance(endpoint: Endpoint) -> str:
    name = endpoint.fields["name"]
    if name in ("tracks", "osem_bike_data"):
        return "Global collection: check groupTags contains heilbronn before local use."
    if name == "track_points":
        return "Global collection: inspect schema/join keys before filtering to Heilbronn."
    if name == "statistics":
        return "Filter city by tag; statistics text is not JSON. Never use eval."
    return ""


class Knowledge:
    def __init__(self, root: Path = ROOT):
        self.root = root
        self.config = json.loads((root / "agents/sources.json").read_text(encoding="utf-8"))
        self.reference = self.config["reference"]
        self.catalog = self.config["catalog"]
        self.lines = (root / self.reference).read_text(encoding="utf-8").splitlines()
        self.sections = read_sections(self.lines)
        self.endpoints = read_catalog(root / self.catalog)
        self.sources = self.config["sources"]
        self.by_id = {source["id"]: source for source in self.sources}
        self.by_card = {source["card"]: source for source in self.sources}
        self.validate()

    def validate(self) -> None:
        if (len(self.by_id) != len(self.sources)
                or len(self.by_card) != len(self.sources)):
            raise ValueError("Source IDs and cards must be unique in agents/sources.json")
        cards = {endpoint.fields["card"] for endpoint in self.endpoints}
        if cards != set(self.by_card):
            raise ValueError(
                f"Source routing mismatch: unrouted={sorted(cards - set(self.by_card))}; "
                f"unused={sorted(set(self.by_card) - cards)}"
            )
        for source in self.sources:
            if not source["sections"]:
                raise ValueError(f"No reference sections routed for {source['id']}")
            for key in source["sections"]:
                if key not in self.sections:
                    raise ValueError(f"Missing reference section {key} for {source['id']}")
        identities = [(e.fields["card"], e.fields["name"], e.fields["url"], e.fields["kind"])
                      for e in self.endpoints]
        if len(identities) != len(set(identities)):
            raise ValueError("Duplicate endpoint records in catalog")

    def citation(self, path: str, start: int, end: int) -> str:
        return f"{path}:{start}" + (f"-{end}" if end != start else "")

    def section_location(self, key: str) -> dict:
        section = self.sections[key]
        return {"id": key, "title": section.title,
                "citation": self.citation(self.reference, section.start, section.end)}

    def hashes(self) -> dict[str, str]:
        return {path: hashlib.sha256((self.root / path).read_bytes()).hexdigest()
                for path in (self.reference, self.catalog)}

    def find(self, terms: list[str], source: str = "", all_cities: bool = False) -> list[Endpoint]:
        words = [word.casefold() for term in terms for word in term.split()]
        results = []
        for endpoint in self.endpoints:
            fields = endpoint.fields
            if source and fields["card"] != self.by_id[source]["card"]:
                continue
            if not all_cities and is_foreign_layer(endpoint):
                continue
            searchable = " ".join(fields.values()).casefold()
            if all(word in searchable for word in words):
                results.append(endpoint)
        if words:
            def relevance(endpoint: Endpoint) -> tuple:
                name = endpoint.fields["name"].casefold()
                return (name != " ".join(words),
                        not all(word in name for word in words),
                        -sum(word in name for word in words), endpoint.record)
            results.sort(key=relevance)
        return results


def positive_int(value: str) -> int:
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("Use a positive integer")
    return number


def overview(knowledge: Knowledge) -> int:
    print(f"Local research: {len(knowledge.endpoints)} endpoints; {len(knowledge.sources)} source cards.")
    print("Snapshot evidence only; no live API checks. SHA-256 prefixes:")
    for path, digest in knowledge.hashes().items():
        print(f"  {path}  {digest[:12]}")
    counts = Counter(endpoint.fields["card"] for endpoint in knowledge.endpoints)
    print("\nSource shortcuts (catalog rows include all cities):")
    for source in knowledge.sources:
        sections = ", ".join(source["sections"])
        print(f"  {source['id']:13} {counts[source['card']]:3} rows  "
              f"section {sections:5}  {source['card']}")
    print("\nReference locations:")
    keys = list(dict.fromkeys(
        [key for source in knowledge.sources for key in source["sections"]]
        + list(COMMON_SECTIONS)))
    for key in keys:
        location = knowledge.section_location(key)
        print(f"  {key:12} {location['title']} [{location['citation']}]")
    print("\nNext: find <words> --source <shortcut>, then section <id>.")
    print("find defaults: 5 results; known foreign ATRAI layers hidden; global data still needs filtering.")
    return 0


def find(knowledge: Knowledge, args: argparse.Namespace) -> int:
    matches = knowledge.find(args.words, args.source, args.all_cities)
    records = []
    for endpoint in matches[:args.limit]:
        source = knowledge.by_card[endpoint.fields["card"]]
        records.append({
            **endpoint.fields,
            "source_id": source["id"],
            "catalog_record": endpoint.record,
            "citation": knowledge.citation(knowledge.catalog, endpoint.start, endpoint.end),
            "reference_sections": [knowledge.section_location(key) for key in source["sections"]],
            "scope_guidance": scope_guidance(endpoint),
        })
    summary = {"matches": len(matches), "returned": len(records),
               "truncated": len(matches) > len(records),
               "known_foreign_atrai_layers_excluded": not args.all_cities,
               "live_verification": "not performed", "endpoints": records}
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print(f"{summary['matches']} matches; showing {summary['returned']}.")
        print("Research snapshot only. " + (
            "All city layers included." if args.all_cities else
            "Known foreign ATRAI layers excluded; global collections still need local filters."))
        for record in records:
            print(f"\n[{record['source_id']}] {record['name']} | CSV record {record['catalog_record']}")
            print(f"  Citation: {record['citation']}")
            for field in FIELDS:
                if field not in ("card", "name") and record[field]:
                    print(f"  {field}: {record[field]}")
            if record["scope_guidance"]:
                print(f"  Scope: {record['scope_guidance']}")
            for section in record["reference_sections"]:
                print(f"  Read section {section['id']}: {section['title']} [{section['citation']}]")
        if summary["truncated"]:
            print("\nMore matches omitted. Narrow the search/source or increase --limit.")
        if not records:
            print("No matching catalog rows. Try fewer words, list --source without words, "
                  "read its reference section, or use --all-cities.")
    return 0 if matches else 1


def excerpt(knowledge: Knowledge, args: argparse.Namespace) -> int:
    keys = list(dict.fromkeys(key.lower() for key in args.ids))
    unknown = [key for key in keys if key not in knowledge.sections]
    if unknown:
        raise ValueError(f"Unknown section(s): {', '.join(unknown)}. Run overview for section IDs.")
    remaining = args.max_lines
    for key in keys:
        section = knowledge.sections[key]
        print(f"\n{knowledge.citation(knowledge.reference, section.start, section.end)}")
        count = min(section.end - section.start + 1, remaining)
        for index in range(section.start - 1, section.start - 1 + count):
            print(f"{index + 1:4} | {knowledge.lines[index]}")
        remaining -= count
        omitted = section.end - section.start + 1 - count
        if omitted:
            print(f"[{omitted} source lines omitted from section {key}; "
                  "request fewer sections or increase --max-lines.]")
    return 0


def main(argv: list[str] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("overview", help="Compact source map and reference locations")
    search = commands.add_parser("find", help="Search all CSV fields, keeping evidence labels intact")
    search.add_argument("words", nargs="*", help="All words must match; case-insensitive")
    search.add_argument("--source", default="", help="Source shortcut listed by overview")
    search.add_argument("--limit", type=positive_int, default=5)
    search.add_argument("--all-cities", action="store_true")
    search.add_argument("--json", action="store_true", help="Machine-readable rows and citations")
    section = commands.add_parser("section", help="Print numbered excerpts from the original reference")
    section.add_argument("ids", nargs="+", help="E.g. 3, 3.2, 19.2, appendix-a")
    section.add_argument("--max-lines", type=positive_int, default=160)
    commands.add_parser("check", help="Validate local structure/routing and print full SHA-256 hashes")
    args = parser.parse_args(argv)
    try:
        knowledge = Knowledge()
        if args.command == "find":
            if args.source and args.source not in knowledge.by_id:
                raise ValueError(f"Unknown source '{args.source}'; choose: {', '.join(knowledge.by_id)}")
            return find(knowledge, args)
        if args.command == "section":
            return excerpt(knowledge, args)
        if args.command == "overview":
            for key in COMMON_SECTIONS:
                if key not in knowledge.sections:
                    raise ValueError(f"Missing shared reference section: {key}")
            return overview(knowledge)
        for key in COMMON_SECTIONS:
            if key not in knowledge.sections:
                raise ValueError(f"Missing shared reference section: {key}")
        print(f"OK: {len(knowledge.endpoints)} endpoints, {len(knowledge.sources)} routed source cards, "
              f"{len(knowledge.sections)} reference sections.")
        for path, digest in knowledge.hashes().items():
            print(f"SHA-256 {digest}  {path}")
        print("Offline structural check only; no live requests or schema/availability verification.")
        return 0
    except (OSError, ValueError, KeyError, TypeError, csv.Error) as error:
        print(f"Context error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
