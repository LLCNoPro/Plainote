import type { NoteSnapshot, Result } from './types.ts';
export type Saver = (path: string, content: string, revision: string) => Promise<Result<NoteSnapshot>>;
export class SaveSession {
  path: string; content: string; savedContent: string; revision: string;
  status: 'saved' | 'dirty' | 'saving' | 'error' | 'conflict' = 'saved';
  error: { code: string; message: string } | null = null;
  private saver: Saver;
  private notify: () => void;
  private inFlight: Promise<boolean> | null = null;
  constructor(note: NoteSnapshot, saver: Saver, notify: () => void = () => {}) {
    this.path = note.path; this.content = this.savedContent = note.content; this.revision = note.revision;
    this.saver = saver; this.notify = notify;
  }
  edit(content: string) {
    this.content = content;
    if (this.status !== 'conflict') this.status = this.inFlight ? 'saving' : this.content === this.savedContent ? 'saved' : 'dirty';
    this.notify();
  }
  flush(): Promise<boolean> {
    if (this.inFlight) return this.inFlight;
    if (this.status === 'conflict') return Promise.resolve(false);
    const run = async () => {
      while (this.content !== this.savedContent) {
        const submitted = this.content;
        this.status = 'saving'; this.notify();
        let result: Result<NoteSnapshot>;
        try { result = await this.saver(this.path, submitted, this.revision); }
        catch (error) { result = { ok: false, error: { code: 'IO', message: String(error) } }; }
        if (!result.ok) {
          this.status = result.error.code === 'CONFLICT' ? 'conflict' : 'error';
          this.error = result.error; this.notify(); return false;
        }
        this.savedContent = submitted; this.revision = result.value.revision; this.error = null;
      }
      this.status = 'saved'; this.notify(); return true;
    };
    this.inFlight = run().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
  acceptDisk(snapshot: NoteSnapshot) {
    this.content = this.savedContent = snapshot.content; this.revision = snapshot.revision;
    this.status = 'saved'; this.error = null; this.notify();
  }
}
