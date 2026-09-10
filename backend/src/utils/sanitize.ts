/**
 * Shared error message sanitizer.
 *
 * Removes known sensitive patterns from error messages before they are
 * written to logs or returned in non-production API responses.
 * Add new patterns here as the application evolves.
 */
export function sanitizeErrorMessage(err: unknown, includeStack = false): string {
  const raw = err instanceof Error
    ? (includeStack && err.stack ? err.stack : err.message)
    : String(err);
  return raw
    // MongoDB connection strings (e.g. mongodb+srv://user:pass@cluster.mongodb.net)
    .replace(/mongodb(?:\+srv)?:\/\/[^\s@]+@/gi, 'mongodb+srv://***:***@')
    // Device tokens issued by this service (prefix dvt_ + 32–64 hex chars)
    .replace(/dvt_[a-f0-9]{32,64}/gi, 'dvt_***')
    // Upstash / generic Bearer tokens that may appear in fetch error bodies
    .replace(/Bearer\s+[A-Za-z0-9\-_=.]{16,}/g, 'Bearer ***');
}
