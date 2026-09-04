import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Public: the login page, the share page of a saved clip, and the shared-clip
// file endpoint (which checks the share token itself). Everything else,
// including every video proxy route, needs a session.
const PUBLIC_PREFIXES = ["/login", "/share/", "/api/clips/shared/", "/api/version", "/manifest.webmanifest"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  const isLoginPage = pathname.startsWith("/login");

  if (!isLoggedIn && !isPublic) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.nextUrl);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/courts", req.nextUrl));
  }
});

export const config = {
  // api/health stays outside so it can diagnose a broken auth setup
  matcher: ["/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|ico)$).*)"],
};
