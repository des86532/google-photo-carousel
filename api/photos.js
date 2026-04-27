const PICKER_API_BASE_URL = 'https://photospicker.googleapis.com/v1';

const sendJson = (res, status, payload) => {
  res.status(status).json(payload);
};

const getAccessToken = (req) => {
  const authHeader = req.headers.authorization || '';

  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.slice('Bearer '.length);
};

const callPickerApi = async (path, accessToken, options = {}) => {
  const response = await fetch(`${PICKER_API_BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data.error?.message || data.error || 'Google Photos Picker API request failed';
    const error = new Error(message);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
};

const getJsonBody = (req) => {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return req.body;
};

/**
 * Proxies Google Photos Picker API requests with the current user's access token.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const accessToken = getAccessToken(req);

  if (!accessToken) {
    sendJson(res, 401, { error: 'Missing Google access token' });
    return;
  }

  const urlParams = new URL(req.url, `http://${req.headers.host}`);
  const action = urlParams.searchParams.get('action') || '';

  try {
    if (action === 'createSession') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }

      const session = await callPickerApi('/sessions', accessToken, {
        method: 'POST',
        body: getJsonBody(req),
      });

      sendJson(res, 200, session);
      return;
    }

    if (action === 'getSession') {
      const sessionId = urlParams.searchParams.get('sessionId');

      if (!sessionId) {
        sendJson(res, 400, { error: 'Missing sessionId' });
        return;
      }

      const session = await callPickerApi(`/sessions/${encodeURIComponent(sessionId)}`, accessToken);
      sendJson(res, 200, session);
      return;
    }

    if (action === 'listMediaItems') {
      const sessionId = urlParams.searchParams.get('sessionId');
      const pageToken = urlParams.searchParams.get('pageToken') || '';

      if (!sessionId) {
        sendJson(res, 400, { error: 'Missing sessionId' });
        return;
      }

      const params = new URLSearchParams({
        sessionId,
        pageSize: '50',
      });

      if (pageToken) {
        params.set('pageToken', pageToken);
      }

      const mediaItems = await callPickerApi(`/mediaItems?${params.toString()}`, accessToken);
      sendJson(res, 200, mediaItems);
      return;
    }

    if (action === 'deleteSession') {
      const sessionId = urlParams.searchParams.get('sessionId');

      if (!sessionId) {
        sendJson(res, 400, { error: 'Missing sessionId' });
        return;
      }

      await callPickerApi(`/sessions/${encodeURIComponent(sessionId)}`, accessToken, {
        method: 'DELETE',
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 400, { error: 'Unknown action' });
  } catch (error) {
    console.error('Google Photos Picker API error:', error.details || error);
    sendJson(res, error.status || 500, {
      error: error.message || 'Internal server error',
      details: error.details,
    });
  }
}
