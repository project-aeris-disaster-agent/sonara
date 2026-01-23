// Shared helper for fetching and merging global settings
// Global settings act as defaults that can be overridden by per-user settings

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface GlobalSettings {
  id: string;
  enable_live_search: boolean;
  enable_emoji_mode: boolean;
  enable_humanizer: boolean;
  humanizer_strictness: 'light' | 'moderate' | 'strict';
  enable_auto_retweet: boolean;
  enable_auto_like: boolean;
  enable_auto_mention: boolean;
  default_frequency: 'daily' | '3days' | 'weekly';
  max_global_engagements_per_day: number;
  max_per_account_engagements_per_day: number;
  emoji_intensity: number;
  signature_phrase_frequency: number;
  humor_intensity: number;
  anti_slop_strictness: number;
  opening_variety: number;
  response_length_preference: 'terse' | 'brief' | 'normal' | 'detailed';
  allow_tangents: 'never' | 'rarely' | 'sometimes';
  opinion_strength: 'soft' | 'normal' | 'strong';
  creativity_level: 'consistent' | 'balanced' | 'creative';
  active_hours_start: number;
  active_hours_end: number;
  pause_all_agents: boolean;
  maintenance_mode: boolean;
  updated_at: string;
  updated_by: string | null;
}

/**
 * Fetch global settings from database
 * Returns null if not found or on error
 */
export async function getGlobalSettings(
  supabase: SupabaseClient
): Promise<GlobalSettings | null> {
  try {
    const { data, error } = await supabase
      .from('global_settings')
      .select('*')
      .eq('id', 'global')
      .single();

    if (error) {
      console.error('Error fetching global settings:', error);
      return null;
    }

    return data as GlobalSettings;
  } catch (error) {
    console.error('Exception fetching global settings:', error);
    return null;
  }
}

/**
 * Merge global settings with user preferences
 * User settings override global defaults when present
 */
export function mergeGlobalWithUserSettings<T extends Record<string, any>>(
  globalSettings: GlobalSettings | null,
  userSettings: T | null | undefined
): T {
  if (!globalSettings) {
    return (userSettings || {}) as T;
  }

  // Start with global defaults
  const merged: any = {
    // Core features
    enableLiveSearch: globalSettings.enable_live_search,
    emojiMode: globalSettings.enable_emoji_mode,
    enableHumanizer: globalSettings.enable_humanizer,
    humanizerStrictness: globalSettings.humanizer_strictness,
    
    // Agent settings
    enableAutoRetweet: globalSettings.enable_auto_retweet,
    enableAutoLike: globalSettings.enable_auto_like,
    enableAutoMention: globalSettings.enable_auto_mention,
    defaultFrequency: globalSettings.default_frequency,
    
    // Personality tuning
    emojiIntensity: globalSettings.emoji_intensity,
    signaturePhraseFrequency: globalSettings.signature_phrase_frequency,
    humorIntensity: globalSettings.humor_intensity,
    antiSlopStrictness: globalSettings.anti_slop_strictness,
    openingVariety: globalSettings.opening_variety,
    responseLengthPreference: globalSettings.response_length_preference,
    allowTangents: globalSettings.allow_tangents,
    opinionStrength: globalSettings.opinion_strength,
    creativityLevel: globalSettings.creativity_level,
  };

  // Override with user settings if present
  if (userSettings) {
    Object.assign(merged, userSettings);
  }

  return merged as T;
}

/**
 * Check if service is in maintenance mode or paused
 */
export function isServicePaused(globalSettings: GlobalSettings | null): boolean {
  if (!globalSettings) {
    return false; // If we can't fetch settings, don't block (fail open)
  }
  return globalSettings.pause_all_agents || globalSettings.maintenance_mode;
}

/**
 * Get effective agent actions (global defaults + user overrides)
 */
export function getEffectiveAgentActions(
  globalSettings: GlobalSettings | null,
  userActions?: {
    retweet?: boolean;
    like?: boolean;
    mention?: boolean;
  }
): {
  retweet: boolean;
  like: boolean;
  mention: boolean;
} {
  if (!globalSettings) {
    // Fallback to user settings or defaults
    return {
      retweet: userActions?.retweet ?? false,
      like: userActions?.like ?? false,
      mention: userActions?.mention ?? false,
    };
  }

  return {
    retweet: userActions?.retweet ?? globalSettings.enable_auto_retweet,
    like: userActions?.like ?? globalSettings.enable_auto_like,
    mention: userActions?.mention ?? globalSettings.enable_auto_mention,
  };
}

/**
 * Get effective frequency (global default + user override)
 */
export function getEffectiveFrequency(
  globalSettings: GlobalSettings | null,
  userFrequency?: 'daily' | '3days' | 'weekly'
): 'daily' | '3days' | 'weekly' {
  if (!globalSettings) {
    return userFrequency || 'daily';
  }
  return userFrequency || globalSettings.default_frequency;
}
