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
  lastChecked?: number;
}

interface Settings {
  notificationsEnabled: boolean;
}

const MAX_AUTHORS = 3;

// Bottom navigation switching
document.querySelectorAll('.nav-item').forEach(nav => {
  nav.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    nav.classList.add('active');
    const tabId = nav.getAttribute('data-tab');
    document.getElementById(`${tabId}-tab`)?.classList.add('active');
  });
});

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

  const articles = Array.from(articlesMap.values());
  articles.sort((a, b) => b.lastRead - a.lastRead);

  if (articles.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📖</div>
        <p>No articles yet.<br>Start reading on X to track progress!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = articles.map(article => `
    <div class="article-card" data-url="${escapeHtml(article.url)}">
      ${article.image
        ? `<img class="article-image" src="${escapeHtml(article.image)}" alt="" onerror="this.outerHTML='<div class=\\'article-image-placeholder\\'>📖</div>'">`
        : '<div class="article-image-placeholder">📖</div>'
      }
      <div class="article-content">
        <div class="article-title">${escapeHtml(article.title || 'Untitled Article')}</div>
        <div class="article-author">@${escapeHtml(article.authorHandle || article.author || 'unknown')}</div>
        <div class="article-meta">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${article.scrollPercentage}%"></div>
          </div>
          <div class="progress-text">${article.scrollPercentage}%</div>
        </div>
      </div>
      <button class="remove-btn" data-url="${escapeHtml(article.url)}">✕</button>
    </div>
  `).join('');

  // Add click handlers
  container.querySelectorAll('.article-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('remove-btn')) return;
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
        <div class="empty-state-icon">👤</div>
        <p>No authors followed yet.<br>Add authors to get article notifications.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = authors.map(author => `
    <div class="author-card">
      <div class="author-avatar">${author.username.charAt(0).toUpperCase()}</div>
      <div class="author-info">
        <div class="author-name">${escapeHtml(author.displayName || author.username)}</div>
        <div class="author-handle">@${escapeHtml(author.username)}</div>
      </div>
      <button class="author-remove" data-username="${escapeHtml(author.username)}">✕</button>
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

  authors.push({
    username: cleanUsername,
    lastChecked: Date.now()
  });

  await chrome.storage.local.set({ followed_authors: authors });
  loadAuthors();
  showToast(`Following @${cleanUsername}`);
}

async function removeAuthor(username: string): Promise<void> {
  const result = await chrome.storage.local.get('followed_authors');
  const authors: Author[] = result.followed_authors || [];
  const filtered = authors.filter(a => a.username.toLowerCase() !== username.toLowerCase());
  await chrome.storage.local.set({ followed_authors: filtered });
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
        <div class="empty-state-icon">✨</div>
        <p>No new articles yet.<br>Add authors and check for articles!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = articles.map(article => `
    <div class="article-card" data-url="${escapeHtml(article.url)}">
      ${article.image
        ? `<img class="article-image" src="${escapeHtml(article.image)}" alt="" onerror="this.outerHTML='<div class=\\'article-image-placeholder\\'>✨</div>'">`
        : '<div class="article-image-placeholder">✨</div>'
      }
      <div class="article-content">
        <div class="article-title">${escapeHtml(article.title || 'New Article')}</div>
        <div class="article-author">@${escapeHtml(article.author || 'unknown')}</div>
        <div class="progress-text" style="margin-top: 4px;">${formatTimeAgo(article.timestamp)}</div>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.article-card').forEach(card => {
    card.addEventListener('click', () => {
      const url = card.getAttribute('data-url');
      if (url) chrome.tabs.create({ url });
    });
  });
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// Initialize
loadArticles();
loadNewArticles();
loadAuthors();
loadSettings();
