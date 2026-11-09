export interface QuizQuestion {
  /** What the player judges: either the fact itself or a copy with one number changed. */
  statement: string;
  /** true when `statement` is the unaltered fact. */
  answer: boolean;
  /** The original research fact, shown after answering. */
  fact: string;
}

// 1,234,567.8 | 12.5 | 2024 — the first alternative keeps thousands separators together.
const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

/**
 * True/false questions from the run's own research facts, no AI call needed:
 * facts that contain a number are used as-is (true) or with one number
 * plausibly changed (false). Facts without numbers are skipped, so topics whose
 * research is mostly qualitative produce a short quiz or none.
 */
export function buildQuiz(facts: string[], count = 5, random: () => number = Math.random): QuizQuestion[] {
  const candidates = shuffle(
    facts.map((f) => f.trim()).filter((f) => f.length >= 25 && f.length <= 320 && /\d/.test(f)),
    random
  ).slice(0, count);

  return candidates.map((fact) => {
    if (random() < 0.5) return { statement: fact, answer: true, fact };
    const altered = alterOneNumber(fact, random);
    return altered === fact ? { statement: fact, answer: true, fact } : { statement: altered, answer: false, fact };
  });
}

function alterOneNumber(fact: string, random: () => number): string {
  const matches = Array.from(fact.matchAll(NUMBER));
  if (!matches.length) return fact;
  const match = matches[Math.floor(random() * matches.length)];
  const raw = match[0];
  const value = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(value)) return fact;

  const decimals = (raw.split('.')[1] || '').length;
  let next: number;
  if (!raw.includes(',') && !decimals && value >= 1900 && value <= 2100) {
    // Looks like a year: shift it by a few years.
    next = value + (random() < 0.5 ? -1 : 1) * (1 + Math.floor(random() * 5));
  } else if (value === 0) {
    next = 1 + Math.floor(random() * 9);
  } else {
    const factors = [0.5, 0.6, 1.5, 2, 3];
    next = value * factors[Math.floor(random() * factors.length)];
  }

  let replacement = decimals ? next.toFixed(decimals) : String(Math.round(next));
  if (raw.includes(',')) {
    replacement = Number(replacement).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  if (replacement === raw) return fact;
  const start = match.index ?? 0;
  return fact.slice(0, start) + replacement + fact.slice(start + raw.length);
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
