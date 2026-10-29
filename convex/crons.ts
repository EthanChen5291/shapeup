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

export default crons;
