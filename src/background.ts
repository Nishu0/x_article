interface Author {
  username: string;
  displayName?: string;
  lastChecked?: number;
}

interface Settings {
  notificationsEnabled: boolean;
}

interface Tweet {
  id: string;
  text: string;
  createdAt: string;
  author?: {
    userName: string;
    name: string;
  };
  entities?: {
    urls?: Array<{ expanded_url: string }>;
  };
}

interface ArticleInfo {
  title: string;
  preview_text: string;
  cover_media_img_url?: string;
  author?: {
    userName: string;
    name: string;
  };
}

// HARDCODED API KEY - Replace with your key
const API_KEY = '';
const API_BASE = 'https://api.twitterapi.io/twitter';
const CHECK_INTERVAL = 30 * 60 * 1000; // 30 minutes

// Check for new articles from followed authors
async function checkNewArticles(): Promise<void> {
  console.log('[XArticle] Starting article check...');

  const result = await chrome.storage.local.get(['followed_authors', 'settings', 'seen_articles']);
  const authors: Author[] = result.followed_authors || [];
  const settings: Settings = result.settings || { notificationsEnabled: true };
  const seenArticles: Set<string> = new Set(result.seen_articles || []);

  console.log(`[XArticle] Found ${authors.length} authors to check`);
  console.log(`[XArticle] Notifications enabled: ${settings.notificationsEnabled}`);

  if (!API_KEY || API_KEY === 'YOUR_API_KEY_HERE') {
    console.log('[XArticle] No API key configured');
    return;
  }

  if (!settings.notificationsEnabled || authors.length === 0) {
    console.log('[XArticle] Skipping: notifications disabled or no authors');
    return;
  }

  for (const author of authors) {
    console.log(`[XArticle] Checking @${author.username}...`);

    try {
      const tweets = await fetchUserTweets(author.username);
      console.log(`[XArticle] Got ${tweets.length} tweets from @${author.username}`);

      for (const tweet of tweets) {
        const articleUrl = findArticleUrl(tweet);

        if (articleUrl) {
          console.log(`[XArticle] Found article URL in tweet ${tweet.id}: ${articleUrl}`);

          if (!seenArticles.has(tweet.id)) {
            console.log(`[XArticle] New article! Fetching details...`);

            const articleInfo = await fetchArticleDetails(tweet.id);

            if (articleInfo) {
              console.log(`[XArticle] Article title: ${articleInfo.title}`);
              await showNotification(author, articleInfo, articleUrl);
              seenArticles.add(tweet.id);
            } else {
              console.log(`[XArticle] Could not fetch article details`);
            }
          } else {
            console.log(`[XArticle] Already seen tweet ${tweet.id}`);
          }
        }
      }

      author.lastChecked = Date.now();
    } catch (error) {
      console.error(`[XArticle] Error checking @${author.username}:`, error);
    }
  }

  await chrome.storage.local.set({
    seen_articles: Array.from(seenArticles),
    followed_authors: authors
  });

  console.log('[XArticle] Article check complete');
}

async function fetchUserTweets(username: string): Promise<Tweet[]> {
  console.log(`[XArticle] Fetching tweets for @${username}...`);

  const url = `${API_BASE}/user/last_tweets?userName=${username}`;
  console.log(`[XArticle] API URL: ${url}`);
  console.log(`[XArticle] Using API Key: ${API_KEY.substring(0, 10)}...`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json'
    }
  });

  console.log(`[XArticle] API response status: ${response.status}`);

  const data = await response.json();
  console.log(`[XArticle] Full API response keys:`, Object.keys(data));
  console.log(`[XArticle] Full API response:`, JSON.stringify(data).substring(0, 500));

  if (!response.ok) {
    console.error(`[XArticle] API error:`, data);
    throw new Error(`Failed to fetch tweets: ${response.status}`);
  }

  // Response structure: { status, code, msg, data: { pin_tweet, tweets: [...] } }
  let tweets: Tweet[] = [];
  if (data.data?.tweets && Array.isArray(data.data.tweets)) {
    tweets = data.data.tweets;
  } else if (Array.isArray(data.tweets)) {
    tweets = data.tweets;
  } else if (Array.isArray(data.data)) {
    tweets = data.data;
  }

  console.log(`[XArticle] API returned ${tweets.length} tweets`);

  // Log first tweet to check for article field
  if (tweets.length > 0) {
    console.log(`[XArticle] First tweet id: ${tweets[0].id}`);
    console.log(`[XArticle] First tweet has article: ${tweets[0].article !== null}`);
  }

  return tweets;
}

