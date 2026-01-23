// Preferences Service - Handles user preferences management
// Manages user settings like emoji mode and other preferences

import { supabase } from '@/lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as SupabaseClient<any>;

// Advanced settings that fine-tune how the personality is expressed
// These complement (not override) the character card
export interface AdvancedSettings {
  // Response behavior
  responseLengthPreference: 'terse' | 'brief' | 'normal' | 'detailed';
  allowTangents: 'never' | 'rarely' | 'sometimes';
  enableLiveSearch: boolean;
  openingVariety: number; // How much to vary reply openers (0-100)
  antiSlopStrictness: number; // How aggressively to avoid banned phrases (0-100)
  
  // Expression intensity (0-100, scales character card traits)
  emojiIntensity: number;      // How often emojis appear (uses character's emoji patterns)
  signaturePhraseFrequency: number;  // How often catchphrases appear
  humorIntensity: number;      // How much humor shows through
  opinionStrength: 'soft' | 'normal' | 'strong';
  
  // Creativity
  creativityLevel: 'consistent' | 'balanced' | 'creative';
  
  // Humanizer settings - post-processing to remove AI writing patterns
  enableHumanizer: boolean;  // Enable humanizer post-processing (default: true)
  humanizerStrictness: 'light' | 'moderate' | 'strict';  // How aggressively to transform
}

export const DEFAULT_ADVANCED_SETTINGS: AdvancedSettings = {
  responseLengthPreference: 'brief',
  allowTangents: 'rarely',
  enableLiveSearch: true,
  openingVariety: 75,           // Increased from 60 for more varied openers
  antiSlopStrictness: 85,       // Increased from 70 for stricter slop prevention
  emojiIntensity: 50,
  signaturePhraseFrequency: 60, // Increased from 30 to enforce personality expression
  humorIntensity: 50,
  opinionStrength: 'normal',
  creativityLevel: 'balanced',
  enableHumanizer: true,        // Enabled by default - removes AI writing patterns
  humanizerStrictness: 'moderate',
};

/**
 * Get user preferences
 */
export async function getUserPreferences(userId: string): Promise<Record<string, any>> {
  const { data, error } = await db
    .from('profiles')
    .select('preferences')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('Failed to fetch user preferences:', error.message || error);
    return {};
  }

  return data?.preferences || {};
}

/**
 * Update user preferences (merges with existing preferences)
 */
export async function updateUserPreferences(
  userId: string,
  preferences: Partial<Record<string, any>>
): Promise<void> {
  // Get current preferences
  const currentPreferences = await getUserPreferences(userId);
  
  // Merge with new preferences
  const updatedPreferences = {
    ...currentPreferences,
    ...preferences,
  };

  const { error } = await db
    .from('profiles')
    .update({ preferences: updatedPreferences })
    .eq('id', userId);

  if (error) {
    console.error('Failed to update user preferences:', error);
    throw new Error('Failed to update user preferences');
  }
}

/**
 * Get emoji mode setting for a user
 */
export async function getEmojiMode(userId: string): Promise<boolean> {
  const preferences = await getUserPreferences(userId);
  return preferences.emoji_mode === true;
}

/**
 * Set emoji mode setting for a user
 */
export async function setEmojiMode(userId: string, enabled: boolean): Promise<void> {
  await updateUserPreferences(userId, { emoji_mode: enabled });
}

/**
 * Get advanced settings for a user
 */
export async function getAdvancedSettings(userId: string): Promise<AdvancedSettings> {
  const preferences = await getUserPreferences(userId);
  return {
    ...DEFAULT_ADVANCED_SETTINGS,
    ...preferences.advanced_settings,
  };
}

/**
 * Update advanced settings for a user
 */
export async function updateAdvancedSettings(
  userId: string,
  settings: Partial<AdvancedSettings>
): Promise<void> {
  const currentSettings = await getAdvancedSettings(userId);
  const updatedSettings = { ...currentSettings, ...settings };
  await updateUserPreferences(userId, { advanced_settings: updatedSettings });
}