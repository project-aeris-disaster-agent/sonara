// Supabase Edge Function: Process Agent Mode actions
// Triggered via Vercel Cron or an external cron hitting this endpoint.
// Fetches target account tweets and schedules engagement actions (retweet, like, mention/reply)
// Includes randomized timing to avoid detection by Twitter/X

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateResponse, type CharacterCard, type PersonalityMetadata } from '../_shared/generateResponse.ts';
import { getGlobalSettings, isServicePaused, getEffectiveAgentActions, getEffectiveFrequency, mergeGlobalWithUserSettings } from '../_shared/globalSettings.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CRON_SECRET = Deno.env.get('CRON_SECRET');
const SUPABASE_URL =
  Deno.env.get('PROJECT_URL') ??
  Deno.env.get('SUPABASE_URL') ??
  '';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SERVICE_ROLE_KEY') ??
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  '';
const TWITTER_CLIENT_ID = Deno.env.get('TWITTER_CLIENT_ID') ?? '';
const TWITTER_CLIENT_SECRET = Deno.env.get('TWITTER_CLIENT_SECRET') ?? '';
const GROK_API_KEY = Deno.env.get('GROK_API_KEY') ?? '';

// Rate limiting for Twitter API calls (avoid 429 errors)
const TWITTER_API_DELAY_MS = 1200; // 1.2 seconds between Twitter API calls
const ACCOUNT_DELAY_MS = 2500; // 2.5 seconds between target accounts
const ACCOUNT_DELAY_JITTER_MS = 1000; // Add jitter to reduce burst patterns
const BATCH_DELAY_MS = 2000; // 2 seconds between user batches
const RATE_LIMIT_RETRY_DELAY_MS = 5000; // 5 seconds before retry on 429
const RATE_LIMIT_MAX_WAIT_MS = 30000; // Cap wait to 30s to avoid long stalls
const MAX_TARGET_ACCOUNTS_PER_RUN = 3; // Safe batch size per run (rotation handles all)
const TARGET_ID_CACHE_TTL_HOURS = 168; // 7 days

/** Helper to add delay between API calls to avoid rate limits */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function waitForRateLimitReset(response: Response): Promise<void> {
  const resetHeader = response.headers.get('x-rate-limit-reset');
  if (resetHeader) {
    const resetEpochMs = parseInt(resetHeader, 10) * 1000;
    const waitMs = resetEpochMs - Date.now();
    if (waitMs > 0) {
      await delay(Math.min(waitMs, RATE_LIMIT_MAX_WAIT_MS));
      return;
    }
  }
  await delay(RATE_LIMIT_RETRY_DELAY_MS);
}

function getJitteredDelay(baseMs: number, jitterMs: number): number {
  return baseMs + Math.floor(Math.random() * jitterMs);
}

function getCachedTargetUserId(
  cache: Record<string, { id: string; cachedAt: string }> | undefined,
  username: string
): string | null {
  if (!cache || !cache[username]) return null;
  const cached = cache[username];
  const cachedAt = new Date(cached.cachedAt).getTime();
  const ageHours = (Date.now() - cachedAt) / (1000 * 60 * 60);
  if (Number.isNaN(ageHours) || ageHours > TARGET_ID_CACHE_TTL_HOURS) {
    return null;
  }
  return cached.id;
}

// Agent settings type (matches TypeScript definition)
interface TargetAccountConfig {
  username: string;
  priority?: 'high' | 'medium' | 'low';
  actions?: {
    retweet?: boolean;
    like?: boolean;
    mention?: boolean;
  };
  lastEngagedAt?: string | null;
}

interface ContentFilterConfig {
  keywords?: string[];
  negativeKeywords?: string[];
  minEngagement?: {
    likes?: number;
    retweets?: number;
  };
  sentimentFilter?: 'positive' | 'neutral' | 'all';
  tweetTypes?: ('original' | 'reply' | 'retweet')[];
  topicMatching?: boolean;
}

interface RateLimitConfig {
  maxPerAccountPerDay?: number;
  maxGlobalPerDay?: number;
  cooldownAfterHighEngagement?: {
    threshold: number;
    pauseHours: number;
  };
  safeMode?: boolean;
}

interface SchedulingConfig {
  timezone?: string;
  activeHours?: {
    start: number;
    end: number;
  };
  quietHours?: {
    start: number;
    end: number;
  };
}

interface AgentSettings {
  enabled: boolean;
  targetAccounts: (string | TargetAccountConfig)[];
  actions: {
    retweet: boolean;
    like: boolean;
    mention: boolean;
  };
  frequency: 'daily' | '3days' | 'weekly';
  lastRunAt: string | null;
  contentFilter?: ContentFilterConfig;
  rateLimits?: RateLimitConfig;
  scheduling?: SchedulingConfig;
  targetAccountCursor?: number;
  targetAccountIdCache?: Record<string, { id: string; cachedAt: string }>;
}

interface UserWithAgentSettings {
  id: string;
  twitter_access_token: string | null;
  twitter_refresh_token: string | null;
  twitter_user_id: string | null;
  agent_settings: AgentSettings;
}

interface TwitterTweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  public_metrics?: {
    like_count?: number;
    retweet_count?: number;
    reply_count?: number;
    quote_count?: number;
  };
  in_reply_to_user_id?: string;
  referenced_tweets?: Array<{
    type: 'replied_to' | 'retweeted' | 'quoted';
    id: string;
  }>;
}

interface ProcessResult {
  userId: string;
  status: 'processed' | 'skipped' | 'failed';
  actionsScheduled: number;
  error?: string;
}

