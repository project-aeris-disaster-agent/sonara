// src/services/twitterOAuth.ts
// PKCE utilities for Twitter OAuth 2.0

function base64URLEncode(str: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return await crypto.subtle.digest('SHA-256', data);
}

export interface TwitterOAuthConfig {
  clientId: string;
  redirectUri: string;
  scopes?: string[];
}

export interface AuthorizationUrlOptions {
  /** Force Twitter to show the account selection screen (useful for account switching) */
  forceVerify?: boolean;
}

export class TwitterOAuthService {
  private config: TwitterOAuthConfig;

  constructor(config: TwitterOAuthConfig) {
    this.config = config;
  }

  /**
   * Get the configured redirect URI
   * This ensures consistency between authorization and token exchange
   */
  getRedirectUri(): string {
    return this.config.redirectUri;
  }

  /**
   * Generate PKCE code verifier and challenge
   */
  async generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string }> {
    // Generate code verifier (43-128 characters)
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const codeVerifier = base64URLEncode(array.buffer);

    // Generate code challenge
    const codeChallenge = base64URLEncode(await sha256(codeVerifier));

    return { codeVerifier, codeChallenge };
  }

  /**
   * Generate random state for CSRF protection
   */
  generateState(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return base64URLEncode(array.buffer);
  }

  /**
   * Get Twitter OAuth authorization URL
   * 
   * Note: Twitter OAuth 2.0 will always show the login screen on FIRST-TIME authorization,
   * even if the user is already logged into Twitter. This is a security feature by Twitter.
   * After the first authorization, subsequent authorizations should skip the login screen
   * if the user is still logged in and has previously authorized the app.
   * 
   * @param options.forceVerify - When true, clears all cached OAuth state to force a fresh login.
   *                              This is useful for account switching scenarios.
   */
  async getAuthorizationUrl(options?: AuthorizationUrlOptions): Promise<{
    url: string;
    codeVerifier: string;
    state: string;
  }> {
    const { forceVerify = false } = options || {};
    
    // If forceVerify is true, clear all stored OAuth data first
    if (forceVerify) {
      console.log('🔄 Force verify enabled - clearing all OAuth state for account switch');
      this.clearStoredData();
    }
    // Check if there's already an active OAuth flow to prevent loops
    const activeFlowId = sessionStorage.getItem('twitter_oauth_active_flow');
    const activeFlowTimestamp = sessionStorage.getItem('twitter_oauth_active_flow_timestamp');
    
    if (activeFlowId && activeFlowTimestamp) {
      const age = Date.now() - parseInt(activeFlowTimestamp, 10);
      // If flow is less than 30 seconds old, prevent starting a new one
      if (age < 30000) {
        console.warn('⚠️ Active OAuth flow detected, preventing duplicate initiation');
        throw new Error('An OAuth flow is already in progress. Please wait a moment and try again.');
      } else {
        // Clear stale flow
        sessionStorage.removeItem('twitter_oauth_active_flow');
        sessionStorage.removeItem('twitter_oauth_active_flow_timestamp');
      }
    }

    const { codeVerifier, codeChallenge } = await this.generatePKCE();
    const state = this.generateState();

    // Generate unique flow ID to track this specific OAuth attempt
    const flowId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Store code verifier and state in localStorage for better persistence across redirects
    // Also store timestamp to allow cleanup of old entries
    // Use both localStorage and sessionStorage for redundancy
    const timestamp = Date.now().toString();
    try {
      localStorage.setItem('twitter_code_verifier', codeVerifier);
      localStorage.setItem('twitter_state', state);
      localStorage.setItem('twitter_oauth_timestamp', timestamp);
      // Also store in sessionStorage as backup
      sessionStorage.setItem('twitter_code_verifier', codeVerifier);
      sessionStorage.setItem('twitter_state', state);
      sessionStorage.setItem('twitter_oauth_timestamp', timestamp);
    } catch (e) {
      console.error('❌ Failed to store OAuth state in localStorage:', e);
      // Fallback to sessionStorage only
      try {
        sessionStorage.setItem('twitter_code_verifier', codeVerifier);
        sessionStorage.setItem('twitter_state', state);
        sessionStorage.setItem('twitter_oauth_timestamp', timestamp);
        console.warn('⚠️ Using sessionStorage only for OAuth state (localStorage unavailable)');
      } catch (e2) {
        console.error('❌ Failed to store OAuth state in sessionStorage:', e2);
        throw new Error('Failed to store OAuth state. Please check your browser settings.');
      }
    }
    
    // Store active flow in sessionStorage (cleared on tab close, more reliable on mobile)
    sessionStorage.setItem('twitter_oauth_active_flow', flowId);
    sessionStorage.setItem('twitter_oauth_active_flow_timestamp', timestamp);
    
    // Debug logging for production to help diagnose OAuth issues
    console.log('🔐 Twitter OAuth state stored:', {
      state: state.substring(0, 10) + '...',
      timestamp,
      redirectUri: this.config.redirectUri,
      origin: typeof window !== 'undefined' ? window.location.origin : 'unknown',
    });

    // Validate redirect URI format before using it
    try {
      const redirectUriObj = new URL(this.config.redirectUri);
      if (redirectUriObj.protocol !== 'https:' && redirectUriObj.protocol !== 'http:') {
        throw new Error(`Invalid redirect URI protocol: ${redirectUriObj.protocol}`);
      }
    } catch (e) {
      console.error('❌ Invalid redirect URI:', this.config.redirectUri, e);
      throw new Error(`Invalid redirect URI format: ${this.config.redirectUri}. Please check your VITE_TWITTER_REDIRECT_URI environment variable.`);
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: (this.config.scopes || [
        'tweet.read', 
        'tweet.write', 
        'users.read', 
        'like.read',
        'like.write',
        'offline.access'
      ]).join(' '),
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      // Twitter OAuth 2.0 doesn't support 'prompt' parameter
      // First-time authorization will always show login screen (Twitter security feature)
    });

    const url = `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
    
    // Log the exact redirect URI being used for debugging
    console.log('🔗 Twitter OAuth URL generated:', {
      redirectUri: this.config.redirectUri,
      redirectUriLength: this.config.redirectUri.length,
      hasTrailingSlash: this.config.redirectUri.endsWith('/'),
      clientIdPrefix: this.config.clientId.substring(0, 10) + '...',
    });

    // Debug logging (remove in production)
    if (import.meta.env.DEV) {
      console.log('🔗 Twitter OAuth URL:', url.substring(0, 100) + '...');
      console.log('📍 Redirect URI being used:', this.config.redirectUri);
    }

    return { url, codeVerifier, state };
  }

  /**
   * Get stored code verifier from localStorage (with sessionStorage fallback)
   */
  getStoredCodeVerifier(): string | null {
    let verifier: string | null = null;
    let timestamp: string | null = null;
    
    try {
      verifier = localStorage.getItem('twitter_code_verifier');
      timestamp = localStorage.getItem('twitter_oauth_timestamp');
    } catch (e) {
      console.error('❌ Failed to access localStorage:', e);
      // Try sessionStorage as fallback
      try {
        verifier = sessionStorage.getItem('twitter_code_verifier');
        timestamp = sessionStorage.getItem('twitter_oauth_timestamp');
        console.log('⚠️ Using sessionStorage as fallback for code verifier');
      } catch (e2) {
        console.error('❌ Failed to access sessionStorage:', e2);
        return null;
      }
    }
    
    // Clean up if older than 10 minutes (OAuth flows should complete quickly)
    if (timestamp && verifier) {
      const age = Date.now() - parseInt(timestamp, 10);
      if (age > 10 * 60 * 1000) {
        console.warn('⚠️ OAuth state expired, clearing old data');
        this.clearStoredData();
        return null;
      }
    }
    
    return verifier;
  }

  /**
   * Get stored state from localStorage
   */
  getStoredState(): string | null {
    let state: string | null = null;
    let timestamp: string | null = null;
    
    try {
      state = localStorage.getItem('twitter_state');
      timestamp = localStorage.getItem('twitter_oauth_timestamp');
    } catch (e) {
      console.error('❌ Failed to access localStorage:', e);
      // Try sessionStorage as fallback
      try {
        state = sessionStorage.getItem('twitter_state');
        timestamp = sessionStorage.getItem('twitter_oauth_timestamp');
        console.log('⚠️ Using sessionStorage as fallback for state');
      } catch (e2) {
        console.error('❌ Failed to access sessionStorage:', e2);
        return null;
      }
    }
    
    // Clean up if older than 10 minutes
    if (timestamp && state) {
      const age = Date.now() - parseInt(timestamp, 10);
      if (age > 10 * 60 * 1000) {
        console.warn('⚠️ OAuth state expired, clearing old data');
        this.clearStoredData();
        return null;
      }
    }
    
    // Debug logging
    console.log('🔍 Retrieving stored state:', {
      hasState: !!state,
      state: state ? state.substring(0, 10) + '...' : null,
      timestamp,
      age: timestamp ? `${Math.round((Date.now() - parseInt(timestamp, 10)) / 1000)}s` : 'unknown',
      origin: typeof window !== 'undefined' ? window.location.origin : 'unknown',
      storageType: state ? (localStorage.getItem('twitter_state') ? 'localStorage' : 'sessionStorage') : 'none',
    });
    
    return state;
  }

  /**
   * Clear stored OAuth data
   */
  clearStoredData(): void {
    try {
      localStorage.removeItem('twitter_code_verifier');
      localStorage.removeItem('twitter_state');
      localStorage.removeItem('twitter_oauth_timestamp');
    } catch (e) {
      console.warn('⚠️ Failed to clear localStorage:', e);
    }
    
    try {
      sessionStorage.removeItem('twitter_code_verifier');
      sessionStorage.removeItem('twitter_state');
      sessionStorage.removeItem('twitter_oauth_timestamp');
      // Also clear sessionStorage flow tracking
      sessionStorage.removeItem('twitter_oauth_active_flow');
      sessionStorage.removeItem('twitter_oauth_active_flow_timestamp');
      // Clear redirect loop tracking
      sessionStorage.removeItem('twitter_callback_redirect_count');
      sessionStorage.removeItem('twitter_callback_redirect_timestamp');
      // Clear last known Twitter user (for account switching detection)
      sessionStorage.removeItem('sona_last_twitter_user');
    } catch (e) {
      console.warn('⚠️ Failed to clear sessionStorage:', e);
    }
  }

  /**
   * Prepare for account switch by clearing all OAuth state
   * and returning a fresh authorization URL with force verify
   */
  async getAccountSwitchUrl(): Promise<{
    url: string;
    codeVerifier: string;
    state: string;
  }> {
    console.log('🔀 Initiating account switch - clearing all cached state');
    
    // Clear all OAuth state first
    this.clearStoredData();
    
    // Get fresh authorization URL
    return this.getAuthorizationUrl({ forceVerify: true });
  }

  /**
   * Extract authorization code from callback URL
   */
  parseCallbackUrl(url: string): { code: string | null; state: string | null; error: string | null } {
    const urlObj = new URL(url);
    const code = urlObj.searchParams.get('code');
    const state = urlObj.searchParams.get('state');
    const error = urlObj.searchParams.get('error');

    return { code, state, error };
  }
}

// Singleton instance
let twitterOAuthInstance: TwitterOAuthService | null = null;

// Helper function to clean environment variable values
function cleanEnvValue(value: string | undefined): string | undefined {
  if (!value || typeof value !== 'string') return undefined;
  // Remove quotes (both single and double) from start and end
  // Remove any whitespace/newlines
  return value.trim().replace(/^["']|["']$/g, '').trim();
}

export function getTwitterOAuthService(): TwitterOAuthService {
  if (!twitterOAuthInstance) {
    // Get and clean environment variables (remove quotes and whitespace)
    const rawClientId = import.meta.env.VITE_TWITTER_CLIENT_ID;
    const rawRedirectUri = import.meta.env.VITE_TWITTER_REDIRECT_URI;
    const rawScopes = import.meta.env.VITE_TWITTER_SCOPES;

    const clientId = cleanEnvValue(rawClientId);
    
    // In development, always use the current origin (localhost) for redirect URI
    // In production, use the environment variable if set, otherwise fall back to current origin
    let redirectUri: string;
    if (import.meta.env.DEV) {
      // Development mode: always use local origin
      redirectUri = `${window.location.origin}/auth/twitter/callback`;
      console.log('🔧 Development mode detected - using local redirect URI:', redirectUri);
    } else {
      // Production mode: use env var if set, otherwise current origin
      const cleanedEnvRedirectUri = cleanEnvValue(rawRedirectUri);
      redirectUri = cleanedEnvRedirectUri || `${window.location.origin}/auth/twitter/callback`;
      
      // Enhanced logging for production debugging
      console.log('🔧 Production mode - redirect URI resolution:', {
        hasEnvVar: !!rawRedirectUri,
        rawEnvValue: rawRedirectUri ? rawRedirectUri.substring(0, 50) + '...' : null,
        cleanedEnvValue: cleanedEnvRedirectUri,
        currentOrigin: window.location.origin,
        finalRedirectUri: redirectUri,
        envVarLength: rawRedirectUri?.length || 0,
      });
      
      // Warn if using fallback (env var not set)
      if (!cleanedEnvRedirectUri) {
        console.warn('⚠️ VITE_TWITTER_REDIRECT_URI not set in production! Using fallback:', redirectUri);
        console.warn('⚠️ This may cause OAuth failures if the fallback URI is not registered in Twitter Developer Portal.');
      }
    }
    
    // Parse and clean scopes
    let envScopes: string[] = [];
    if (rawScopes) {
      const cleanedScopes = cleanEnvValue(rawScopes);
      if (cleanedScopes) {
        envScopes = cleanedScopes.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
    }
    
    // Include tweet.write for posting capability and like.write for liking tweets
    // Requires: Twitter Developer Portal → Your App → Settings → User authentication settings → App permissions → Read and Write
    const defaultScopes = [
      'tweet.read', 
      'tweet.write', 
      'users.read', 
      'like.read',    // Read likes (for checking if already liked)
      'like.write',   // Like tweets (for agent mode)
      'offline.access'
    ];
    const scopes = [...new Set([...envScopes, ...defaultScopes])];

    if (!clientId) {
      throw new Error('VITE_TWITTER_CLIENT_ID is not set in environment variables');
    }

    // Always log in production to help debug OAuth issues
    console.log('🔐 Twitter OAuth Config:', {
      clientId: clientId.substring(0, 10) + '...',
      redirectUri,
      scopes,
      currentOrigin: window.location.origin,
      hasEnvRedirectUri: !!rawRedirectUri,
      rawClientIdLength: rawClientId?.length || 0,
      cleanedClientIdLength: clientId?.length || 0,
    });

    twitterOAuthInstance = new TwitterOAuthService({
      clientId,
      redirectUri,
      scopes,
    });
  }

  return twitterOAuthInstance;
}

