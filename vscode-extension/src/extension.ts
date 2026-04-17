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
  start: number;
  end: number;
  columnCount: number;
}

function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i++;
    if (i >= line.length) break;
    if (line[i] === '-' && line[i + 1] === '-') break;
    if (line[i] === '/') break;

    const start = i;
    let text: string;

    if (line[i] === "'") {
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

    const repeatMatch = text.match(/^(\d+)\*$/);
    const columnCount = repeatMatch ? parseInt(repeatMatch[1]) : 1;
    tokens.push({ text, start, end: i, columnCount });
  }
  return tokens;
}

function columnAtCursor(line: string, cursorChar: number): number {
  const tokens = tokenizeLine(line);
  let col = 1;
  for (const tok of tokens) {
    if (cursorChar >= tok.start && cursorChar < tok.end) return col;
    col += tok.columnCount;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Backward keyword scanner
// ---------------------------------------------------------------------------

const KEYWORD_LINE_RE = /^\s*([A-Z][A-Z0-9_-]{1,})\s*(?:--|\/\s*(?:--|$)|$)/;

function findActiveKeyword(document: vscode.TextDocument, position: vscode.Position): string | null {
  for (let lineNum = position.line; lineNum >= 0; lineNum--) {
    const text = document.lineAt(lineNum).text;
    if (text.trim().startsWith('--')) continue;
    const m = text.match(KEYWORD_LINE_RE);
    if (m) return m[1];
  }
  return null;
}

function wordAtPosition(document: vscode.TextDocument, position: vscode.Position): string {
  const range = document.getWordRangeAtPosition(position, /[A-Z][A-Z0-9_-]*/);
  return range ? document.getText(range) : '';
}

// ---------------------------------------------------------------------------
// HTML builder for the sidebar docs panel
// ---------------------------------------------------------------------------

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildDocsHtml(entry: KeywordEntry | null, highlightParam: Parameter | null): string {
  const css = `
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 8px 12px;
      margin: 0;
      line-height: 1.5;
    }
    h1 { font-size: 1.15em; margin: 0 0 4px 0; }
    h2 { font-size: 1em; margin: 12px 0 4px 0; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 2px; }
    .badges { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
    .badge {
      font-size: 0.78em; padding: 1px 7px; border-radius: 10px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .badge.ok   { background: #2d6a2d; color: #c8f0c8; }
    .badge.fail { background: #6a2d2d; color: #f0c8c8; }
    p { margin: 4px 0 8px 0; }
    table { border-collapse: collapse; width: 100%; font-size: 0.9em; margin-bottom: 8px; }
    th {
      text-align: left; padding: 4px 6px;
      background: var(--vscode-editorGroupHeader-tabsBackground);
      border: 1px solid var(--vscode-panel-border);
    }
    td { padding: 3px 6px; border: 1px solid var(--vscode-panel-border); vertical-align: top; }
    tr.highlight td { background: var(--vscode-editor-selectionBackground); }
    code {
      font-family: var(--vscode-editor-font-family);
      background: var(--vscode-textBlockQuote-background);
      padding: 1px 4px; border-radius: 3px; font-size: 0.9em;
    }
    pre {
      font-family: var(--vscode-editor-font-family);
      font-size: 0.88em;
      background: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--vscode-textBlockQuote-border);
      padding: 6px 10px; margin: 4px 0;
      white-space: pre-wrap; word-break: break-all;
      overflow-x: auto;
    }
    .placeholder { color: var(--vscode-descriptionForeground); font-style: italic; margin-top: 20px; }
  `;

  if (!entry) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
      <style>${css}</style></head>
      <body><p class="placeholder">Move the cursor over a keyword or value to see documentation.</p></body></html>`;
  }

  const supportBadge =
    entry.supported === true  ? `<span class="badge ok">&#10003; Supported</span>` :
    entry.supported === false ? `<span class="badge fail">&#10007; Not supported</span>` :
                                `<span class="badge">? Support unknown</span>`;

  let paramsHtml = '';
  if (entry.parameters && entry.parameters.length > 0) {
    const hasUnits = entry.parameters.some(p => p.units && Object.keys(p.units).length > 0);
    const unitCols = hasUnits ? '<th>Field</th><th>Metric</th><th>Lab</th>' : '';
    const rows = entry.parameters.map(p => {
      const u = p.units ?? {};
      const unitCells = hasUnits
        ? `<td>${escHtml(u.field ?? '')}</td><td>${escHtml(u.metric ?? '')}</td><td>${escHtml(u.laboratory ?? '')}</td>`
        : '';
      const hl = highlightParam && highlightParam.index === p.index ? ' class="highlight"' : '';
      return `<tr${hl}><td>${p.index}</td><td><code>${escHtml(p.name)}</code></td><td>${escHtml(p.description)}</td>${unitCells}<td>${escHtml(p.default)}</td></tr>`;
    }).join('');
    paramsHtml = `<h2>Parameters</h2>
      <table><thead><tr><th>No.</th><th>Name</th><th>Description</th>${unitCols}<th>Default</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  const exampleHtml = entry.example
    ? `<h2>Example</h2><pre>${escHtml(entry.example)}</pre>`
    : '';

  const descHtml = entry.description
    ? `<p>${escHtml(entry.description)}</p>`
    : (entry.summary ? `<p>${escHtml(entry.summary)}</p>` : '');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
    <style>${css}</style></head>
    <body>
      <h1><code>${escHtml(entry.name)}</code></h1>
      <div class="badges">
        <span class="badge">${escHtml(entry.section)}</span>
        ${supportBadge}
      </div>
      ${descHtml}
      ${paramsHtml}
      ${exampleHtml}
    </body></html>`;
}

// ---------------------------------------------------------------------------
// Sidebar docs panel
// ---------------------------------------------------------------------------

class DocsViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _index: KeywordIndex
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this._view = view;
    view.webview.options = { enableScripts: false };
    view.webview.html = buildDocsHtml(null, null);
  }

  update(entry: KeywordEntry, param?: Parameter): void {
    if (this._view) {
      this._view.webview.html = buildDocsHtml(entry, param ?? null);
    }
  }
}

// ---------------------------------------------------------------------------
// Hover markdown builders (tooltip)
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
  if (entry.summary) md.appendMarkdown(`${entry.summary}\n\n`);
  if (entry.description && entry.description !== entry.summary) {
    md.appendMarkdown(`${entry.description}\n\n`);
  }
  appendParameterTable(md, entry.parameters);
  if (entry.example) md.appendMarkdown(`**Example**\n\`\`\`\n${entry.example}\n\`\`\`\n`);
  return md;
}

