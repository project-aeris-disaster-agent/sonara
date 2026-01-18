# Twitter OAuth Production Debugging Guide

## Issue
Twitter authentication works on localhost but fails in production deployment.

## Changes Made
1. **Enhanced Logging**: Added detailed console logs to track:
   - Redirect URI resolution (env var vs fallback)
   - State validation process
   - Storage access (localStorage vs sessionStorage)
   - OAuth configuration

2. **Storage Fallback**: Added sessionStorage as backup when localStorage is unavailable or blocked

3. **Better Error Handling**: Improved error messages and warnings for storage failures

## How to Debug

### Step 1: Check Browser Console
Open the browser console (F12) on the production site and look for:

1. **OAuth Config Log** (when page loads):
   ```
   🔐 Twitter OAuth Config: {
     clientId: "...",
     redirectUri: "...",
     currentOrigin: "...",
     hasEnvRedirectUri: true/false
   }
   ```

2. **Redirect URI Resolution** (in production):
   ```
   🔧 Production mode - redirect URI resolution: {
     hasEnvVar: true/false,
     finalRedirectUri: "...",
     ...
   }
   ```

3. **State Validation** (on callback):
   ```
   🔍 State validation: {
     statesMatch: true/false,
     hasStoredState: true/false,
     localStorageKeys: [...]
   }
   ```

### Step 2: Verify Environment Variables
Check that `VITE_TWITTER_REDIRECT_URI` is set correctly in Vercel:

```bash
vercel env ls | Select-String "TWITTER_REDIRECT"
```

The redirect URI should be:
- **Exactly** `https://sonara-rust.vercel.app/auth/twitter/callback`
- Must match **exactly** what's registered in Twitter Developer Portal
- No trailing slashes (unless registered with one)
- Must use HTTPS

### Step 3: Check Twitter Developer Portal
1. Go to https://developer.twitter.com/en/portal/dashboard
2. Select your app
3. Go to **Settings** → **User authentication settings**
4. Check **Callback URI / Redirect URL** section
5. Ensure it matches exactly: `https://sonara-rust.vercel.app/auth/twitter/callback`

### Step 4: Common Issues

#### Issue: "OAuth session expired or not found"
**Cause**: localStorage was cleared or blocked between redirects
**Solution**: 
- Check browser console for storage errors
- Try in incognito/private mode
- Check if browser extensions are blocking storage
- The code now uses sessionStorage as fallback

#### Issue: "State mismatch"
**Cause**: State stored in one domain but retrieved from another
**Solution**:
- Ensure redirect URI matches exactly
- Check that you're not being redirected to a different domain
- Clear browser cache and try again

#### Issue: "Redirect URI mismatch" (from Twitter)
**Cause**: Redirect URI in code doesn't match Twitter Developer Portal
**Solution**:
- Verify `VITE_TWITTER_REDIRECT_URI` in Vercel matches Twitter portal
- Check console logs for the actual redirect URI being used
- Ensure no trailing slashes or protocol mismatches

#### Issue: "VITE_TWITTER_REDIRECT_URI not set"
**Cause**: Environment variable missing in Vercel
**Solution**:
```bash
echo "https://sonara-rust.vercel.app/auth/twitter/callback" | vercel env add VITE_TWITTER_REDIRECT_URI production
```

### Step 5: Test Flow
1. Open production site
2. Open browser console (F12)
3. Click "Sign in with X"
4. Watch console logs:
   - Should see redirect URI being used
   - Should see state being stored
5. After Twitter redirects back:
   - Check if state is retrieved
   - Check if states match
   - Look for any error messages

## Expected Console Output (Success)

```
🔐 Twitter OAuth Config: {
  clientId: "TGtVM2p...",
  redirectUri: "https://sonara-rust.vercel.app/auth/twitter/callback",
  currentOrigin: "https://sonara-rust.vercel.app",
  hasEnvRedirectUri: true
}

🔗 Twitter OAuth URL generated: {
  redirectUri: "https://sonara-rust.vercel.app/auth/twitter/callback",
  ...
}

🔍 Retrieving stored state: {
  hasState: true,
  state: "abc123...",
  origin: "https://sonara-rust.vercel.app"
}

🔍 State validation: {
  statesMatch: true,
  hasStoredState: true,
  ...
}
```

## Next Steps
If issue persists after checking above:
1. Share browser console logs
2. Check Vercel deployment logs
3. Verify Supabase Edge Function logs for token exchange errors
4. Test with a fresh browser session (incognito)
