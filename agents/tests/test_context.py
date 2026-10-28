"""Regression checks for evidence-preserving lookup and bounded context output."""

import contextlib
import csv
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from agents.context import FIELDS, Knowledge, main, read_catalog, read_sections


class ParsingTests(unittest.TestCase):
    def test_section_bounds_ignore_fenced_code_and_include_subsections(self):
        lines = [
            "# Title", "## Contents", "## 1. Start", "intro",
            "### 1.1 First", "````python", "## 99. Not a section", "```",
            "still code", "````", "### 1.2 Second", "text",
            "~~~sh", "## 98. Also code", "~~~", "## 2. Next", "end",
            "## Appendix A. Inventory", "items",
        ]
        sections = read_sections(lines)
        self.assertEqual(set(sections), {"1", "1.1", "1.2", "2", "appendix-a"})
        self.assertEqual((sections["1"].start, sections["1"].end), (3, 15))
        self.assertEqual((sections["1.1"].start, sections["1.1"].end), (5, 10))
        self.assertEqual(sections["2"].end, 17)

    def test_duplicate_section_ids_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "Duplicate reference section"):
            read_sections(["## 1. First", "## 1. Second"])

    def test_bom_quoted_commas_and_multiline_csv_citations(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "catalog.csv"
            row = {field: "" for field in FIELDS}
            row.update(card="Example", name="Sensor", url="https://example.org/items",
                       verification="Reported, not checked", notes="line one\nline two")
            with path.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=FIELDS)
                writer.writeheader()
                writer.writerow(row)
                handle.write("\n")
                writer.writerow({**row, "name": "Second", "notes": ""})
            endpoints = read_catalog(path)
            self.assertEqual(endpoints[0].fields, row)
            self.assertEqual((endpoints[0].start, endpoints[0].end), (2, 3))
            self.assertEqual((endpoints[1].record, endpoints[1].start), (3, 5))

    def test_csv_schema_changes_fail_explicitly(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "wrong.csv"
            path.write_text("name,url\nSensor,https://example.org\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Unexpected CSV columns"):
                read_catalog(path)


class ResearchLookupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.knowledge = Knowledge()

    def invoke(self, *arguments):
        output, errors = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            status = main(list(arguments))
        return status, output.getvalue(), errors.getvalue()

    def test_local_default_excludes_foreign_layers_but_keeps_global_data(self):
        local = self.knowledge.find(["bumpy_roads"], source="bike")
        all_cities = self.knowledge.find(["bumpy_roads"], source="bike", all_cities=True)
        self.assertEqual([row.fields["name"] for row in local], ["bumpy_roads_heilbronn"])
        self.assertGreater(len(all_cities), len(local))
        self.assertEqual(self.knowledge.find(["osem_bike_data"])[0].fields["name"], "osem_bike_data")

    def test_case_insensitive_search_across_fields_and_source_selection(self):
        matches = self.knowledge.find(["ROUGHNESS", "nullable"], source="bike")
        self.assertEqual(matches[0].fields["name"], "bumpy_roads_heilbronn")
        home = self.knowledge.find([], source="home")
        self.assertEqual([row.fields["name"] for row in home], ["osem_home_data_heilbronn"])
        self.assertEqual(self.knowledge.find(["osem_home_data_heilbronn"], source="bike"), [])

    def test_json_keeps_original_evidence_and_reports_truncation(self):
        status, output, errors = self.invoke("find", "--source", "birds", "--limit", "1", "--json")
        result = json.loads(output)
        self.assertEqual((status, errors), (0, ""))
        self.assertTrue(result["truncated"])
        self.assertEqual(result["returned"], 1)
        original = self.knowledge.find([], source="birds")[0]
        for field in FIELDS:
            self.assertEqual(result["endpoints"][0][field], original.fields[field])
        self.assertEqual(result["live_verification"], "not performed")
        self.assertIn(f":{original.start}", result["endpoints"][0]["citation"])
        self.assertEqual(result["endpoints"][0]["reference_sections"][0]["id"], "6")

    def test_statistics_gets_specific_filter_warning(self):
        status, output, _ = self.invoke("find", "statistics", "--source", "bike", "--json")
        self.assertEqual(status, 0)
        row = json.loads(output)["endpoints"][0]
        self.assertIn("Filter city by tag", row["scope_guidance"])
        self.assertIn("groupTags", row["notes"])  # Retain the original, generic catalog note.

    def test_section_budget_is_total_and_reports_omissions(self):
        status, output, _ = self.invoke("section", "3.2", "3.3", "--max-lines", "3")
        source_lines = [line for line in output.splitlines() if " | " in line and line.split(" | ")[0].strip().isdigit()]
        self.assertEqual(status, 0)
        self.assertEqual(len(source_lines), 3)
        self.assertIn("omitted from section 3.2", output)
        self.assertIn("omitted from section 3.3", output)

    def test_missing_source_routes_and_missing_reference_sections_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "agents").mkdir()
            catalog = self.knowledge.root / self.knowledge.catalog
            reference = self.knowledge.root / self.knowledge.reference
            config = {**self.knowledge.config, "catalog": str(catalog), "reference": str(reference)}
            path = root / "agents/sources.json"
            path.write_text(json.dumps({**config, "sources": config["sources"][1:]}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unrouted=.*senseBox:bike"):
                Knowledge(root)
            sources = [dict(source) for source in config["sources"]]
            sources[0]["sections"] = ["999"]
            path.write_text(json.dumps({**config, "sources": sources}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Missing reference section 999"):
                Knowledge(root)

    def test_no_matches_and_invalid_lookups_have_clear_exit_codes(self):
        status, output, _ = self.invoke("find", "no-such-record-xyz", "--json")
        self.assertEqual((status, json.loads(output)["matches"]), (1, 0))
        for arguments in (("find", "--source", "missing"), ("section", "999")):
            status, output, errors = self.invoke(*arguments)
            self.assertEqual((status, output), (2, ""))
            self.assertIn("Context error:", errors)

    def test_lookup_works_outside_repository_cwd(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                [sys.executable, str(self.knowledge.root / "agents/context.py"),
                 "find", "--source", "home"],
                cwd=directory, capture_output=True, text=True, check=False,
            )
        self.assertEqual((result.returncode, result.stderr), (0, ""))
        self.assertIn("osem_home_data_heilbronn", result.stdout)


if __name__ == "__main__":
    unittest.main()
