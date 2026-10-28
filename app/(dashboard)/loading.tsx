import { BallLoader } from "@/components/brand";

/** Shown the moment a link is tapped, while the server prepares the page. */
export default function Loading() {
  return (
    <div className="grid place-items-center" style={{ minHeight: "calc(100dvh - var(--chrome-top))" }}>
      <BallLoader />
    </div>
  );
}
