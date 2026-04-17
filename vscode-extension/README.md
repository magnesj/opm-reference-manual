# OPM Flow VS Code Extension

Language support for [OPM Flow](https://opm-project.org/) reservoir simulation deck files.

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

Autocomplete support for all 363 OPM Flow keywords from the 12.3 keyword reference. Completions are triggered when typing uppercase letters at the start of a line.

## Supported File Extensions

| Extension | Description |
|-----------|-------------|
| `.data`   | Main simulation deck files |
| `.DATA`   | Main simulation deck files (uppercase) |
| `.inc`    | Include files |
| `.INC`    | Include files (uppercase) |

## Language ID

The language is registered as `opm-flow`.

## Example

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

## Requirements

- VS Code 1.74.0 or later

## Release Notes

### 0.1.0

Initial release with syntax highlighting and keyword autocompletion.
