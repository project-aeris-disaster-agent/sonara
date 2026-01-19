// Supabase Edge Function: Chat with AI Clone
// Handles conversations using character card personality context
// Now uses shared response generation for consistent intelligence

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '../_shared/rateLimit.ts';
import { generateResponse, type CharacterCard, type PersonalityMetadata, type ConversationMessage, type ConversationContext } from '../_shared/generateResponse.ts';

const SUPABASE_URL =
  Deno.env.get('PROJECT_URL') ??
  Deno.env.get('SUPABASE_URL') ??
  '';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SERVICE_ROLE_KEY') ??
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  '';

function createSupabaseAdmin(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ChatRequest {
  user_id: string;
  session_id: string;
  message: string;
  character_card: CharacterCard;
  conversation_history: ConversationMessage[];
  personality_metadata?: PersonalityMetadata;
  conversation_context?: ConversationContext;
  dry_run?: boolean;
}

// Main handler
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const {
      user_id,
      session_id,
      message,
      character_card,
      conversation_history,
      personality_metadata,
      conversation_context,
      dry_run = false,
    } = await req.json() as ChatRequest;

    if (dry_run) {
      const grokConfigured = !!Deno.env.get('GROK_API_KEY');
      return new Response(
        JSON.stringify({ success: true, dry_run: true, grok_configured: grokConfigured }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate required fields
    if (!user_id || !message || !character_card) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: user_id, message, or character_card' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Rate limiting - 30 messages per minute per user
    const rateLimitResult = checkRateLimit(user_id, RATE_LIMITS.chat);
    if (!rateLimitResult.allowed) {
      console.warn(`Rate limit exceeded for user ${user_id}: chat`);
      return rateLimitResponse(rateLimitResult, corsHeaders);
    }

    // Get Grok API key
    const grokApiKey = Deno.env.get('GROK_API_KEY');
    if (!grokApiKey) {
      console.error('GROK_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'Chat service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Chat request from user ${user_id}, session ${session_id}`);
    console.log(`Character: ${character_card.name}`);
    console.log(`Message: ${message.substring(0, 100)}...`);
    console.log(`History: ${conversation_history?.length || 0} messages`);
    console.log(`Has personality metadata: ${!!personality_metadata}`);

    // Fetch user preferences for emoji mode and advanced settings
    let emojiMode = false;
    let advancedSettings: any = undefined;
    try {
      const supabaseAdmin = createSupabaseAdmin();
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('preferences')
        .eq('id', user_id)
        .single();
      
      if (profile?.preferences?.emoji_mode === true) {
        emojiMode = true;
        console.log('🎭 Emoji mode enabled for user');
      }
      
      if (profile?.preferences?.advanced_settings) {
        advancedSettings = profile.preferences.advanced_settings;
        console.log('⚙️ Advanced settings loaded:', Object.keys(advancedSettings).join(', '));
      }
    } catch (error) {
      console.error('Error fetching user preferences:', error);
      // Continue with defaults if fetch fails
    }

    // Extract recent assistant responses for repetition detection
    const recentResponses = (conversation_history || [])
      .filter(m => m.role === 'assistant')
      .slice(-5) // Last 5 assistant responses
      .map(m => m.content);

    // Use shared response generation function
    const result = await generateResponse({
      characterCard: character_card,
      userMessage: message,
      personalityMetadata: personality_metadata,
      conversationHistory: conversation_history || [],
      recentResponses,
      enforceOneSentence: true, // Chat mode: legacy support (dynamic length used instead)
      mode: 'chat',
      grokApiKey,
      emojiMode,
      conversationContext: conversation_context,
      advancedSettings,
    });

    if (!result) {
      throw new Error('Failed to generate response');
    }

    const { response, tokens_used } = result;

    console.log(`Response generated (${tokens_used || 'unknown'} tokens)`);

    return new Response(
      JSON.stringify({
        success: true,
        response,
        tokens_used,
        model: 'grok-3-latest',
        session_id,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Chat error:', error);
    
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Chat failed',
        details: error instanceof Error ? error.toString() : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

