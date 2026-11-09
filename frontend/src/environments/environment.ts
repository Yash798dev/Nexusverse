

/**
 * Every server address the app uses, in one place.
 *
 * These were previously hardcoded as 'http://localhost:8000' in six different
 * services, so pointing the app at a deployed backend meant hunting them down
 * individually (and one of them, AuthService.getCredits, had already drifted).
 *
 * Ports:
 *   8000 — Express API + Socket.IO (auth, credits, jobs, knowledge proxy)
 *   8100 — NexusNotes FastAPI ingest service (internal; reached via /api/knowledge)
 *
 * The browser only ever talks to `apiBase`/`socketBase`. `notesApiBase` is here
 * for local debugging of the notes service directly; app code should not use it.
 */
const SERVER_ORIGIN = 'http://localhost:8000';

export const environment = {
  /** REST root for the Express API. */
  apiBase: `${SERVER_ORIGIN}/api`,
  /** Socket.IO origin (the workflow runner). */
  socketBase: SERVER_ORIGIN,
  /** Origin that serves generated media at /uploads. */
  uploadsBase: SERVER_ORIGIN,
  /** NexusNotes ingest service — debugging only; go through /api/knowledge instead. */
  notesApiBase: 'http://localhost:8100',
};
