import { useState, useEffect, useCallback, useRef } from 'react';
import { useSwipeable } from 'react-swipeable';

// Slide 停留時間：5秒
const SLIDE_DURATION = 5000;

export default function Carousel() {
  const [photos, setPhotos] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pageToken, setPageToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

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
        setPhotos(prev => {
          // 防止重複載入相同的照片
          const existingIds = new Set(prev.map(p => p.id));
          const newPhotos = data.mediaItems.filter(p => !existingIds.has(p.id));
          return [...prev, ...newPhotos];
        });
      }
      setPageToken(data.nextPageToken || null);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // 初始獲取第一頁照片
  useEffect(() => {
    fetchPhotos();
  }, []);

  // 檢查是否需要提前載入下一頁（當滑動到剩下 10 張時）
  useEffect(() => {
    if (photos.length > 0 && currentIndex >= photos.length - 10 && pageToken) {
      fetchPhotos(pageToken);
    }
  }, [currentIndex, photos.length, pageToken]);

  // 前進下一張
  const goNext = useCallback(() => {
    if (photos.length === 0) return;
    
    setCurrentIndex(prev => {
      const nextIndex = prev + 1;
      
      // 如果到了最後一張，且已經沒有下一頁
      if (nextIndex >= photos.length && !pageToken) {
        return 0; // 循環回到第一張
      }
      return nextIndex;
    });
    // 切換時重置影片播放狀態
    setIsVideoPlaying(false);
  }, [photos.length, pageToken]);

  // 回到上一張
  const goPrev = useCallback(() => {
    if (photos.length === 0) return;
    
    setCurrentIndex(prev => {
      // 避免回到負數，如果是 0 且想往回滑，就跳到最後一張
      if (prev === 0) return photos.length - 1; 
      return prev - 1;
    });
    setIsVideoPlaying(false);
  }, [photos.length]);

  // 設定自動輪播計時器 5秒
  // 注意：如果是影片播放中（isVideoPlaying），或者被使用者按住暫停（isPaused），都不執行自動切換
  useEffect(() => {
    if (photos.length === 0 || isPaused || isVideoPlaying) return;
    const timer = setInterval(goNext, SLIDE_DURATION);
    return () => clearInterval(timer);
  }, [photos.length, goNext, isPaused, isVideoPlaying]);

  // 當前媒體如果是影片，處理播放狀態
  useEffect(() => {
    if (photos.length === 0) return;
    const currentMedia = photos[currentIndex];
    if (currentMedia?.mimeType?.startsWith('video/')) {
      setIsVideoPlaying(true);
    }
  }, [currentIndex, photos]);

  // 註冊滑動手勢
  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => goNext(),   // 往左滑 -> 下一張
    onSwipedRight: () => goPrev(),  // 往右滑 -> 上一張
    trackMouse: true, // 在電腦版可以用滑鼠模擬觸控滑動
    preventDefaultTouchmoveEvent: true, // 防止在 iPad 上滑動時畫面跟著捲動
  });

  // 處理按住暫停 (Mouse & Touch)
  const pointerDownHandlers = {
    onPointerDown: () => setIsPaused(true),
    onPointerUp: () => setIsPaused(false),
    onPointerLeave: () => setIsPaused(false),
    onPointerCancel: () => setIsPaused(false),
  };

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-black text-white p-8 space-y-4">
        <h2 className="text-xl font-bold text-red-500">Error Loading Media</h2>
        <p className="text-white/60 text-center">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-2 mt-4 bg-white/10 rounded-full hover:bg-white/20 transition-colors"
        >
          重試 (Retry)
        </button>
      </div>
    );
  }

  if (isLoading && photos.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black text-white">
        <h1 className="text-2xl font-light tracking-widest text-white/50 animate-pulse">
          載入中...
        </h1>
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black text-white">
        <h1 className="text-2xl font-light tracking-widest text-white/50">
          找不到任何圖片或影片
        </h1>
      </div>
    );
  }

  return (
    <div 
      {...swipeHandlers} 
      {...pointerDownHandlers}
      className="relative w-full h-full bg-black overflow-hidden select-none outline-none cursor-pointer"
    >
      {photos.map((media, index) => {
        // 為了節省 iPad 記憶體，只把前後兩張和當前媒體留在 DOM
        const distance = Math.abs(index - currentIndex);
        if (distance > 2) return null;

        const isCurrent = index === currentIndex;
        const isVideo = media.mimeType?.startsWith('video/');

        return (
          <div
            key={media.id}
            className={`absolute inset-0 w-full h-full flex items-center justify-center transition-opacity duration-[1.5s] ease-in-out pointer-events-none ${
              isCurrent ? 'opacity-100 z-10' : 'opacity-0 z-0'
            }`}
          >
            {isVideo ? (
              <video
                src={media.baseUrl}
                className="w-full h-full object-contain"
                autoPlay={isCurrent}
                muted
                playsInline
                loop={false}
                onEnded={() => {
                  if (isCurrent) {
                    setIsVideoPlaying(false);
                    goNext(); // 影片播完自動換下一張
                  }
                }}
              />
            ) : (
              <img
                src={media.baseUrl}
                alt={media.filename || 'Google Drive Media'}
                className="w-full h-full object-contain"
              />
            )}
          </div>
        );
      })}
      
      {/* 隱藏的進度條提示或觸控區域，方便除錯，生產環境可移除 */}
      <div className="absolute top-4 right-4 flex items-center space-x-2 text-white/20 text-xs z-50 pointer-events-none">
        {isPaused && <span className="text-white/50">⏸ 暫停中</span>}
        <span>{currentIndex + 1} / {photos.length}</span>
      </div>
    </div>
  );
}
