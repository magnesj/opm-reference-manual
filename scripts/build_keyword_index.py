#!/usr/bin/env python3
"""
build_keyword_index.py

Parse OPM Flow reference manual (.fodt files) and build a JSON keyword index
suitable for use in AI-assisted editors (VS Code extension, ResInsight, etc.)

Usage:
    python build_keyword_index.py --manual-dir /path/to/opm-reference-manual \
                                  --output keyword_index.json

The manual is at: https://github.com/OPM/opm-reference-manual
Each keyword lives in: parts/chapters/subsections/X.3/KEYWORD.fodt
"""

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Optional

from lxml import etree


# ---------------------------------------------------------------------------
# ODF XML namespace map
# ---------------------------------------------------------------------------
NS = {
    "text":  "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
    "table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
    "office":"urn:oasis:names:tc:opendocument:xmlns:office:1.0",
    "style": "urn:oasis:names:tc:opendocument:xmlns:style:1.0",
}

# Subsection number → OPM Flow deck section name
SECTION_MAP = {
    "4.3":  "RUNSPEC",
    "5.3":  "GRID",
    "6.3":  "EDIT",
    "7.3":  "PROPS",
    "8.3":  "REGIONS",
    "9.3":  "SOLUTION",
    "10.3": "SUMMARY",
    "11.3": "SCHEDULE",
    "12.3": "OPTIMIZE",
}

# Paragraph style names that indicate a heading in the OPM manual
# (inspect a .fodt file to confirm; these are common LibreOffice defaults)
HEADING_STYLES = {
    "Heading_20_1", "Heading_20_2", "Heading_20_3",
    "Heading 1", "Heading 2", "Heading 3",
}

