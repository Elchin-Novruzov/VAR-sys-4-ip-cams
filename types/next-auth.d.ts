import type { DefaultSession } from "next-auth";
import type { UserRole } from "@/lib/types";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & { id: string; role: UserRole };
  }
  interface User {
    id?: string;
    role?: UserRole;
    remember?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: UserRole;
    remember?: boolean;
  }
}
