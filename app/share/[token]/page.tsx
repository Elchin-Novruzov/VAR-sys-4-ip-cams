import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { getClipByToken, serializeClip } from "@/lib/clips";
import { ClipPlayers } from "@/components/clip-players";
import { Logo } from "@/components/brand";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shared moment" };

/** Public page for a saved moment. The token is the only credential, so the
 *  page reveals nothing but that one clip. */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const clip = await getClipByToken(token);
  if (!clip) notFound();
  const s = serializeClip(clip);
  return (
    <main className="stage min-h-dvh flex flex-col">
      <header
        className="app-header relative h-14 shrink-0 flex items-center gap-3 px-4"
        style={{ paddingTop: "env(safe-area-inset-top)", boxSizing: "content-box" }}
      >
        <Logo height={30} />
        <span className="display text-[0.95rem] leading-none px-2 pt-[0.2rem] pb-[0.1rem] rounded-md bg-[var(--accent)] text-[var(--on-accent)]">
          VAR
        </span>
        <span className="ml-auto pill pill-quiet">Shared moment</span>
      </header>
      <div className="flex-1">
        <ClipPlayers clip={s} fileBase={`/api/clips/shared/${s.shareToken}/file`} />
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 px-4 py-5 text-sm muted border-t border-[var(--line)]">
        <span>Recorded at Padel Center Baku · court replay</span>
        <a href="https://padelcenter.az/" className="btn btn-ghost !min-h-9 !px-3 text-sm" target="_blank" rel="noopener">
          padelcenter.az
          <ArrowUpRight className="icon" aria-hidden />
        </a>
      </footer>
    </main>
  );
}
