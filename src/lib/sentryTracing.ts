// Server-side tracing settings. The route's outgoing fetch to the GPU worker
// carries Sentry's trace headers (sentry-trace, baggage), so the worker's
// request joins the same trace. Propagation is limited to the worker: S3
// presigned URLs, Convex and Clerk never receive the extra headers.

export const SERVER_TRACES_SAMPLE_RATE = 1; // every build: traffic is low, the free plan's span quota is not

export const TRACE_PROPAGATION_TARGETS: RegExp[] = [/^https:\/\/[^/]+\.modal\.run(\/|$)/];
