// The realtime endpoint id, in one place because both halves of the wire need
// it and they live in different runtimes: the server scopes the minted token to
// it (`allowed_apps`), and the browser connects to it. A mismatch between the
// two produces an authorization failure with no useful message, so they must
// read from the same constant.
export const LUCY_REALTIME_APP = 'decart/lucy-2-5/realtime';

/**
 * What `allowed_apps` actually wants: the bare app alias, NOT the full endpoint
 * id. fal's own client scopes tokens this way (`parseEndpointId(app).alias` in
 * @fal-ai/client's auth.js), and sending the full `owner/alias/path` instead is
 * silently wrong — the mint either rejects it or returns a token the websocket
 * won't accept.
 */
export const LUCY_REALTIME_ALIAS = LUCY_REALTIME_APP.split('/')[1];
