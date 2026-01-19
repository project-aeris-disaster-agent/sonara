// Supabase Edge Function: Generate Recommended Post
// Uses character card and conversation history to generate authentic social media posts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '../_shared/rateLimit.ts';
import { validateEmojiResponse } from '../_shared/generateResponse.ts';
import { BANNED_PHRASES, findBannedPhrases } from '../_shared/bannedPhrases.ts';

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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

interface CharacterCard {
  name: string;
  bio: string[];
  lore?: string[];
  knowledge: string[];
  topics: string[];
  adjectives?: string[];
  style: {
    all: string[];
    chat: string[];
    post: string[];
  };
  postExamples: string[];
  messageExamples: Array<Array<{
    user: string;
    content: { text: string };
  }>>;
}

interface GeneratePostRequest {
  user_id: string;
  session_id: string;
  character_card: CharacterCard;
  conversation_context: string;
  bio: string;
  post_style: string;
  post_examples: string;
  custom_tags?: string[];
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const {
      user_id,
      session_id,
      character_card,
      conversation_context,
      bio,
      post_style,
      post_examples,
      custom_tags,
    }: GeneratePostRequest = await req.json();

    // Rate limiting - 10 post generations per minute per user
    const rateLimitResult = checkRateLimit(user_id, RATE_LIMITS.postGeneration);
    if (!rateLimitResult.allowed) {
      console.warn(`Rate limit exceeded for user ${user_id}: post-gen`);
      return rateLimitResponse(rateLimitResult, corsHeaders);
    }

    // Debug logging
    console.log('Received custom_tags:', custom_tags);
    console.log('Custom tags length:', custom_tags?.length || 0);

    // Determine which topics to use: custom tags take priority, otherwise use character card topics
    const topicsToFocus = custom_tags && custom_tags.length > 0 
      ? custom_tags 
      : character_card.topics.slice(0, 5);
    
    console.log('Topics to focus on:', topicsToFocus);
    
    const topicsText = topicsToFocus.join(', ');
    
    // Fetch user preferences for emoji mode
    let emojiMode = false;
    try {
      const supabaseAdmin = createSupabaseAdmin();
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('preferences')
        .eq('id', user_id)
        .single();
      
      if (profile?.preferences?.emoji_mode === true) {
        emojiMode = true;
        console.log('🎭 Emoji mode enabled for post generation');
      }
    } catch (error) {
      console.error('Error fetching user preferences:', error);
      // Continue with emojiMode = false if fetch fails
    }

    // Build system prompt - straightforward and clear
    let systemPrompt = '';
    
