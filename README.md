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


NOTICES:
- lucy seems to drift a bit -> facial hair is possible but highly likely to cause face drift. not reliable
- "x inches shorter/longer" isn't very accurate -> sometimes same length, sometimes different hairstyle. system prompt add-on added (length rule fires on typed length words; keeps style, moves only length) — needs live validation
- bald head reduces scalp size to the point of being unnatural (possibly just me?)
- curly hair (e.g korean perm) sometimes results in a more cartoony, unnatural style (need to explore more)
- NEED TO EXPLORE well-known hairstyle effects
- NEED TO EXPLORE the possibility and model awareness of flagging hairstyles that may be impossible for user's hairtype (e.g curls for straight hair without perm)

Big multimodal models internally translate "2 inches shorter" into a spatial target before editing. Lucy is a small realtime video model — it can't measure inches in a frame, so the prompt has to do that translation for it. Today the number sits raw inside the fence, and three things sabotage it (from my earlier analysis, all still present in the current file):

CHANGES:
- experimentation time set to 3 min from 1 min
- voice diction added
- account system added (10 emails)
- debug system added. snapshots of videos and their prompts saved to s3 storage for debugging
- hairstyle recognition + length changing tweaked
- made rate limits more lenient, as well as per-account usage tracking

added 10 demo accounts, 1 test account