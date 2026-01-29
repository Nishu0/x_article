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

interface Author {
  username: string;
  displayName?: string;
  profilePicture?: string;
  lastChecked?: number;
}

interface Settings {
  notificationsEnabled: boolean;
}

// API for fetching user info
const API_KEY = '';
const API_BASE = 'https://api.twitterapi.io/twitter';

const MAX_AUTHORS = 3;
let currentFilter: 'pending' | 'finished' = 'pending';
let searchQuery = '';

// Filter tabs (Pending/Finished within Library)
document.querySelectorAll('.filter-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const filter = tab.getAttribute('data-filter') as 'pending' | 'finished';
    
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentFilter = filter;
    loadArticles();
  });
});

// Bottom navigation switching
document.querySelectorAll('.nav-item').forEach(nav => {
  nav.addEventListener('click', () => {
    const tabId = nav.getAttribute('data-tab');
    if (tabId) {
      switchToTab(tabId);
    }
  });
});

function switchToTab(tabId: string): void {
  // Update nav items
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  
  const navItem = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
  navItem?.classList.add('active');
  document.getElementById(`${tabId}-tab`)?.classList.add('active');
  
  // Show/hide filter tabs based on current tab
  const filterTabsContainer = document.getElementById('filter-tabs-container');
  if (filterTabsContainer) {
    if (tabId === 'library') {
      filterTabsContainer.classList.remove('hidden');
      // Update filter tab highlighting
      document.querySelectorAll('.filter-tab').forEach(t => {
        const f = t.getAttribute('data-filter');
        t.classList.toggle('active', f === currentFilter);
      });
    } else {
      filterTabsContainer.classList.add('hidden');
    }
  }
  
  // Clear badge when viewing Discover
  if (tabId === 'discover') {
    chrome.action.setBadgeText({ text: '' });
  }
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

// Load and display articles
async function loadArticles(): Promise<void> {
  const container = document.getElementById('articles-list');
  if (!container) return;

  const result = await chrome.storage.local.get(null);
  const articlesMap = new Map<string, ArticleProgress>();

  for (const [key, value] of Object.entries(result)) {
    if (key.startsWith('article_progress_') && value) {
      const article = value as ArticleProgress;
      const normalizedUrl = normalizeUrl(article.url);
      const existing = articlesMap.get(normalizedUrl);

      if (!existing || article.lastRead > existing.lastRead) {
        articlesMap.set(normalizedUrl, article);
      }
    }
  }

  let articles = Array.from(articlesMap.values());
  articles.sort((a, b) => b.lastRead - a.lastRead);

  // Filter based on current filter
  if (currentFilter === 'pending') {
    articles = articles.filter(a => a.scrollPercentage < 100);
  } else if (currentFilter === 'finished') {
    articles = articles.filter(a => a.scrollPercentage >= 100);
  }

  // Apply search filter
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    articles = articles.filter(a => 
      (a.title?.toLowerCase().includes(query)) ||
      (a.author?.toLowerCase().includes(query)) ||
      (a.authorHandle?.toLowerCase().includes(query))
    );
  }

  if (articles.length === 0) {
    const emptyMessage = currentFilter === 'pending' 
      ? 'No pending articles.<br>Start reading on X to track progress!'
      : 'No finished articles yet.<br>Complete reading articles to see them here!';
    
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <span class="material-symbols-outlined">${currentFilter === 'pending' ? 'auto_stories' : 'task_alt'}</span>
        </div>
        <p>${emptyMessage}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = articles.map(article => `
    <div class="article-card" data-url="${escapeHtml(article.url)}">
      <div class="article-main">
        ${article.image
          ? `<img class="article-image" src="${escapeHtml(article.image)}" alt="" onerror="this.outerHTML='<div class=\\'article-image-placeholder\\'><span class=\\'material-symbols-outlined\\'>article</span></div>'">`
          : '<div class="article-image-placeholder"><span class="material-symbols-outlined">article</span></div>'
        }
        <div class="article-content">
          <div class="article-title">${escapeHtml(article.title || 'Untitled Article')}</div>
          <div class="article-author">@${escapeHtml(article.authorHandle || article.author || 'unknown')}</div>
        </div>
        <button class="remove-btn" data-url="${escapeHtml(article.url)}">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div class="progress-section">
        <div class="progress-header">
          <span class="progress-label">Reading Progress</span>
          <span class="progress-value">${article.scrollPercentage}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${article.scrollPercentage}%"></div>
        </div>
      </div>
    </div>
  `).join('') + `
    <div class="end-of-list">
      <p>End of List</p>
    </div>
  `;

  // Add click handlers
  container.querySelectorAll('.article-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.remove-btn')) return;
      const url = card.getAttribute('data-url');
      if (url) chrome.tabs.create({ url });
    });
  });

  container.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const url = btn.getAttribute('data-url');
      if (url) {
        await removeArticle(url);
        loadArticles();
        showToast('Article removed');
      }
    });
  });
}

