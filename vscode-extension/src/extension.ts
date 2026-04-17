import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface Parameter {
  index: number;
  name: string;
  description: string;
  units: { field?: string; metric?: string; laboratory?: string };
  default: string;
}

interface KeywordEntry {
  name: string;
  section: string;
  supported: boolean | null;
  summary: string;
  description: string;
  parameters: Parameter[];
  example: string;
}

type KeywordIndex = Record<string, KeywordEntry>;

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function loadKeywordIndex(context: vscode.ExtensionContext): KeywordIndex {
  const indexPath = path.join(context.extensionPath, 'data', 'keyword_index_compact.json');
  try {
    const raw = fs.readFileSync(indexPath, 'utf-8');
    return JSON.parse(raw) as KeywordIndex;
  } catch (e) {
    console.error('OPM Flow: failed to load keyword index', e);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Record tokenizer
// ---------------------------------------------------------------------------

interface Token {
  text: string;
  start: number;  // inclusive char index in line
  end: number;    // exclusive char index in line
  columnCount: number; // 1 normally, N for "N*" default notation
}

function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    // skip whitespace
    while (i < line.length && /\s/.test(line[i])) i++;
    if (i >= line.length) break;
    // comment: rest of line is ignored
    if (line[i] === '-' && line[i + 1] === '-') break;
    // record terminator
    if (line[i] === '/') break;

    const start = i;
    let text: string;

    if (line[i] === "'") {
      // quoted string — advance to closing quote
      let j = i + 1;
      while (j < line.length && line[j] !== "'") j++;
      text = line.substring(i, j + 1);
      i = j + 1;
    } else {
      let j = i;
      while (j < line.length && !/[\s/]/.test(line[j])) j++;
      text = line.substring(i, j);
      i = j;
    }

    // "N*" means N defaulted columns; bare "*" means 1 defaulted column
    const repeatMatch = text.match(/^(\d+)\*$/);
    const bareDefaultMatch = text === '*';
    const columnCount = repeatMatch ? parseInt(repeatMatch[1]) : bareDefaultMatch ? 1 : 1;

    tokens.push({ text, start, end: i, columnCount });
  }
  return tokens;
}

