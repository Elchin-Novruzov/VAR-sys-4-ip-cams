// A session cookie for testing a PRODUCTION build locally, where the dev
// login is switched off. It is signed with the AUTH_SECRET the server under
// test uses (for a local `.next/standalone` run: the one in .env.local), so
// no user has to be created in the shared Mongo. Never point it at the real
// site's secret: the cookie is an admin session.
//
//   AUTH_SECRET=<secret> node scripts/checks/mint-session.mjs > session.txt
//   SESSION=$(cat session.txt) BASE=http://127.0.0.1:3001 node .../replay-audit.mjs
//
// Cookie name for http:// sites: authjs.session-token (https uses the
// __Secure- prefix). Valid one hour.
import { encode } from "next-auth/jwt";

const secret = process.env.AUTH_SECRET;
if (!secret) {
  console.error("set AUTH_SECRET");
  process.exit(1);
}
const token = await encode({
  token: { id: "local-test", sub: "local-test", email: "test@local", name: "Local test", role: "admin" },
  secret,
  salt: "authjs.session-token",
  maxAge: 3600,
});
process.stdout.write(token);