async function removeArticle(url: string): Promise<void> {
  const key = `article_progress_${hashUrl(normalizeUrl(url))}`;
  await chrome.storage.local.remove(key);
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

// Authors management
async function loadAuthors(): Promise<void> {
  const container = document.getElementById('authors-list');
  const limitEl = document.getElementById('author-limit');
  const addBtn = document.getElementById('add-author-btn') as HTMLButtonElement;

  if (!container) return;

  const result = await chrome.storage.local.get('followed_authors');
  const authors: Author[] = result.followed_authors || [];

  if (limitEl) limitEl.textContent = `${authors.length}/${MAX_AUTHORS}`;
  if (addBtn) addBtn.disabled = authors.length >= MAX_AUTHORS;

  if (authors.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <span class="material-symbols-outlined">person_add</span>
        </div>
        <p>No authors followed yet.<br>Add authors to get article notifications.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = authors.map(author => `
    <div class="author-card">
      ${author.profilePicture 
        ? `<img class="author-avatar-img" src="${escapeHtml(author.profilePicture)}" alt="" onerror="this.outerHTML='<div class=\\'author-avatar\\'>${author.username.charAt(0).toUpperCase()}</div>'">`
        : `<div class="author-avatar">${author.username.charAt(0).toUpperCase()}</div>`
      }
      <div class="author-info">
        <div class="author-name" title="${escapeHtml(author.displayName || author.username)}">${escapeHtml(author.displayName || author.username)}</div>
        <div class="author-handle">@${escapeHtml(author.username)}</div>
      </div>
      <button class="author-remove" data-username="${escapeHtml(author.username)}">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
  `).join('');

  container.querySelectorAll('.author-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const username = btn.getAttribute('data-username');
      if (username) {
        await removeAuthor(username);
        loadAuthors();
        showToast('Author removed');
      }
    });
  });
}