async function fetchArticleDetails(tweetId: string): Promise<ArticleInfo | null> {
  console.log(`[XArticle] Fetching article details for tweet ${tweetId}...`);

  try {
    const response = await fetch(`${API_BASE}/article?tweet_id=${tweetId}`, {
      headers: {
        'X-API-Key': API_KEY
      }
    });

    console.log(`[XArticle] Article API status: ${response.status}`);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    console.log(`[XArticle] Article data:`, data.article?.title || 'No title');

    return data.article || null;
  } catch (error) {
    console.error(`[XArticle] Error fetching article:`, error);
    return null;
  }
}

function findArticleUrl(tweet: any): string | null {
  // Check if tweet has article field (API provides this)
  if (tweet.article !== null && tweet.article !== undefined) {
    console.log(`[XArticle] Tweet ${tweet.id} has article field`);
    return tweet.url || `https://x.com/${tweet.author?.userName}/status/${tweet.id}`;
  }

  const text = tweet.text || '';

  // Check for article URLs in text
  const articlePatterns = [
    /https:\/\/x\.com\/\w+\/articles\/\d+/,
    /https:\/\/twitter\.com\/\w+\/articles\/\d+/
  ];

  for (const pattern of articlePatterns) {
    const match = text.match(pattern);
    if (match) {
      console.log(`[XArticle] Found article URL pattern in text`);
      return match[0];
    }
  }

  // Check entities URLs
  if (tweet.entities?.urls) {
    for (const urlObj of tweet.entities.urls) {
      const url = urlObj.expanded_url || urlObj.url;
      if (url?.includes('/articles/')) {
        console.log(`[XArticle] Found article URL in entities`);
        return url;
      }
    }
  }

  // Long tweets (500+ chars) might be articles
  if (text.length > 500 && tweet.author?.userName) {
    console.log(`[XArticle] Long tweet detected (${text.length} chars)`);
    return `https://x.com/${tweet.author.userName}/status/${tweet.id}`;
  }

  return null;
}

async function showNotification(author: Author, article: ArticleInfo, url: string): Promise<void> {
  console.log(`[XArticle] Showing notification for article: ${article.title}`);

  const notificationId = `new-article-${Date.now()}`;

  try {
    await chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: `New article from @${author.username}`,
      message: article.title || article.preview_text?.substring(0, 100) || 'New article available',
      priority: 2
    });
  } catch (e) {
    console.log(`[XArticle] Notification error (non-critical):`, e);
  }

  // Store the new article for display in popup
  const result = await chrome.storage.local.get('new_articles');
  const newArticles: any[] = result.new_articles || [];

  // Add to beginning of list
  newArticles.unshift({
    id: notificationId,
    url,
    title: article.title,
    preview: article.preview_text?.substring(0, 150),
    image: article.cover_media_img_url,
    author: author.username,
    timestamp: Date.now()
  });

  // Keep only last 20 articles
  if (newArticles.length > 20) {
    newArticles.pop();
  }

  await chrome.storage.local.set({ new_articles: newArticles });
  console.log(`[XArticle] Stored article in new_articles list`);
}

// Handle notification clicks
chrome.notifications.onClicked.addListener(async (notificationId) => {
  const result = await chrome.storage.local.get(`notification_${notificationId}`);
  const data = result[`notification_${notificationId}`];

  if (data?.url) {
    chrome.tabs.create({ url: data.url });
  }

  chrome.notifications.clear(notificationId);
  await chrome.storage.local.remove(`notification_${notificationId}`);
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CHECK_NEW_ARTICLES') {
    console.log('[XArticle] Manual check triggered from popup');
    checkNewArticles().then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      console.error('[XArticle] Check failed:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
});

// Schedule periodic checks
function scheduleCheck(): void {
  chrome.alarms.clear('check-articles');
  chrome.alarms.create('check-articles', {
    delayInMinutes: 1,
    periodInMinutes: 30
  });
  console.log('[XArticle] Scheduled periodic checks (every 30 min)');
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'check-articles') {
    console.log('[XArticle] Alarm triggered, checking articles...');
    checkNewArticles();
  }
});

// Initialize on install
chrome.runtime.onInstalled.addListener(() => {
  console.log('[XArticle] Extension installed');
  scheduleCheck();
});

// Check on startup
chrome.runtime.onStartup.addListener(() => {
  console.log('[XArticle] Extension started');
  scheduleCheck();
});

console.log('[XArticle] Background script loaded');
