export const INDEX_FILE = 'AGENT.md';
export interface AiConfig { baseUrl: string; apiKey: string; model: string; }
export interface AiChatMessage { role: 'user' | 'assistant'; content: string; }
export interface AiNoteContext { path: string; name: string; content: string; }
export interface AiContext { currentNote?: AiNoteContext; selection?: string; retrieved?: AiNoteContext[]; index?: string; }
export interface AiSearchHit { path: string; name: string; snippet: string; score: number; content: string; }