// Fetch user info from API (profile picture, display name)
async function fetchUserInfo(username: string): Promise<{name: string, profilePicture: string} | null> {
  try {
    const response = await fetch(`${API_BASE}/user/info?userName=${username}`, {
      headers: {
        'X-API-Key': API_KEY
      }
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    if (data.status === 'success' && data.data) {
      return {
        name: data.data.name || username,
        profilePicture: data.data.profilePicture || ''
      };
    }
    return null;
  } catch (error) {
    console.error('[XArticle] Error fetching user info:', error);
    return null;
  }
}

async function addAuthor(username: string): Promise<void> {
  const cleanUsername = username.replace('@', '').trim().toLowerCase();
  if (!cleanUsername) return;

  const result = await chrome.storage.local.get('followed_authors');
  const authors: Author[] = result.followed_authors || [];

  if (authors.length >= MAX_AUTHORS) {
    showToast('Maximum 3 authors allowed');
    return;
  }

  if (authors.some(a => a.username.toLowerCase() === cleanUsername)) {
    showToast('Author already followed');
    return;
  }

  // Show loading state
  showToast(`Looking up @${cleanUsername}...`);
  
  // Fetch user info from API
  const userInfo = await fetchUserInfo(cleanUsername);
  
  authors.push({
    username: cleanUsername,
    displayName: userInfo?.name || cleanUsername,
    profilePicture: userInfo?.profilePicture || '',
    lastChecked: Date.now()
  });

  await chrome.storage.local.set({ followed_authors: authors });
  loadAuthors();
  showToast(`Following @${cleanUsername}`);
}

async function removeAuthor(username: string): Promise<void> {
  const normalizedUsername = username.toLowerCase();
  
  const result = await chrome.storage.local.get(['followed_authors', 'seen_articles', 'new_articles']);
  const authors: Author[] = result.followed_authors || [];
  const seenArticles: string[] = result.seen_articles || [];
  const newArticles: any[] = result.new_articles || [];
  
  // Remove from followed authors
  const filteredAuthors = authors.filter(a => a.username.toLowerCase() !== normalizedUsername);
  
  // Remove author's entries from seen_articles (format: username:tweetId)
  const filteredSeenArticles = seenArticles.filter(entry => {
    const [entryUsername] = entry.split(':');
    return entryUsername !== normalizedUsername;
  });
  
  // Remove author's articles from new_articles (Discover)
  const filteredNewArticles = newArticles.filter(a => 
    a.author?.toLowerCase() !== normalizedUsername
  );
  
  await chrome.storage.local.set({ 
    followed_authors: filteredAuthors,
    seen_articles: filteredSeenArticles,
    new_articles: filteredNewArticles
  });
  
  // Update badge
  if (filteredNewArticles.length > 0) {
    chrome.action.setBadgeText({ text: filteredNewArticles.length.toString() });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
  
  console.log(`[XArticle] Removed @${normalizedUsername} - cleared ${seenArticles.length - filteredSeenArticles.length} seen articles, ${newArticles.length - filteredNewArticles.length} discover articles`);
}

// Settings
async function loadSettings(): Promise<void> {
  const result = await chrome.storage.local.get(['settings']);
  const settings: Settings = result.settings || { notificationsEnabled: true };

  const notifToggle = document.getElementById('notifications-toggle') as HTMLInputElement;
  if (notifToggle) notifToggle.checked = settings.notificationsEnabled;
}

async function saveSettings(): Promise<void> {
  const notifToggle = document.getElementById('notifications-toggle') as HTMLInputElement;

  const settings: Settings = {
    notificationsEnabled: notifToggle?.checked ?? true
  };

  await chrome.storage.local.set({ settings });
  showToast('Settings saved');
}

// Event listeners
document.getElementById('add-author-btn')?.addEventListener('click', () => {
  const input = document.getElementById('author-input') as HTMLInputElement;
  if (input?.value) {
    addAuthor(input.value);
    input.value = '';
  }
});

document.getElementById('author-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const input = e.target as HTMLInputElement;
    if (input.value) {
      addAuthor(input.value);
      input.value = '';
    }
  }
});

document.getElementById('notifications-toggle')?.addEventListener('change', saveSettings);

document.getElementById('clear-all-btn')?.addEventListener('click', async () => {
  if (confirm('Remove all reading progress?')) {
    const result = await chrome.storage.local.get(null);
    const keysToRemove = Object.keys(result).filter(k => k.startsWith('article_progress_'));
    await chrome.storage.local.remove(keysToRemove);
    loadArticles();
    showToast('All progress cleared');
  }
});

document.getElementById('check-articles-btn')?.addEventListener('click', async () => {
  showToast('Checking for new articles...');
  chrome.runtime.sendMessage({ type: 'CHECK_NEW_ARTICLES' }, (response) => {
    if (response?.success) {
      showToast('Check complete!');
    }
  });
});



// Helpers
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message: string): void {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 2500);
}