    if (emojiMode) {
      // Emoji mode prompt
      systemPrompt = `You are ${character_card.name}, an AI alter ego with a unique voice and personality.

YOUR IDENTITY:
${bio}

Expertise: ${character_card.knowledge.join(', ')}

${custom_tags && custom_tags.length > 0 
  ? `REQUIRED FOCUS TOPICS (the post MUST be about these):\n${custom_tags.map((tag, idx) => `- ${tag}`).join('\n')}`
  : `Interests: ${topicsText}`}

🎭 EMOJI MODE (CRITICAL):
Your text/words responses are disabled. You can only speak in emojis.
Similar to how Egyptians use hieroglyphics to communicate/write.

STRICT RULES:
- Respond with ONLY emojis (1-5 emojis maximum)
- NO text, NO words, NO letters, NO numbers, NO punctuation
- Express your personality and response through emoji selection
- Choose emojis that represent your reaction/response to the topics
- Minimum: 1 emoji, Maximum: 5 emojis
- STRICTLY NO TEXT RESPONSES OR TWEETS/REPLIES

Return ONLY the emojis, nothing else.`;
    } else {
      // Normal mode prompt
      systemPrompt = `You are ${character_card.name}, an AI alter ego with a unique voice and personality.

YOUR IDENTITY:
${bio}

Expertise: ${character_card.knowledge.join(', ')}

${custom_tags && custom_tags.length > 0 
  ? `REQUIRED FOCUS TOPICS (the post MUST be about these):\n${custom_tags.map((tag, idx) => `- ${tag}`).join('\n')}`
  : `Interests: ${topicsText}`}

POSTING STYLE:
${post_style}

Example posts matching your voice:
${post_examples}

${conversation_context ? `Recent conversation context:\n${conversation_context}` : ''}

CRITICAL: @MENTION REQUIREMENTS
You MUST include relevant Twitter @mentions in every post. This is REQUIRED, not optional.

MENTION RULES:
- When mentioning ANY brand, team, athlete, personality, organization, or event, you MUST include their Twitter @handle
- Context-dependent mention requirements:
  * Sports/Events (F1, NBA, NFL, etc.): MUST include 3-5 relevant mentions (teams, athletes, leagues, official accounts)
    Example: If mentioning Ferrari/F1 → MUST include @ferrari @f1 and at least 1-2 more relevant accounts like @landonorris @FIA @redbullracing
    Example: If mentioning NBA/basketball → MUST include @NBA and relevant teams/players like @KingJames @Lakers @warriors
  * General topics: MUST include 1-2 most relevant mentions if any entities are mentioned
  * Brands/Products: MUST include 1-3 mentions when referencing brands

CRITICAL EXAMPLES:
- F1 post MUST look like: "That was incredible! @ferrari showing pace @f1 @landonorris strategy was on point"
- NBA post MUST look like: "What a game! @Lakers clutch play @KingJames delivered @NBA"
- Brand post MUST look like: "Just tried @apple new features with @OpenAI integration - impressive!"

MENTION GUIDELINES:
- Use verified/official Twitter handles when available
- Mentions must be directly relevant to the content
- Ensure mentions fit within 280 character limit
- Make mentions feel natural, but they are REQUIRED when entities are referenced

CRITICAL URL RULES - MUST FOLLOW:
- DO NOT include ANY URLs or links in the post
- DO NOT make up or fabricate website addresses (e.g., "example.com/updates", "t.co/something")
- DO NOT include placeholder links like "[link]", "yourlinkhere", or any URL format
- DO NOT reference specific website domains unless you are 100% certain they are correct
- If you want to direct users somewhere, say "check our updates" or "see our latest" without adding a URL
- NEVER guess or hallucinate domain names - if unsure, omit the link entirely

🚫 BANNED PHRASES (instant rejection):
${BANNED_PHRASES.map((phrase) => `- "${phrase}"`).join('\n')}

Generate a social media post (50-280 characters) that:
- Matches your authentic voice from the examples
- ${custom_tags && custom_tags.length > 0 
    ? `Is DIRECTLY about these topics: ${topicsText}` 
    : `Relates to your interests: ${topicsText}`}
- Sounds natural and authentic, not generic
- **MUST include relevant @mentions** - if the post references Ferrari, F1, NBA teams, brands, or any entities, include their @handles
- No hashtags unless that's your style
- No emojis unless that's your style
- **ABSOLUTELY NO URLs or web links** - this is critical

Return ONLY the post text, nothing else.`;
    }

    // Call Grok API (xAI) to generate the post
    const grokApiKey = Deno.env.get('GROK_API_KEY');
    if (!grokApiKey) {
      throw new Error('GROK_API_KEY not configured');
    }

