'use client';

// Upload a blob to Convex storage and get a fetchable URL back.
//
// Extracted from the card's try-on, which needed it for stills, when chair mode
// needed the same three-step dance for take recordings and reference frames:
// mint an upload URL, POST the bytes, resolve the storage id. Both callers are
// signed in — `barberTryOn.generateUploadUrl` requires an identity.

import { useCallback } from 'react';
import { useConvex, useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';

export interface ConvexUploadResult {
  storageId: Id<'_storage'>;
  url: string;
}

export function useConvexUpload() {
  const convex = useConvex();
  const generateUploadUrl = useMutation(api.barberTryOn.generateUploadUrl);

  return useCallback(
    async (blob: Blob): Promise<ConvexUploadResult> => {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'application/octet-stream' },
        body: blob,
      });
      if (!res.ok) throw new Error('Upload failed');
      const { storageId } = (await res.json()) as { storageId: Id<'_storage'> };
      const url = await convex.query(api.barberTryOn.getUploadedImageUrl, { storageId });
      if (!url) throw new Error('Upload succeeded but no URL came back');
      return { storageId, url };
    },
    [convex, generateUploadUrl],
  );
}
