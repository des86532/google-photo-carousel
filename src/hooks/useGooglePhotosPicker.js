import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const GOOGLE_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const PHOTOS_PICKER_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
const TOKEN_STORAGE_KEY = 'googlePhotosAccessToken';
const TOKEN_EXPIRY_STORAGE_KEY = 'googlePhotosAccessTokenExpiresAt';

let googleIdentityScriptPromise;

const loadGoogleIdentityScript = () => {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }

  if (googleIdentityScriptPromise) {
    return googleIdentityScriptPromise;
  }

  googleIdentityScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${GOOGLE_SCRIPT_SRC}"]`);
    const script = existingScript || document.createElement('script');

    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', reject, { once: true });

    if (existingScript) return;

    script.src = GOOGLE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });

  return googleIdentityScriptPromise;
};

const parseDurationMs = (duration = '', fallbackMs = 3000) => {
  const seconds = Number.parseFloat(duration.replace('s', ''));
  return Number.isFinite(seconds) ? seconds * 1000 : fallbackMs;
};

const normalizePhoto = (item) => {
  const mediaFile = item.mediaFile || item;
  const baseUrl = mediaFile.baseUrl || item.baseUrl;
  const mimeType = mediaFile.mimeType || item.mimeType || '';

  if (!baseUrl || !mimeType.startsWith('image/')) {
    return null;
  }

  return {
    id: item.id,
    baseUrl,
    filename: mediaFile.filename || item.filename || 'Google Photo',
    mimeType,
  };
};

const getStoredToken = () => {
  const token = sessionStorage.getItem(TOKEN_STORAGE_KEY);
  const expiresAt = Number(sessionStorage.getItem(TOKEN_EXPIRY_STORAGE_KEY) || 0);

  if (!token || Date.now() > expiresAt - 60000) {
    return null;
  }

  return token;
};

const storeToken = (accessToken, expiresIn) => {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, accessToken);
  sessionStorage.setItem(
    TOKEN_EXPIRY_STORAGE_KEY,
    String(Date.now() + Number(expiresIn || 3600) * 1000),
  );
};

const clearStoredToken = () => {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  sessionStorage.removeItem(TOKEN_EXPIRY_STORAGE_KEY);
};

export function useGooglePhotosPicker() {
  const [isReady, setIsReady] = useState(false);
  const [accessToken, setAccessToken] = useState(() => getStoredToken());
  const [session, setSession] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [pageToken, setPageToken] = useState(null);
  const [isPicking, setIsPicking] = useState(false);
  const [isLoadingPhotos, setIsLoadingPhotos] = useState(false);
  const [error, setError] = useState(null);
  const tokenClientRef = useRef(null);

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const isSignedIn = Boolean(accessToken);

  useEffect(() => {
    let isMounted = true;

    loadGoogleIdentityScript()
      .then(() => {
        if (!isMounted || !clientId) return;

        tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: PHOTOS_PICKER_SCOPE,
          callback: (response) => {
            if (response.error) {
              setError(response.error_description || response.error);
              return;
            }

            storeToken(response.access_token, response.expires_in);
            setAccessToken(response.access_token);
            setError(null);
          },
        });
        setIsReady(true);
      })
      .catch(() => setError('Failed to load Google sign-in script.'));

    return () => {
      isMounted = false;
    };
  }, [clientId]);

  const requestAccessToken = useCallback(() => {
    if (!clientId) {
      setError('Missing VITE_GOOGLE_CLIENT_ID.');
      return;
    }

    tokenClientRef.current?.requestAccessToken({
      prompt: accessToken ? '' : 'consent',
    });
  }, [accessToken, clientId]);

  const signOut = useCallback(() => {
    if (accessToken && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(accessToken);
    }

    clearStoredToken();
    setAccessToken(null);
    setSession(null);
    setPhotos([]);
    setPageToken(null);
  }, [accessToken]);

  const callPhotosApi = useCallback(
    async (action, options = {}) => {
      if (!accessToken) {
        throw new Error('Please sign in with Google first.');
      }

      const params = new URLSearchParams({ action, ...(options.params || {}) });
      const response = await fetch(`/api/photos?${params.toString()}`, {
        method: options.method || 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Google Photos request failed.');
      }

      return data;
    },
    [accessToken],
  );

  const loadPickedPhotos = useCallback(
    async (sessionId, nextPageToken = '') => {
      setIsLoadingPhotos(true);

      try {
        const data = await callPhotosApi('listMediaItems', {
          params: {
            sessionId,
            pageToken: nextPageToken,
          },
        });
        const newPhotos = (data.mediaItems || []).map(normalizePhoto).filter(Boolean);

        setPhotos((previousPhotos) => [...previousPhotos, ...newPhotos]);
        setPageToken(data.nextPageToken || null);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoadingPhotos(false);
      }
    },
    [callPhotosApi],
  );

  const pollSession = useCallback(
    async (sessionId) => {
      setIsPicking(true);

      try {
        let nextDelay = 3000;
        let startedAt = Date.now();
        let timeoutMs = 5 * 60 * 1000;

        while (Date.now() - startedAt < timeoutMs) {
          const data = await callPhotosApi('getSession', {
            params: { sessionId },
          });

          if (data.mediaItemsSet) {
            await loadPickedPhotos(sessionId);
            return;
          }

          nextDelay = parseDurationMs(data.pollingConfig?.pollInterval, nextDelay);
          timeoutMs = parseDurationMs(data.pollingConfig?.timeoutIn, timeoutMs);

          if (timeoutMs === 0) {
            throw new Error('Photo selection timed out.');
          }

          await new Promise((resolve) => window.setTimeout(resolve, nextDelay));
        }

        throw new Error('Photo selection timed out.');
      } catch (err) {
        setError(err.message);
      } finally {
        setIsPicking(false);
      }
    },
    [callPhotosApi, loadPickedPhotos],
  );

  const startPicking = useCallback(async () => {
    setError(null);
    setPhotos([]);
    setPageToken(null);

    const pickerWindow = window.open('about:blank', '_blank');

    if (pickerWindow) {
      pickerWindow.opener = null;
    }

    try {
      const nextSession = await callPhotosApi('createSession', {
        method: 'POST',
        body: {
          pickingConfig: {
            maxItemCount: '2000',
          },
        },
      });

      setSession(nextSession);
      if (pickerWindow) {
        pickerWindow.location.href = `${nextSession.pickerUri}/autoclose`;
      } else {
        window.location.href = nextSession.pickerUri;
      }
      pollSession(nextSession.id);
    } catch (err) {
      pickerWindow?.close();
      setError(err.message);
      setIsPicking(false);
    }
  }, [callPhotosApi, pollSession]);

  const loadMorePhotos = useCallback(() => {
    if (session?.id && pageToken && !isLoadingPhotos) {
      loadPickedPhotos(session.id, pageToken);
    }
  }, [isLoadingPhotos, loadPickedPhotos, pageToken, session?.id]);

  return useMemo(
    () => ({
      accessToken,
      clientId,
      error,
      isLoadingPhotos,
      isPicking,
      isReady,
      isSignedIn,
      pageToken,
      photos,
      requestAccessToken,
      signOut,
      startPicking,
      loadMorePhotos,
    }),
    [
      accessToken,
      clientId,
      error,
      isLoadingPhotos,
      isPicking,
      isReady,
      isSignedIn,
      pageToken,
      photos,
      requestAccessToken,
      signOut,
      startPicking,
      loadMorePhotos,
    ],
  );
}