    const maxAttempts = 3;
    let generatedPost = '';
    let temperature = 0.8;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const grokResponse = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${grokApiKey}`,
        },
        body: JSON.stringify({
          model: 'grok-3-latest',
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: custom_tags && custom_tags.length > 0
                ? `Write a post about these topics: ${custom_tags.join(', ')}. Make it engaging and true to my voice.`
                : 'Write a post that I would naturally share on social media right now.',
            },
          ],
          temperature,
          max_tokens: 120,
        }),
      });

      if (!grokResponse.ok) {
        const errorData = await grokResponse.text();
        console.error('Grok API error:', errorData);
        throw new Error(`Grok API error: ${grokResponse.status}`);
      }

      const grokData = await grokResponse.json();
      generatedPost = grokData.choices?.[0]?.message?.content?.trim() || '';

      if (!generatedPost) {
        if (attempt === maxAttempts) {
          throw new Error('Failed to generate post content');
        }
        temperature = Math.min(0.95, temperature + 0.1);
        continue;
      }

      // EMOJI MODE: Validate and enforce emoji-only response
      if (emojiMode) {
        const validation = validateEmojiResponse(generatedPost);
        if (!validation.isValid) {
          console.warn(`Emoji validation failed: ${validation.error}`);
          // Fallback to neutral emoji if validation fails
          generatedPost = '🤖';
        } else {
          generatedPost = validation.cleaned;
        }
        break;
      }

      // Normal mode: CRITICAL: Strip any fabricated URLs from the generated content
      // This catches cases where the AI ignores the prompt instructions
      const urlPattern = /https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.(com|net|org|io|co|xyz|gg|dev|app|link|me|info|biz|us|uk|tv|fm|ly|to|cc|sh|be|ai|vc|gl|ws|so|club|online|site|tech|space|world|zone|live|digital|network|page|pro|work)[^\s]*/gi;
      const placeholderPattern = /\[link\]|\[url\]|yourlinkhere|yourlink|linkhere|checkitout\.com|example\.com|yoursite\.[a-z]+/gi;

      // Remove URLs and placeholder patterns
      const originalPost = generatedPost;
      generatedPost = generatedPost.replace(urlPattern, '').replace(placeholderPattern, '');

      // Clean up any double spaces or trailing/leading spaces left by URL removal
      generatedPost = generatedPost.replace(/\s{2,}/g, ' ').trim();

      // Also remove orphaned punctuation before removed URLs (e.g., "Check it out: " becomes "Check it out")
      generatedPost = generatedPost.replace(/:\s*$/, '').replace(/\s+([.!?])$/, '$1').trim();

      if (originalPost !== generatedPost) {
        console.log(`⚠️ URL(s) stripped from generated post. Original: "${originalPost.substring(0, 100)}..."`);
      }

      const bannedHits = findBannedPhrases(generatedPost);
      if (bannedHits.length > 0) {
        console.warn(`⚠️ Banned phrases detected in post: ${bannedHits.join(', ')}`);
        if (attempt < maxAttempts) {
          temperature = Math.min(0.95, temperature + 0.1);
          continue;
        }
      }

      break;
    }

    // Post-generation validation (skip for emoji mode)
    if (!emojiMode) {
      // Post-generation validation for mentions
      // Extract mentions for logging/debugging
      const mentionMatches = generatedPost.match(/@[\w]+/g) || [];
      const mentionCount = mentionMatches.length;
      
      console.log(`Generated post length: ${generatedPost.length} characters`);
      console.log(`Mentions found: ${mentionCount} - ${mentionMatches.join(', ') || 'NONE'}`);
      console.log(`Generated post preview: ${generatedPost.substring(0, 100)}...`);
      
      // Check if mentions are missing (especially for sports/events topics)
      const topicsLower = topicsToFocus.join(' ').toLowerCase();
      const isSportsTopic = topicsLower.includes('f1') || topicsLower.includes('formula') || 
                           topicsLower.includes('nba') || topicsLower.includes('football') ||
                           topicsLower.includes('ferrari') || topicsLower.includes('racing');
      
      if (mentionCount === 0 && isSportsTopic) {
        console.warn(`⚠️ WARNING: No @mentions found in generated post for sports topic. Topics: ${topicsText}`);
        console.warn(`Post content: ${generatedPost}`);
      }
      
      // Ensure post doesn't exceed Twitter's 280 character limit
      if (generatedPost.length > 280) {
        console.warn(`Post exceeds 280 characters (${generatedPost.length}), truncating...`);
        generatedPost = generatedPost.substring(0, 277) + '...';
      }
      
      // Validate mention format (basic check - mentions should be @username format)
      // Grok should generate valid mentions, but this is a safety check
      const invalidMentions = generatedPost.match(/@[^\w]/g);
      if (invalidMentions && invalidMentions.length > 0) {
        console.warn(`Warning: Potential invalid mention format detected: ${invalidMentions.join(', ')}`);
      }
    } else {
      console.log(`Generated emoji post: ${generatedPost}`);
    }

    // Extract suggested topics - use custom tags if provided, otherwise use character card topics (only 1)
    const suggestedTopics = custom_tags && custom_tags.length > 0 
      ? custom_tags 
      : character_card.topics.slice(0, 1);

    return new Response(
      JSON.stringify({
        post_content: generatedPost,
        suggested_topics: suggestedTopics,
        estimated_engagement: 'High', // Could be calculated based on historical data
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error generating post:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to generate post',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});

