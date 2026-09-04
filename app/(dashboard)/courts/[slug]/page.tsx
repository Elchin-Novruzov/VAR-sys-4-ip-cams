import { notFound } from "next/navigation";
import { getCourt } from "@/lib/courts";
import { ReplayConsole } from "@/components/replay-console";

export const dynamic = "force-dynamic";

export default async function CourtReplayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const court = await getCourt(slug);
  if (!court) notFound();
  return <ReplayConsole court={court} />;
}
