import bcrypt from "bcryptjs";

export async function hashPassword(rawPassword: string) {
  const password = rawPassword.trim();
  if (!password) return null;
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(rawPassword: string, hash: string) {
  return bcrypt.compare(rawPassword.trim(), hash);
}
