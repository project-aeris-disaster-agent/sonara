// src/pages/TwitterCallbackPage.tsx
import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getTwitterOAuthService } from '@/services/twitterOAuth';
import { exchangeCodeForTokens } from '@/services/twitterApi';
import { AuthService } from '@/services/auth';
import { supabase } from '@/lib/supabase';
import { Loader2, CheckCircle2, XCircle, RefreshCcw } from 'lucide-react';
import { motion } from 'framer-motion';
import { DitheringShader } from '@/components/ui/dithering-shader';

export function TwitterCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [showSwitchAccountHelp, setShowSwitchAccountHelp] = useState(false);
  
  // Prevent multiple executions on mobile browsers
  const hasProcessedRef = useRef(false);
  const isProcessingRef = useRef(false);

  // Handler for "Try Again" button - clears state and redirects to auth page
  const handleTryAgain = () => {
    console.log('🔄 User clicked Try Again - clearing OAuth state');
    AuthService.clearAllOAuthState();
    navigate('/auth', { replace: true });
  };

  // Handler for "Switch Account" button - initiates fresh OAuth flow
  const handleSwitchAccount = async () => {
    console.log('🔀 User clicked Switch Account - initiating fresh OAuth flow');
    AuthService.clearAllOAuthState();
    
    try {
      const oauthService = getTwitterOAuthService();
      const { url } = await oauthService.getAccountSwitchUrl();
      window.location.replace(url);
    } catch (error) {
      console.error('Error initiating account switch:', error);
      navigate('/auth', { replace: true });
    }
  };

  useEffect(() => {
    // #region agent log
    console.log('[DEBUG-H3,H5] TwitterCallbackPage:useEffect:entry', {hasCode:!!searchParams.get('code'),hasError:!!searchParams.get('error'),hasProcessed:hasProcessedRef.current,isProcessing:isProcessingRef.current,urlPrefix:window.location.href.substring(0,120)});
    // #endregion
    
    // Early validation - if we don't have code or error, don't process
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    
    // Safety check: if we're somehow on Twitter's domain, don't process
    if (window.location.hostname.includes('twitter.com') || window.location.hostname.includes('x.com')) {
      console.error('❌ Callback page loaded on Twitter domain - this should not happen');
      return;
    }
    
    // Check for redirect loop - if we've been redirected here multiple times quickly
    const redirectCount = sessionStorage.getItem('twitter_callback_redirect_count');
    const redirectTimestamp = sessionStorage.getItem('twitter_callback_redirect_timestamp');
    
    // #region agent log
    console.log('[DEBUG-H6,H8] redirectLoopCheck', {redirectCount, redirectTimestamp, now: Date.now()});
    // #endregion
    
    if (redirectCount && redirectTimestamp) {
      const age = Date.now() - parseInt(redirectTimestamp, 10);
      const count = parseInt(redirectCount, 10);
      
      // #region agent log
      console.log('[DEBUG-H6,H8] redirectLoopCheck:eval', {count, age, willBlock: count >= 3 && age < 5000});
      // #endregion
      
      // If we've been redirected here 3+ times in less than 5 seconds, we're in a loop
      if (count >= 3 && age < 5000) {
        console.error('❌ Redirect loop detected! Clearing OAuth state.');
        // #region agent log
        console.log('[DEBUG-H6,H8] LOOP_DETECTED', {count, age});
        // #endregion
        const oauthService = getTwitterOAuthService();
        oauthService.clearStoredData();
        sessionStorage.removeItem('twitter_callback_redirect_count');
        sessionStorage.removeItem('twitter_callback_redirect_timestamp');
        setStatus('error');
        setShowSwitchAccountHelp(true);
        setMessage('We detected a login loop. This often happens when switching between Twitter accounts. Please use the buttons below to retry.');
        hasProcessedRef.current = true;
        // Don't auto-redirect - let user choose action
        return;
      }
      
      // Increment count if within 10 seconds
      if (age < 10000) {
        sessionStorage.setItem('twitter_callback_redirect_count', (count + 1).toString());
      } else {
        // Reset if older than 10 seconds
        sessionStorage.setItem('twitter_callback_redirect_count', '1');
        sessionStorage.setItem('twitter_callback_redirect_timestamp', Date.now().toString());
      }
    } else {
      // First time, initialize
      sessionStorage.setItem('twitter_callback_redirect_count', '1');
      sessionStorage.setItem('twitter_callback_redirect_timestamp', Date.now().toString());
    }
    
    // If no code and no error, this might be an initial load or invalid redirect
    if (!code && !error) {
      console.warn('⚠️ No OAuth parameters found in URL. This might be a direct navigation to the callback page.');
      // Show error after a short delay to allow for potential redirect
      const timeoutId = setTimeout(() => {
        if (!hasProcessedRef.current) {
          setStatus('error');
          setMessage('Invalid OAuth callback. Please try signing in again.');
          setTimeout(() => navigate('/auth', { replace: true }), 3000);
        }
      }, 2000);
      return () => clearTimeout(timeoutId);
    }

    // Prevent multiple executions
    if (hasProcessedRef.current || isProcessingRef.current) {
      console.log('⚠️ Callback already processed or processing, skipping...');
      return;
    }

    // Mark as processing immediately
    isProcessingRef.current = true;

    const handleCallback = async () => {
      try {
        const oauthService = getTwitterOAuthService();
        const code = searchParams.get('code');
        const state = searchParams.get('state');
        const error = searchParams.get('error');

        // Check for error from Twitter
        if (error) {
          // Clear OAuth state on error to prevent loops
          oauthService.clearStoredData();
          sessionStorage.removeItem('twitter_callback_redirect_count');
          sessionStorage.removeItem('twitter_callback_redirect_timestamp');
          setStatus('error');
          setMessage(`Twitter authorization failed: ${error}`);
          setTimeout(() => navigate('/auth', { replace: true }), 3000);
          return;
        }

        // Validate state with detailed error logging
        const storedState = oauthService.getStoredState();
        
        // Enhanced debugging for production
        console.log('🔍 State validation:', {
          receivedState: state ? state.substring(0, 10) + '...' : null,
          storedState: storedState ? storedState.substring(0, 10) + '...' : null,
          statesMatch: state === storedState,
          hasReceivedState: !!state,
          hasStoredState: !!storedState,
          origin: window.location.origin,
          fullUrl: window.location.href,
          localStorageAvailable: typeof Storage !== 'undefined',
          localStorageKeys: typeof Storage !== 'undefined' ? Object.keys(localStorage).filter(k => k.includes('twitter')) : [],
        });
        
        if (!state) {
          setStatus('error');
          setMessage('No state parameter received from Twitter. Please try again.');
          console.error('❌ Missing state parameter in callback URL');
          setTimeout(() => navigate('/auth'), 3000);
          return;
        }
        
        if (!storedState) {
          setStatus('error');
          setShowSwitchAccountHelp(true);
          setMessage('OAuth session expired or not found. This can happen when switching between Twitter accounts. Please try again.');
          console.error('❌ No stored state found in localStorage. This may happen if:', [
            '1. The browser cleared localStorage',
            '2. You opened the callback in a different browser/tab',
            '3. The OAuth flow took longer than 10 minutes',
            '4. There was a domain mismatch between redirects',
            '5. User switched Twitter accounts mid-flow',
          ].join('\n'));
          // Don't auto-redirect - let user choose action
          return;
        }
        
        if (state !== storedState) {
          setStatus('error');
          // State mismatch often occurs when switching accounts
          setShowSwitchAccountHelp(true);
          setMessage('Security validation failed. This often happens when switching Twitter accounts. Please try again or use the "Switch Account" button below.');
          console.error('❌ State mismatch (likely account switch issue):', {
            received: state.substring(0, 20),
            stored: storedState.substring(0, 20),
            receivedLength: state.length,
            storedLength: storedState.length,
          });
          // Don't auto-redirect - let user choose action
          return;
        }

        // Get code verifier
        const codeVerifier = oauthService.getStoredCodeVerifier();
        if (!codeVerifier) {
          setStatus('error');
          setMessage('Code verifier not found. Please try again.');
          setTimeout(() => navigate('/auth'), 3000);
          return;
        }

        if (!code) {
          setStatus('error');
          setMessage('Authorization code not found.');
          setTimeout(() => navigate('/auth'), 3000);
          return;
        }

        // Exchange code for tokens via Supabase Edge Function
        // The Edge Function also fetches user profile (avoids CORS issues)
        // IMPORTANT: Use the same redirect URI from the OAuth service to ensure exact match
        // This prevents "redirect URI mismatch" errors from Twitter
        const redirectUri = oauthService.getRedirectUri();
        console.log('🔗 Using redirect URI from OAuth service:', redirectUri);
        const tokenData = await exchangeCodeForTokens(code, codeVerifier, redirectUri);
        
        // Check for error from Edge Function
        if ((tokenData as any).error) {
          console.error('Edge Function returned error:', (tokenData as any).error);
          const errorDetails = (tokenData as any).details ? ` Details: ${(tokenData as any).details}` : '';
          throw new Error(`${(tokenData as any).error}${errorDetails}`);
        }
        
        // User profile is already included in tokenData from Edge Function
        if (!tokenData.user) {
          console.error('Token data received but no user:', tokenData);
          throw new Error('Failed to fetch Twitter user profile. The Twitter API did not return user information.');
        }
        
        const twitterUser = tokenData.user;
        
        // Log for debugging
        console.log('Token data received:', {
          hasUser: !!tokenData.user,
          hasSupabaseUser: !!tokenData.supabase_user,
          supabaseUser: tokenData.supabase_user,
          twitterUser: twitterUser.username,
        });
        
        // If no supabase_user, Edge Function failed to create user
        if (!tokenData.supabase_user) {
          console.error('Edge Function did not create user. Response:', tokenData);
          throw new Error('Failed to create account. The server could not create your user account. Please try again or contact support.');
        }

        // Clear stored OAuth data immediately to prevent reuse
        oauthService.clearStoredData();
        
        // Clear redirect loop tracking on success
        sessionStorage.removeItem('twitter_callback_redirect_count');
        sessionStorage.removeItem('twitter_callback_redirect_timestamp');
        
        // Mark as processed to prevent re-execution
        hasProcessedRef.current = true;

        // Edge Function creates/finds user with admin privileges (bypasses email validation)
        let user;
        if (tokenData.supabase_user) {
          const isExistingUser = tokenData.supabase_user.is_existing;
          console.log(`${isExistingUser ? 'Existing' : 'New'} user detected:`, tokenData.supabase_user.email);

          // Both new and existing users now get a temporary password from Edge Function
          if (tokenData.supabase_user.password) {
            const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
              email: tokenData.supabase_user.email,
              password: tokenData.supabase_user.password,
            });

            if (signInError || !authData.user) {
              console.error('Sign in failed:', signInError);
              throw new Error(`Failed to sign in: ${signInError?.message || 'Unknown error'}`);
            }

            user = authData.user;
            console.log('Successfully signed in user:', user.id);
          } else {
            // Fallback: Edge Function couldn't set password, check if already signed in
            const { data: { user: currentUser } } = await supabase.auth.getUser();
            
            if (currentUser && currentUser.id === tokenData.supabase_user.id) {
              user = currentUser;
            } else {
              throw new Error('Authentication failed. Please try again.');
            }
          }
        } else {
          throw new Error('Server did not return user information. Please try again.');
        }

        if (!user) {
          throw new Error('Failed to authenticate user. Please try again.');
        }

        // Store Twitter tokens and profile in Supabase
        const { error: linkError } = await AuthService.linkTwitterAccount({
          twitter_user_id: twitterUser.id,
          twitter_username: twitterUser.username,
          twitter_access_token: tokenData.access_token,
          twitter_refresh_token: tokenData.refresh_token,
        });

        if (linkError) {
          throw new Error('Failed to save Twitter connection. Please try again.');
        }

        // Update profile with Twitter info
        await AuthService.updateProfile({
          full_name: twitterUser.name || user.user_metadata?.full_name || undefined,
          profile_photo_url: twitterUser.profile_image_url ?? undefined,
        });

        setStatus('success');
        setMessage(`Successfully connected to Twitter as @${twitterUser.username}! Redirecting...`);

        // Redirect to home/dashboard immediately (no delay)
        navigate('/home', { replace: true });

      } catch (error) {
        console.error('Twitter callback error:', error);
        // Mark as processed even on error to prevent retry loops
        hasProcessedRef.current = true;
        setStatus('error');
        setMessage(error instanceof Error ? error.message : 'An error occurred during authentication');
        setTimeout(() => navigate('/auth'), 3000);
      } finally {
        // Always clear processing flag
        isProcessingRef.current = false;
      }
    };

    handleCallback();
    
    // Cleanup function to reset processing flag if component unmounts
    return () => {
      // Don't reset hasProcessedRef - we want to prevent re-processing
      // Only reset isProcessingRef if we're still processing
      if (isProcessingRef.current && !hasProcessedRef.current) {
        isProcessingRef.current = false;
      }
    };
  }, [searchParams, navigate]);

  return (
    <div className="relative flex h-screen w-full items-center justify-center overflow-hidden">
      {/* Background Shader - Full screen fixed - matching AuthPage */}
      <DitheringShader 
        shape="wave"
        type="8x8"
        colorBack="#001122"
        colorFront="#ff0088"
        pxSize={3}
        speed={0.6}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          zIndex: 0,
        }}
      />
      
      {/* Floating Content Container - matching AuthPage style */}
      <div className="fixed inset-0 z-20 flex items-center justify-center p-4 sm:p-6 md:p-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="relative w-full max-w-md"
        >
          {/* Card Container - matching NewAuthCard style */}
          <div className="relative bg-black/60 backdrop-blur-xl rounded-2xl border border-cyan-400/30 p-8 shadow-2xl shadow-cyan-500/10">
            {/* Decorative gradient border effect */}
            <div className="absolute -inset-[1px] rounded-2xl overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-pink-600/20 via-cyan-500/20 to-pink-600/20 opacity-0 transition-opacity duration-300" />
            </div>
            
            <div className="relative z-10 flex flex-col items-center justify-center space-y-6 text-center">
              {status === 'loading' && (
                <>
                  <div className="relative">
                    <div className="p-4 rounded-full bg-gradient-to-r from-pink-600/20 to-cyan-500/20 border border-white/10">
                      <Loader2 className="h-12 w-12 animate-spin text-cyan-400" />
                    </div>
                    <motion.div
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-cyan-400"
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-xl font-bold text-white">Completing Twitter authentication...</h2>
                    <p className="text-white/60 text-sm">Please wait while we connect your account</p>
                  </div>
                  <div className="flex gap-1 mt-4">
                    <motion.div
                      className="w-2 h-2 rounded-full bg-cyan-400"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.5, repeat: Infinity, delay: 0 }}
                    />
                    <motion.div
                      className="w-2 h-2 rounded-full bg-pink-500"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.5, repeat: Infinity, delay: 0.3 }}
                    />
                    <motion.div
                      className="w-2 h-2 rounded-full bg-cyan-400"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.5, repeat: Infinity, delay: 0.6 }}
                    />
                  </div>
                </>
              )}
              {status === 'success' && (
                <>
                  <div className="relative">
                    <div className="p-4 rounded-full bg-gradient-to-r from-green-500/20 to-cyan-500/20 border border-green-500/30">
                      <CheckCircle2 className="h-12 w-12 text-green-400" />
                    </div>
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.2, type: "spring" }}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-400"
                    />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-xl font-bold text-white">Authentication Successful!</h2>
                    <p className="text-white/80 text-sm">{message}</p>
                  </div>
                </>
              )}
              {status === 'error' && (
                <>
                  <div className="relative">
                    <div className="p-4 rounded-full bg-gradient-to-r from-red-500/20 to-pink-500/20 border border-red-500/30">
                      <XCircle className="h-12 w-12 text-red-400" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-xl font-bold text-white">Authentication Failed</h2>
                    <p className="text-white/80 text-sm">{message}</p>
                    
                    {/* Action buttons */}
                    <div className="flex flex-col gap-2 mt-4">
                      <button
                        onClick={handleTryAgain}
                        className="px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-white text-sm transition-colors flex items-center justify-center gap-2"
                      >
                        <RefreshCcw className="w-4 h-4" />
                        Try Again
                      </button>
                      
                      {showSwitchAccountHelp && (
                        <button
                          onClick={handleSwitchAccount}
                          className="px-4 py-2 bg-gradient-to-r from-pink-600/80 to-cyan-500/80 hover:from-pink-600 hover:to-cyan-500 rounded-lg text-white text-sm font-medium transition-colors"
                        >
                          Switch Twitter Account
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