// Load new articles from followed authors
async function loadNewArticles(): Promise<void> {
  const container = document.getElementById('new-articles-list');
  if (!container) return;

  const result = await chrome.storage.local.get('new_articles');
  const articles: any[] = result.new_articles || [];

  if (articles.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <span class="material-symbols-outlined">explore</span>
        </div>
        <p>No new articles yet.<br>Add authors and check for articles!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = articles.map(article => `
    <div class="article-card" data-url="${escapeHtml(article.url)}">
      <button class="remove-btn discover-remove" data-url="${escapeHtml(article.url)}" title="Remove from Discover">
        <span class="material-symbols-outlined">close</span>
      </button>
      <div class="article-main">
        ${article.image
          ? `<img class="article-image" src="${escapeHtml(article.image)}" alt="" onerror="this.outerHTML='<div class=\\'article-image-placeholder\\'><span class=\\'material-symbols-outlined\\'>explore</span></div>'">`
          : '<div class="article-image-placeholder"><span class="material-symbols-outlined">explore</span></div>'
        }
        <div class="article-content">
          <div class="article-title">${escapeHtml(article.title || 'New Article')}</div>
          <div class="article-author">@${escapeHtml(article.author || 'unknown')}</div>
          <div class="article-time">${formatTimeAgo(article.timestamp)}</div>
        </div>
      </div>
    </div>
  `).join('');

  // Handle close button clicks
  container.querySelectorAll('.discover-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const url = (btn as HTMLElement).getAttribute('data-url');
      if (url) {
        await removeFromDiscover(url);
        loadNewArticles();
        showToast('Article removed');
      }
    });
  });

  // Handle article card clicks - move to pending and open
  container.querySelectorAll('.article-card').forEach(card => {
    card.addEventListener('click', async () => {
      const url = card.getAttribute('data-url');
      if (url) {
        await moveDiscoverToPending(url);
        chrome.tabs.create({ url });
        loadNewArticles();
      }
    });
  });
}

// Remove an article from Discover list
async function removeFromDiscover(url: string): Promise<void> {
  const result = await chrome.storage.local.get('new_articles');
  const articles: any[] = result.new_articles || [];
  const filtered = articles.filter(a => a.url !== url);
  await chrome.storage.local.set({ new_articles: filtered });
  
  // Update badge
  if (filtered.length > 0) {
    chrome.action.setBadgeText({ text: filtered.length.toString() });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Move an article from Discover to Pending (Library)
async function moveDiscoverToPending(url: string): Promise<void> {
  const result = await chrome.storage.local.get(['new_articles', 'articles']);
  const newArticles: any[] = result.new_articles || [];
  const articles: Record<string, any> = result.articles || {};
  
  const article = newArticles.find(a => a.url === url);
  if (article) {
    // Add to library as pending (0% progress)
    const urlHash = hashUrl(url);
    articles[urlHash] = {
      url: article.url,
      scrollPosition: 0,
      scrollPercentage: 0,
      lastRead: Date.now(),
      title: article.title,
      image: article.image,
      author: article.authorName,
      authorHandle: article.author
    };
    
    // Remove from Discover
    const filtered = newArticles.filter(a => a.url !== url);
    
    await chrome.storage.local.set({ 
      articles,
      new_articles: filtered 
    });
    
    // Update badge
    if (filtered.length > 0) {
      chrome.action.setBadgeText({ text: filtered.length.toString() });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  }
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// Search functionality
const searchBtn = document.getElementById('search-btn');
const searchContainer = document.getElementById('search-container');
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const searchClose = document.getElementById('search-close');

searchBtn?.addEventListener('click', () => {
  searchContainer?.classList.add('active');
  searchInput?.focus();
});

searchClose?.addEventListener('click', () => {
  searchContainer?.classList.remove('active');
  if (searchInput) {
    searchInput.value = '';
    searchQuery = '';
    loadArticles();
  }
});

// Debounce search input
let searchTimeout: number;
searchInput?.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = window.setTimeout(() => {
    searchQuery = (e.target as HTMLInputElement).value;
    loadArticles();
  }, 200);
});

// Initialize
loadArticles();
loadNewArticles();
loadAuthors();
loadSettings();
