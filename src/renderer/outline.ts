import { Text } from '@codemirror/state';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { DocInput } from '@codemirror/language';
import { normalizeDocument } from '../shared/raw-document.ts';

export interface OutlineHeading { text: string; level: number; line: number }
export function extractHeadings(raw: string): OutlineHeading[] {
  const source = normalizeDocument(raw), doc = Text.of(source.split('\n'));
  const frontmatter = source.match(/^---\n[\s\S]*?\n---(?:\n|$)/)?.[0].length ?? 0;
  const headings: OutlineHeading[] = [];
  // EditorState's syntaxTree may only cover the initial parsing budget. The
  // outline needs a complete document tree, independent of editor viewport.
  markdownLanguage.parser.parse(new DocInput(doc)).iterate({ enter(node) {
    if (node.name === 'Document') return;
    if (node.from < frontmatter || ['FencedCode', 'CodeBlock', 'HTMLBlock'].includes(node.name)) return false;
    const heading = node.name.match(/^(?:ATX|Setext)Heading(\d)$/);
    if (!heading) return;
    const line = doc.lineAt(node.from);
    headings.push({ text: line.text.replace(/^\s*#{1,6}\s+/, '').replace(/\s+#+\s*$/, ''), level: Number(heading[1]), line: line.number });
    return false;
  } });
  return headings;
}
