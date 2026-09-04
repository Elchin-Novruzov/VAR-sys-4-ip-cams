import type { ObjectId } from "mongodb";

export type UserRole = "admin" | "staff" | "player";

export type UserDoc = {
  _id?: ObjectId;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
};

/** One camera as MediaMTX knows it: `path` is the stream name the camera publishes to. */
export type CameraConfig = {
  path: string;
  label: string;
  /** Frame rate the camera is set to. Drives the frame-step size in the player. */
  fps: number;
};

export type CourtConfig = {
  slug: string;
  name: string;
  club: string;
  /** How far back replay is available; must match recordDeleteAfter in infra/mediamtx.yml. */
  retentionHours: number;
  cameras: CameraConfig[];
};

export type CourtsFile = { courts: CourtConfig[] };

/** A saved moment: one MP4 file per camera, cut from the rolling buffer. */
export type ClipDoc = {
  _id?: ObjectId;
  courtSlug: string;
  label: string;
  /** Wall-clock start of the clip. */
  start: Date;
  durationSec: number;
  cameras: { path: string; label: string; file: string; bytes: number }[];
  createdBy: string;
  createdAt: Date;
  /** Unguessable token for the public share page. */
  shareToken: string;
};

/** ClipDoc as sent to the browser. */
export type SerializedClip = {
  id: string;
  courtSlug: string;
  label: string;
  start: string;
  durationSec: number;
  cameras: { path: string; label: string; bytes: number }[];
  createdBy: string;
  createdAt: string;
  shareToken: string;
};

/** One recorded segment as reported by MediaMTX's playback server. */
export type Segment = { start: string; duration: number };
