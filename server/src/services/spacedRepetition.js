// SM-2 scheduling — decides when a card should come back.
//
// The quiz already in the product tests you once and is then gone. Spaced
// repetition is the opposite: it shows you a card just as you are about to
// forget it, which is what actually moves material into long-term memory.
//
// This is the classic SuperMemo-2 algorithm, driven by Anki's four-button
// grading because that is the interaction people already know:
//
//   again — you did not recall it      -> back today, ease drops
//   hard  — recalled, but it hurt      -> shorter interval, ease drops a little
//   good  — recalled correctly         -> the normal progression
//   easy  — instant recall             -> longer interval, ease rises
//
// A card's `ease` never falls below 1.3: below that the interval barely grows
// and the card is shown forever, which is demoralising rather than useful.

const MIN_EASE = 1.3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Anki's buttons mapped onto SM-2's 0-5 quality scale. */
const GRADE_QUALITY = { again: 0, hard: 3, good: 4, easy: 5 };
const GRADES = Object.keys(GRADE_QUALITY);

/**
 * A brand-new card: due immediately, default ease.
 *
 * Takes the clock as an argument like schedule() does. Reading the real clock
 * internally made this the one function here that could not be exercised
 * against a fixed instant, which is a poor property for scheduling code.
 */
function newCardState(now = new Date()) {
  return {
    ease: 2.5,
    intervalDays: 0,
    repetitions: 0,
    lapses: 0,
    dueAt: new Date(now),
    lastGrade: null,
  };
}

/**
 * Apply a grade to a card and return its next state.
 *
 * @param {object} card  current scheduling fields
 * @param {'again'|'hard'|'good'|'easy'} grade
 * @param {Date}   [now]
 */
function schedule(card, grade, now = new Date()) {
  if (!GRADES.includes(grade)) {
    throw new Error(`Unknown grade "${grade}". Expected one of: ${GRADES.join(", ")}`);
  }

  const quality = GRADE_QUALITY[grade];
  let ease = typeof card.ease === "number" ? card.ease : 2.5;
  let repetitions = card.repetitions || 0;
  let intervalDays = card.intervalDays || 0;
  let lapses = card.lapses || 0;

  if (quality < 3) {
    // Failed: the card starts its progression again and comes back this session.
    repetitions = 0;
    intervalDays = 0;
    lapses += 1;
  } else {
    repetitions += 1;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 6;
    else intervalDays = Math.round(intervalDays * ease);

    // "hard" should still advance, but noticeably less than "good".
    if (grade === "hard") intervalDays = Math.max(1, Math.round(intervalDays * 0.6));
    if (grade === "easy") intervalDays = Math.round(intervalDays * 1.3);
  }

  // The SM-2 ease adjustment.
  ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  ease = Math.max(MIN_EASE, Number(ease.toFixed(2)));

  const dueAt = new Date(now.getTime() + intervalDays * DAY_MS);

  return { ease, intervalDays, repetitions, lapses, dueAt, lastGrade: grade };
}

/** Human-readable "next time you'll see this", for the review buttons. */
function describeInterval(intervalDays) {
  if (!intervalDays) return "today";
  if (intervalDays === 1) return "tomorrow";
  if (intervalDays < 30) return `in ${intervalDays} days`;
  const months = Math.round(intervalDays / 30);
  return months === 1 ? "in a month" : `in ${months} months`;
}

/** What each button would do, so the UI can show it before you commit. */
function previewAll(card, now = new Date()) {
  return GRADES.reduce((acc, grade) => {
    acc[grade] = describeInterval(schedule(card, grade, now).intervalDays);
    return acc;
  }, {});
}

const isDue = (card, now = new Date()) => !card.dueAt || new Date(card.dueAt) <= now;

module.exports = { newCardState, schedule, previewAll, describeInterval, isDue, GRADES, MIN_EASE };
