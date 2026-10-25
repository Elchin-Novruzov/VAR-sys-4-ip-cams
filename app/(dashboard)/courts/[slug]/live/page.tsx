import { notFound } from "next/navigation";
import { getCourt } from "@/lib/courts";
import { mediamtxStatus } from "@/lib/mediamtx";
import { LiveGrid } from "@/components/live-grid";

export const dynamic = "force-dynamic";

export default async function CourtLivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const court = await getCourt(slug);
  if (!court) notFound();
  // The club's cameras always get a tile; the detector cameras only while the
  // detector PC is publishing them (most of the time it is not at the court).
  const { publishing } = await mediamtxStatus().catch(() => ({ ok: false, publishing: [] as string[] }));
  const cameras = court.cameras.filter((c) => (c.group ?? "var") === "var" || publishing.includes(c.path));
  return <LiveGrid court={{ ...court, cameras }} />;
}
