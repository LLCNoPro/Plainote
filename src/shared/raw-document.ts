export interface RawChange { from: number; to: number; insert: string }
export function normalizeDocument(raw: string): string { return raw.replace(/^\ufeff/, '').replace(/\r\n?|\n/g, '\n'); }
export function applyRawChanges(raw: string, changes: RawChange[]): string {
  if (!changes.length) return raw;
  const ending = raw.match(/\r\n|\r|\n/)?.[0] ?? '\n';
  const positions = [...new Set(changes.flatMap(c => [c.from, c.to]))].sort((a, b) => a - b);
  const offsets = new Map<number, number>();
  let index = raw.startsWith('\ufeff') ? 1 : 0, logical = 0;
  for (const position of positions) {
    if (position < 0) throw new RangeError('Invalid edit offset');
    while (logical < position && index < raw.length) {
      index += raw[index] === '\r' && raw[index + 1] === '\n' ? 2 : 1;
      logical++;
    }
    if (logical !== position) throw new RangeError('Edit outside document');
    offsets.set(position, index);
  }
  let result = '', cursor = 0;
  for (const change of changes) {
    const start = offsets.get(change.from)!, end = offsets.get(change.to)!;
    result += raw.slice(cursor, start) + change.insert.replace(/\n/g, ending);
    cursor = end;
  }
  return result + raw.slice(cursor);
}
