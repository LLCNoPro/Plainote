/** A canceled close must not be revived by a delayed save completion. */
export class CloseAttempt {
  private id: number | null = null;
  begin(id: number) { this.id = id; }
  isCurrent(id: number) { return this.id === id; }
  cancel(id: number) { if (!this.isCurrent(id)) return false; this.id = null; return true; }
}
