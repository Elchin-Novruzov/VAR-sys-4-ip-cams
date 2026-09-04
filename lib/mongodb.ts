import { MongoClient, type MongoClientOptions } from "mongodb";

// Same driver settings as the labeling site, for the same reasons: a small
// capped pool, short server selection so failures land inside the request
// budget, and a connect promise that is dropped on failure rather than cached
// as a permanent rejection.
//
// The URI is read at connect time, not at module load: Next reloads .env
// files while the dev server runs, and a value captured at first import would
// stay stale until a restart (which is exactly what broke the first login).
const uri = () => process.env.MONGODB_URI;

const options: MongoClientOptions = {
  maxPoolSize: 5,
  minPoolSize: 0,
  maxIdleTimeMS: 60_000,
  serverSelectionTimeoutMS: 5_000,
  connectTimeoutMS: 5_000,
  socketTimeoutMS: 45_000,
};

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function connect(): Promise<MongoClient> {
  // Lazy check, not a module-load throw: the simulator and the dev login can
  // run this site with no database at all (see DEV_LOGIN_* in .env.example).
  const u = uri();
  if (!u) {
    return Promise.reject(new Error("MONGODB_URI is not set: saved clips need a database"));
  }
  const attempt: Promise<MongoClient> = new MongoClient(u, options)
    .connect()
    .catch((err) => {
      if (globalThis._mongoClientPromise === attempt) {
        globalThis._mongoClientPromise = undefined;
      }
      throw err;
    });
  return attempt;
}

export function getClient(): Promise<MongoClient> {
  globalThis._mongoClientPromise ??= connect();
  return globalThis._mongoClientPromise;
}

export async function getDb() {
  const client = await getClient();
  return client.db();
}

export function isDbConfigured() {
  return Boolean(uri());
}
