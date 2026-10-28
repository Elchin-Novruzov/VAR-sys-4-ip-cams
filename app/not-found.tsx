import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Ball, Logo } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="stage min-h-dvh grid place-items-center px-6 text-center">
      <div className="space-y-6 rise">
        <Logo height={36} className="mx-auto" />
        <div className="display text-[clamp(6rem,24vw,12rem)] flex items-center justify-center gap-2 leading-none">
          4<Ball size={120} className="inline-block w-[0.72em] h-[0.72em]" />4
        </div>
        <div className="space-y-1">
          <h1 className="display text-4xl">Out of the court</h1>
          <p className="muted">This page does not exist, or the clip was removed.</p>
        </div>
        <Link href="/courts" className="btn btn-accent">
          <ArrowLeft className="icon" aria-hidden />
          Back to the courts
        </Link>
      </div>
    </main>
  );
}
