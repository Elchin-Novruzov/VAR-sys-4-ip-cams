import { notFound } from "next/navigation";
import { getCourt, liveCameras } from "@/lib/courts";
import { LiveGrid } from "@/components/live-grid";

export const dynamic = "force-dynamic";

export default async function CourtLivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const court = await getCourt(slug);
  if (!court) notFound();
  // The club's cameras always get a tile; the detector cameras only while the
  // detector PC is publishing them (most of the time it is not at the court).
  // The grid asks /api/live/cameras and picks up a detector camera that
  // starts while the page is open.
  return <LiveGrid court={{ ...court, cameras: await liveCameras(court) }} />;
}