EXAMPLE_HEADING_RE = re.compile(r"example", re.IGNORECASE)
SUPPORTED_RE       = re.compile(r"(supported|not\s+supported)", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Low-level XML helpers
# ---------------------------------------------------------------------------

def all_text(element) -> str:
    """Recursively collect all text content from an element."""
    parts = []
    if element.text:
        parts.append(element.text)
    for child in element:
        parts.append(all_text(child))
        if child.tail:
            parts.append(child.tail)
    return "".join(parts)


def style_name(element) -> str:
    return element.get(f"{{{NS['text']}}}style-name", "")


def iter_paragraphs(body):
    """Yield (style, text) for every text:p in document order."""
    for p in body.iter(f"{{{NS['text']}}}p"):
        text = all_text(p).strip()
        if text:
            yield style_name(p), text


def extract_table(table_elem) -> list[list[str]]:
    """Convert a table:table element into a list of row strings."""
    rows = []
    for row in table_elem.iter(f"{{{NS['table']}}}table-row"):
        cells = []
        for cell in row.iter(f"{{{NS['table']}}}table-cell"):
            cell_text = " ".join(
                all_text(p).strip()
                for p in cell.iter(f"{{{NS['text']}}}p")
            ).strip()
            cells.append(cell_text)
        # Skip completely empty rows
        if any(c for c in cells):
            rows.append(cells)
    return rows


def table_to_markdown(rows: list[list[str]]) -> str:
    """Render a table as a compact markdown string."""
    if not rows:
        return ""
    col_widths = [
        max(len(str(row[i])) for row in rows if i < len(row))
        for i in range(max(len(r) for r in rows))
    ]
    lines = []
    for idx, row in enumerate(rows):
        padded = [str(row[i]).ljust(col_widths[i]) if i < len(row) else " " * col_widths[i]
                  for i in range(len(col_widths))]
        lines.append("| " + " | ".join(padded) + " |")
        if idx == 0:  # header separator
            lines.append("|" + "|".join("-" * (w + 2) for w in col_widths) + "|")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Per-keyword .fodt parser
# ---------------------------------------------------------------------------

def parse_keyword_file(fodt_path: Path, section: str) -> dict:
    """
    Parse a single keyword .fodt file and return a structured dict.

    Output schema:
    {
        "name":          "WELSPECS",
        "section":       "SCHEDULE",
        "supported":     true,        # None if unknown
        "summary":       "First paragraph of description",
        "description":   "Full description text (paragraphs joined)",
        "parameters":    "Markdown table of parameters",
        "examples":      ["example text 1", ...],
        "full_text":     "All plain text in the document",
        "source_file":   "parts/chapters/subsections/11.3/WELSPECS.fodt"
    }
    """
    keyword_name = fodt_path.stem  # filename without extension

    try:
        tree = etree.parse(str(fodt_path))
    except etree.XMLSyntaxError as e:
        print(f"  WARNING: XML parse error in {fodt_path.name}: {e}", file=sys.stderr)
        return None

    root = tree.getroot()
    body = root.find(f".//{{{NS['office']}}}text")
    if body is None:
        print(f"  WARNING: No office:text in {fodt_path.name}", file=sys.stderr)
        return None

    # --- collect paragraphs and tables in document order ---------------
    description_parts = []
    example_parts     = []
    all_text_parts    = []
    in_example        = False
    supported         = None  # tri-state: True / False / None

    for style, text in iter_paragraphs(body):
        all_text_parts.append(text)

        # Track support status from headings / early paragraphs
        if supported is None:
            m = SUPPORTED_RE.search(text)
            if m:
                supported = "not" not in m.group(0).lower()

        if style in HEADING_STYLES:
            in_example = bool(EXAMPLE_HEADING_RE.search(text))
            continue  # headings go into full_text but not description/example

        if in_example:
            example_parts.append(text)
        else:
            description_parts.append(text)

    # --- extract parameter tables (first table = parameter definition table)
    param_table_md = ""
    example_table_md_parts = []
    tables = body.findall(f".//{{{NS['table']}}}table")

    for i, tbl in enumerate(tables):
        rows = extract_table(tbl)
        if not rows:
            continue
        md = table_to_markdown(rows)
        if i == 0:
            param_table_md = md
        else:
            example_table_md_parts.append(md)

    # --- assemble summary (first non-trivial paragraph) ----------------
    summary = next(
        (p for p in description_parts if len(p) > 30 and p != keyword_name),
        ""
    )

    return {
        "name":        keyword_name,
        "section":     section,
        "supported":   supported,
        "summary":     summary,
        "description": "\n\n".join(description_parts),
        "parameters":  param_table_md,
        "examples":    example_parts + example_table_md_parts,
        "full_text":   "\n".join(all_text_parts),
        "source_file": str(fodt_path),
    }


# ---------------------------------------------------------------------------
# Directory walker
# ---------------------------------------------------------------------------

def build_index(manual_dir: Path) -> dict:
    """
    Walk all subsection dirs and parse every keyword .fodt file.
    Returns { "KEYWORD_NAME": {...}, ... }
    """
    subsections_root = manual_dir / "parts" / "chapters" / "subsections"

    if not subsections_root.exists():
        sys.exit(f"ERROR: subsections directory not found: {subsections_root}")

    index = {}
    total = 0
    skipped = 0

    for section_num, section_name in SECTION_MAP.items():
        section_dir = subsections_root / section_num
        if not section_dir.exists():
            print(f"  INFO: directory not found, skipping: {section_dir}")
            continue

        fodt_files = sorted(section_dir.glob("*.fodt"))
        print(f"  {section_name:10s} ({section_num}): {len(fodt_files)} files")

        for fodt_path in fodt_files:
            result = parse_keyword_file(fodt_path, section_name)
            if result is None:
                skipped += 1
                continue
            name = result["name"]
            if name in index:
                # Some keywords appear in multiple sections (e.g. INCLUDE)
                # Keep both; append section to disambiguate
                print(f"    NOTE: duplicate keyword {name} in {section_name}, merging")
                existing = index[name]
                if isinstance(existing, list):
                    existing.append(result)
                else:
                    index[name] = [existing, result]
            else:
                index[name] = result
            total += 1

    print(f"\nIndexed {total} keywords ({skipped} skipped)")
    return index


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

def write_json(index: dict, output_path: Path):
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
    size_kb = output_path.stat().st_size // 1024
    print(f"Wrote {output_path}  ({size_kb} KB, {len(index)} keywords)")


def write_compact_json(index: dict, output_path: Path):
    """
    Write a compact JSON suitable for bundling in the VS Code extension.
    Strips full_text and source_file, truncates description to first paragraph,
    and keeps only the first example.
    """
    compact = {}
    for name, entry in index.items():
        if isinstance(entry, list):
            entry = entry[0]
        desc = entry.get("description", "")
        first_para = desc.split("\n\n")[0][:600] if desc else ""
        examples = entry.get("examples", [])
        first_example = examples[0][:400] if examples else ""
        compact[name] = {
            "name":        entry["name"],
            "section":     entry["section"],
            "supported":   entry["supported"],
            "summary":     entry.get("summary", "")[:200],
            "description": first_para,
            "parameters":  entry.get("parameters", ""),
            "example":     first_example,
        }
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(compact, f, separators=(",", ":"), ensure_ascii=False)
    size_kb = output_path.stat().st_size // 1024
    print(f"Wrote compact JSON: {output_path}  ({size_kb} KB, {len(compact)} keywords)")


def write_summary_tsv(index: dict, output_path: Path):
    """
    Lightweight companion file: keyword TAB section TAB supported TAB summary
    Useful for quick loading in the LSP server without parsing full JSON.
    """
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("keyword\tsection\tsupported\tsummary\n")
        for name, entry in sorted(index.items()):
            if isinstance(entry, list):
                entry = entry[0]  # primary entry for duplicates
            supported = {True: "yes", False: "no", None: "unknown"}[entry["supported"]]
            summary   = entry["summary"].replace("\t", " ").replace("\n", " ")[:120]
            f.write(f"{name}\t{entry['section']}\t{supported}\t{summary}\n")
    print(f"Wrote summary TSV: {output_path}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Build a keyword index from the OPM Flow reference manual (.fodt files)"
    )
    parser.add_argument(
        "--manual-dir", required=True,
        help="Path to cloned opm-reference-manual repository"
    )
    parser.add_argument(
        "--output", default="keyword_index.json",
        help="Output JSON file (default: keyword_index.json)"
    )
    parser.add_argument(
        "--tsv", default="keyword_summary.tsv",
        help="Output TSV summary file (default: keyword_summary.tsv)"
    )
    parser.add_argument(
        "--compact", default=None,
        help="Output compact JSON for VS Code extension bundling (e.g. --compact keyword_index_compact.json)"
    )
    parser.add_argument(
        "--keyword", default=None,
        help="Parse and print a single keyword for debugging (e.g. --keyword WELSPECS)"
    )
    args = parser.parse_args()

    manual_dir = Path(args.manual_dir).expanduser().resolve()

    if args.keyword:
        # Debug mode: find and dump one keyword
        for section_num, section_name in SECTION_MAP.items():
            p = manual_dir / "parts" / "chapters" / "subsections" / section_num / f"{args.keyword}.fodt"
            if p.exists():
                result = parse_keyword_file(p, section_name)
                print(json.dumps(result, indent=2, ensure_ascii=False))
                return
        print(f"Keyword file not found: {args.keyword}")
        return

    print(f"Building index from: {manual_dir}")
    index = build_index(manual_dir)

    write_json(index, Path(args.output))
    if args.tsv:
        write_summary_tsv(index, Path(args.tsv))
    if args.compact:
        write_compact_json(index, Path(args.compact))


if __name__ == "__main__":
    main()
