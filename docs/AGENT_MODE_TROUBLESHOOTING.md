# Agent Mode Troubleshooting Guide

## Free Tier Limits

### Supabase Free Tier
| Resource | Limit | Our Usage |
|----------|-------|-----------|
| Database Size | 500 MB | ~50 MB estimated |
| Edge Function Invocations | 500,000/month | ~8,640/month (cron only) |
| Edge Function Execution Time | 400,000 seconds/month | ~720 min/month |
| pg_cron Jobs | Unlimited | 2 active jobs |
| API Requests | 50,000/month | Variable by usage |
| Bandwidth | 2 GB/month | Variable |

### Vercel Free Tier (Hobby)
| Resource | Limit | Notes |
|----------|-------|-------|
| Serverless Function Invocations | 100,000/month | Cron runs once daily |
| Edge Function Invocations | 500,000/month | N/A |
| Execution Duration | 10s max | Our cron proxies to Supabase |
| Cron Jobs | 2 max, once/day | Using 1 (`/api/cron/process-agent`) |

### Twitter API Free Tier
| Resource | Limit | Notes |
|----------|-------|-------|
| Tweets per month | 1,500 | Includes retweets, replies |
| Reads (home timeline) | Limited | Rate limited aggressively |
| User lookup | 100/15min | For resolving @usernames |
| Tweet timeline | 75/15min | For fetching target tweets |

## Architecture Overview

```
[User enables Agent Mode]
         |
         v
[profiles.agent_settings.enabled = true]
         |
    (pg_cron every 6h)
         |
         v
[process-agent-actions Edge Function]
    - Fetches all enabled users
    - For each user:
      - Refreshes Twitter token
      - Fetches tweets from target accounts
      - Schedules actions in scheduled_posts table
         |
    (pg_cron every 5min)
         |
         v
[process-scheduled-posts Edge Function]
    - Picks up pending posts with scheduled_for <= NOW()
    - Executes Twitter API calls
    - Updates status to posted/failed
```

## Common Issues & Fixes

### Issue: User has agent_enabled=true but 0 actions scheduled

**Symptoms:**
- `agent_settings.lastRunAt` is null or very old
- No entries in `scheduled_posts` for this user

**Causes:**
1. Token refresh failed silently
2. Target accounts have no recent tweets (48h window)
3. Rate limiting during tweet fetch
4. Settings persistence bug (fixed in this version)

**Fix:**
```sql
-- Reset user to trigger re-processing on next cron run
UPDATE profiles 
SET agent_settings = agent_settings || '{"lastRunAt": null}'::jsonb
WHERE id = 'user-uuid-here';
```

### Issue: Actions show as "overdue" but not executing

**Symptoms:**
- Posts in UI show as overdue
- `scheduled_posts.status = 'pending'` with `scheduled_for` in the past

**Explanation:**
The cron runs every 5 minutes. Up to 5 minutes of "overdue" is normal behavior.
Posts scheduled at 13:07 will be picked up at the 13:10 cron run.

**Verify cron is running:**
```sql
SELECT jobid, jobname, schedule, active 
FROM cron.job;

-- Check recent runs
SELECT runid, jobid, status, start_time, return_message 
FROM cron.job_run_details 
WHERE jobid = 3 -- process-scheduled-posts
ORDER BY start_time DESC 
LIMIT 10;
```

### Issue: Actions fail with "Twitter API 400"

**Symptoms:**
- `scheduled_posts.error_message` = "Twitter API 400: One or more parameters to your request was invalid."

**Causes:**
1. Target tweet was deleted
2. User already retweeted/liked this tweet
3. Invalid tweet ID stored

**Fix:**
No automatic fix - these are legitimate Twitter rejections. The retry mechanism will attempt 3 times before marking as failed.

### Issue: Token refresh failures

**Symptoms:**
- Logs show "Token refresh failed: 401"
- User's agent actions stop working

**Fix:**
User needs to re-authenticate Twitter in the app. The access token has been revoked or expired beyond refresh capability.

## Diagnostic Queries

### Check stuck users (agent enabled but no actions)
```sql
SELECT p.id, p.twitter_user_id,
       (p.agent_settings->>'enabled')::boolean as enabled,
       p.agent_settings->>'lastRunAt' as last_run_at,
       COUNT(sp.id) FILTER (WHERE sp.status = 'posted') as posted_count
FROM profiles p
LEFT JOIN scheduled_posts sp ON sp.user_id = p.id 
  AND sp.post_metadata->>'generated_by' = 'agent_mode'
WHERE (p.agent_settings->>'enabled')::boolean = true
GROUP BY p.id
HAVING COUNT(sp.id) FILTER (WHERE sp.status = 'posted') = 0
ORDER BY p.agent_settings->>'lastRunAt' NULLS FIRST;
```

### Check daily action volume
```sql
SELECT DATE(scheduled_for) as date,
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE status = 'posted') as posted,
       COUNT(*) FILTER (WHERE status = 'failed') as failed,
       COUNT(*) FILTER (WHERE status = 'pending') as pending
FROM scheduled_posts
WHERE scheduled_for > NOW() - INTERVAL '7 days'
GROUP BY DATE(scheduled_for)
ORDER BY date DESC;
```

### Check user action stats
```sql
SELECT sp.user_id, p.twitter_user_id,
       COUNT(*) FILTER (WHERE sp.status = 'posted') as posted,
       COUNT(*) FILTER (WHERE sp.status = 'failed') as failed,
       COUNT(*) FILTER (WHERE sp.status = 'pending') as pending
FROM scheduled_posts sp
JOIN profiles p ON p.id = sp.user_id
WHERE sp.post_metadata->>'generated_by' = 'agent_mode'
GROUP BY sp.user_id, p.twitter_user_id
ORDER BY posted DESC;
```

### Manual trigger for single user
```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/process-agent-actions \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-uuid-here"}'
```

## Optimization Recommendations

### For Free Tier Efficiency

1. **Reduce cron frequency for action discovery**
   - Current: Every 6 hours
   - Minimum safe: Every 4 hours
   - Note: More frequent = more edge function invocations

2. **Limit target accounts per user**
   - Current max per run: 3 accounts
   - Rotation handles all accounts over multiple runs

3. **Increase tweet window if needed**
   - Current: 48 hours
   - Can increase to 72h for less active accounts

4. **Monitor rate limit tracking table**
   ```sql
   SELECT * FROM agent_rate_limit_tracking 
   WHERE date = CURRENT_DATE 
   ORDER BY engagements_today DESC;
   ```

### Avoiding Twitter Rate Limits

- 1.2 second delay between API calls
- 2.5 second delay between target accounts
- 2 second delay between user batches
- Max 3 target accounts per run (rotation covers all)
- Automatic retry with 5 second backoff on 429

## Version History

- **v.0.1.8**: Fixed settings persistence race condition, added error logging
- **v.0.1.7**: Added retry mechanism with exponential backoff
- **v.0.1.6**: Migrated from Vercel cron to Supabase pg_cron
