import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const GOOGLE_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const PHOTOS_PICKER_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
const TOKEN_STORAGE_KEY = 'googlePhotosAccessToken';
const TOKEN_EXPIRY_STORAGE_KEY = 'googlePhotosAccessTokenExpiresAt';
const REDIRECT_STATE_STORAGE_KEY = 'googlePhotosAuthRedirectState';

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

const getRedirectUri = () => `${window.location.origin}${window.location.pathname}`;

const createAuthState = () => {
  const randomValues = new Uint32Array(4);
  window.crypto.getRandomValues(randomValues);
  return [...randomValues].map((value) => value.toString(36)).join('');
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
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const redirectedAccessToken = hashParams.get('access_token');
    const redirectedError = hashParams.get('error');

    if (!redirectedAccessToken && !redirectedError) return;

    const expectedState = sessionStorage.getItem(REDIRECT_STATE_STORAGE_KEY);
    const actualState = hashParams.get('state');
    sessionStorage.removeItem(REDIRECT_STATE_STORAGE_KEY);

    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);

    if (expectedState && actualState !== expectedState) {
      setError('Google sign-in state did not match. Please try again.');
      return;
    }

    if (redirectedError) {
      setError(hashParams.get('error_description') || redirectedError);
      return;
    }

    storeToken(redirectedAccessToken, hashParams.get('expires_in'));
    setAccessToken(redirectedAccessToken);
    setError(null);
  }, []);

  const redirectToGoogleAuth = useCallback(() => {
    if (!clientId) {
      setError('Missing VITE_GOOGLE_CLIENT_ID.');
      return;
    }

    const state = createAuthState();
    sessionStorage.setItem(REDIRECT_STATE_STORAGE_KEY, state);

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', getRedirectUri());
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('scope', PHOTOS_PICKER_SCOPE);
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('include_granted_scopes', 'true');
    authUrl.searchParams.set('state', state);

    window.location.assign(authUrl.toString());
  }, [clientId]);

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
          error_callback: (err) => {
            if (err?.type === 'popup_failed_to_open') {
              redirectToGoogleAuth();
              return;
            }

            if (err?.type === 'popup_closed') {
              setError('Google sign-in popup was closed.');
              return;
            }

            setError('Google sign-in could not start. Please try again.');
          },
        });
        setIsReady(true);
      })
      .catch(() => setError('Failed to load Google sign-in script.'));

    return () => {
      isMounted = false;
    };
  }, [clientId, redirectToGoogleAuth]);

  const requestAccessToken = useCallback(() => {
    if (!clientId) {
      setError('Missing VITE_GOOGLE_CLIENT_ID.');
      return;
    }

    tokenClientRef.current?.requestAccessToken({
      prompt: accessToken ? '' : 'consent',
    });
  }, [accessToken, clientId]);

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

  const deleteSession = useCallback(
    async (sessionId) => {
      if (!sessionId) return;

      try {
        await callPhotosApi('deleteSession', {
          method: 'DELETE',
          params: { sessionId },
        });
      } catch {
        // Session cleanup is best-effort; the selected photos remain usable.
      }
    },
    [callPhotosApi],
  );

  const signOut = useCallback(() => {
    deleteSession(session?.id);

    if (accessToken && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(accessToken);
    }

    clearStoredToken();
    setAccessToken(null);
    setSession(null);
    setPhotos([]);
    setPageToken(null);
  }, [accessToken, deleteSession, session?.id]);

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

        if (!data.nextPageToken) {
          setSession(null);
          deleteSession(sessionId);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoadingPhotos(false);
      }
    },
    [callPhotosApi, deleteSession],
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
    deleteSession(session?.id);
    setSession(null);
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
  }, [callPhotosApi, deleteSession, pollSession, session?.id]);

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
