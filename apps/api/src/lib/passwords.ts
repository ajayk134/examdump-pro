import bcrypt from 'bcryptjs';

export async function hashPassword(password: string, pepper: string, rounds: number): Promise<string> {
  return bcrypt.hash(`${password}${pepper}`, rounds);
}

export async function verifyPassword(
  password: string,
  hash: string | null | undefined,
  pepper: string,
): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(`${password}${pepper}`, hash);
}