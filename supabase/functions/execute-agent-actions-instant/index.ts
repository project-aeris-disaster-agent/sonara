// Supabase Edge Function: Execute Agent Mode actions instantly (Easter Egg)
// Triggered manually to test agent functionality immediately
// Executes retweet, like, and mention/reply actions without scheduling

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateResponse, type CharacterCard, type PersonalityMetadata } from '../_shared/generateResponse.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
const TWITTER_API_DELAY_MS = 1000; // 1 second between Twitter API calls
const ACCOUNT_DELAY_MS = 1500; // 1.5 seconds between target accounts
const RATE_LIMIT_RETRY_DELAY_MS = 5000; // 5 seconds before retry on 429
const RATE_LIMIT_MAX_WAIT_MS = 30000; // Cap wait to 30s to avoid long stalls

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

const TARGET_ID_CACHE_TTL_HOURS = 168; // 7 days

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

interface AgentSettings {
  enabled: boolean;
  targetAccounts: string[];
  actions: {
    retweet: boolean;
    like: boolean;
    mention: boolean;
  };
  frequency: 'daily' | '3days' | 'weekly';
  lastRunAt: string | null;
  targetAccountIdCache?: Record<string, { id: string; cachedAt: string }>;
}

interface TwitterTweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
}

interface ExecutionResult {
  action: 'retweet' | 'like' | 'comment';
  tweetId: string;
  targetAccount: string;
  success: boolean;
  error?: string;
  postId?: string;
  alreadyDone?: boolean;
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
  const testResponse = await fetch('https://api.twitter.com/2/users/me', {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (testResponse.ok) {
    return accessToken;
  }

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
    throw new Error(`Token refresh failed: ${tokenResponse.status}`);
  }

  const tokens = await tokenResponse.json();
  const newAccessToken = tokens.access_token;
  const newRefreshToken = tokens.refresh_token || refreshToken;

  await supabaseAdmin
    .from('profiles')
    .update({
      twitter_access_token: newAccessToken,
      twitter_refresh_token: newRefreshToken,
    })
    .eq('id', userId);

  return newAccessToken;
}

/**
 * Get Twitter user ID by username
 */
async function getTwitterUserIdByUsername(
  username: string,
  accessToken: string
): Promise<{ id: string | null; rateLimited: boolean }> {
  await delay(TWITTER_API_DELAY_MS);
  const response = await fetch(
    `https://api.twitter.com/2/users/by/username/${username}`,
    {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    }
  );

  if (!response.ok) {
    if (response.status === 429) {
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
    return { id: null, rateLimited: false };
  }

  const data = await response.json();
  return { id: data.data?.id || null, rateLimited: false };
}

/**
 * Fetch recent tweets from a target account
 */
async function fetchTargetAccountTweets(
  targetUserId: string,
  accessToken: string,
  sinceHours: number = 24
): Promise<{ tweets: TwitterTweet[]; rateLimited: boolean }> {
  await delay(TWITTER_API_DELAY_MS);
  const sinceTime = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
  const params = new URLSearchParams({
    max_results: '5',
    'tweet.fields': 'created_at,author_id',
    start_time: sinceTime.toISOString(),
  });

  const response = await fetch(
    `https://api.twitter.com/2/users/${targetUserId}/tweets?${params}`,
    {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    }
  );

  if (!response.ok) {
    if (response.status === 429) {
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
    return { tweets: [], rateLimited: false };
  }

  const data = await response.json();
  return { tweets: data.data || [], rateLimited: false };
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
      return [];
    }
    
    return data.map((row: { content: string }) => row.content);
  } catch (error) {
    console.error('Error fetching recent replies:', error);
    return [];
  }
}

/**
 * Generate a reply using shared response generation (UNIFIED with chat brain)
 * Now includes personalityMetadata for consistent personality across modes
 */
async function generateMentionReply(
  supabaseAdmin: SupabaseClient,
  userId: string,
  targetTweet: TwitterTweet,
  targetUsername: string,
  characterCard: CharacterCard,
  personalityMetadata?: PersonalityMetadata
): Promise<string | null> {
  if (!GROK_API_KEY) {
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
    
    if (profile?.preferences?.emoji_mode === true) {
      emojiMode = true;
      console.log('🎭 Emoji mode enabled for Twitter reply');
    }
    
    if (profile?.preferences?.advanced_settings) {
      advancedSettings = profile.preferences.advanced_settings;
      console.log('⚙️ Advanced settings loaded for Twitter reply:', Object.keys(advancedSettings).join(', '));
    }
  } catch (error) {
    console.error('Error fetching user preferences:', error);
    // Continue with defaults if fetch fails
  }

  // Fetch recent replies from DB for anti-repetition (limit for efficiency)
  const recentResponses = await fetchRecentAgentReplies(supabaseAdmin, userId, 5);

  try {
    // Use shared response generation with Twitter mode (SAME brain as chat)
    // Enable live search for intelligent, contextual replies
    const result = await generateResponse({
      characterCard,
      userMessage: targetTweet.text,
      personalityMetadata, // NOW PASSED: Same personality enhancement as chat
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
 * Check if user has already retweeted a tweet
 */
async function hasRetweeted(
  accessToken: string,
  twitterUserId: string,
  tweetId: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.twitter.com/2/users/${twitterUserId}/retweets?ids=${tweetId}`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }
    );
    
    if (!response.ok) return false;
    
    const data = await response.json();
    return (data.data?.length || 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Check if user has already liked a tweet
 */
async function hasLiked(
  accessToken: string,
  twitterUserId: string,
  tweetId: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.twitter.com/2/users/${twitterUserId}/likes?ids=${tweetId}`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }
    );
    
    if (!response.ok) return false;
    
    const data = await response.json();
    return (data.data?.length || 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Execute retweet action
 */
async function executeRetweet(
  accessToken: string,
  twitterUserId: string,
  tweetId: string
): Promise<{ success: boolean; error?: string; alreadyDone?: boolean }> {
  // Check if already retweeted
  const alreadyRetweeted = await hasRetweeted(accessToken, twitterUserId, tweetId);
  if (alreadyRetweeted) {
    return { success: true, alreadyDone: true };
  }

  const response = await fetch(
    `https://api.twitter.com/2/users/${twitterUserId}/retweets`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ tweet_id: tweetId }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = errorText;
    
    // Try to parse JSON error for better message
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.errors && errorJson.errors.length > 0) {
        errorMessage = errorJson.errors[0].message || errorText;
      } else if (errorJson.detail) {
        errorMessage = errorJson.detail;
      } else if (errorJson.title) {
        errorMessage = errorJson.title;
      }
    } catch {
      // Keep original error text if not JSON
    }
    
    // Check for "already retweeted" type errors
    const lowerError = errorMessage.toLowerCase();
    if (lowerError.includes('already') || lowerError.includes('duplicate') || 
        lowerError.includes('cannot retweet')) {
      return { success: true, alreadyDone: true };
    }
    
    return { success: false, error: `Twitter API ${response.status}: ${errorMessage.substring(0, 200)}` };
  }

  return { success: true };
}

/**
 * Execute like action
 */
async function executeLike(
  accessToken: string,
  twitterUserId: string,
  tweetId: string
): Promise<{ success: boolean; error?: string; alreadyDone?: boolean }> {
  // Check if already liked
  const alreadyLiked = await hasLiked(accessToken, twitterUserId, tweetId);
  if (alreadyLiked) {
    return { success: true, alreadyDone: true };
  }

  const response = await fetch(
    `https://api.twitter.com/2/users/${twitterUserId}/likes`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ tweet_id: tweetId }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = errorText;
    
    // Try to parse JSON error for better message
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.errors && errorJson.errors.length > 0) {
        errorMessage = errorJson.errors[0].message || errorText;
      } else if (errorJson.detail) {
        errorMessage = errorJson.detail;
      } else if (errorJson.title) {
        errorMessage = errorJson.title;
      }
    } catch {
      // Keep original error text if not JSON
    }
    
