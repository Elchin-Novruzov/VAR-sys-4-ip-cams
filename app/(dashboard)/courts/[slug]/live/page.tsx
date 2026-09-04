import { notFound } from "next/navigation";
import { getCourt } from "@/lib/courts";
import { LiveGrid } from "@/components/live-grid";

export const dynamic = "force-dynamic";

export default async function CourtLivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const court = await getCourt(slug);
  if (!court) notFound();
  return <LiveGrid court={court} />;
}