function unauthorized() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function createSupabaseAdmin(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Refresh Twitter access token if expired
 */
async function refreshTokenIfNeeded(
  supabaseAdmin: SupabaseClient,
  userId: string,
  accessToken: string,
  refreshToken: string | null
): Promise<string> {
  // Test if current token is valid
  const testResponse = await fetch('https://api.twitter.com/2/users/me', {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (testResponse.ok) {
    return accessToken;
  }

  console.log(`Token invalid for user ${userId}, attempting refresh...`);

  if (!refreshToken) {
    throw new Error('No refresh token available');
  }

  if (!TWITTER_CLIENT_ID || !TWITTER_CLIENT_SECRET) {
    throw new Error('Twitter client credentials not configured');
  }

  const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      client_id: TWITTER_CLIENT_ID,
    }),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error('Token refresh failed:', tokenResponse.status, errorText);
    throw new Error(`Token refresh failed: ${tokenResponse.status}`);
  }

  const tokens = await tokenResponse.json();
  const newAccessToken = tokens.access_token;
  const newRefreshToken = tokens.refresh_token || refreshToken;

  // Update tokens in database
  await supabaseAdmin
    .from('profiles')
    .update({
      twitter_access_token: newAccessToken,
      twitter_refresh_token: newRefreshToken,
    })
    .eq('id', userId);

  console.log(`Token refreshed successfully for user ${userId}`);
  return newAccessToken;
}

/**
 * Convert timezone-aware date to UTC
 */
function toUTC(date: Date, timezone?: string): Date {
  if (!timezone) return date;
  
  // Simple timezone offset conversion (for production, use a proper timezone library)
  // This is a simplified version - in production, use Intl.DateTimeFormat or a library
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  const offset = tzDate.getTime() - utcDate.getTime();
  
  return new Date(date.getTime() - offset);
}

/**
 * Get hour in specific timezone
 */
function getHourInTimezone(date: Date, timezone?: string): number {
  if (!timezone) return date.getUTCHours();
  
  // Convert to timezone-aware hour
  const tzString = date.toLocaleString('en-US', { 
    timeZone: timezone, 
    hour: 'numeric', 
    hour12: false 
  });
  return parseInt(tzString, 10);
}

/**
 * Calculate randomized schedule time based on frequency
 * Adds jitter to avoid detection by Twitter/X
 * Supports timezone-aware scheduling
 */
function calculateRandomizedScheduleTime(
  frequency: 'daily' | '3days' | 'weekly',
  lastRunAt: Date | null,
  schedulingConfig?: SchedulingConfig
): Date {
  const now = new Date();
  const timezone = schedulingConfig?.timezone;
  const activeHours = schedulingConfig?.activeHours || { start: 9, end: 21 };
  const quietHours = schedulingConfig?.quietHours;
  
  // First run optimization: schedule 1-4 hours in future for immediate feedback
  if (!lastRunAt) {
    const minHours = 1;
    const maxHours = 4;
    const randomHours = minHours + Math.random() * (maxHours - minHours);
    let scheduledTime = new Date(now.getTime() + randomHours * 60 * 60 * 1000);
    
    // Ensure within active hours (timezone-aware)
    const hour = getHourInTimezone(scheduledTime, timezone);
    if (hour < activeHours.start) {
      scheduledTime.setUTCHours(activeHours.start, Math.floor(Math.random() * 60), 0);
    }
    if (hour >= activeHours.end) {
      scheduledTime.setUTCHours(activeHours.end - 1, Math.floor(Math.random() * 60), 0);
    }
    
    // Check quiet hours
    if (quietHours) {
      const quietHour = getHourInTimezone(scheduledTime, timezone);
      if (quietHour >= quietHours.start || quietHour < quietHours.end) {
        // Move to after quiet hours
        scheduledTime.setUTCHours(quietHours.end, Math.floor(Math.random() * 60), 0);
      }
    }
    
    return scheduledTime;
  }

  // Subsequent runs - use normal frequency-based delays
  const base = lastRunAt;

  // Define min/max hours for each frequency with jitter
  let minHours: number, maxHours: number;
  switch (frequency) {
    case 'daily':
      minHours = 20;
      maxHours = 28;
      break;
    case '3days':
      minHours = 66;
      maxHours = 78;
      break;
    case 'weekly':
      minHours = 144;
      maxHours = 192; // 6-8 days
      break;
    default:
      minHours = 20;
      maxHours = 28;
  }

  const randomHours = minHours + Math.random() * (maxHours - minHours);
  let scheduledTime = new Date(base.getTime() + randomHours * 60 * 60 * 1000);

  // Ensure within active hours (timezone-aware)
  const hour = getHourInTimezone(scheduledTime, timezone);
  if (hour < activeHours.start) {
    scheduledTime.setUTCHours(activeHours.start, Math.floor(Math.random() * 60), 0);
  }
  if (hour >= activeHours.end) {
    scheduledTime.setUTCHours(activeHours.end - 1, Math.floor(Math.random() * 60), 0);
  }

  // Check quiet hours
  if (quietHours) {
    const quietHour = getHourInTimezone(scheduledTime, timezone);
    if (quietHour >= quietHours.start || quietHour < quietHours.end) {
      // Move to after quiet hours
      scheduledTime.setUTCHours(quietHours.end, Math.floor(Math.random() * 60), 0);
    }
  }

  return scheduledTime;
}

/**
 * Add staggered delay for multiple actions
 */
function addActionDelay(baseTime: Date, actionIndex: number): Date {
  const delayRanges = [
    { min: 0, max: 15 },
    { min: 15, max: 45 },
    { min: 30, max: 90 },
  ];

  const range = delayRanges[actionIndex] || delayRanges[2];
  const randomMinutes = range.min + Math.random() * (range.max - range.min);

  return new Date(baseTime.getTime() + randomMinutes * 60 * 1000);
}

/**
 * Check if it's time to run agent actions based on frequency
 */
