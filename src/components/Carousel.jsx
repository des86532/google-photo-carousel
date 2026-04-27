import { useEffect, useMemo, useRef, useState } from 'react';
import { useGooglePhotosPicker } from '../hooks/useGooglePhotosPicker';

const getImageUrl = (baseUrl) => `${baseUrl}=w2048-h2048`;

function FrameSetup({
  error,
  isLoadingPhotos,
  isPicking,
  isReady,
  isSignedIn,
  onPickPhotos,
  onSignIn,
  onSignOut,
}) {
  const title = isSignedIn ? 'Choose photos for this frame' : 'Connect Google Photos';
  const status = isPicking
    ? 'Waiting for your Google Photos selection...'
    : isLoadingPhotos
      ? 'Preparing selected photos...'
      : isSignedIn
        ? 'Pick the photos you want this frame to play.'
        : 'Sign in with Google to select photos from your own library.';

  return (
    <main className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[#050505] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_25%,rgba(255,255,255,0.14),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.05),transparent_42%)]" />
      <section className="relative flex w-full max-w-[520px] flex-col items-center px-8 text-center">
        <div className="mb-8 h-px w-28 bg-white/30" />
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.42em] text-white/45">
          Google Photos Frame
        </p>
        <h1 className="text-3xl font-light leading-tight text-white sm:text-5xl">
          {title}
        </h1>
        <p className="mt-5 max-w-sm text-sm leading-6 text-white/58 sm:text-base">
          {status}
        </p>

        {error && (
          <p className="mt-6 w-full border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </p>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {!isSignedIn ? (
            <button
              type="button"
              onClick={onSignIn}
              disabled={!isReady}
              className="min-h-11 bg-white px-6 text-sm font-semibold text-black transition hover:bg-white/88 disabled:cursor-not-allowed disabled:bg-white/30"
            >
              {isReady ? 'Sign in with Google' : 'Loading Google...'}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onPickPhotos}
                disabled={isPicking || isLoadingPhotos}
                className="min-h-11 bg-white px-6 text-sm font-semibold text-black transition hover:bg-white/88 disabled:cursor-not-allowed disabled:bg-white/30"
              >
                {isPicking ? 'Selecting...' : 'Pick photos'}
              </button>
              <button
                type="button"
                onClick={onSignOut}
                className="min-h-11 border border-white/25 px-5 text-sm font-medium text-white/78 transition hover:border-white/45 hover:text-white"
              >
                Sign out
              </button>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

export default function Carousel() {
  const {
    accessToken,
    error,
    isLoadingPhotos,
    isPicking,
    isReady,
    isSignedIn,
    loadMorePhotos,
    pageToken,
    photos,
    requestAccessToken,
    signOut,
    startPicking,
  } = useGooglePhotosPicker();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [objectUrls, setObjectUrls] = useState({});
  const [imageError, setImageError] = useState(null);
  const objectUrlsRef = useRef({});

  const visiblePhotos = useMemo(() => {
    if (photos.length === 0) return [];

    const indexes = new Set([
      Math.max(currentIndex - 1, 0),
      currentIndex,
      Math.min(currentIndex + 1, photos.length - 1),
    ]);

    return [...indexes].map((index) => photos[index]).filter(Boolean);
  }, [currentIndex, photos]);

  useEffect(() => {
    if (photos.length === 0) {
      setCurrentIndex(0);
      Object.values(objectUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current = {};
      setObjectUrls({});
    }
  }, [photos.length]);

  useEffect(() => {
    if (!accessToken || visiblePhotos.length === 0) return undefined;

    const controller = new AbortController();

    const loadVisibleImages = async () => {
      try {
        const missingPhotos = visiblePhotos.filter((photo) => !objectUrlsRef.current[photo.id]);
        const loadedEntries = await Promise.all(
          missingPhotos.map(async (photo) => {
            const response = await fetch(getImageUrl(photo.baseUrl), {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
              signal: controller.signal,
            });

            if (!response.ok) {
              throw new Error('Failed to load selected photo.');
            }

            const blob = await response.blob();
            return [photo.id, URL.createObjectURL(blob)];
          }),
        );

        if (controller.signal.aborted) return;

        setObjectUrls((previousUrls) => {
          const nextVisibleIds = new Set(visiblePhotos.map((photo) => photo.id));
          const nextUrls = {};

          Object.entries(previousUrls).forEach(([id, url]) => {
            if (nextVisibleIds.has(id)) {
              nextUrls[id] = url;
            } else {
              URL.revokeObjectURL(url);
            }
          });

          loadedEntries.forEach(([id, url]) => {
            if (nextUrls[id]) {
              URL.revokeObjectURL(url);
            } else {
              nextUrls[id] = url;
            }
          });

          objectUrlsRef.current = nextUrls;
          return nextUrls;
        });
        setImageError(null);
      } catch (err) {
        if (!controller.signal.aborted) {
          setImageError(err.message);
        }
      }
    };

    loadVisibleImages();

    return () => {
      controller.abort();
    };
  }, [accessToken, visiblePhotos]);

  useEffect(() => {
    return () => {
      Object.values(objectUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (photos.length === 0) return undefined;

    const timer = window.setInterval(() => {
      setCurrentIndex((previousIndex) => {
        const nextIndex = previousIndex + 1;

        if (nextIndex >= photos.length - 3 && pageToken) {
          loadMorePhotos();
        }

        if (nextIndex >= photos.length) {
          return 0;
        }

        return nextIndex;
      });
    }, 15000);

    return () => window.clearInterval(timer);
  }, [loadMorePhotos, pageToken, photos.length]);

  if (!isSignedIn || photos.length === 0) {
    return (
      <FrameSetup
        error={error || imageError}
        isLoadingPhotos={isLoadingPhotos}
        isPicking={isPicking}
        isReady={isReady}
        isSignedIn={isSignedIn}
        onPickPhotos={startPicking}
        onSignIn={requestAccessToken}
        onSignOut={signOut}
      />
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {photos.map((photo, index) => {
        if (index < currentIndex - 1 || index > currentIndex + 1) return null;

        const isCurrent = index === currentIndex;
        const src = objectUrls[photo.id];

        if (!src) return null;

        return (
          <img
            key={photo.id}
            src={src}
            alt={photo.filename || 'Google Photo'}
            className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-[2s] ease-in-out ${
              isCurrent ? 'z-10 opacity-100' : 'z-0 opacity-0'
            }`}
          />
        );
      })}

      <div className="absolute right-4 top-4 z-20 flex gap-2 opacity-0 transition-opacity duration-300 hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={startPicking}
          className="bg-black/55 px-4 py-2 text-xs font-medium text-white/85 backdrop-blur transition hover:bg-black/75 hover:text-white"
        >
          Change photos
        </button>
        <button
          type="button"
          onClick={signOut}
          className="bg-black/55 px-4 py-2 text-xs font-medium text-white/85 backdrop-blur transition hover:bg-black/75 hover:text-white"
        >
          Sign out
        </button>
      </div>

      {imageError && (
        <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 bg-black/70 px-4 py-2 text-sm text-red-100 backdrop-blur">
          {imageError}
        </div>
      )}
    </div>
  );
}
