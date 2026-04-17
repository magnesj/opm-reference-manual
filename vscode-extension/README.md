# OPM Flow VS Code Extension

Language support for [OPM Flow](https://opm-project.org/) reservoir simulation deck files,
with AI-assisted development features backed by the full OPM Flow reference manual.

## Features

### Syntax Highlighting

Provides syntax highlighting for OPM Flow simulation deck files with support for:

- **Section headers**: `RUNSPEC`, `GRID`, `EDIT`, `PROPS`, `REGIONS`, `SOLUTION`, `SUMMARY`, `SCHEDULE`, `OPTIMIZE` — scoped so most themes render them in a distinct color (yellow in Dark+)
- **Keywords**: ALL_CAPS identifiers (e.g., `COMPDAT`, `WELSPECS`, `DATES`)
- **Comments**: Lines starting with `--`
- **Record terminators**: `/` marking the end of a record
- **Numbers**: Integers and floating-point values
- **Defaults / repeat markers**: `1*`, `3*`, etc. (distinct from ordinary numbers)
- **Strings**: Text in single quotes
- **Template variables**: `<NAME>` placeholders used in macro/ERT workflows
- **END keyword**: Specially highlighted file terminator

### Keyword Autocompletion

Autocomplete support for 1145 OPM Flow keywords extracted from the reference manual.
Each completion item shows the deck section (`RUNSPEC`, `GRID`, `SCHEDULE`, etc.) and
a one-line description in the documentation pane. Completions are triggered when typing
uppercase letters at the start of a line.

### Hover Tooltips

Hover over any keyword to see a quick tooltip with:

- Which deck **section** it belongs to
- Whether it is **supported** in OPM Flow
- A **description** from the reference manual
- A **parameter table** listing all record fields with units and defaults
- A usage **example**

Hovering over a **value in a data record** shows the description for that specific
parameter column. For example, hovering over the group name in a `WELSPECS` record
shows the `GRPNAME` parameter description, units, and default.

### Docs Panel (Sidebar)

Open the **Explorer** sidebar (`Ctrl+Shift+E`) and scroll down to the **OPM Keyword Reference** panel.
It updates automatically as you move the cursor — no keystrokes needed:

- **Cursor on a keyword** → full documentation: description, complete parameter table, example
- **Cursor on a value column** → same view with the matching parameter row highlighted
- **Cursor on whitespace or a comment** → panel retains the last shown keyword

This is the main view for reading long keyword documentation, since it scrolls freely
and stays visible while you edit.

### Align Record Columns

Tidy up record blocks so every column lines up. Invoke **OPM Flow: Align Record Columns**
from the Command Palette or the editor right-click menu. With a selection it aligns only
the selected lines; without one it aligns the whole document.

Groups of consecutive record lines (same token count) are reformatted in place:
strings left-aligned, numerics (including `N*` repeat markers) right-aligned. Keyword
headers, comment lines, the closing `/`, and trailing `-- comments` are left untouched.

Before:
```
MULTIPLY
 'PERMZ' 0.2 1 24 1 62 1 1 /
 'PERMZ' 0.04 1 24 1 62 2 2 /
 'PERMZ' 0.016 1 24 1 62 18 18 /
 'PERMZ' 1 1 24 1 62 22 22 /
/
```

After:
```
MULTIPLY
 'PERMZ'   0.2 1 24 1 62  1  1 /
 'PERMZ'  0.04 1 24 1 62  2  2 /
 'PERMZ' 0.016 1 24 1 62 18 18 /
 'PERMZ'     1 1 24 1 62 22 22 /
/
```

### AI Context Commands

Two commands are available from the Command Palette (`Ctrl+Shift+P`) and, for the first
one, via the editor right-click menu:

| Command | Description |
|---------|-------------|
| **OPM Flow: Copy Keyword Context for AI** | Copies full documentation for the keyword under the cursor to the clipboard, ready to paste into GitHub Copilot Chat, Claude, or any other AI assistant |
| **OPM Flow: Generate Keyword Reference** | Opens a Markdown document listing all 1145 keywords grouped by section — useful for uploading as context to an AI chat session |

## Supported File Extensions

The extension activates for the following extensions (case-sensitive on some platforms —
both common casings are registered where relevant):

Core deck files: `.data`, `.DATA`, `.inc`, `.INC`, `.include`, `.sch`, `.SCH`,
`.schedule`, `.summary`, `.grdecl`, `.GRDECL`, `.vfp`, `.VFP`, `.prop`, `.Ecl`, `.ecl`.

Section data files (Eclipse/OPM include conventions): `.aqucon`, `.aqunum`, `.dimens`,
`.eqlnum`, `.equil`, `.fault`, `.fipnum`, `.multnum`, `.multregp`, `.multregt`, `.nnc`,
`.ntg`, `.opernum`, `.perm`, `.poro`, `.pvt`, `.rocknum`, `.satnum`, `.sattab`,
`.tabdims`, `.thpres`.

## Installation in VS Code

### From the repository (development / local install)

1. **Install dependencies and compile:**
   ```bash
   cd vscode-extension
   npm install
   npm run compile
   ```

2. **Open the extension folder in VS Code**, then press **F5** to launch an Extension
   Development Host. All features will be active for any supported file you open.

3. **To install permanently** without publishing, package the extension and install it:
   ```bash
   npm install -g @vscode/vsce
   vsce package
   # produces opm-flow-0.4.0.vsix
   ```
   Then in VS Code: **Extensions → ⋯ → Install from VSIX…** and select the `.vsix` file.

### Quick test

1. Open any `.data` or `.sch` file.
2. Open the Explorer sidebar (`Ctrl+Shift+E`) and scroll down to **OPM Keyword Reference**.
3. Move the cursor onto a keyword such as `WELSPECS` — the panel shows its full documentation.
4. Move the cursor to a value in a data record — the panel highlights the matching parameter.
5. Hover over a keyword or value to see a quick tooltip.

To use the AI context feature:

1. Place the cursor on a keyword (e.g. `COMPDAT`).
2. Right-click → **OPM Flow: Copy Keyword Context for AI**, or open the Command Palette
   and run the command.
3. Paste the copied text into your AI chat (Copilot Chat, Claude, ChatGPT, etc.) before
   asking a question about that keyword.

## Updating the Keyword Index

The keyword documentation is extracted from the `.fodt` files in the reference manual
repository and stored in `data/keyword_index_compact.json`. When the manual is updated,
regenerate this file:

### Prerequisites

```bash
pip install lxml
```

### Run the extractor

From the **repository root** (one level above `vscode-extension/`):

```bash
python scripts/build_keyword_index.py \
    --manual-dir . \
    --output vscode-extension/data/keyword_index.json \
    --compact vscode-extension/data/keyword_index_compact.json
```

Or use the npm shortcut from inside `vscode-extension/`:

```bash
npm run build-index
```

This reads every `.fodt` file under `parts/chapters/subsections/` and produces:

| File | Size | Purpose |
|------|------|---------|
| `data/keyword_index.json` | ~22 MB | Full index with complete descriptions — not committed, not bundled |
| `data/keyword_index_compact.json` | ~1 MB | Compact index bundled in the extension |

After regenerating, recompile the extension (`npm run compile`) and commit
`data/keyword_index_compact.json`.

## Language ID

The language is registered as `opm-flow`.

## Requirements

- VS Code 1.74.0 or later
- Python 3.10+ with `lxml` (only required when regenerating the keyword index)

## Example Deck

```
-- Reservoir simulation deck example
SCHEDULE

DATES
  1 JAN 2020 /
/

WELSPECS
  'PROD1'  'G1'  10  10  1*  'OIL' /
/

COMPDAT
  'PROD1'  10  10  1  5  'OPEN'  1*  1*  0.2 /
/

TSTEP
  30 /

END
```

## Release Notes

### 0.4.0

- **Align Record Columns** command: tidies consecutive record lines so columns line up
  (strings left-aligned, numerics right-aligned); comments and the closing `/` stay put
- **Grammar expansion**: section headers (`RUNSPEC`, `GRID`, …) colored distinctly;
  default/repeat markers `N*` scoped separately from numbers; template variables `<VAR>`
  highlighted; single-quote auto-closing
- **Parameter extraction fixes**:
  - Multi-record keywords like `VFPPROD` / `VFPINJ` now show their full parameter tables
    (previously empty because of composite indices like `1-1`, `1-2`)
  - Keyword examples now appear in hover and in the sidebar docs panel (previously
    silently dropped because the section-heading style wasn't recognized)
- **Expanded file associations**: many additional Eclipse/OPM include-file extensions
  (`.include`, `.schedule`, `.summary`, `.satnum`, `.fipnum`, `.pvt`, `.equil`, `.perm`,
  `.poro`, `.ntg`, and more — see *Supported File Extensions*)

### 0.3.0

- **Sidebar docs panel**: persistent OPM Keyword Reference panel in the Explorer sidebar
  that follows the cursor automatically and highlights the active parameter row
- **Column hover**: hovering on a value in a data record shows the description for that
  parameter column, including units (Field / Metric / Laboratory) and default value
- Structured parameter extraction from reference manual tables (name, description, units, default)
- MathML formula annotations preserved in descriptions instead of binary garbage
- Additional file extensions: `.sch`, `.SCH`, `.grdecl`, `.GRDECL`, `.vfp`, `.VFP`, `.prop`, `.Ecl`

### 0.2.0

- Keyword documentation extracted from the full OPM Flow reference manual (1145 keywords)
- Hover tooltips with section, support status, parameter table, and example
- Completion items enriched with section label and description
- New commands: **Copy Keyword Context for AI** and **Generate Keyword Reference**
- `scripts/build_keyword_index.py` for regenerating the keyword index from updated manuals

### 0.1.0

Initial release with syntax highlighting and keyword autocompletion.