function shouldRunAgent(settings: AgentSettings): boolean {
  if (!settings.enabled) return false;
  if (!settings.lastRunAt) return true;

  const lastRun = new Date(settings.lastRunAt);
  const now = new Date();

  // Calculate minimum hours based on frequency (use minimum of the range)
  let minHours: number;
  switch (settings.frequency) {
    case 'daily':
      minHours = 20;
      break;
    case '3days':
      minHours = 66;
      break;
    case 'weekly':
      minHours = 144;
      break;
    default:
      minHours = 20;
  }

  const hoursSinceLastRun = (now.getTime() - lastRun.getTime()) / (1000 * 60 * 60);
  return hoursSinceLastRun >= minHours;
}

/**
 * Fetch user ID by username from Twitter API
 */
async function getTwitterUserIdByUsername(
  username: string,
  accessToken: string
): Promise<{ id: string | null; rateLimited: boolean }> {
  // Add delay before API call to avoid rate limits
  await delay(TWITTER_API_DELAY_MS);
  
  const response = await fetch(
    `https://api.twitter.com/2/users/by/username/${username}`,
    {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    }
  );

  if (!response.ok) {
    const status = response.status;
    if (status === 429) {
      console.warn(`Rate limited fetching user ID for @${username} - retrying once...`);
      await waitForRateLimitReset(response);
      const retry = await fetch(
        `https://api.twitter.com/2/users/by/username/${username}`,
        {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        }
      );
      if (!retry.ok) {
        console.error(`Retry failed fetching user ID for @${username}:`, retry.status);
        return { id: null, rateLimited: retry.status === 429 };
      }
      const retryData = await retry.json();
      return { id: retryData.data?.id || null, rateLimited: false };
    }
    console.error(`Failed to fetch user ID for @${username}:`, status);
    return { id: null, rateLimited: false };
  }

  const data = await response.json();
  return { id: data.data?.id || null, rateLimited: false };
}

/**
 * Fetch recent tweets from a target account with enhanced fields
 */
async function fetchTargetAccountTweets(
  targetUserId: string,
  accessToken: string,
  sinceHours: number = 48
): Promise<{ tweets: TwitterTweet[]; rateLimited: boolean }> {
  // Add delay before API call to avoid rate limits
  await delay(TWITTER_API_DELAY_MS);
  
  const sinceTime = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
  const params = new URLSearchParams({
    max_results: '10',
    'tweet.fields': 'created_at,author_id,public_metrics,in_reply_to_user_id,referenced_tweets',
    start_time: sinceTime.toISOString(),
  });

  const response = await fetch(
    `https://api.twitter.com/2/users/${targetUserId}/tweets?${params}`,
    {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    }
  );

  if (!response.ok) {
    const status = response.status;
    if (status === 429) {
      console.warn(`Rate limited fetching tweets for user ${targetUserId} - retrying once...`);
      await waitForRateLimitReset(response);
      const retry = await fetch(
        `https://api.twitter.com/2/users/${targetUserId}/tweets?${params}`,
        {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        }
      );
      if (!retry.ok) {
        console.error(`Retry failed fetching tweets for user ${targetUserId}:`, retry.status);
        return { tweets: [], rateLimited: retry.status === 429 };
      }
      const retryData = await retry.json();
      return { tweets: retryData.data || [], rateLimited: false };
    }
    console.error(`Failed to fetch tweets for user ${targetUserId}:`, status);
    return { tweets: [], rateLimited: false };
  }

  const data = await response.json();
  return { tweets: data.data || [], rateLimited: false };
}

/**
 * Apply content filtering to tweets
 */
function filterTweets(
  tweets: TwitterTweet[],
  filterConfig?: ContentFilterConfig
): TwitterTweet[] {
  if (!filterConfig) return tweets;

  let filtered = [...tweets];

  // Keyword filtering
  if (filterConfig.keywords && filterConfig.keywords.length > 0) {
    const keywordsLower = filterConfig.keywords.map((k) => k.toLowerCase());
    filtered = filtered.filter((tweet) =>
      keywordsLower.some((keyword) => tweet.text.toLowerCase().includes(keyword))
    );
  }

  // Negative keywords
  if (filterConfig.negativeKeywords && filterConfig.negativeKeywords.length > 0) {
    const negativeKeywordsLower = filterConfig.negativeKeywords.map((k) => k.toLowerCase());
    filtered = filtered.filter(
      (tweet) =>
        !negativeKeywordsLower.some((keyword) =>
          tweet.text.toLowerCase().includes(keyword)
        )
    );
  }

  // Engagement thresholds
  if (filterConfig.minEngagement) {
    filtered = filtered.filter((tweet) => {
      const metrics = tweet.public_metrics || {};
      const likes = metrics.like_count || 0;
      const retweets = metrics.retweet_count || 0;

      if (
        filterConfig.minEngagement!.likes !== undefined &&
        likes < filterConfig.minEngagement!.likes
      ) {
        return false;
      }
      if (
        filterConfig.minEngagement!.retweets !== undefined &&
        retweets < filterConfig.minEngagement!.retweets
      ) {
        return false;
      }
      return true;
    });
  }

  // Tweet type filtering
  if (filterConfig.tweetTypes && filterConfig.tweetTypes.length > 0) {
    filtered = filtered.filter((tweet) => {
      const isReply = !!tweet.in_reply_to_user_id;
      const isRetweet =
        tweet.referenced_tweets?.some((ref) => ref.type === 'retweeted') || false;
      const isOriginal = !isReply && !isRetweet;

      if (isOriginal && filterConfig.tweetTypes!.includes('original')) return true;
      if (isReply && filterConfig.tweetTypes!.includes('reply')) return true;
      if (isRetweet && filterConfig.tweetTypes!.includes('retweet')) return true;
      return false;
    });
  }

  return filtered;
}

/**
 * Fetch thread context for a tweet
 */