function buildParameterHover(entry: KeywordEntry, param: Parameter): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.appendMarkdown(`**\`${entry.name}\` — parameter ${param.index}: \`${param.name}\`**\n\n`);
  md.appendMarkdown(`${param.description}\n\n`);
  const u = param.units ?? {};
  if (u.field || u.metric || u.laboratory) {
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

function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number): (...args: T) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: T) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function activate(context: vscode.ExtensionContext): void {
  const index = loadKeywordIndex(context);
  const keywords = Object.keys(index);

  // --- Sidebar docs panel ---
  const docsProvider = new DocsViewProvider(context.extensionUri, index);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('opm-flow.docsView', docsProvider)
  );

  // --- Cursor-driven docs update ---
  const onCursorMove = debounce((editor: vscode.TextEditor) => {
    const pos = editor.selection.active;
    const line = editor.document.lineAt(pos).text;

    const word = wordAtPosition(editor.document, pos);
    if (word && index[word]) {
      docsProvider.update(index[word]);
      return;
    }

    const col = columnAtCursor(line, pos.character);
    if (col >= 1) {
      const kwName = findActiveKeyword(editor.document, pos);
      const entry = kwName ? index[kwName] : undefined;
      if (entry) {
        const param = entry.parameters.find(p => p.index === col);
        docsProvider.update(entry, param);
        return;
      }
    }
  }, 150);

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(e => {
      if (e.textEditor.document.languageId === 'opm-flow') {
        onCursorMove(e.textEditor);
      }
    })
  );

  // --- Completion provider ---
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    'opm-flow',
    {
      provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
      ): vscode.CompletionItem[] {
        const linePrefix = document.lineAt(position).text.substring(0, position.character);
        if (!/^\s*[A-Z][A-Z0-9_-]*$/.test(linePrefix)) return [];
        return keywords.map((kw) => {
          const entry = index[kw];
          const item = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
          item.detail = `[${entry.section}] ${entry.supported === false ? '(not supported) ' : ''}OPM Flow`;
          if (entry.summary) item.documentation = new vscode.MarkdownString(entry.summary);
          return item;
        });
      },
    },
    ...('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''))
  );

  // --- Hover provider (tooltip) ---
  const hoverProvider = vscode.languages.registerHoverProvider('opm-flow', {
    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
      const line = document.lineAt(position).text;

      const word = wordAtPosition(document, position);
      if (word && index[word]) return new vscode.Hover(buildKeywordHover(index[word]));

      const col = columnAtCursor(line, position.character);
      if (col < 1) return undefined;

      const kwName = findActiveKeyword(document, position);
      if (!kwName) return undefined;
      const entry = index[kwName];
      if (!entry?.parameters?.length) return undefined;

      const param = entry.parameters.find(p => p.index === col);
      if (!param) return undefined;

      return new vscode.Hover(buildParameterHover(entry, param));
    },
  });

  // --- Command: copy AI context ---
  const copyContextCommand = vscode.commands.registerCommand('opm-flow.copyKeywordContext', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const word = wordAtPosition(editor.document, editor.selection.active);
    const entry = word ? index[word] : undefined;
    if (!entry) {
      vscode.window.showInformationMessage(word ? `No documentation found for "${word}"` : 'Place cursor on a keyword first');
      return;
    }
    const paramLines: string[] = [];
    if (entry.parameters?.length) {
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
      '', entry.description || entry.summary,
      ...paramLines,
      entry.example ? `\n## Example\n\n\`\`\`\n${entry.example}\n\`\`\`` : '',
    ].filter(Boolean).join('\n');
    await vscode.env.clipboard.writeText(contextText);
    vscode.window.showInformationMessage(`Copied context for ${entry.name} to clipboard`);
  });

  // --- Command: generate keyword reference ---
  const generateReferenceCommand = vscode.commands.registerCommand('opm-flow.generateKeywordReference', async () => {
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
        if (e.parameters?.length) {
          lines.push('');
          for (const p of e.parameters) lines.push(`- **${p.name}**: ${p.description} *(default: ${p.default})*`);
        }
        lines.push('');
      }
    }
    const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'markdown' });
    await vscode.window.showTextDocument(doc);
  });

  context.subscriptions.push(completionProvider, hoverProvider, copyContextCommand, generateReferenceCommand);
}

export function deactivate(): void {}
