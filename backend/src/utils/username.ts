export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;

/**
 * Usernames are stored in a normalized form so that `Vince` and `vince`
 * cannot become two different accounts.
 */
export function normalizeUsername(value: string): string {
  return value.trim().normalize('NFKC').toLowerCase();
}

export function isValidUsername(value: string): boolean {
  return new RegExp(
    `^[\\p{L}\\p{N}][\\p{L}\\p{N}._-]{${USERNAME_MIN_LENGTH - 1},${USERNAME_MAX_LENGTH - 1}}$`,
    'u',
  ).test(value);
}

/**
 * Convert a legacy email address (or an arbitrary value) into a safe account
 * name for the one-time database migration.
 */
export function usernameFromLegacyEmail(email: string | null | undefined, userId: string): string {
  const localPart = email?.split('@')[0] || '';
  let candidate = normalizeUsername(localPart)
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^[._-]+|[._-]+$/gu, '');

  if (!candidate || !/^[\p{L}\p{N}]/u.test(candidate)) {
    candidate = `user_${userId.replace(/[^a-z0-9]/gi, '').slice(0, 8)}`;
  }

  if (candidate.length < USERNAME_MIN_LENGTH) {
    candidate = `${candidate}_user`;
  }

  return candidate.slice(0, USERNAME_MAX_LENGTH);
}