async function fetchThreadContext(
  tweetId: string,
  accessToken: string
): Promise<{ conversationId: string; threadTweets: TwitterTweet[] } | null> {
  try {
    // Get the conversation ID from the tweet
    const tweetResponse = await fetch(
      `https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=conversation_id,author_id,public_metrics,in_reply_to_user_id,referenced_tweets`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }
    );

    if (!tweetResponse.ok) return null;

    const tweetData = await tweetResponse.json();
    const conversationId = tweetData.data?.conversation_id;

    if (!conversationId) return null;

    // Fetch conversation thread
    const threadResponse = await fetch(
      `https://api.twitter.com/2/tweets/search/recent?query=conversation_id:${conversationId}&tweet.fields=created_at,author_id,public_metrics,in_reply_to_user_id,referenced_tweets&max_results=10`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }
    );

    if (!threadResponse.ok) return null;

    const threadData = await threadResponse.json();
    const threadTweets = (threadData.data || []) as TwitterTweet[];

    return { conversationId, threadTweets };
  } catch (error) {
    console.error('Error fetching thread context:', error);
    return null;
  }
}

/**
 * Fetch recent agent replies from DB for anti-repetition
 */
async function fetchRecentAgentReplies(
  supabaseAdmin: SupabaseClient,
  userId: string,
  limit: number = 10
): Promise<string[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('scheduled_posts')
      .select('content')
      .eq('user_id', userId)
      .eq('post_type', 'comment')
      .eq('status', 'posted')
      .order('posted_at', { ascending: false })
      .limit(limit);
    
    if (error || !data) {
      console.error('Error fetching recent replies:', error);
      return [];
    }
    
    return data.map((row: { content: string }) => row.content);
  } catch (error) {
    console.error('Error fetching recent replies:', error);
    return [];
  }
}

/**
 * Generate a reply tweet using shared response generation (UNIFIED with chat brain)
 * Now includes personalityMetadata for consistent personality across modes
 */
async function generateMentionReply(
  supabaseAdmin: SupabaseClient,
  userId: string,
  targetTweet: TwitterTweet,
  targetUsername: string,
  characterCard: CharacterCard,
  personalityMetadata: PersonalityMetadata | undefined,
  globalSettings: any,
  accessToken?: string
): Promise<string | null> {
  if (!GROK_API_KEY) {
    console.error('GROK_API_KEY not configured');
    return null;
  }

  // Fetch user preferences for emoji mode and advanced settings
  let emojiMode = false;
  let advancedSettings: any = undefined;
  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('preferences')
      .eq('id', userId)
      .single();
    
    // Merge global settings with user preferences (user overrides global)
    const userPreferences = profile?.preferences || {};
    
    // Emoji mode: user setting overrides global default
    emojiMode = userPreferences.emoji_mode ?? globalSettings?.enable_emoji_mode ?? false;
    if (emojiMode) {
      console.log('🎭 Emoji mode enabled for Twitter reply', userPreferences.emoji_mode ? '(user setting)' : '(global default)');
    }
    
    // Advanced settings: merge global defaults with user overrides
    if (globalSettings) {
      advancedSettings = mergeGlobalWithUserSettings(globalSettings, userPreferences.advanced_settings);
      console.log('⚙️ Advanced settings loaded for Twitter reply (global defaults + user overrides):', Object.keys(advancedSettings).join(', '));
    } else if (userPreferences.advanced_settings) {
      advancedSettings = userPreferences.advanced_settings;
      console.log('⚙️ Advanced settings loaded for Twitter reply (user only):', Object.keys(advancedSettings).join(', '));
    }
  } catch (error) {
    console.error('Error fetching user preferences:', error);
    // Continue with global defaults if fetch fails
    if (globalSettings) {
      advancedSettings = mergeGlobalWithUserSettings(globalSettings, null);
    }
  }

  // Fetch thread context if available (limit to save API calls on free tier)
  let threadContext = '';
  if (accessToken && targetTweet.in_reply_to_user_id) {
    const context = await fetchThreadContext(targetTweet.id, accessToken);
    if (context && context.threadTweets.length > 1) {
      // Build context with tweet text only (limit to 3 for token efficiency)
      const threadTexts = context.threadTweets
        .slice(0, 3)
        .map((t) => `"${t.text}"`)
        .join('\n\n');
      threadContext = `Previous tweets in this conversation:\n${threadTexts}`;
    }
  }

  // Fetch recent replies from DB for anti-repetition (limit for efficiency)
  const recentResponses = await fetchRecentAgentReplies(supabaseAdmin, userId, 5);
  console.log(`Fetched ${recentResponses.length} recent replies for anti-repetition`);

  try {
    // Use shared response generation with Twitter mode (SAME brain as chat)
    // Enable live search for intelligent, contextual replies
    const result = await generateResponse({
      characterCard,
      userMessage: targetTweet.text,
      personalityMetadata, // NOW PASSED: Same personality enhancement as chat
      context: threadContext,
      suggestedAngle: undefined,
      recentResponses,
      minLength: 40, // Shorter replies to reduce tokens and costs
      maxLength: 140,
      enforceOneSentence: false, // Twitter replies can be longer if needed
      mode: 'twitter',
      grokApiKey: GROK_API_KEY,
      targetUsername, // Pass actual username for proper mentions
      emojiMode,
      advancedSettings, // NOW PASSED: Universal advanced settings for Twitter replies
      enableLiveSearch: undefined, // Only enable if detectKnowledgeQuery triggers
      tweetBeingRepliedTo: targetTweet.text, // Pass original tweet for anti-echo detection
    });

    if (!result) {
      return null;
    }

    return result.response;
  } catch (error) {
    console.error('Error generating mention reply:', error);
    return null;
  }
}

/**
 * Check if we've already engaged with a tweet
 */
async function hasAlreadyEngaged(
  supabaseAdmin: SupabaseClient,
  userId: string,
  tweetId: string,
  actionType: string
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('scheduled_posts')
    .select('id')
    .eq('user_id', userId)
    .eq('target_tweet_id', tweetId)
    .eq('post_type', actionType)
    .in('status', ['pending', 'posted'])
    .limit(1);

  return (data?.length || 0) > 0;
}

