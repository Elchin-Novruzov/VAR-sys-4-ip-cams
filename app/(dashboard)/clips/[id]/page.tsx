import { notFound } from "next/navigation";
import { getClip, serializeClip } from "@/lib/clips";
import { ClipPlayers } from "@/components/clip-players";

export const dynamic = "force-dynamic";

export default async function ClipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clip = await getClip(id);
  if (!clip) notFound();
  const s = serializeClip(clip);
  return (
    <ClipPlayers clip={s} fileBase={`/api/clips/${s.id}/file`} showShare />
  );
}
