import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// A build runs inside Vercel's after(), which is cancelled if the function
// times out or the instance dies — so neither completeBuild nor failBuild
// would ever arrive. This moves such projects out of "building" and releases
// their credit hold. See projects.reapStaleBuilds.
crons.interval(
  "fail stale builds and release their credit holds",
  { minutes: 5 },
  internal.projects.reapStaleBuilds,
  {},
);

// Drain the S3 deletion outbox: delete the specific facelifts/<jobId>/…
// keys that were enqueued when builds were superseded or reaped. This is NOT
// a bucket sweep — only explicitly enqueued keys are deleted, and only after
// their notBefore delay (≥20 min) has passed. See convex/s3Drain.ts.
crons.interval(
  "drain S3 deletion outbox",
  { hours: 1 },
  internal.s3Drain.drain,
  {},
);

export default crons;
