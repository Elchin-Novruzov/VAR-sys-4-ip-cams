/**
 * Create or update a login in MongoDB. Runs from anywhere with MONGODB_URI
 * in .env.local, so it also works for the production database.
 *
 *   pnpm seed-user email@club.com "Display Name" password [admin|staff|player]
 */
import { hash } from "bcryptjs";
import { getClient } from "../lib/mongodb";
import type { UserDoc, UserRole } from "../lib/types";

async function main() {
  // pnpm forwards a literal "--" to the script; ignore it if present.
  const args = process.argv.slice(2).filter((a, i) => !(i === 0 && a === "--"));
  const [email, name, password, roleArg] = args;
  const ROLES: UserRole[] = ["admin", "staff", "player"];
  if (!email || !email.includes("@") || !name || !password || (roleArg && !ROLES.includes(roleArg as UserRole))) {
    console.error('usage: pnpm seed-user <email> "<name>" <password> [admin|staff|player]');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error("password must be at least 10 characters");
    process.exit(1);
  }
  const role = (roleArg as UserRole) || "staff";
  const client = await getClient();
  const users = client.db().collection<UserDoc>("users");
  await users.createIndex({ email: 1 }, { unique: true });
  const passwordHash = await hash(password, 10);
  const res = await users.updateOne(
    { email: email.toLowerCase() },
    { $set: { name, passwordHash, role }, $setOnInsert: { email: email.toLowerCase(), createdAt: new Date() } },
    { upsert: true },
  );
  console.log(res.upsertedCount ? "created" : "updated", email, "as", role);
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
