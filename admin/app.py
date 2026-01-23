"""
Streamlit Admin Panel for Global Settings Management
Manages universal settings that apply to all accounts as defaults
"""

import streamlit as st
import os
from datetime import datetime
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Page config
st.set_page_config(
    page_title="Global Settings Admin",
    page_icon="⚙️",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Initialize Supabase connection
@st.cache_resource
def init_supabase():
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    
    if not supabase_url or not supabase_key:
        st.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables")
        st.stop()
    
    return create_client(supabase_url, supabase_key)

def get_global_settings(supabase: Client):
    """Fetch current global settings"""
    try:
        response = supabase.table("global_settings").select("*").eq("id", "global").execute()
        if response.data and len(response.data) > 0:
            return response.data[0]
        return None
    except Exception as e:
        st.error(f"Error fetching settings: {str(e)}")
        return None

def update_global_settings(supabase: Client, updates: dict):
    """Update global settings"""
    try:
        updates["updated_at"] = datetime.utcnow().isoformat()
        updates["updated_by"] = "admin"  # Could be enhanced with actual user tracking
        
        response = supabase.table("global_settings").update(updates).eq("id", "global").execute()
        return True, "Settings updated successfully"
    except Exception as e:
        return False, f"Error updating settings: {str(e)}"

def main():
    st.title("⚙️ Global Settings Admin Panel")
    st.markdown("Manage universal settings that apply to all accounts as defaults")
    
    supabase = init_supabase()
    settings = get_global_settings(supabase)
    
    if settings is None:
        st.error("Could not load global settings. Please check your database connection.")
        return
    
    # Display last update info
    if settings.get("updated_at"):
        last_update = datetime.fromisoformat(settings["updated_at"].replace("Z", "+00:00"))
        st.caption(f"Last updated: {last_update.strftime('%Y-%m-%d %H:%M:%S UTC')} by {settings.get('updated_by', 'unknown')}")
    
    # Create tabs for organization
    tab1, tab2, tab3, tab4, tab5 = st.tabs([
        "🔍 Core Features",
        "🤖 Agent Settings",
        "🎨 Personality Tuning",
        "🛡️ Safety & Limits",
        "🚨 Emergency Controls"
    ])
    
    # Track if any changes were made
    changes = {}
    
    # Tab 1: Core Features
    with tab1:
        st.header("Core Feature Toggles")
        
        col1, col2 = st.columns(2)
        
        with col1:
            st.subheader("Live Search")
            enable_live_search = st.toggle(
                "Enable Live Search Globally",
                value=settings.get("enable_live_search", True),
                help="Enables real-time web/Twitter search for knowledge queries"
            )
            changes["enable_live_search"] = enable_live_search
            
            st.subheader("Emoji Mode")
            enable_emoji_mode = st.toggle(
                "Enable Emoji Mode Globally",
                value=settings.get("enable_emoji_mode", False),
                help="Forces all responses to be emoji-only (1-5 emojis max)"
            )
            changes["enable_emoji_mode"] = enable_emoji_mode
            
            st.subheader("Humanizer")
            enable_humanizer = st.toggle(
                "Enable Humanizer Post-Processing",
                value=settings.get("enable_humanizer", True),
                help="Removes AI writing patterns from responses"
            )
            changes["enable_humanizer"] = enable_humanizer
            
            if enable_humanizer:
                humanizer_strictness = st.selectbox(
                    "Humanizer Strictness",
                    ["light", "moderate", "strict"],
                    index=["light", "moderate", "strict"].index(settings.get("humanizer_strictness", "moderate")),
                    help="How aggressively to transform AI patterns"
                )
                changes["humanizer_strictness"] = humanizer_strictness
        
        with col2:
            st.subheader("Response Length")
            response_length = st.selectbox(
                "Default Response Length Preference",
                ["terse", "brief", "normal", "detailed"],
                index=["terse", "brief", "normal", "detailed"].index(settings.get("response_length_preference", "brief")),
                help="Default response length for all accounts"
            )
            changes["response_length_preference"] = response_length
            
            st.subheader("Tangents")
            allow_tangents = st.selectbox(
                "Allow Tangents",
                ["never", "rarely", "sometimes"],
                index=["never", "rarely", "sometimes"].index(settings.get("allow_tangents", "rarely")),
                help="How often agents can go on tangents"
            )
            changes["allow_tangents"] = allow_tangents
            
            st.subheader("Opinion Strength")
            opinion_strength = st.selectbox(
                "Default Opinion Strength",
                ["soft", "normal", "strong"],
                index=["soft", "normal", "strong"].index(settings.get("opinion_strength", "normal")),
                help="How strongly agents express opinions"
            )
            changes["opinion_strength"] = opinion_strength
            
            st.subheader("Creativity Level")
            creativity_level = st.selectbox(
                "Default Creativity Level",
                ["consistent", "balanced", "creative"],
                index=["consistent", "balanced", "creative"].index(settings.get("creativity_level", "balanced")),
                help="How creative/varied responses should be"
            )
            changes["creativity_level"] = creativity_level
    
    # Tab 2: Agent Settings
    with tab2:
        st.header("Agent Mode Settings")
        st.markdown("These settings control automated Twitter engagement actions")
        
        col1, col2 = st.columns(2)
        
        with col1:
            st.subheader("Action Toggles")
            enable_auto_retweet = st.toggle(
                "Enable Auto Retweet Globally",
                value=settings.get("enable_auto_retweet", False),
                help="Allow agents to automatically retweet target accounts"
            )
            changes["enable_auto_retweet"] = enable_auto_retweet
            
            enable_auto_like = st.toggle(
                "Enable Auto Like Globally",
                value=settings.get("enable_auto_like", False),
                help="Allow agents to automatically like tweets"
            )
            changes["enable_auto_like"] = enable_auto_like
            
            enable_auto_mention = st.toggle(
                "Enable Auto Mention/Reply Globally",
                value=settings.get("enable_auto_mention", False),
                help="Allow agents to automatically reply to tweets with generated content"
            )
            changes["enable_auto_mention"] = enable_auto_mention
        
        with col2:
            st.subheader("Frequency & Scheduling")
            default_frequency = st.selectbox(
                "Default Frequency",
                ["daily", "3days", "weekly"],
                index=["daily", "3days", "weekly"].index(settings.get("default_frequency", "daily")),
                help="Default engagement frequency for all agents"
            )
            changes["default_frequency"] = default_frequency
            
            col_start, col_end = st.columns(2)
            with col_start:
                active_hours_start = st.number_input(
                    "Active Hours Start",
                    min_value=0,
                    max_value=23,
                    value=settings.get("active_hours_start", 9),
                    help="Hour of day when agents start (0-23)"
                )
                changes["active_hours_start"] = int(active_hours_start)
            
            with col_end:
                active_hours_end = st.number_input(
                    "Active Hours End",
                    min_value=0,
                    max_value=23,
                    value=settings.get("active_hours_end", 21),
                    help="Hour of day when agents stop (0-23)"
                )
                changes["active_hours_end"] = int(active_hours_end)
    
    # Tab 3: Personality Tuning
    with tab3:
        st.header("Personality Expression Tuning")
        st.markdown("Fine-tune how personality traits are expressed globally")
        
        col1, col2 = st.columns(2)
        
        with col1:
            st.subheader("Emoji Intensity")
            emoji_intensity = st.slider(
                "Emoji Intensity",
                min_value=0,
                max_value=100,
                value=settings.get("emoji_intensity", 50),
                help="How often emojis appear (0-100)"
            )
            changes["emoji_intensity"] = int(emoji_intensity)
            
            st.subheader("Signature Phrase Frequency")
            signature_phrase_frequency = st.slider(
                "Signature Phrase Frequency",
                min_value=0,
                max_value=100,
                value=settings.get("signature_phrase_frequency", 60),
                help="How often signature phrases appear (0-100)"
            )
            changes["signature_phrase_frequency"] = int(signature_phrase_frequency)
            
            st.subheader("Humor Intensity")
            humor_intensity = st.slider(
                "Humor Intensity",
                min_value=0,
                max_value=100,
                value=settings.get("humor_intensity", 50),
                help="How much humor shows through (0-100)"
            )
            changes["humor_intensity"] = int(humor_intensity)
        
        with col2:
            st.subheader("Anti-Slop Strictness")
            anti_slop_strictness = st.slider(
                "Anti-Slop Strictness",
                min_value=0,
                max_value=100,
                value=settings.get("anti_slop_strictness", 85),
                help="How aggressively to avoid banned phrases (0-100)"
            )
            changes["anti_slop_strictness"] = int(anti_slop_strictness)
            
            st.subheader("Opening Variety")
            opening_variety = st.slider(
                "Opening Variety",
                min_value=0,
                max_value=100,
                value=settings.get("opening_variety", 75),
                help="How much to vary reply openers (0-100)"
            )
            changes["opening_variety"] = int(opening_variety)
    
    # Tab 4: Safety & Limits
    with tab4:
        st.header("Rate Limits & Safety")
        st.markdown("Control engagement limits to prevent spam detection")
        
        col1, col2 = st.columns(2)
        
        with col1:
            st.subheader("Global Daily Limits")
            max_global_engagements = st.number_input(
                "Max Global Engagements Per Day",
                min_value=0,
                max_value=1000,
                value=settings.get("max_global_engagements_per_day", 50),
                help="Maximum total engagements across all accounts per day"
            )
            changes["max_global_engagements_per_day"] = int(max_global_engagements)
        
        with col2:
            st.subheader("Per-Account Limits")
            max_per_account_engagements = st.number_input(
                "Max Per-Account Engagements Per Day",
                min_value=0,
                max_value=100,
                value=settings.get("max_per_account_engagements_per_day", 10),
                help="Maximum engagements per target account per day"
            )
            changes["max_per_account_engagements_per_day"] = int(max_per_account_engagements)
    
    # Tab 5: Emergency Controls
    with tab5:
        st.header("🚨 Emergency Controls")
        st.warning("Use these controls to immediately pause all agent activity")
        
        col1, col2 = st.columns(2)
        
        with col1:
            st.subheader("Pause All Agents")
            pause_all_agents = st.toggle(
                "Pause All Agent Processing",
                value=settings.get("pause_all_agents", False),
                help="Emergency stop - pauses all agent mode processing globally"
            )
            changes["pause_all_agents"] = pause_all_agents
            
            if pause_all_agents:
                st.error("⚠️ All agent processing is currently PAUSED")
        
        with col2:
            st.subheader("Maintenance Mode")
            maintenance_mode = st.toggle(
                "Enable Maintenance Mode",
                value=settings.get("maintenance_mode", False),
                help="When enabled, all automated actions are paused for maintenance"
            )
            changes["maintenance_mode"] = maintenance_mode
            
            if maintenance_mode:
                st.error("⚠️ Maintenance mode is ACTIVE - all actions paused")
    
    # Save button at the bottom
    st.divider()
    
    col1, col2, col3 = st.columns([1, 2, 1])
    with col2:
        if st.button("💾 Save All Changes", type="primary", use_container_width=True):
            if changes:
                success, message = update_global_settings(supabase, changes)
                if success:
                    st.success(message)
                    st.rerun()
                else:
                    st.error(message)
            else:
                st.info("No changes to save")
    
    # Display current settings as JSON (for debugging)
    with st.expander("📋 View Raw Settings (JSON)"):
        st.json(settings)

if __name__ == "__main__":
    main()
