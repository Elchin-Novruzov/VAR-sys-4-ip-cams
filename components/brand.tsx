import Image from "next/image";

/** Padel Center Baku's marks and the decorative pieces built from them.
 *  Server components only (no hooks): they render on every page without
 *  adding script. Logo files come from the club's site (padelcenter.az);
 *  public/brand/logo-light.png is the secondary logo with the green wordmark
 *  turned cream for the dark UI. */

const LOGO_W = 640;
const LOGO_H = 146;

export function Logo({ height = 32, className }: { height?: number; className?: string }) {
  return (
    <Image
      src="/brand/logo-light.png"
      alt="Padel Center Baku"
      width={Math.round((height * LOGO_W) / LOGO_H)}
      height={height}
      loading="eager"
      unoptimized
      className={className}
    />
  );
}

/** The ball monogram on its own. */
export function Ball({ size = 28, className }: { size?: number; className?: string }) {
  return <Image src="/brand/ball.svg" alt="" aria-hidden width={size} height={size} unoptimized className={className} />;
}

/** Waiting for a page: the ball bouncing on its shadow. */
export function BallLoader({ label = "Loading", className = "py-16" }: { label?: string; className?: string }) {
  return (
    <div className={`grid place-items-center gap-3 fade ${className}`} role="status" aria-label={label}>
      <div className="relative h-16 w-10 grid justify-items-center">
        <div className="bounce-ball self-end mb-1.5">
          <Ball size={30} />
        </div>
        <div className="bounce-shadow absolute bottom-0 h-1.5 w-8 rounded-full bg-black/80" style={{ boxShadow: "0 0 8px rgba(0,0,0,.8)" }} />
      </div>
      <span className="eyebrow">{label}</span>
    </div>
  );
}

/** A padel court from above (20 x 10 m, 1 unit = 10 cm): glass at both ends
 *  and the first four metres of the sides, mesh between, the service boxes,
 *  the net. The lines draw themselves in and a ball rallies across the net;
 *  `cams` marks each end that has a camera streaming. */
export function CourtArt({
  className,
  rally = true,
  cams,
}: {
  className?: string;
  rally?: boolean;
  cams?: { left: boolean; right: boolean };
}) {
  const line = { stroke: "#f3f5ec", strokeOpacity: 0.85, strokeWidth: 0.9, fill: "none" } as const;
  const glass = { stroke: "#ceff65", strokeOpacity: 0.75, strokeWidth: 2, fill: "none", strokeLinecap: "round" } as const;
  const ball = "M 22 68 Q 100 6 176 36 Q 100 96 22 68";
  return (
    <svg viewBox="-14 -12 228 124" className={className} aria-hidden>
      <rect x="0" y="0" width="200" height="100" rx="1.5" fill="#1f4f2e" />
      <rect x="0" y="0" width="100" height="100" fill="#ffffff" fillOpacity="0.035" />
      {/* service lines, the centre line, the net */}
      <path d="M 30.5 0 V 100 M 169.5 0 V 100 M 30.5 50 H 169.5" pathLength={1} className="draw" style={{ ...line, ["--d" as string]: "150ms" }} />
      <path d="M 100 -3 V 103" style={{ stroke: "#f3f5ec", strokeOpacity: 0.7, strokeWidth: 1.3, strokeDasharray: "2 1.2" }} />
      {/* glass: the back walls and four metres down each side */}
      <path d="M 40 0 H 0 V 100 H 40 M 160 0 H 200 V 100 H 160" pathLength={1} className="draw" style={glass} />
      {/* mesh between the glass */}
      <path d="M 40 0 H 160 M 40 100 H 160" style={{ stroke: "#f3f5ec", strokeOpacity: 0.35, strokeWidth: 1, strokeDasharray: "1.5 2" }} />
      {cams && (
        <>
          <ViewCone x={-8} dir={1} on={cams.left} />
          <ViewCone x={208} dir={-1} on={cams.right} />
          <CamMark x={-8} on={cams.left} />
          <CamMark x={208} on={cams.right} />
        </>
      )}
      {rally && (
        <g>
          {/* a short trail behind the ball reads as speed (the ball itself
              starts furthest along, each ghost a little later) */}
          {[0.08, 0.06, 0.04, 0.02, 0].map((lag, i) => (
            <circle key={lag} r={1.7 + i * 0.25} fill="#f3ea5d" opacity={i === 4 ? 1 : 0.08 + i * 0.07}>
              <animateMotion
                dur="3.4s"
                repeatCount="indefinite"
                path={ball}
                begin={`${(lag - 0.08).toFixed(2)}s`}
                calcMode="spline"
                keyTimes="0;0.5;1"
                keyPoints="0;0.5;1"
                keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
              />
            </circle>
          ))}
        </g>
      )}
    </svg>
  );
}

/** What an end camera sees: a light wedge into the court with a scan line
 *  sweeping across it while the camera streams. */
function ViewCone({ x, dir, on }: { x: number; dir: 1 | -1; on: boolean }) {
  const reach = x + dir * 122;
  return (
    <g style={{ opacity: on ? 1 : 0.35 }}>
      <path d={`M ${x} 50 L ${reach} -4 L ${reach} 104 Z`} fill="#ceff65" fillOpacity={on ? 0.07 : 0.03} />
      {on && (
        <line x1={x} y1={50} x2={reach} y2={50} stroke="#ceff65" strokeOpacity="0.55" strokeWidth="0.6">
          <animateTransform
            attributeName="transform"
            type="rotate"
            values={`-22 ${x} 50;22 ${x} 50;-22 ${x} 50`}
            dur={dir === 1 ? "5s" : "5.6s"}
            repeatCount="indefinite"
          />
        </line>
      )}
    </g>
  );
}

function CamMark({ x, on }: { x: number; on: boolean }) {
  return (
    <g transform={`translate(${x} 50)`}>
      <rect x="-4.5" y="-4.5" width="9" height="9" rx="2.5" fill="#080908" stroke={on ? "#ceff65" : "#3a4a3e"} strokeWidth="1" />
      <circle r="1.8" fill={on ? "#ceff65" : "#3a4a3e"}>
        {on && <animate attributeName="opacity" values="1;0.35;1" dur="1.6s" repeatCount="indefinite" />}
      </circle>
    </g>
  );
}

/** The ticker along the bottom of the brand pages. Decorative: the words are
 *  what the product does, in the club's heading face. */
export function Marquee({ items, className = "" }: { items: string[]; className?: string }) {
  const track = (hidden: boolean) => (
    <div className="marquee-track" aria-hidden={hidden || undefined}>
      {items.map((t, i) => (
        <span key={t} className="flex items-center gap-[2.25rem]">
          <span className={`display text-3xl sm:text-4xl ${i % 2 ? "outline-text" : ""}`}>{t}</span>
          <Ball size={18} />
        </span>
      ))}
    </div>
  );
  return (
    <div className={`marquee select-none ${className}`} aria-hidden>
      {track(false)}
      {track(true)}
    </div>
  );
}