    // Check for "already liked" type errors
    const lowerError = errorMessage.toLowerCase();
    if (lowerError.includes('already') || lowerError.includes('duplicate') || 
        lowerError.includes('cannot like')) {
      return { success: true, alreadyDone: true };
    }
    
    return { success: false, error: `Twitter API ${response.status}: ${errorMessage.substring(0, 200)}` };
  }

  return { success: true };
}

/**
 * Execute comment/reply action
 */
async function executeComment(
  accessToken: string,
  tweetId: string,
  content: string
): Promise<{ success: boolean; postId?: string; error?: string }> {
  const response = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      text: content,
      reply: { in_reply_to_tweet_id: tweetId },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return { success: false, error: `Twitter API ${response.status}: ${errorText.substring(0, 200)}` };
  }

  const data = await response.json();
  return { success: true, postId: data.data?.id };
}

/**
 * Execute instant agent actions for a user
 */
async function executeInstantAgentActions(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<ExecutionResult[]> {
  // Get user profile with agent settings
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('twitter_access_token, twitter_refresh_token, twitter_user_id, agent_settings')
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    throw new Error('User profile not found');
  }

  const agentSettings = profile.agent_settings as AgentSettings | null;
  if (!agentSettings || !agentSettings.enabled) {
    throw new Error('Agent mode not enabled');
  }

  if (!profile.twitter_access_token) {
    throw new Error('Twitter not connected');
  }

  if (agentSettings.targetAccounts.length === 0) {
    throw new Error('No target accounts configured');
  }

  // Refresh token if needed
  const accessToken = await refreshTokenIfNeeded(
    supabaseAdmin,
    userId,
    profile.twitter_access_token,
    profile.twitter_refresh_token
  );

  // Get character card and personality metadata for UNIFIED brain
  let characterCard: CharacterCard | null = null;
  let personalityMetadata: PersonalityMetadata | undefined = undefined;
  if (agentSettings.actions.mention) {
    const { data: cardData } = await supabaseAdmin
      .from('character_cards')
      .select('card_data, generation_metadata')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    if (cardData?.card_data) {
      characterCard = cardData.card_data as typeof characterCard;
      // Extract personality metadata for UNIFIED brain (same as chat)
      const metadata = cardData.generation_metadata as Record<string, any> | null;
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

  const results: ExecutionResult[] = [];
  const targetIdCache = { ...(agentSettings.targetAccountIdCache || {}) };
  let cacheDirty = false;

  // Process each target account (rate limiting handled by delays/retries)
  for (const targetUsername of agentSettings.targetAccounts) {
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
      continue;
    }

    // Get most recent tweet
    const tweetResult = await fetchTargetAccountTweets(targetUserId, accessToken, 24);
    if (tweetResult.rateLimited) {
      console.warn(`Rate limit reached while fetching tweets for @${targetUsername}. Stopping early.`);
      break;
    }
    const tweets = tweetResult.tweets;
    if (tweets.length === 0) {
      continue;
    }

    const tweet = tweets[0]; // Use most recent tweet

    // Execute retweet
    if (agentSettings.actions.retweet) {
      const result = await executeRetweet(accessToken, profile.twitter_user_id || '', tweet.id);
      results.push({
        action: 'retweet',
        tweetId: tweet.id,
        targetAccount: targetUsername,
        success: result.success,
        error: result.error,
        alreadyDone: result.alreadyDone,
      });
      
      // Small delay between actions
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Execute like
    if (agentSettings.actions.like) {
      const result = await executeLike(accessToken, profile.twitter_user_id || '', tweet.id);
      results.push({
        action: 'like',
        tweetId: tweet.id,
        targetAccount: targetUsername,
        success: result.success,
        error: result.error,
        alreadyDone: result.alreadyDone,
      });
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Execute mention/reply using UNIFIED brain (same as chat)
    if (agentSettings.actions.mention && characterCard) {
      const replyContent = await generateMentionReply(
        supabaseAdmin,
        userId,
        tweet,
        targetUsername,
        characterCard as CharacterCard,
        personalityMetadata
      );

      if (replyContent) {
        const result = await executeComment(accessToken, tweet.id, replyContent);
        results.push({
          action: 'comment',
          tweetId: tweet.id,
          targetAccount: targetUsername,
          success: result.success,
          error: result.error,
          postId: result.postId,
        });
      }
    }

    // Small delay between accounts to reduce rate limit risk
    await delay(ACCOUNT_DELAY_MS);
  }

  if (cacheDirty) {
    await supabaseAdmin
      .from('profiles')
      .update({
        agent_settings: {
          ...agentSettings,
          targetAccountIdCache: targetIdCache,
        },
      })
      .eq('id', userId);
  }

  return results;
}

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Health check
  if (req.method === 'GET') {
    return new Response(
      JSON.stringify({ ok: true, service: 'execute-agent-actions-instant' }),
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
    const { userId } = await req.json();

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'userId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createSupabaseAdmin();
    const results = await executeInstantAgentActions(supabaseAdmin, userId);

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return new Response(
      JSON.stringify({
        success: true,
        executed: results.length,
        succeeded: successCount,
        failed: failCount,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Instant agent execution error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

