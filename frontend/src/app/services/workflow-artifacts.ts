// Behind-the-scenes outputs main_new.py reports while a run is in progress.
// Python prints `ARTIFACT:{json}`; the server turns file paths into /uploads URLs
// and forwards them as `workflow_artifact`. `at` is when the server received it.

export interface ResearchArtifact {
  kind: 'research';
  facts: string[];
  sources: string[];
  newsDate: string | null;
  at: number;
}

export interface ScriptArtifact {
  kind: 'script';
  text: string;
  revision: number;
  at: number;
}

export interface CriticArtifact {
  kind: 'critic';
  passed: boolean;
  issues: string[];
  revision: number;
  at: number;
}

export interface ScenesArtifact {
  kind: 'scenes';
  prompts: string[];
  hook: string | null;
  at: number;
}

export interface ImageArtifact {
  kind: 'image';
  index: number;
  url: string | null;
  source: 'real' | 'ai';
  prompt: string;
  at: number;
}

export interface AudioArtifact {
  kind: 'audio';
  url: string | null;
  at: number;
}

export interface VideoArtifact {
  kind: 'video';
  url: string | null;
  variant: 'draft' | 'music' | 'captions';
  at: number;
}

/**
 * A finished draft, handed over because the run is paused for review.
 * Without this kind normalizeArtifact would drop it and the editor would open
 * with nothing in it.
 */
export interface ScriptReviewArtifact {
  kind: 'script_review';
  text: string;
  at: number;
}

/** The packaging the video will be published with. */
export interface MetadataArtifact {
  kind: 'metadata';
  title: string;
  description: string;
  tags: string[];
  at: number;
}

export interface QaArtifact {
  kind: 'qa';
  passed: boolean;
  checks: Record<string, unknown>;
  issues: string[];
  at: number;
}

export type StudioArtifact =
  | ResearchArtifact
  | ScriptArtifact
  | CriticArtifact
  | ScenesArtifact
  | ImageArtifact
  | AudioArtifact
  | VideoArtifact
  | MetadataArtifact
  | ScriptReviewArtifact
  | QaArtifact;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v) => v !== null && v !== undefined).map((v) => String(v)) : [];

const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

/** Validate and coerce one artifact from the socket; unknown or malformed ones are dropped. */
export function normalizeArtifact(raw: any): StudioArtifact | null {
  if (!raw || typeof raw !== 'object') return null;
  const at = Number(raw.at) || Date.now();
  const url = typeof raw.url === 'string' && raw.url ? raw.url : null;

  switch (raw.kind) {
    case 'research':
      return { kind: 'research', facts: strings(raw.facts), sources: strings(raw.sources), newsDate: raw.newsDate ? text(raw.newsDate) : null, at };
    case 'script':
      return { kind: 'script', text: text(raw.text), revision: Number(raw.revision) || 1, at };
    case 'critic':
      return { kind: 'critic', passed: !!raw.passed, issues: strings(raw.issues), revision: Number(raw.revision) || 1, at };
    case 'scenes':
      return { kind: 'scenes', prompts: strings(raw.prompts), hook: raw.hook ? text(raw.hook) : null, at };
    case 'image':
      return { kind: 'image', index: Math.max(0, Number(raw.index) || 0), url, source: raw.source === 'real' ? 'real' : 'ai', prompt: text(raw.prompt), at };
    case 'audio':
      return { kind: 'audio', url, at };
    case 'video': {
      const variant = raw.variant === 'music' || raw.variant === 'captions' ? raw.variant : 'draft';
      return { kind: 'video', url, variant, at };
    }
    case 'script_review':
      return { kind: 'script_review', text: text(raw.text), at };
    case 'metadata':
      return {
        kind: 'metadata',
        title: text(raw.title),
        description: text(raw.description),
        tags: strings(raw.tags),
        at,
      };
    case 'qa':
      return {
        kind: 'qa',
        passed: !!raw.passed,
        checks: raw.checks && typeof raw.checks === 'object' ? raw.checks : {},
        issues: strings(raw.issues),
        at,
      };
    default:
      return null;
  }
}
