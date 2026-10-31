import { describe, expect, it } from 'vitest';
import { labFaceliftBody } from './labFaceliftRequest';

describe('labFaceliftBody', () => {
  it('always asks FaceLift for the raw .ply the labs subtract / align on', () => {
    expect(labFaceliftBody('data:image/png;base64,AAA', 'subtraction-original')).toEqual({
      imageDataUrl: 'data:image/png;base64,AAA',
      outputName: 'subtraction-original',
      needPly: true,
    });
  });
});
