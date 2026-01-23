# Global Settings Admin Panel

A Streamlit-based admin interface for managing universal settings that apply to all accounts as defaults.

## Setup

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env and add your Supabase credentials
   ```

3. **Run the app:**
   ```bash
   streamlit run app.py
   ```

4. **Access the panel:**
   Open your browser to `http://localhost:8501`

## Environment Variables

- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key (for admin access)

## Features

The admin panel is organized into 5 tabs:

1. **Core Features** - Live search, emoji mode, humanizer, response length, etc.
2. **Agent Settings** - Auto retweet/like/mention toggles, frequency, active hours
3. **Personality Tuning** - Emoji intensity, signature phrases, humor, anti-slop strictness
4. **Safety & Limits** - Rate limits for engagements
5. **Emergency Controls** - Pause all agents, maintenance mode

## How It Works

- **Global settings act as defaults** - They apply to all accounts unless overridden
- **User settings override global** - Individual users can still customize their preferences
- **Changes take effect immediately** - Edge functions read global settings on each request
- **Emergency controls** - Instantly pause all agent processing if needed

## Integration

The global settings are automatically used by:
- `chat-with-clone` edge function (chat responses)
- `process-agent-actions` edge function (Twitter engagement)

Settings are merged at runtime: `effective_settings = { ...global_defaults, ...user_overrides }`
