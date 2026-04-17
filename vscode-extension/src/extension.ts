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

function buildHoverMarkdown(entry: KeywordEntry): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportHtml = false;

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

  if (entry.parameters && entry.parameters.length > 0) {
    const hasUnits = entry.parameters.some(p => p.units && Object.keys(p.units).length > 0);
    if (hasUnits) {
      md.appendMarkdown(`**Parameters**\n\n| No. | Name | Description | Field | Metric | Lab | Default |\n|-----|------|-------------|-------|--------|-----|---------|\n`);
      for (const p of entry.parameters) {
        const u = p.units || {};
        md.appendMarkdown(`| ${p.index} | \`${p.name}\` | ${p.description} | ${u.field ?? ''} | ${u.metric ?? ''} | ${u.laboratory ?? ''} | ${p.default} |\n`);
      }
    } else {
      md.appendMarkdown(`**Parameters**\n\n| No. | Name | Description | Default |\n|-----|------|-------------|----------|\n`);
      for (const p of entry.parameters) {
        md.appendMarkdown(`| ${p.index} | \`${p.name}\` | ${p.description} | ${p.default} |\n`);
      }
    }
    md.appendMarkdown('\n');
  }

  if (entry.example) {
    md.appendMarkdown(`**Example**\n\`\`\`\n${entry.example}\n\`\`\`\n`);
  }

  return md;
}

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
            const doc = new vscode.MarkdownString(entry.summary);
            item.documentation = doc;
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
      const word = wordAtPosition(document, position);
      if (!word) return undefined;

      const entry = index[word];
      if (!entry) return undefined;

      return new vscode.Hover(buildHoverMarkdown(entry));
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
          const unitStr = p.units && Object.keys(p.units).length > 0
            ? ` (${[p.units.field, p.units.metric, p.units.laboratory].filter(Boolean).join(' / ')})`
            : '';
          paramLines.push(`${p.index}. **${p.name}**${unitStr} — default: ${p.default}\n   ${p.description}`);
        }
      }

      const context = [
        `# OPM Flow keyword: ${entry.name}`,
        `Section: ${entry.section}`,
        entry.supported !== null ? `Supported: ${entry.supported ? 'yes' : 'no'}` : '',
        '',
        entry.description || entry.summary,
        ...paramLines,
        entry.example ? `\n## Example\n\n\`\`\`\n${entry.example}\n\`\`\`` : '',
      ].filter(Boolean).join('\n');

      await vscode.env.clipboard.writeText(context);
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
        const sec = entry.section;
        if (!bySection[sec]) bySection[sec] = [];
        bySection[sec].push(entry);
      }

      const lines: string[] = ['# OPM Flow Keyword Reference\n'];
      for (const sec of sections) {
        const entries = bySection[sec];
        if (!entries) continue;
        lines.push(`## ${sec}\n`);
        for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          lines.push(`### \`${e.name}\``);
          if (e.summary) lines.push(e.summary);
          if (e.parameters) lines.push(`\n**Parameters**\n\n${e.parameters}`);
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
