# OPM Flow VS Code Extension

Language support for [OPM Flow](https://opm-project.org/) reservoir simulation deck files,
with AI-assisted development features backed by the full OPM Flow reference manual.

## Features

### Syntax Highlighting

Provides syntax highlighting for OPM Flow simulation deck files with support for:

- **Keywords**: ALL_CAPS identifiers (e.g., `COMPDAT`, `WELSPECS`, `DATES`, `SCHEDULE`)
- **Comments**: Lines starting with `--`
- **Section terminators**: Standalone `/` on a line
- **Numbers**: Integers and floating-point values
- **Strings**: Text in single quotes
- **END keyword**: Specially highlighted file terminator

### Keyword Autocompletion

Autocomplete support for 1145 OPM Flow keywords extracted from the reference manual.
Each completion item shows the deck section (`RUNSPEC`, `GRID`, `SCHEDULE`, etc.) and
a one-line description in the documentation pane. Completions are triggered when typing
uppercase letters at the start of a line.

### Hover Documentation

Hover over any keyword to see:

- Which deck **section** it belongs to
- Whether it is **supported** in OPM Flow
- A **description** from the reference manual
- A **parameter table** listing all record fields
- A usage **example**

### AI Context Commands

Two commands are available from the Command Palette (`Ctrl+Shift+P`) and, for the first
one, via the editor right-click menu:

| Command | Description |
|---------|-------------|
| **OPM Flow: Copy Keyword Context for AI** | Copies full documentation for the keyword under the cursor to the clipboard, ready to paste into GitHub Copilot Chat, Claude, or any other AI assistant |
| **OPM Flow: Generate Keyword Reference** | Opens a Markdown document listing all 1145 keywords grouped by section — useful for uploading as context to an AI chat session |

## Supported File Extensions

| Extension | Description |
|-----------|-------------|
| `.data`   | Main simulation deck files |
| `.DATA`   | Main simulation deck files (uppercase) |
| `.inc`    | Include files |
| `.INC`    | Include files (uppercase) |

## Installation in VS Code

### From the repository (development / local install)

1. **Install dependencies and compile:**
   ```bash
   cd vscode-extension
   npm install
   npm run compile
   ```

2. **Open the extension folder in VS Code**, then press **F5** to launch an Extension
   Development Host. OPM Flow syntax highlighting and all features will be active for
   any `.data` or `.inc` file you open in that window.

3. **To install permanently** without publishing, package the extension and install it:
   ```bash
   npm install -g @vscode/vsce
   vsce package
   # produces opm-flow-0.2.0.vsix
   ```
   Then in VS Code: **Extensions → ⋯ → Install from VSIX…** and select the `.vsix` file.

### Quick test

Open any `.data` file, hover over a keyword such as `WELSPECS` and you should see the
reference manual documentation in a tooltip.

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
| `data/keyword_index_compact.json` | ~800 KB | Compact index bundled in the extension |

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

### 0.2.0

- Keyword documentation extracted from the full OPM Flow reference manual (1145 keywords)
- Hover tooltips with section, support status, parameter table, and example
- Completion items enriched with section label and description
- New commands: **Copy Keyword Context for AI** and **Generate Keyword Reference**
- `scripts/build_keyword_index.py` for regenerating the keyword index from updated manuals

### 0.1.0

Initial release with syntax highlighting and keyword autocompletion.
