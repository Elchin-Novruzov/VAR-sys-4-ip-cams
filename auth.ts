import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { encode as defaultEncode } from "next-auth/jwt";
import { compare } from "bcryptjs";
import { getDb } from "@/lib/mongodb";
import type { UserDoc } from "@/lib/types";

// Same session policy as the labeling site: "remember me" controls the JWT's
// own exp claim; the cookie itself is always set for REMEMBER_MAX_AGE.
const DEFAULT_MAX_AGE = 8 * 60 * 60; // 8 hours
const REMEMBER_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

/** Development-only login that needs no database, so the simulator can be
 *  demoed on a laptop. Ignored in production builds. */
function devLogin(email: string, password: string) {
  if (process.env.NODE_ENV === "production") return null;
  const devEmail = process.env.DEV_LOGIN_EMAIL;
  const devPass = process.env.DEV_LOGIN_PASSWORD;
  if (!devEmail || !devPass) return null;
  if (email.toLowerCase() !== devEmail.toLowerCase() || password !== devPass) return null;
  return { id: "dev", email: devEmail, name: "Dev user", role: "admin" as const };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: REMEMBER_MAX_AGE },
  pages: { signIn: "/login" },
  trustHost: true,
  jwt: {
    encode: async (params) => {
      const remember = params.token?.remember === true;
      const maxAge = remember ? REMEMBER_MAX_AGE : DEFAULT_MAX_AGE;
      return defaultEncode({ ...params, maxAge });
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        remember: { label: "Remember me", type: "text" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") return null;
        const remember = credentials.remember === "true";

        const dev = devLogin(email, password);
        if (dev) return { ...dev, remember };

        const db = await getDb();
        const user = await db.collection<UserDoc>("users").findOne({ email: email.toLowerCase() });
        if (!user) return null;
        const valid = await compare(password, user.passwordHash);
        if (!valid) return null;
        return { id: user._id!.toString(), email: user.email, name: user.name, role: user.role, remember };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role ?? "staff";
        token.remember = user.remember ?? false;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id;
        session.user.role = token.role ?? "staff";
      }
      return session;
    },
  },
});
