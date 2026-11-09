import { describe, expect, it } from 'vitest';
import { TRACE_PROPAGATION_TARGETS } from './sentryTracing';

const propagates = (url: string) => TRACE_PROPAGATION_TARGETS.some((re) => re.test(url));

describe('TRACE_PROPAGATION_TARGETS', () => {
  it('sends trace headers to the Modal worker', () => {
    expect(propagates('https://shapeup--facelift-facelift-serve.modal.run/process_image')).toBe(true);
  });
  it('never to S3, Convex, Clerk or look-alike hosts', () => {
    expect(propagates('https://shapeup-bucket.s3.us-east-1.amazonaws.com/facelifts/j/output.splat?X-Amz-Signature=x')).toBe(false);
    expect(propagates('https://outgoing-octopus-107.convex.cloud/api/mutation')).toBe(false);
    expect(propagates('https://clerk.tryshapeup.cc/v1/client')).toBe(false);
    expect(propagates('https://evil.example/https://x.modal.run/')).toBe(false);
    expect(propagates('https://x.modal.run.evil.example/')).toBe(false);
  });
});