/**
 * Check rate limits for a user and target account
 */
async function checkRateLimits(
  supabaseAdmin: SupabaseClient,
  userId: string,
  targetAccount: string | null,
  rateLimits?: RateLimitConfig
): Promise<{ allowed: boolean; reason?: string }> {
  if (!rateLimits) return { allowed: true };

  const today = new Date().toISOString().split('T')[0];

  // Check global daily limit
  if (rateLimits.maxGlobalPerDay) {
    const { data: globalData } = await supabaseAdmin
      .from('agent_rate_limit_tracking')
      .select('engagements_today')
      .eq('user_id', userId)
      .is('target_account', null)
      .eq('date', today)
      .single();

    const globalCount = globalData?.engagements_today || 0;
    if (globalCount >= rateLimits.maxGlobalPerDay) {
      return {
        allowed: false,
        reason: `Global daily limit reached (${globalCount}/${rateLimits.maxGlobalPerDay})`,
      };
    }
  }

  // Check per-account limit
  if (targetAccount && rateLimits.maxPerAccountPerDay) {
    const { data: accountData } = await supabaseAdmin
      .from('agent_rate_limit_tracking')
      .select('engagements_today')
      .eq('user_id', userId)
      .eq('target_account', targetAccount)
      .eq('date', today)
      .single();

    const accountCount = accountData?.engagements_today || 0;
    if (accountCount >= rateLimits.maxPerAccountPerDay) {
      return {
        allowed: false,
        reason: `Per-account daily limit reached for @${targetAccount} (${accountCount}/${rateLimits.maxPerAccountPerDay})`,
      };
    }
  }

  // Check cooldown
  if (rateLimits.cooldownAfterHighEngagement) {
    const { data: cooldownData } = await supabaseAdmin
      .from('agent_rate_limit_tracking')
      .select('in_cooldown, cooldown_until')
      .eq('user_id', userId)
      .is('target_account', null)
      .eq('in_cooldown', true)
      .single();

    if (cooldownData?.in_cooldown) {
      const cooldownUntil = cooldownData.cooldown_until
        ? new Date(cooldownData.cooldown_until)
        : null;
      if (cooldownUntil && cooldownUntil > new Date()) {
        return {
          allowed: false,
          reason: `In cooldown until ${cooldownUntil.toISOString()}`,
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * Increment rate limit tracking
 */
async function incrementRateLimit(
  supabaseAdmin: SupabaseClient,
  userId: string,
  targetAccount: string | null,
  actionType: 'retweet' | 'like' | 'comment',
  rateLimits?: RateLimitConfig
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  // Update global tracking
  const { data: globalData } = await supabaseAdmin
    .from('agent_rate_limit_tracking')
    .select('*')
    .eq('user_id', userId)
    .is('target_account', null)
    .eq('date', today)
    .single();

  const globalEngagements = (globalData?.engagements_today || 0) + 1;
  const globalRetweets =
    (globalData?.retweets_today || 0) + (actionType === 'retweet' ? 1 : 0);
  const globalLikes = (globalData?.likes_today || 0) + (actionType === 'like' ? 1 : 0);
  const globalComments =
    (globalData?.comments_today || 0) + (actionType === 'comment' ? 1 : 0);

  // Check for cooldown trigger
  let inCooldown = globalData?.in_cooldown || false;
  let cooldownUntil = globalData?.cooldown_until
    ? new Date(globalData.cooldown_until)
    : null;

  if (
    rateLimits?.cooldownAfterHighEngagement &&
    !inCooldown &&
    globalEngagements >= rateLimits.cooldownAfterHighEngagement.threshold
  ) {
    inCooldown = true;
    cooldownUntil = new Date(
      Date.now() + rateLimits.cooldownAfterHighEngagement.pauseHours * 60 * 60 * 1000
    );
  }

  if (globalData) {
    await supabaseAdmin
      .from('agent_rate_limit_tracking')
      .update({
        engagements_today: globalEngagements,
        retweets_today: globalRetweets,
        likes_today: globalLikes,
        comments_today: globalComments,
        in_cooldown: inCooldown,
        cooldown_until: cooldownUntil?.toISOString() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', globalData.id);
  } else {
    await supabaseAdmin.from('agent_rate_limit_tracking').insert({
      user_id: userId,
      target_account: null,
      date: today,
      engagements_today: globalEngagements,
      retweets_today: globalRetweets,
      likes_today: globalLikes,
      comments_today: globalComments,
      in_cooldown: inCooldown,
      cooldown_until: cooldownUntil?.toISOString() || null,
    });
  }

  // Update per-account tracking
  if (targetAccount) {
    const { data: accountData } = await supabaseAdmin
      .from('agent_rate_limit_tracking')
      .select('*')
      .eq('user_id', userId)
      .eq('target_account', targetAccount)
      .eq('date', today)
      .single();

    const accountEngagements = (accountData?.engagements_today || 0) + 1;
    const accountRetweets =
      (accountData?.retweets_today || 0) + (actionType === 'retweet' ? 1 : 0);
    const accountLikes =
      (accountData?.likes_today || 0) + (actionType === 'like' ? 1 : 0);
    const accountComments =
      (accountData?.comments_today || 0) + (actionType === 'comment' ? 1 : 0);

    if (accountData) {
      await supabaseAdmin
        .from('agent_rate_limit_tracking')
        .update({
          engagements_today: accountEngagements,
          retweets_today: accountRetweets,
          likes_today: accountLikes,
          comments_today: accountComments,
          updated_at: new Date().toISOString(),
        })
        .eq('id', accountData.id);
    } else {
      await supabaseAdmin.from('agent_rate_limit_tracking').insert({
        user_id: userId,
        target_account: targetAccount,
        date: today,
        engagements_today: accountEngagements,
        retweets_today: accountRetweets,
        likes_today: accountLikes,
        comments_today: accountComments,
      });
    }
  }
}

/**
 * Schedule an engagement action
 */
async function scheduleAction(
  supabaseAdmin: SupabaseClient,
  userId: string,
  tweetId: string,
  actionType: 'retweet' | 'like' | 'comment',
  content: string,
  scheduledFor: Date
): Promise<boolean> {
  const { error } = await supabaseAdmin.from('scheduled_posts').insert({
    user_id: userId,
    content: content,
    post_type: actionType,
    scheduled_for: scheduledFor.toISOString(),
    posted_at: null,
    status: 'pending',
    error_message: null,
    target_tweet_id: tweetId,
    post_metadata: {
      platform: 'twitter',
      generated_by: 'agent_mode',
      scheduled_at: new Date().toISOString(),
    },
  });

  if (error) {
    console.error(`Failed to schedule ${actionType}:`, error);
    return false;
  }

  return true;
}

/**
 * Process a single user's agent actions
 */
async function processUserAgentActions(
  supabaseAdmin: SupabaseClient,
  user: UserWithAgentSettings,
  globalSettings: any
): Promise<ProcessResult> {
  const settings = user.agent_settings;
  
  // Merge global settings with user settings (user overrides global)
  const effectiveActions = getEffectiveAgentActions(globalSettings, settings.actions);
  const effectiveFrequency = getEffectiveFrequency(globalSettings, settings.frequency);
  
  // Enhanced logging for debugging user processing
  console.log(`[${user.id}] Processing: enabled=${settings.enabled}, lastRunAt=${settings.lastRunAt}, targets=${settings.targetAccounts.length}, actions=${JSON.stringify(effectiveActions)}, frequency=${effectiveFrequency}`);

  // Check if it's time to run (use effective frequency)
  const effectiveSettings = {
    ...settings,
    frequency: effectiveFrequency,
  };
  if (!shouldRunAgent(effectiveSettings)) {
    console.log(`[${user.id}] Skipped: Not time to run (lastRunAt=${settings.lastRunAt}, frequency=${effectiveFrequency})`);
    return {
      userId: user.id,
      status: 'skipped',
      actionsScheduled: 0,
      error: 'Not time to run yet',
    };
  }

  // Check if user has Twitter connected
  if (!user.twitter_access_token) {
    return {
      userId: user.id,
      status: 'skipped',
      actionsScheduled: 0,
      error: 'Twitter not connected',
    };
  }

  // Check if any actions are enabled (use effective actions)
  if (!effectiveActions.retweet && !effectiveActions.like && !effectiveActions.mention) {
    return {
      userId: user.id,
      status: 'skipped',
      actionsScheduled: 0,
      error: 'No actions enabled',
    };
  }

  // Check if there are target accounts
  if (settings.targetAccounts.length === 0) {
    return {
      userId: user.id,
      status: 'skipped',
      actionsScheduled: 0,
      error: 'No target accounts configured',
    };
  }

  try {
    // Refresh token if needed
    const accessToken = await refreshTokenIfNeeded(
      supabaseAdmin,
      user.id,
      user.twitter_access_token,
      user.twitter_refresh_token
    );

    // Get character card and personality metadata from pre-fetched data (optimized query)
    let characterCard: CharacterCard | null = null;
    let personalityMetadata: PersonalityMetadata | undefined = undefined;
    if (effectiveActions.mention) {
      // Character cards are already fetched in the main query
      const cardData = (user as any).character_cards?.find((card: any) => card.is_active);
      if (cardData?.card_data) {
        characterCard = cardData.card_data as typeof characterCard;
        // Extract personality metadata for UNIFIED brain (same as chat)
        const metadata = cardData.generation_metadata;
        if (metadata) {
          personalityMetadata = {
            signaturePhrases: metadata.signaturePhrases || metadata.analysis_summary?.signature_phrases || [],
            emojiPatterns: metadata.emojiPatterns || metadata.analysis_summary?.emoji_patterns || [],
            humorStyle: metadata.humorStyle || metadata.analysis_summary?.humor_style || '',
            vocabularyLevel: metadata.vocabularyLevel || metadata.analysis_summary?.vocabulary_level || '',
            opinionStyle: metadata.opinionStyle || metadata.analysis_summary?.opinion_style || 'balanced',
          };
        }
      }
    }

    // Helper to get username from target account (handles both string and config)
    const getTargetUsername = (account: string | TargetAccountConfig): string => {
      return typeof account === 'string' ? account : account.username;
    };

    // Helper to get account-specific actions (falls back to global actions)
    const getAccountActions = (
      account: string | TargetAccountConfig,
      globalActions: AgentSettings['actions']
    ): AgentSettings['actions'] => {
      if (typeof account === 'string') return globalActions;
      return account.actions
        ? { ...globalActions, ...account.actions }
        : globalActions;
    };

    let totalActionsScheduled = 0;
    const baseScheduleTime = calculateRandomizedScheduleTime(
      effectiveFrequency,
      null,
      settings.scheduling
    );

    // Process a safe batch of target accounts (rotation ensures all are covered)
    const totalTargets = settings.targetAccounts.length;
    const batchSize = Math.min(MAX_TARGET_ACCOUNTS_PER_RUN, totalTargets);
    const cursor = settings.targetAccountCursor ?? 0;
    const targetAccountsToProcess = Array.from({ length: batchSize }, (_, idx) => {
      return settings.targetAccounts[(cursor + idx) % totalTargets];
    });
    const nextCursor = (cursor + batchSize) % totalTargets;
    const targetIdCache = { ...(settings.targetAccountIdCache || {}) };
    let cacheDirty = false;

    // Process each target account
    for (const targetAccount of targetAccountsToProcess) {
      const targetUsername = getTargetUsername(targetAccount);
      const accountActions = getAccountActions(targetAccount, effectiveActions);
      // Get target user ID (cached when possible)
      let targetUserId = getCachedTargetUserId(targetIdCache, targetUsername);
      if (!targetUserId) {
        const userIdResult = await getTwitterUserIdByUsername(targetUsername, accessToken);
        if (userIdResult.rateLimited) {
          console.warn(`Rate limit reached while resolving @${targetUsername}. Stopping early.`);
          break;
        }
        targetUserId = userIdResult.id;
        if (targetUserId) {
          targetIdCache[targetUsername] = { id: targetUserId, cachedAt: new Date().toISOString() };
          cacheDirty = true;
        }
      }
      if (!targetUserId) {
        console.log(`Could not find Twitter user: @${targetUsername}`);
        continue;
      }

      // Check rate limits for this account
      const rateLimitCheck = await checkRateLimits(
        supabaseAdmin,
        user.id,
        targetUsername,
        settings.rateLimits
      );
      if (!rateLimitCheck.allowed) {
        console.log(
          `Rate limit check failed for @${targetUsername}: ${rateLimitCheck.reason}`
        );
        continue;
      }

      // Fetch recent tweets
      const tweetResult = await fetchTargetAccountTweets(targetUserId, accessToken);
      if (tweetResult.rateLimited) {
        console.warn(`Rate limit reached while fetching tweets for @${targetUsername}. Stopping early.`);
        break;
      }
      const tweets = tweetResult.tweets;
      if (tweets.length === 0) {
        console.log(`No recent tweets from @${targetUsername}`);
        continue;
      }

      // Apply content filtering
      const filteredTweets = filterTweets(tweets, settings.contentFilter);
      if (filteredTweets.length === 0) {
        console.log(`No tweets passed content filter for @${targetUsername}`);
        continue;
      }

      // Process the most recent tweet(s) - limit to 1-2 per account per run
      const tweetsToProcess = filteredTweets.slice(0, 2);
      let actionIndex = 0;

      for (const tweet of tweetsToProcess) {
        // Schedule retweet
        if (accountActions.retweet) {
          const alreadyRetweeted = await hasAlreadyEngaged(
            supabaseAdmin,
            user.id,
            tweet.id,
            'retweet'
          );

          if (!alreadyRetweeted) {
            // Check rate limit before scheduling
            const rateCheck = await checkRateLimits(
              supabaseAdmin,
              user.id,
              targetUsername,
              settings.rateLimits
            );
            if (!rateCheck.allowed) {
              console.log(`Rate limit reached for retweet on @${targetUsername}`);
              continue;
            }

            const scheduledTime = addActionDelay(baseScheduleTime, actionIndex);
            const success = await scheduleAction(
              supabaseAdmin,
              user.id,
              tweet.id,
              'retweet',
              '',
              scheduledTime
            );
            if (success) {
              await incrementRateLimit(
                supabaseAdmin,
                user.id,
                targetUsername,
                'retweet',
                settings.rateLimits
              );
              totalActionsScheduled++;
              actionIndex++;
            }
          }
        }

        // Schedule like
        if (accountActions.like) {
          const alreadyLiked = await hasAlreadyEngaged(
            supabaseAdmin,
            user.id,
            tweet.id,
            'like'
          );

          if (!alreadyLiked) {
            // Check rate limit before scheduling
            const rateCheck = await checkRateLimits(
              supabaseAdmin,
              user.id,
              targetUsername,
              settings.rateLimits
            );
            if (!rateCheck.allowed) {
              console.log(`Rate limit reached for like on @${targetUsername}`);
              continue;
            }

            const scheduledTime = addActionDelay(baseScheduleTime, actionIndex);
            const success = await scheduleAction(
              supabaseAdmin,
              user.id,
              tweet.id,
              'like',
              '',
              scheduledTime
            );
            if (success) {
              await incrementRateLimit(
                supabaseAdmin,
                user.id,
                targetUsername,
                'like',
                settings.rateLimits
              );
              totalActionsScheduled++;
              actionIndex++;
            }
          }
        }

        // Schedule mention/reply
        if (accountActions.mention && characterCard) {
          const alreadyReplied = await hasAlreadyEngaged(
            supabaseAdmin,
            user.id,
            tweet.id,
            'comment'
          );

          if (!alreadyReplied) {
            // Check rate limit before scheduling
            const rateCheck = await checkRateLimits(
              supabaseAdmin,
              user.id,
              targetUsername,
              settings.rateLimits
            );
            if (!rateCheck.allowed) {
              console.log(`Rate limit reached for comment on @${targetUsername}`);
              continue;
            }

            // Generate reply content using UNIFIED brain (same as chat)
            const replyContent = await generateMentionReply(
              supabaseAdmin,
              user.id,
              tweet,
              targetUsername,
              characterCard as CharacterCard,
              personalityMetadata,
              globalSettings,
              accessToken
            );

            if (replyContent) {
              const scheduledTime = addActionDelay(baseScheduleTime, actionIndex);
              const success = await scheduleAction(
                supabaseAdmin,
                user.id,
                tweet.id,
                'comment',
                replyContent,
                scheduledTime
              );
              if (success) {
                await incrementRateLimit(
                  supabaseAdmin,
                  user.id,
                  targetUsername,
                  'comment',
                  settings.rateLimits
                );
                totalActionsScheduled++;
                actionIndex++;
              }
            }
          }
        }
      }

      // Small delay between accounts to reduce rate limit risk
      await delay(getJitteredDelay(ACCOUNT_DELAY_MS, ACCOUNT_DELAY_JITTER_MS));
    }

    // CRITICAL: Single atomic update to avoid race condition where cache/cursor
    // updates get overwritten by a separate lastRunAt update
    const updatedSettings: AgentSettings = {
      ...settings,
      targetAccountCursor: nextCursor,
      targetAccountIdCache: targetIdCache,
      lastRunAt: new Date().toISOString(),
    };

    await supabaseAdmin
      .from('profiles')
      .update({ agent_settings: updatedSettings })
      .eq('id', user.id);
    
    console.log(`[${user.id}] Updated agent_settings: cursor=${nextCursor}, actions=${totalActionsScheduled}, lastRunAt=${updatedSettings.lastRunAt}`);

    return {
      userId: user.id,
      status: 'processed',
      actionsScheduled: totalActionsScheduled,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[${user.id}] Error processing agent actions:`, errorMessage);
    
    // Still update lastRunAt on error to prevent infinite retry loops
    // This ensures we don't hammer the API on the next cron run
    try {
      const failedSettings: AgentSettings = {
        ...settings,
        lastRunAt: new Date().toISOString(),
      };
      await supabaseAdmin
        .from('profiles')
        .update({ agent_settings: failedSettings })
        .eq('id', user.id);
      console.log(`[${user.id}] Updated lastRunAt after error to prevent retry loop`);
    } catch (updateError) {
      console.error(`[${user.id}] Failed to update lastRunAt after error:`, updateError);
    }
    
    return {
      userId: user.id,
      status: 'failed',
      actionsScheduled: 0,
      error: errorMessage,
    };
  }
}

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Optional shared-secret auth (Verify JWT must be DISABLED in Supabase Dashboard for this to work)
  if (CRON_SECRET) {
    let authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || '';

    if (!authHeader) {
      const url = new URL(req.url);
      const authParam = url.searchParams.get('Authorization');
      if (authParam) {
        authHeader = decodeURIComponent(authParam.replace(/\+/g, ' '));
      }
    }

    const expectedHeader = `Bearer ${CRON_SECRET}`;

    if (authHeader.trim() !== expectedHeader.trim()) {
      console.error('Auth mismatch - check CRON_SECRET in Supabase secrets');
      return unauthorized();
    }
  }

  // Health check
  if (req.method === 'GET') {
    return new Response(
      JSON.stringify({ ok: true, service: 'process-agent-actions' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseAdmin = createSupabaseAdmin();

    // Fetch global settings and check for pause/maintenance
    const globalSettings = await getGlobalSettings(supabaseAdmin);
    
    if (isServicePaused(globalSettings)) {
      const message = globalSettings?.maintenance_mode 
        ? 'Agent processing paused: Service is under maintenance'
        : 'Agent processing paused: All agents are paused globally';
      
      console.log(message);
      return new Response(
        JSON.stringify({ 
          processed: 0, 
          skipped: 0,
          failed: 0,
          totalActionsScheduled: 0,
          message,
          results: []
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for manual trigger (single user processing)
    let body: { userId?: string } = {};
    try {
      body = await req.json();
    } catch {
      // Body is optional, continue with normal processing
    }

    // If userId is provided, process only that user (manual trigger)
    if (body.userId) {
      const { data: user, error: userError } = await supabaseAdmin
        .from('profiles')
        .select(`
          id,
          twitter_access_token,
          twitter_refresh_token,
          twitter_user_id,
          agent_settings,
          character_cards!left(card_data, is_active)
        `)
        .eq('id', body.userId)
        .eq('agent_settings->>enabled', 'true')
        .single();

      if (userError || !user) {
        return new Response(
          JSON.stringify({ error: 'user_not_found', details: 'User not found or agent mode not enabled' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const result = await processUserAgentActions(supabaseAdmin, user as UserWithAgentSettings, globalSettings);
      return new Response(
        JSON.stringify({
          processed: result.status === 'processed' ? 1 : 0,
          skipped: result.status === 'skipped' ? 1 : 0,
          failed: result.status === 'failed' ? 1 : 0,
          totalActionsScheduled: result.actionsScheduled,
          results: [result],
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normal processing: Fetch all users with agent mode enabled
    // Optimized: Fetch character cards in same query to reduce database round trips
    const { data: users, error: fetchError } = await supabaseAdmin
      .from('profiles')
      .select(`
        id,
        twitter_access_token,
        twitter_refresh_token,
        twitter_user_id,
        agent_settings,
        character_cards!left(card_data, is_active)
      `)
      .not('agent_settings', 'is', null)
      .eq('agent_settings->>enabled', 'true');

    if (fetchError) {
      console.error('Failed to fetch users with agent mode:', fetchError);
      return new Response(
        JSON.stringify({ error: 'fetch_failed', details: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!users || users.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, results: [], message: 'No users with agent mode enabled' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing agent actions for ${users.length} users...`);

    const results: ProcessResult[] = [];
    
    // Process users in smaller batches to avoid Twitter API rate limits (429)
    // Reduced from 5 to 2 for more conservative rate limiting
    const BATCH_SIZE = 2;
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = (users as UserWithAgentSettings[]).slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} users)...`);
      
      const batchResults = await Promise.all(
        batch.map(async (user) => {
          console.log(`Processing user ${user.id}...`);
          const result = await processUserAgentActions(supabaseAdmin, user, globalSettings);
          console.log(`User ${user.id} result: ${result.status}, actions: ${result.actionsScheduled}`);
          return result;
        })
      );
      
      results.push(...batchResults);
      
      // Add delay between batches to respect rate limits
      if (i + BATCH_SIZE < users.length) {
        console.log(`Waiting ${BATCH_DELAY_MS}ms before next batch to avoid rate limits...`);
        await delay(BATCH_DELAY_MS);
      }
    }

    const processedCount = results.filter((r) => r.status === 'processed').length;
    const skippedCount = results.filter((r) => r.status === 'skipped').length;
    const failedCount = results.filter((r) => r.status === 'failed').length;
    const totalActions = results.reduce((sum, r) => sum + r.actionsScheduled, 0);

    console.log(
      `Agent processing complete: ${processedCount} processed, ${skippedCount} skipped, ${failedCount} failed, ${totalActions} actions scheduled`
    );

    return new Response(
      JSON.stringify({
        processed: processedCount,
        skipped: skippedCount,
        failed: failedCount,
        totalActionsScheduled: totalActions,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Agent processing error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

