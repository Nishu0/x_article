interface ArticleProgress {
  url: string;
  scrollPosition: number;
  scrollPercentage: number;
  lastRead: number;
}

function hashUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function getStorageKey(url: string): string {
  return `article_progress_${hashUrl(url)}`;
}

function getScrollPercentage(): number {
  const scrollTop = window.scrollY;
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  if (docHeight <= 0) return 0;
  return Math.min(100, Math.round((scrollTop / docHeight) * 100));
}

function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

async function saveProgress(): Promise<void> {
  const progress: ArticleProgress = {
    url: window.location.href,
    scrollPosition: window.scrollY,
    scrollPercentage: getScrollPercentage(),
    lastRead: Date.now(),
  };

  const key = getStorageKey(progress.url);
  await chrome.storage.local.set({ [key]: progress });
  console.log(`[X Article Progress] Saved: ${progress.scrollPercentage}%`);
}

async function loadProgress(): Promise<ArticleProgress | null> {
  const key = getStorageKey(window.location.href);
  const result = await chrome.storage.local.get(key);
  return result[key] || null;
}

async function restoreScrollPosition(): Promise<void> {
  const progress = await loadProgress();
  if (!progress || progress.scrollPosition <= 0) return;

  // Wait for content to load
  await new Promise((resolve) => setTimeout(resolve, 1000));

  window.scrollTo({
    top: progress.scrollPosition,
    behavior: "smooth",
  });

  console.log(
    `[X Article Progress] Restored to ${progress.scrollPercentage}% (${progress.scrollPosition}px)`
  );
}

function isArticlePage(): boolean {
  const pattern = /^https:\/\/(x\.com|twitter\.com)\/[^/]+\/articles\/.+/;
  return pattern.test(window.location.href);
}

function init(): void {
  if (!isArticlePage()) {
    console.log("[X Article Progress] Not an article page, skipping.");
    return;
  }

  console.log("[X Article Progress] Initialized on article page.");

  // Restore previous scroll position
  restoreScrollPosition();

  // Track scroll with debouncing
  const debouncedSave = debounce(saveProgress, 500);
  window.addEventListener("scroll", debouncedSave, { passive: true });

  // Save on page unload
  window.addEventListener("beforeunload", () => {
    saveProgress();
  });
}

init();
