import { notFound } from "next/navigation";
import { getClipByToken, serializeClip } from "@/lib/clips";
import { ClipPlayers } from "@/components/clip-players";

export const dynamic = "force-dynamic";

/** Public page for a saved moment. The token is the only credential, so the
 *  page reveals nothing but that one clip. */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const clip = await getClipByToken(token);
  if (!clip) notFound();
  const s = serializeClip(clip);
  return (
    <main className="min-h-dvh">
      <header className="h-14 flex items-center px-4 font-semibold" style={{ borderBottom: "1px solid var(--line)" }}>
        Padel VAR
      </header>
      <ClipPlayers clip={s} fileBase={`/api/clips/shared/${s.shareToken}/file`} />
    </main>
  );
}
