interface ArticleProgress {
  url: string;
  scrollPosition: number;
  scrollPercentage: number;
  lastRead: number;
  title?: string;
  image?: string;
  author?: string;
  authorHandle?: string;
}

interface ArticleMetadata {
  title: string;
  image: string | null;
  author: string | null;
  authorHandle: string | null;
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

function normalizeUrl(url: string): string {
  // Remove query params and hash to avoid duplicates
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function getStorageKey(url: string): string {
  return `article_progress_${hashUrl(normalizeUrl(url))}`;
}

function extractArticleMetadata(): ArticleMetadata {
  let title = '';

  // Look for article title
  const titleSelectors = [
    'article h1',
    '[data-testid="tweetText"] span',
    'h1[data-testid]',
    '[role="article"] h1',
    'h1'
  ];

  for (const selector of titleSelectors) {
    const el = document.querySelector(selector);
    if (el?.textContent && el.textContent.length > 10) {
      title = el.textContent.trim().substring(0, 200);
      break;
    }
  }

  if (!title) {
    title = document.title.replace(' / X', '').replace(' on X:', ' - ').trim();
  }

  // Get first meaningful image
  let image: string | null = null;
  const imageSelectors = [
    'article img[src*="media"]',
    '[data-testid="tweetPhoto"] img',
    'article img:not([src*="profile"])',
    'img[src*="pbs.twimg.com/media"]'
  ];

  for (const selector of imageSelectors) {
    const img = document.querySelector(selector) as HTMLImageElement;
    if (img?.src && !img.src.includes('emoji') && !img.src.includes('profile_images')) {
      image = img.src;
      break;
    }
  }

  // Get author info from URL
  let author: string | null = null;
  let authorHandle: string | null = null;

  const urlMatch = window.location.pathname.match(/^\/([^/]+)\//);
  if (urlMatch) {
    authorHandle = urlMatch[1];
  }

  // Try to get display name
  const authorSelectors = [
    '[data-testid="User-Name"] span span',
    'a[role="link"] span[style*="font-weight"]',
    '[data-testid="UserName"] span'
  ];

  for (const selector of authorSelectors) {
    const el = document.querySelector(selector);
    if (el?.textContent && !el.textContent.startsWith('@')) {
      author = el.textContent.trim();
      break;
    }
  }

  return { title, image, author, authorHandle };
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

let cachedMetadata: ArticleMetadata | null = null;

async function saveProgress(): Promise<void> {
  try {
    // Use document scrolling metrics
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const docHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    ) - window.innerHeight;

    const scrollPct = docHeight > 0 ? Math.min(100, Math.round((scrollTop / docHeight) * 100)) : 0;

    console.log(`[X Article Progress] Scroll: ${scrollTop}px, ${scrollPct}%`);

    // Don't save if at the very top
    if (scrollTop < 50) {
      console.log('[X Article Progress] Too close to top, not saving');
      return;
    }

    // Extract metadata once and cache it
    if (!cachedMetadata) {
      cachedMetadata = extractArticleMetadata();
      console.log('[X Article Progress] Metadata:', cachedMetadata);
    }

    const progress: ArticleProgress = {
      url: normalizeUrl(window.location.href),
      scrollPosition: scrollTop,
      scrollPercentage: scrollPct,
      lastRead: Date.now(),
      title: cachedMetadata.title,
      image: cachedMetadata.image || undefined,
      author: cachedMetadata.author || undefined,
      authorHandle: cachedMetadata.authorHandle || undefined,
    };

    const key = getStorageKey(progress.url);
    await chrome.storage.local.set({ [key]: progress });
    console.log(`[X Article Progress] Saved: ${progress.scrollPercentage}% (${progress.scrollPosition}px)`);
  } catch (error) {
    // Extension context may be invalidated after reload
    console.log('[X Article Progress] Could not save (extension may have been reloaded)');
  }
}

async function loadProgress(): Promise<ArticleProgress | null> {
  try {
    const key = getStorageKey(window.location.href);
    const result = await chrome.storage.local.get(key);
    return result[key] || null;
  } catch (error) {
    console.log('[X Article Progress] Could not load (extension may have been reloaded)');
    return null;
  }
}

function createContinueReadingButton(progress: ArticleProgress): HTMLElement {
  // Remove existing button if any
  const existing = document.getElementById("x-progress-continue-btn");
  if (existing) existing.remove();

  const btn = document.createElement("div");
  btn.id = "x-progress-continue-btn";
  btn.innerHTML = `
    <button id="x-progress-btn-action">
      📖 Continue Reading (${progress.scrollPercentage}%)
    </button>
    <button id="x-progress-btn-close">✕</button>
  `;
  btn.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 9999;
    display: flex;
    gap: 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;

  const actionBtnStyle = `
    background: #1d9bf0;
    color: white;
    border: none;
    padding: 12px 20px;
    border-radius: 24px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(29, 155, 240, 0.4);
    transition: transform 0.2s, box-shadow 0.2s;
  `;

  const closeBtnStyle = `
    background: #536471;
    color: white;
    border: none;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  document.body.appendChild(btn);

  const actionBtn = document.getElementById("x-progress-btn-action") as HTMLButtonElement;
  const closeBtn = document.getElementById("x-progress-btn-close") as HTMLButtonElement;

  actionBtn.style.cssText = actionBtnStyle;
  closeBtn.style.cssText = closeBtnStyle;

  actionBtn.addEventListener("mouseenter", () => {
    actionBtn.style.transform = "scale(1.05)";
  });
  actionBtn.addEventListener("mouseleave", () => {
    actionBtn.style.transform = "scale(1)";
  });

  actionBtn.addEventListener("click", () => {
    window.scrollTo({ top: progress.scrollPosition, behavior: "smooth" });
    btn.remove();
  });

  closeBtn.addEventListener("click", () => {
    btn.remove();
  });

  return btn;
}

function isArticlePage(): boolean {
  const url = window.location.href;
  const pathname = window.location.pathname;

  // Exclude profile sub-pages
  const excludedPaths = ['/media', '/highlights', '/with_replies', '/likes', '/followers', '/following', '/lists'];
  for (const excluded of excludedPaths) {
    if (pathname.endsWith(excluded)) {
      console.log(`[XArticle] Excluded path: ${excluded}`);
      return false;
    }
  }

  // Only track article and status pages
  const pattern = /^https:\/\/(x\.com|twitter\.com)\/[^/]+\/(articles|status)\/.+/;
  return pattern.test(url);
}

let currentUrl = "";
let scrollHandler: (() => void) | null = null;
let isInitialized = false;

async function initTracking(): Promise<void> {
  if (!isArticlePage()) {
    console.log("[X Article Progress] Not an article/status page, skipping.");
    return;
  }

  // Avoid re-initializing for the same URL
  if (currentUrl === window.location.href && isInitialized) return;
  currentUrl = window.location.href;
  isInitialized = true;

  // Reset cached metadata for new article
  cachedMetadata = null;

  console.log("[X Article Progress] Initializing on:", window.location.href);

  // Wait for content to load
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Check for saved progress
  const progress = await loadProgress();
  if (progress && progress.scrollPosition > 50) {
    console.log(`[X Article Progress] Found saved progress: ${progress.scrollPercentage}%`);
    createContinueReadingButton(progress);
  }

  // Remove old scroll handler if exists
  if (scrollHandler) {
    window.removeEventListener("scroll", scrollHandler);
    document.removeEventListener("scroll", scrollHandler);
  }

  // Track scroll with debouncing
  const debouncedSave = debounce(saveProgress, 500);
  scrollHandler = () => debouncedSave();

  // Listen on both window and document
  window.addEventListener("scroll", scrollHandler, { passive: true });
  document.addEventListener("scroll", scrollHandler, { passive: true });

  console.log("[X Article Progress] Scroll listeners attached");

  // Also save periodically while on the page
  setInterval(() => {
    if (isArticlePage() && window.scrollY > 50) {
      saveProgress();
    }
  }, 5000);
}

// Initialize on load
initTracking();

// Handle SPA navigation - watch for URL changes
let lastUrl = window.location.href;
const observer = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    console.log("[X Article Progress] URL changed to:", lastUrl);
    // Remove old button
    const btn = document.getElementById("x-progress-continue-btn");
    if (btn) btn.remove();
    // Reset and re-init
    currentUrl = "";
    isInitialized = false;
    setTimeout(initTracking, 1000);
  }
});

observer.observe(document.body, { childList: true, subtree: true });

// Save on page unload
window.addEventListener("beforeunload", () => {
  if (isArticlePage()) {
    saveProgress();
  }
});

// Also save on visibility change (when user switches tabs)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && isArticlePage()) {
    saveProgress();
  }
});

console.log("[X Article Progress] Content script loaded");

// ===== FEED PROGRESS BAR FEATURE =====

interface StoredProgress {
  url: string;
  scrollPercentage: number;
  authorHandle?: string;
}

// CSS for the progress bar
const feedProgressStyles = document.createElement('style');
feedProgressStyles.textContent = `
  .x-article-feed-progress {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: rgba(29, 155, 240, 0.2);
    z-index: 10;
    pointer-events: none;
  }
  .x-article-feed-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #1d9bf0, #1a8cd8);
    transition: width 0.3s ease;
    box-shadow: 0 0 8px rgba(29, 155, 240, 0.6);
  }
  .x-article-feed-progress-container {
    position: relative;
  }
`;
document.head.appendChild(feedProgressStyles);

// Cache for stored progress to avoid repeated storage calls
let progressCache: Map<string, StoredProgress> = new Map();
let cacheLoaded = false;

async function loadProgressCache(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(null);
    progressCache.clear();
    
    for (const [key, value] of Object.entries(result)) {
      if (key.startsWith('article_progress_') && value) {
        const progress = value as StoredProgress;
        if (progress.url && progress.scrollPercentage > 0) {
          // Store by normalized URL
          const normalizedUrl = normalizeUrl(progress.url);
          progressCache.set(normalizedUrl, progress);
          
          // Also store by author handle + status ID for easier matching
          const urlMatch = progress.url.match(/\/([\w]+)\/(status|articles)\/(\d+)/);
          if (urlMatch) {
            const matchKey = `${urlMatch[1].toLowerCase()}/${urlMatch[3]}`;
            progressCache.set(matchKey, progress);
          }
        }
      }
    }
    
    cacheLoaded = true;
    console.log(`[X Article Progress] Loaded ${progressCache.size} articles into cache`);
  } catch (error) {
    console.log('[X Article Progress] Could not load progress cache');
  }
}

function findProgressForArticle(articleElement: Element): StoredProgress | null {
  // Try to find the article URL from links within the element
  const links = articleElement.querySelectorAll('a[href*="/status/"], a[href*="/articles/"]');
  
  for (const link of links) {
    const href = (link as HTMLAnchorElement).href;
    if (!href) continue;
    
    // Try direct URL match
    const normalizedUrl = normalizeUrl(href);
    if (progressCache.has(normalizedUrl)) {
      return progressCache.get(normalizedUrl)!;
    }
    
    // Try author/status ID match
    const urlMatch = href.match(/\/([\w]+)\/(status|articles)\/(\d+)/);
    if (urlMatch) {
      const matchKey = `${urlMatch[1].toLowerCase()}/${urlMatch[3]}`;
      if (progressCache.has(matchKey)) {
        return progressCache.get(matchKey)!;
      }
    }
  }
  
  return null;
}

function addProgressBarToArticle(articleElement: Element, progress: StoredProgress): void {
  // Check if already has a progress bar
  if (articleElement.querySelector('.x-article-feed-progress')) {
    return;
  }
  
  // Find the article card container - look for the card with content
  const cardContainer = articleElement.querySelector('[data-testid="card.wrapper"]') ||
                        articleElement.querySelector('[data-testid="card.layoutLarge.media"]') ||
                        articleElement.closest('article');
  
  if (!cardContainer) return;
  
  // Make container relative if needed
  const computedStyle = window.getComputedStyle(cardContainer);
  if (computedStyle.position === 'static') {
    (cardContainer as HTMLElement).style.position = 'relative';
  }
  cardContainer.classList.add('x-article-feed-progress-container');
  
  // Create progress bar
  const progressBar = document.createElement('div');
  progressBar.className = 'x-article-feed-progress';
  progressBar.innerHTML = `<div class="x-article-feed-progress-fill" style="width: ${progress.scrollPercentage}%"></div>`;
  progressBar.title = `${progress.scrollPercentage}% read`;
  
  cardContainer.appendChild(progressBar);
  console.log(`[X Article Progress] Added progress bar (${progress.scrollPercentage}%) to article`);
}

function scanFeedForArticles(): void {
  if (!cacheLoaded || progressCache.size === 0) return;
  
  // Find all tweet/article containers in the feed
  const articleContainers = document.querySelectorAll([
    'article[data-testid="tweet"]',
    '[data-testid="cellInnerDiv"]',
    '[data-testid="card.wrapper"]'
  ].join(','));
  
  articleContainers.forEach(container => {
    // Skip if already processed
    if (container.hasAttribute('data-progress-checked')) return;
    container.setAttribute('data-progress-checked', 'true');
    
    const progress = findProgressForArticle(container);
    if (progress && progress.scrollPercentage > 0) {
      addProgressBarToArticle(container, progress);
    }
  });
}

// Debounced feed scanner
let feedScanTimeout: ReturnType<typeof setTimeout> | null = null;
function debouncedFeedScan(): void {
  if (feedScanTimeout) clearTimeout(feedScanTimeout);
  feedScanTimeout = setTimeout(scanFeedForArticles, 300);
}

// Initialize feed progress tracking
async function initFeedProgressBars(): Promise<void> {
  // Load the cache first
  await loadProgressCache();
  
  // Initial scan
  scanFeedForArticles();
  
  // Watch for new content being added to the feed
  const feedObserver = new MutationObserver((mutations) => {
    let hasNewContent = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        hasNewContent = true;
        break;
      }
    }
    if (hasNewContent) {
      debouncedFeedScan();
    }
  });
  
  // Observe the main content area
  const mainContent = document.querySelector('main') || document.body;
  feedObserver.observe(mainContent, { 
    childList: true, 
    subtree: true 
  });
  
  // Refresh cache periodically (in case user reads articles in other tabs)
  setInterval(async () => {
    await loadProgressCache();
    // Re-scan with fresh cache, but only reset elements that might have changed
    document.querySelectorAll('[data-progress-checked]').forEach(el => {
      el.removeAttribute('data-progress-checked');
    });
    scanFeedForArticles();
  }, 30000); // Refresh every 30 seconds
  
  console.log('[X Article Progress] Feed progress bar tracking initialized');
}

// Start feed progress tracking after a short delay
setTimeout(initFeedProgressBars, 2000);
