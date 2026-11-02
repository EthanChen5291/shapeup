import { beforeEach, describe, expect, test, vi } from 'vitest';

// Records the order of S3 deletes and Convex calls so the test can assert
// "files before rows".
let log: string[];
let batches: Array<{ s3Keys: string[]; sessionIds: string[]; faceliftIds: string[]; projectIds: string[] }>;
let deleteManyFromS3: ReturnType<typeof vi.fn>;
let deleteUser: ReturnType<typeof vi.fn>;

const empty = { s3Keys: ['thumbnails/d.webp'], sessionIds: [], faceliftIds: [], projectIds: [] };

beforeEach(() => {
  vi.resetModules();
  log = [];
  batches = [
    { s3Keys: ['pictures/a/scan.png', 'edit-images/a.png'], sessionIds: ['s1'], faceliftIds: [], projectIds: ['p1'] },
    empty,
  ];
  deleteManyFromS3 = vi.fn(async (keys: string[]) => { log.push(`s3:${keys.join(',')}`); });
  deleteUser = vi.fn(async () => { log.push('clerk'); });
  vi.doMock('@/lib/s3', () => ({ deleteManyFromS3 }));
  vi.doMock('@/lib/serverAuth', () => ({
    requireSignedIn: vi.fn().mockResolvedValue({ response: null, session: { userId: 'user_1', getToken: vi.fn().mockResolvedValue('jwt') } }),
  }));
  vi.doMock('@clerk/nextjs/server', () => ({ clerkClient: async () => ({ users: { deleteUser } }) }));
  vi.doMock('@convex/_generated/api', () => ({
    api: { users: { accountDeletionBatch: 'batch', deleteAccountRows: 'rows', deleteCurrentUserData: 'final' } },
  }));
  vi.doMock('convex/browser', () => ({
    ConvexHttpClient: vi.fn(function ConvexHttpClient() {
      return {
        setAuth: vi.fn(),
        query: vi.fn(async () => { log.push('query'); return batches.shift() ?? empty; }),
        mutation: vi.fn(async (fn: string) => {
          log.push(`mutation:${fn}`);
          return fn === 'final' ? { done: true, clerkId: 'user_1', s3Keys: ['thumbnails/d.webp', 'edit-images/late.png'] } : null;
        }),
      };
    }),
  }));
});

describe('/api/account/delete', () => {
  test('deletes each batch of files before its rows, then the user, then Clerk', async () => {
    const { POST } = await import('./route');
    const res = await POST();
    expect(res.status).toBe(200);
    expect(log).toEqual([
      'query',
      's3:pictures/a/scan.png,edit-images/a.png',
      'mutation:rows',
      'query',
      's3:thumbnails/d.webp',
      'mutation:final',
      // Only files the final step found that weren't already deleted.
      's3:edit-images/late.png',
      'clerk',
    ]);
  });

  test('stops with the rows intact when S3 deletion fails', async () => {
    deleteManyFromS3.mockRejectedValueOnce(new Error('AccessDenied'));
    const { POST } = await import('./route');
    const res = await POST();
    expect(res.status).toBe(500);
    expect(log.some((l) => l.startsWith('mutation:'))).toBe(false);
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
