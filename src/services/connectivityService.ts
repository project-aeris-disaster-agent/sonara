import { fetchTwitterMetrics } from './twitterApi';
import { getAgentSettings, getAgentActivityStats } from './agentService';
import { getSupabaseUrl, getSupabaseAnonKey } from '@/lib/supabase';

// Session cache for LLM connectivity (checked once per session)
let llmConnectivityCache: {
  status: 'available' | 'unavailable';
  lastChecked: Date;
  error?: string;
} | null = null;

// Cache for Twitter connectivity (5 minutes)
let twitterConnectivityCache: {
  status: 'connected' | 'disconnected';
  lastChecked: Date;
  error?: string;
} | null = null;

const TWITTER_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Check Twitter API connectivity by actually testing the token
 */
export async function checkTwitterConnectivity(
  accessToken: string | null
): Promise<{
  status: 'connected' | 'disconnected' | 'checking';
  lastChecked: Date;
  error?: string;
}> {
  if (!accessToken) {
    return {
      status: 'disconnected',
      lastChecked: new Date(),
      error: 'No token configured',
    };
  }

  // Check cache first
  const now = new Date();
  if (
    twitterConnectivityCache &&
    now.getTime() - twitterConnectivityCache.lastChecked.getTime() < TWITTER_CACHE_DURATION
  ) {
    return {
      ...twitterConnectivityCache,
      status: twitterConnectivityCache.status,
    };
  }

  // Test actual connectivity
  try {
    const metrics = await fetchTwitterMetrics(accessToken);
    
    if (metrics !== null) {
      twitterConnectivityCache = {
        status: 'connected',
        lastChecked: now,
      };
      return {
        status: 'connected',
        lastChecked: now,
      };
    } else {
      twitterConnectivityCache = {
        status: 'disconnected',
        lastChecked: now,
        error: 'Failed to fetch metrics - token may be invalid',
      };
      return {
        status: 'disconnected',
        lastChecked: now,
        error: 'Failed to fetch metrics - token may be invalid',
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    twitterConnectivityCache = {
      status: 'disconnected',
      lastChecked: now,
      error: errorMessage,
    };
    return {
      status: 'disconnected',
      lastChecked: now,
      error: errorMessage,
    };
  }
}

/**
 * Check LLM (Grok API) connectivity
 * Checks once per session, then caches the result
 * Must check again after user logs in next time (cache cleared on page reload)
 */
export async function checkLLMConnectivity(): Promise<{
  status: 'available' | 'unavailable' | 'checking';
  lastChecked: Date;
  error?: string;
}> {
  // Return cached result if available
  if (llmConnectivityCache) {
    return {
      ...llmConnectivityCache,
      status: llmConnectivityCache.status,
    };
  }

  // Test LLM connectivity via a simple Edge Function call
  // We'll use the chat-with-clone endpoint with a minimal test
  const now = new Date();
  
  try {
    const baseUrl = getSupabaseUrl();
    if (!baseUrl) {
      throw new Error('Supabase URL not configured');
    }
    const edgeFunctionUrl = `${baseUrl}/functions/v1/chat-with-clone`;
    const anonKey = getSupabaseAnonKey();
    
    // Make a minimal test request (dry run to avoid Grok usage)
    const response = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${anonKey || ''}`,
      },
      body: JSON.stringify({
        dry_run: true,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (data.grok_configured === false) {
      llmConnectivityCache = {
        status: 'unavailable',
        lastChecked: now,
        error: 'Grok API key not configured',
      };
      return {
        status: 'unavailable',
        lastChecked: now,
        error: 'Grok API key not configured',
      };
    }

    // Service is available (even if the test request fails for other reasons)
    llmConnectivityCache = {
      status: 'available',
      lastChecked: now,
    };
    return {
      status: 'available',
      lastChecked: now,
    };
  } catch (error) {
    // Network error - assume unavailable
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    llmConnectivityCache = {
      status: 'unavailable',
      lastChecked: now,
      error: errorMessage,
    };
    return {
      status: 'unavailable',
      lastChecked: now,
      error: errorMessage,
    };
  }
}

/**
 * Check Agent status
 */
export async function checkAgentStatus(userId: string): Promise<{
  status: 'active' | 'inactive' | 'checking';
  enabled: boolean;
  lastRun: Date | null;
  pendingActions: number;
}> {
  try {
    const agentSettings = await getAgentSettings(userId);
    const agentStats = await getAgentActivityStats(userId);
    
    return {
      status: agentSettings.enabled ? 'active' : 'inactive',
      enabled: agentSettings.enabled,
      lastRun: agentStats.lastRunAt,
      pendingActions: agentStats.pendingActions,
    };
  } catch (error) {
    console.error('Failed to check agent status:', error);
    return {
      status: 'inactive',
      enabled: false,
      lastRun: null,
      pendingActions: 0,
    };
  }
}

/**
 * Clear LLM connectivity cache (call on logout or when needed)
 */
export function clearLLMConnectivityCache(): void {
  llmConnectivityCache = null;
}

/**
 * Clear Twitter connectivity cache (call when needed)
 */
export function clearTwitterConnectivityCache(): void {
  twitterConnectivityCache = null;
}

