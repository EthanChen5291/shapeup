// The name to show for a user: their chosen ShapeUp username, else their Clerk
// first name, else the part of their email before the @.
export function displayName(
  username: string | null | undefined,
  firstName: string | null | undefined,
  email: string | null | undefined,
): string | undefined {
  return username?.trim() || firstName?.trim() || email?.split('@')[0] || undefined;
}