// Returns the 1-based parameter column index the cursor is on, or -1.
function columnAtCursor(line: string, cursorChar: number): number {
  const tokens = tokenizeLine(line);
  let col = 1;
  for (const tok of tokens) {
    if (cursorChar >= tok.start && cursorChar < tok.end) {
      return col;
    }
    col += tok.columnCount;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Backward keyword scanner
// ---------------------------------------------------------------------------

const KEYWORD_LINE_RE = /^\s*([A-Z][A-Z0-9_-]{1,})\s*(?:--|\/\s*(?:--|$)|$)/;

// Scans backward from position to find the most recent keyword name.
function findActiveKeyword(document: vscode.TextDocument, position: vscode.Position): string | null {
  for (let lineNum = position.line; lineNum >= 0; lineNum--) {
    const text = document.lineAt(lineNum).text;
    if (text.trim().startsWith('--')) continue;
    const m = text.match(KEYWORD_LINE_RE);
    if (m) return m[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Markdown builders
// ---------------------------------------------------------------------------

function buildKeywordHover(entry: KeywordEntry): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;

  const supportLabel =
    entry.supported === true  ? '✅ Supported' :
    entry.supported === false ? '❌ Not supported' :
                                '❓ Support unknown';

  md.appendMarkdown(`## \`${entry.name}\` — ${entry.section}\n\n`);
  md.appendMarkdown(`*${supportLabel}*\n\n`);

  if (entry.summary) {
    md.appendMarkdown(`${entry.summary}\n\n`);
  }

  if (entry.description && entry.description !== entry.summary) {
    md.appendMarkdown(`${entry.description}\n\n`);
  }

  appendParameterTable(md, entry.parameters);

  if (entry.example) {
    md.appendMarkdown(`**Example**\n\`\`\`\n${entry.example}\n\`\`\`\n`);
  }

  return md;
}

function buildParameterHover(entry: KeywordEntry, param: Parameter): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;

  md.appendMarkdown(`**\`${entry.name}\` — parameter ${param.index}: \`${param.name}\`**\n\n`);
  md.appendMarkdown(`${param.description}\n\n`);

  const u = param.units ?? {};
  const hasUnits = u.field || u.metric || u.laboratory;
  if (hasUnits) {
    md.appendMarkdown(`| Field | Metric | Laboratory |\n|-------|--------|------------|\n`);
    md.appendMarkdown(`| ${u.field ?? ''} | ${u.metric ?? ''} | ${u.laboratory ?? ''} |\n\n`);
  }

  md.appendMarkdown(`*Default: ${param.default || '—'}*`);
  return md;
}

function appendParameterTable(md: vscode.MarkdownString, parameters: Parameter[]): void {
  if (!parameters || parameters.length === 0) return;

  const hasUnits = parameters.some(p => p.units && Object.keys(p.units).length > 0);
  if (hasUnits) {
    md.appendMarkdown(`**Parameters**\n\n| No. | Name | Description | Field | Metric | Lab | Default |\n|-----|------|-------------|-------|--------|-----|---------|\n`);
    for (const p of parameters) {
      const u = p.units || {};
      md.appendMarkdown(`| ${p.index} | \`${p.name}\` | ${p.description} | ${u.field ?? ''} | ${u.metric ?? ''} | ${u.laboratory ?? ''} | ${p.default} |\n`);
    }
  } else {
    md.appendMarkdown(`**Parameters**\n\n| No. | Name | Description | Default |\n|-----|------|-------------|----------|\n`);
    for (const p of parameters) {
      md.appendMarkdown(`| ${p.index} | \`${p.name}\` | ${p.description} | ${p.default} |\n`);
    }
  }
  md.appendMarkdown('\n');
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

function wordAtPosition(document: vscode.TextDocument, position: vscode.Position): string {
  const range = document.getWordRangeAtPosition(position, /[A-Z][A-Z0-9_-]*/);
  return range ? document.getText(range) : '';
}

export function activate(context: vscode.ExtensionContext): void {
  const index = loadKeywordIndex(context);
  const keywords = Object.keys(index);

  // --- Completion provider ---
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    'opm-flow',
    {
      provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
      ): vscode.CompletionItem[] {
        const linePrefix = document.lineAt(position).text.substring(0, position.character);
        if (!/^\s*[A-Z][A-Z0-9_-]*$/.test(linePrefix)) {
          return [];
        }

        return keywords.map((kw) => {
          const entry = index[kw];
          const item = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
          item.detail = `[${entry.section}] ${entry.supported === false ? '(not supported) ' : ''}OPM Flow`;
          if (entry.summary) {
            item.documentation = new vscode.MarkdownString(entry.summary);
          }
          return item;
        });
      },
    },
    ...('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''))
  );

  // --- Hover provider ---
  const hoverProvider = vscode.languages.registerHoverProvider('opm-flow', {
    provideHover(
      document: vscode.TextDocument,
      position: vscode.Position
    ): vscode.Hover | undefined {
      const line = document.lineAt(position).text;
      const cursorChar = position.character;

      // 1. Cursor on a keyword name → show keyword docs
      const word = wordAtPosition(document, position);
      if (word && index[word]) {
        return new vscode.Hover(buildKeywordHover(index[word]));
      }

      // 2. Cursor on a value token → show parameter description for that column
      const col = columnAtCursor(line, cursorChar);
      if (col < 1) return undefined;

      const kwName = findActiveKeyword(document, position);
      if (!kwName) return undefined;

      const entry = index[kwName];
      if (!entry || !entry.parameters || entry.parameters.length === 0) return undefined;

      const param = entry.parameters.find(p => p.index === col);
      if (!param) return undefined;

      return new vscode.Hover(buildParameterHover(entry, param));
    },
  });

  // --- Command: copy AI context for current keyword ---
  const copyContextCommand = vscode.commands.registerCommand(
    'opm-flow.copyKeywordContext',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const word = wordAtPosition(editor.document, editor.selection.active);
      const entry = word ? index[word] : undefined;

      if (!entry) {
        vscode.window.showInformationMessage(
          word ? `No documentation found for "${word}"` : 'Place cursor on a keyword first'
        );
        return;
      }

      const paramLines: string[] = [];
      if (entry.parameters && entry.parameters.length > 0) {
        paramLines.push('\n## Parameters\n');
        for (const p of entry.parameters) {
          const u = p.units ?? {};
          const unitStr = (u.field || u.metric || u.laboratory)
            ? ` (${[u.field, u.metric, u.laboratory].filter(Boolean).join(' / ')})`
            : '';
          paramLines.push(`${p.index}. **${p.name}**${unitStr} — default: ${p.default}\n   ${p.description}`);
        }
      }

      const contextText = [
        `# OPM Flow keyword: ${entry.name}`,
        `Section: ${entry.section}`,
        entry.supported !== null ? `Supported: ${entry.supported ? 'yes' : 'no'}` : '',
        '',
        entry.description || entry.summary,
        ...paramLines,
        entry.example ? `\n## Example\n\n\`\`\`\n${entry.example}\n\`\`\`` : '',
      ].filter(Boolean).join('\n');

      await vscode.env.clipboard.writeText(contextText);
      vscode.window.showInformationMessage(`Copied context for ${entry.name} to clipboard`);
    }
  );

  // --- Command: generate full keyword reference as markdown ---
  const generateReferenceCommand = vscode.commands.registerCommand(
    'opm-flow.generateKeywordReference',
    async () => {
      const sections = ['RUNSPEC', 'GRID', 'EDIT', 'PROPS', 'REGIONS', 'SOLUTION', 'SUMMARY', 'SCHEDULE', 'OPTIMIZE'];
      const bySection: Record<string, KeywordEntry[]> = {};

      for (const entry of Object.values(index)) {
        if (!bySection[entry.section]) bySection[entry.section] = [];
        bySection[entry.section].push(entry);
      }

      const lines: string[] = ['# OPM Flow Keyword Reference\n'];
      for (const sec of sections) {
        const entries = bySection[sec];
        if (!entries) continue;
        lines.push(`## ${sec}\n`);
        for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          lines.push(`### \`${e.name}\``);
          if (e.summary) lines.push(e.summary);
          if (e.parameters && e.parameters.length > 0) {
            lines.push('');
            for (const p of e.parameters) {
              lines.push(`- **${p.name}**: ${p.description} *(default: ${p.default})*`);
            }
          }
          lines.push('');
        }
      }

      const doc = await vscode.workspace.openTextDocument({
        content: lines.join('\n'),
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc);
    }
  );

  context.subscriptions.push(
    completionProvider,
    hoverProvider,
    copyContextCommand,
    generateReferenceCommand
  );
}

export function deactivate(): void {}
