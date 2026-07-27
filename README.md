GENERAL:
- Needs FAL_KEY (fal runs inference for Lucy)
- I bought $10 fal credits total ->  ~8 min 20 secs of total video
- Added system prompt pass over user request (blocks changes outside of hair/facial hair, specifies hairstyles to prevent incorrect render)
- Added suggestions for hairstyles based off user face geometry via mediapipe live during recording

AFTER VIDEO:
- analyze frames of video with mediapipe, find best angles of the head, and allow barber to choose 2-4 of the most helpful as references. real-time


- rate limit: 2 takes per 2 min
- convex redacting errors to ConvexError

'dashboard' branch has all dashboard functionality