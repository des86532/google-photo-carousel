import { useState, useEffect } from 'react';

export default function Carousel() {
  const [photos, setPhotos] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pageToken, setPageToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPhotos = async (token = '') => {
    try {
      const url = token ? `/api/photos?pageToken=${token}` : '/api/photos';
      const response = await fetch(url);

      if (!response.ok) {
        let errMessage = 'Failed to fetch from API';
        try {
          const errData = await response.json();
          errMessage = errData.error || errData.message || JSON.stringify(errData);
        } catch (e) {
          errMessage = await response.text();
        }
        throw new Error(`${response.status}: ${errMessage}`);
      }

      const data = await response.json();

      if (data.mediaItems && data.mediaItems.length > 0) {
        setPhotos(prev => [...prev, ...data.mediaItems]);
      }
      setPageToken(data.nextPageToken || null);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchPhotos();
  }, []);

  // Timer for switching photos
  useEffect(() => {
    if (photos.length === 0) return;

    // Switch every 15 seconds
    const timer = setInterval(() => {
      setCurrentIndex(prev => {
        const nextIndex = prev + 1;

        // If we are nearing the end and have a pageToken, fetch more
        if (nextIndex >= photos.length - 3 && pageToken) {
          fetchPhotos(pageToken);
        }

        // If we reach the end and NO more pages, reload to refresh expired Tokens/URLs
        if (nextIndex >= photos.length && !pageToken) {
          window.location.reload();
          return prev;
        }

        return nextIndex;
      });
    }, 15000);

    return () => clearInterval(timer);
  }, [photos.length, pageToken]);

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-black text-white p-8 space-y-4">
        <h2 className="text-xl font-bold text-red-500">Error Loading Photos</h2>
        <p className="text-white/60">{error}</p>
        <p className="text-sm text-white/40">Check your Vercel Environment Variables.</p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-2 mt-4 bg-white/10 rounded-full hover:bg-white/20 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (isLoading && photos.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black text-white">
        <h1 className="text-2xl font-light tracking-widest text-white/50 animate-pulse">
          Loading Photos...
        </h1>
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black text-white">
        <h1 className="text-2xl font-light tracking-widest text-white/50">
          No photos found.
        </h1>
      </div>
    );
  }

  // To prevent iPad memory issues from too many DOM nodes,
  // we only render the current, previous, and next images.
  // Previous helps with fade out transition. Next helps with preloading.
  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      {photos.map((photo, index) => {
        // Keep only n-1, n, n+1 in the DOM
        if (index < currentIndex - 1 || index > currentIndex + 1) return null;

        const isCurrent = index === currentIndex;

        return (
          <img
            key={photo.id}
            src={photo.baseUrl}
            alt={photo.filename || 'Google Photo'}
            className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-[2s] ease-in-out ${isCurrent ? 'opacity-100 z-10' : 'opacity-0 z-0'
              }`}
          />
        );
      })}
    </div>
  );
}
