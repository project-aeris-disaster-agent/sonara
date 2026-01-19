// Shared Response Generation for Chat and Twitter Replies
// UNIFIED BRAIN: Both chat and Twitter use the same personality core
// Supports Grok's Twitter knowledge and web search capabilities for intelligent responses
import { BANNED_PHRASES, buildBannedPhrasePatterns, buildAiSlopPatterns } from './bannedPhrases.ts';

export interface CharacterCard {
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
  messageExamples: Array<Array<{
    user: string;
    content: { text: string };
  }>>;
  postExamples: string[];
}

export interface PersonalityMetadata {
  signaturePhrases?: string[];
  emojiPatterns?: string[];
  humorStyle?: string;
  vocabularyLevel?: string;
  opinionStyle?: 'strong' | 'balanced' | 'provocative' | 'diplomatic';
}

interface SignatureInjection {
  phrases: string[];
  openers: string[];
  fillers: string[];
  closers: string[];
}

interface TwitterReplyArchetype {
  name: string;
  guidance: string;
  minChars: number;
  maxChars: number;
  minSentences: number;
  maxSentences: number;
}

export interface ConversationContext {
  topics: string[];
  userMood: 'positive' | 'neutral' | 'frustrated' | 'curious' | 'excited';
  ongoingThreads: string[];
  lastMentioned: Record<string, string>;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// ============================================================================
// UNIFIED PERSONALITY PROFILE - Shared "brain" for chat and Twitter
// ============================================================================

interface UnifiedPersonalityProfile {
  name: string;
  identity: string;        // Full bio (3 sentences)
  background: string;      // Lore context
  expertise: string;       // Knowledge areas
  interests: string;       // Topics
  vibe: string;            // Adjectives
  communicationStyle: string; // Combined style traits
  voiceExamples: string;   // Message + post examples combined
  enhancedPersonality: string; // From metadata
}

/**
 * Build unified personality profile from character card
 * This is the SAME "brain" used by both chat and Twitter modes
 * Keeps prompt size efficient for free tier (minimal tokens)
 */
function buildUnifiedPersonalityProfile(
  card: CharacterCard,
  metadata?: PersonalityMetadata
): UnifiedPersonalityProfile {
  // Core identity - use full bio (3 sentences) for both modes
  const identity = card.bio.slice(0, 3).join(' ');
  
  // Background context from lore
  const background = card.lore?.slice(0, 2).join(' ') || '';
  
  // Expertise and interests
  const expertise = card.knowledge.slice(0, 5).join(', ');
  const interests = card.topics.slice(0, 5).join(', ');
  
  // Unified vibe from adjectives
  const vibe = card.adjectives?.slice(0, 5).join(', ') || 'authentic, engaging';
  
  // UNIFIED STYLE: Combine all style traits for consistent voice
  // Both chat and Twitter get the same personality foundation
  const allTraits = [
    ...card.style.all.slice(0, 3),
    ...card.style.chat.slice(0, 2),
    ...card.style.post.slice(0, 2),
  ];
  const communicationStyle = [...new Set(allTraits)].join(', '); // Dedupe
  
  // CROSS-POLLINATE voice examples: Both modes see conversation AND writing style
  const maxExampleLength = 140; // Balance style fidelity with token cost
  const maxConversationExamples = 4;
  const maxPostExamples = 6;
  const maxVoiceExamples = 6;

  const conversationExamples = card.messageExamples
    .slice(0, maxConversationExamples)
    .map(convo => {
      const assistantMsg = convo.find(m => m.user !== '{{user1}}');
      if (assistantMsg?.content?.text) {
        const text = assistantMsg.content.text;
        return text.length > maxExampleLength ? text.substring(0, maxExampleLength) + '...' : text;
      }
      return null;
    })
    .filter(Boolean);
  
  const writingExamples = card.postExamples.slice(0, maxPostExamples).map(ex => 
    ex.length > maxExampleLength ? ex.substring(0, maxExampleLength) + '...' : ex
  );
  
  // Combine voice examples (keeps token count low)
  const voiceExamples = [
    ...writingExamples.map(ex => `• "${ex}"`),
    ...conversationExamples.map(ex => `• "${ex}"`),
  ].slice(0, maxVoiceExamples).join('\n'); // Max 6 examples total for efficiency
  
  // Enhanced personality from metadata (BOTH modes now use this)
  let enhancedPersonality = '';
  if (metadata) {
    const parts: string[] = [];
    if (metadata.signaturePhrases?.length) {
      parts.push(`Signature phrases: ${metadata.signaturePhrases.slice(0, 3).join(', ')}`);
    }
    if (metadata.humorStyle) {
      parts.push(`Humor: ${metadata.humorStyle}`);
    }
    if (metadata.vocabularyLevel) {
      parts.push(`Vocabulary: ${metadata.vocabularyLevel}`);
    }
    if (metadata.emojiPatterns?.length) {
      parts.push(`Emoji style: ${metadata.emojiPatterns.slice(0, 3).join(' ')}`);
    }
    enhancedPersonality = parts.join(' | ');
  }
  
  return {
    name: card.name,
    identity,
    background,
    expertise,
    interests,
    vibe,
    communicationStyle,
    voiceExamples,
    enhancedPersonality,
  };
}

function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function buildStyleSeed(card: CharacterCard, metadata?: PersonalityMetadata): number {
  const seedInput = [
    card.name,
    card.bio?.[0],
    card.lore?.[0],
    card.topics?.[0],
    metadata?.signaturePhrases?.[0],
    metadata?.humorStyle,
  ]
    .filter(Boolean)
    .join('|');

  return stableHash(seedInput || card.name);
}

// Archetype definitions
const TWITTER_ARCHETYPES: TwitterReplyArchetype[] = [
  {
    name: 'Analytical',
    guidance: `STRUCTURE: Lead with fact/insight → brief takeaway. NO greeting.
OPENER: Skip greeting entirely. Start with data, stat, or observation.
EXAMPLE STARTS: "The data shows..." / "Actually, [specific stat]..." / "[Concrete observation]—"
BANNED: "Hey/Yo", acknowledgments like "I hear ya", filler phrases.
For hot takes: Agree with data ("The numbers back this up—") or challenge with specifics ("That misses [specific thing] because...")`,
    minChars: 90,
    maxChars: 210,
    minSentences: 1,
    maxSentences: 2,
  },
  {
    name: 'Conversational',
    guidance: `STRUCTURE: Quick reaction → specific point or question. Feels like mid-thread.
OPENER: Use reactions NOT greetings. Try "Wait—" / "Hmm" / "Ok but" / "Fr" / "This." / or just @mention.
EXAMPLE STARTS: "Wait @username—" / "Ngl" / "Lowkey" / "@username ok but"
BANNED: "Hey @username", "Yo @username", "I hear ya", "sounds intense".
For hot takes: React then engage ("Fr tho—but what about [specific]?" or "Wait, isn't that also true for [X]?")`,
    minChars: 70,
    maxChars: 190,
    minSentences: 1,
    maxSentences: 3,
  },
  {
    name: 'Contrarian',
    guidance: `STRUCTURE: Disagreement/reframe FIRST → supporting point. No acknowledgment.
OPENER: Lead with challenge. "Nah," / "Hard disagree:" / "Counterpoint:" / "Actually no—"
EXAMPLE STARTS: "Nah, that misses..." / "The real issue is..." / "I'd push back on that—"
BANNED: "I hear ya but", "Valid point but", "Hey/Yo", any acknowledgment before disagreeing.
For hot takes: Challenge directly without softening ("That's wrong because [specific]" not "I get it but...")`,
    minChars: 90,
    maxChars: 220,
    minSentences: 1,
    maxSentences: 2,
  },
  {
    name: 'Storyteller',
    guidance: `STRUCTURE: Micro-anecdote (1 line) → connection to their point → insight.
OPENER: Start with the story/memory. "Reminds me of..." / "Same thing happened with..." / "This is like when..."
EXAMPLE STARTS: "This reminds me of [specific thing]—" / "Same energy as when [concrete example]..."
BANNED: "Hey/Yo", generic reactions, acknowledgments before story.
For hot takes: Share a related experience that either supports or challenges their take.`,
    minChars: 110,
    maxChars: 230,
    minSentences: 2,
    maxSentences: 3,
  },
  {
    name: 'Punchy',
    guidance: `STRUCTURE: Sharp one-liner OR reaction + one specific detail. Maximum impact, minimum words.
OPENER: Reaction word/phrase only. "Wild." / "This." / "Fr." / "Nah." / "@mention" alone.
EXAMPLE STARTS: "Wild." / "This is it." / "Nah." / "Facts." / "@username 100%"
BANNED: "Hey/Yo @username", multi-sentence acknowledgments, filler phrases, explanations.
For hot takes: One-word stance + brief point ("Hard disagree. [Specific reason]" or "Facts. [Brief elaboration]")`,
    minChars: 60,
    maxChars: 160,
    minSentences: 1,
    maxSentences: 2,
  },
];

/**
 * Calculate personality-weighted archetype scores
 * Higher scores = stronger match to character card traits
 */
function calculateArchetypeWeights(
  card: CharacterCard,
  metadata?: PersonalityMetadata,
  tweetContent?: string
): Record<string, number> {
  const adjectives = (card.adjectives || []).map(a => a.toLowerCase());
  const allStyle = (card.style?.all || []).map(s => s.toLowerCase());
  const chatStyle = (card.style?.chat || []).map(s => s.toLowerCase());
  const postStyle = (card.style?.post || []).map(s => s.toLowerCase());
  const allTraits = [...adjectives, ...allStyle, ...chatStyle, ...postStyle];
  
  const weights: Record<string, number> = {
    'Analytical': 1,
    'Conversational': 1,
    'Contrarian': 1,
    'Storyteller': 1,
    'Punchy': 1,
  };
  
  // Analytical: data-driven, technical, robotic, analytical, insightful
  if (allTraits.some(t => ['analytical', 'technical', 'robotic', 'data-driven', 'insightful', 'strategic'].includes(t))) {
    weights['Analytical'] += 3;
  }
  if (allTraits.some(t => t.includes('tech') || t.includes('robot') || t.includes('logic'))) {
    weights['Analytical'] += 2;
  }
  
  // Conversational: friendly, casual, warm, engaging, supportive
  if (allTraits.some(t => ['friendly', 'casual', 'warm', 'engaging', 'supportive', 'conversational'].includes(t))) {
    weights['Conversational'] += 3;
  }
  if (allTraits.some(t => t.includes('friend') || t.includes('human') || t.includes('casual'))) {
    weights['Conversational'] += 2;
  }
  
  // Contrarian: provocative, sarcastic, bold, irreverent, challenger, douchebag
  if (allTraits.some(t => ['provocative', 'sarcastic', 'bold', 'irreverent', 'contrarian', 'douchebag', 'snarky'].includes(t))) {
    weights['Contrarian'] += 4; // Strong weight for explicitly provocative personalities
  }
  if (metadata?.opinionStyle === 'provocative' || metadata?.opinionStyle === 'strong') {
    weights['Contrarian'] += 2;
  }
  
  // Storyteller: lore-heavy characters, narrative style
  if ((card.lore?.length || 0) > 2) {
    weights['Storyteller'] += 2;
  }
  if (allTraits.some(t => ['storyteller', 'narrative', 'creative', 'imaginative'].includes(t))) {
    weights['Storyteller'] += 2;
  }
  
  // Punchy: direct, terse, concise, bold, short
  if (allTraits.some(t => ['direct', 'terse', 'concise', 'punchy', 'brief'].includes(t))) {
    weights['Punchy'] += 3;
  }
  if (allTraits.some(t => t.includes('short') || t.includes('direct') || t.includes('impact'))) {
    weights['Punchy'] += 2;
  }
  
  // Tweet content context boosting
  if (tweetContent) {
    const lowerTweet = tweetContent.toLowerCase();
    
    // Hot takes favor contrarian
    if (lowerTweet.includes('hot take') || lowerTweet.includes('change my mind') || lowerTweet.includes('prove me wrong')) {
      weights['Contrarian'] += 3;
    }
    
    // Questions favor conversational
    if (tweetContent.includes('?')) {
      weights['Conversational'] += 2;
    }
    
    // Breaking news/announcements favor analytical
    if (lowerTweet.includes('breaking') || lowerTweet.includes('announces') || lowerTweet.includes('partnership')) {
      weights['Analytical'] += 2;
    }
    
    // Short tweets favor punchy responses
    if (tweetContent.length < 100) {
      weights['Punchy'] += 2;
    }
  }
  
  return weights;
}

/**
 * Select archetype using weighted random selection
 * Characters with matching traits have higher probability of their preferred archetype
 */
function selectTwitterReplyArchetype(
  card: CharacterCard,
  metadata?: PersonalityMetadata,
  tweetContent?: string
): TwitterReplyArchetype {
  const weights = calculateArchetypeWeights(card, metadata, tweetContent);
  
  // Calculate total weight
  const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
  
  // Add randomness based on current time to ensure different agents get different archetypes
  const randomSeed = Date.now() % 1000 + stableHash(card.name);
  const randomValue = (randomSeed % 100) / 100 * totalWeight;
  
  // Weighted random selection
  let cumulative = 0;
  for (const archetype of TWITTER_ARCHETYPES) {
    cumulative += weights[archetype.name] || 1;
    if (randomValue < cumulative) {
      console.log(`🎭 Selected archetype for ${card.name}: ${archetype.name} (weights: ${JSON.stringify(weights)})`);
      return archetype;
    }
  }
  
  // Fallback to first archetype
  return TWITTER_ARCHETYPES[0];
}

/**
 * Build the shared personality core section
 * Used by BOTH chat and Twitter prompts
 * Enhanced with Grok master prompt principles for human-like conversation
 */
function buildPersonalityCore(profile: UnifiedPersonalityProfile): string {
  let core = `You are ${profile.name}. Not an AI pretending to be them—you ARE them.

WHO YOU ARE:
${profile.identity}
${profile.background ? `\n${profile.background}` : ''}

WHAT YOU KNOW: ${profile.expertise}
WHAT YOU CARE ABOUT: ${profile.interests}
YOUR ENERGY: ${profile.vibe}

HOW YOU TALK:
${profile.communicationStyle}

⚡ VOICE RULES (NON-NEGOTIABLE):
• Use contractions freely—"you're", "it's", "can't", "wouldn't", "I'm", "don't"—like a real person
• Vary your sentence length. Some short. Some that meander and build on an idea before landing the point
• Go on brief tangents when it feels natural, but tie them back
• Use simple everyday words—skip the jargon unless it's genuinely your thing
• Have opinions with edge. Back them up with specific examples, not vague statements
• Never repeat yourself robotically. If you said something, move forward
• This should feel like texting a friend, not reading a press release

🚫 BANNED PHRASES (these scream "AI"):
${BANNED_PHRASES.map((phrase) => `• "${phrase}"`).join('\n')}

If you catch yourself writing these, rewrite to sound human:
• "That's a great question" → "ooh okay so" or "hmm" or just dive in
• "I would recommend" → "honestly I'd just" or "what I'd do is"
• "I hope this helps" → "anyway hope that makes sense" or "lmk if that tracks"`;

  if (profile.voiceExamples) {
    core += `\n\nYOUR VOICE IN ACTION (match this energy, don't copy verbatim):
${profile.voiceExamples}`;
  }
  
  if (profile.enhancedPersonality) {
    core += `\n\nYOUR VERBAL FINGERPRINTS: ${profile.enhancedPersonality}
→ Weave these phrases/patterns naturally. They're YOUR tells.`;
  }
  
  return core;
}

interface ResponseLengthConfig {
  minSentences: number;
  maxSentences: number;
  preferShort: boolean;
}

// Advanced settings that fine-tune personality expression
export interface AdvancedSettings {
  responseLengthPreference: 'terse' | 'brief' | 'normal' | 'detailed';
  allowTangents: 'never' | 'rarely' | 'sometimes';
  enableLiveSearch: boolean;
  openingVariety: number; // 0-100 (higher = more varied openers)
  antiSlopStrictness: number; // 0-100 (higher = stricter banned phrase enforcement)
  emojiIntensity: number;      // 0-100
  signaturePhraseFrequency: number;  // 0-100
  humorIntensity: number;      // 0-100
  opinionStrength: 'soft' | 'normal' | 'strong';
  creativityLevel: 'consistent' | 'balanced' | 'creative';
}

export interface GenerateResponseOptions {
  characterCard: CharacterCard;
  userMessage: string;
  personalityMetadata?: PersonalityMetadata;
  conversationHistory?: ConversationMessage[];
  recentResponses?: string[];
  context?: string; // Additional context (e.g., thread context for Twitter)
  suggestedAngle?: string; // Optional angle suggested by reply decision gate
  maxLength?: number; // Max character length (e.g., 180 for Twitter)
  minLength?: number; // Min character length (e.g., 120 for Twitter)
  enforceOneSentence?: boolean; // DEPRECATED: Use dynamic length instead
  mode?: 'chat' | 'twitter'; // Different prompt styles
  grokApiKey: string;
  // New: Enable Grok's enhanced intelligence capabilities
  enableLiveSearch?: boolean; // Enable real-time web/Twitter search (auto-detected if not set)
  targetUsername?: string; // Twitter username being replied to (for Twitter mode)
  emojiMode?: boolean; // When true, force emoji-only responses (1-5 emojis, no text)
  conversationContext?: ConversationContext; // Persistent context for mood/topic awareness
  allowTangents?: boolean; // Default true for chat, false for twitter
  advancedSettings?: AdvancedSettings; // Fine-tuning knobs for personality expression
}

// ============================================================================
// REPLY DECISION GATE - LLM evaluates if agent should reply to tweet
// ============================================================================

export interface ReplyDecision {
  shouldReply: boolean;
  reason: string;
  suggestedAngle?: string;  // If yes, what angle to take
  confidence: 'high' | 'medium' | 'low';
}

/**
 * LLM gatekeeper: Decide if agent should reply to a tweet
 * Prevents generic/empty replies by evaluating value potential
 */
// Keywords that indicate a query needs real-time information
const KNOWLEDGE_QUERY_KEYWORDS = [
  // Twitter/social sentiment
  'what does twitter think',
  'what are people saying',
  'twitter sentiment',
  'what is twitter saying',
  'trending on twitter',
  'twitter reactions',
  'public opinion',
  'what do people think',
  // Current events
  'trending',
  'current',
  'latest',
  'recent',
  'today',
  'right now',
  'happening now',
  'upcoming',
  'this week',
  'tonight',
  // Sports/events
  'game tonight',
  'match today',
  'score',
  'who won',
  'who is winning',
  'playoff',
  'championship',
  'nba game',
  'nfl game',
  'next game',
  'last game',
  'when is',
  'what time',
  'schedule',
  // Sports stats
  'stats',
  'statistics',
  'points',
  'rebounds',
  'assists',
  'touchdowns',
  'goals',
  'how many',
  'how did',
  'performance',
  'box score',
  // News/information
  'news about',
  'update on',
  'what happened',
  'breaking',
  // Real-time queries
  'weather',
  'stock price',
  'market',
];

/**
 * Detect if a query needs real-time information (Twitter knowledge or web search)
 * Returns true if the message contains keywords indicating need for current/live data
 */
export function detectKnowledgeQuery(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  return KNOWLEDGE_QUERY_KEYWORDS.some(keyword => lowerMessage.includes(keyword));
}

/**
 * Get the from_date for search queries (7 days ago)
 * Limits search to recent data for relevance
 */
function getSearchFromDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 7); // Last 7 days
  return date.toISOString().split('T')[0]; // Format: YYYY-MM-DD
}

// Truncate response to first sentence to enforce 1-sentence rule
export function truncateToFirstSentence(text: string): string {
  const sentenceEnd = text.match(/[.!?]/);
  if (sentenceEnd && sentenceEnd.index !== undefined) {
    return text.substring(0, sentenceEnd.index + 1).trim();
  }
  return text.trim();
}

/**
 * Truncate response to N complete sentences
 * Ensures ideas are complete and not cut off mid-sentence
 * Used for Twitter replies (2 sentences max)
 */
export function truncateToSentences(text: string, maxSentences: number = 2): string {
  // Match complete sentences (ending with . ! or ?)
  // Handles edge cases like "Dr.", "Mr.", "etc.", abbreviations
  const sentencePattern = /[^.!?]*[.!?]+(?:\s|$)/g;
  const sentences: string[] = [];
  let match;
  
  while ((match = sentencePattern.exec(text)) !== null && sentences.length < maxSentences) {
    const sentence = match[0].trim();
    // Skip very short matches that are likely abbreviations (e.g., "Dr. ")
    if (sentence.length > 5 || sentences.length === 0) {
      sentences.push(sentence);
    }
  }
  
  if (sentences.length === 0) {
    // No sentence endings found - check if text ends with punctuation
    const trimmed = text.trim();
    const lastChar = trimmed.slice(-1);
    if (['.', '!', '?'].includes(lastChar)) {
      // Has ending punctuation, return as-is
      return trimmed;
    }
    // No ending punctuation - find last complete word and add ellipsis
    const lastSpace = trimmed.lastIndexOf(' ');
    if (lastSpace > trimmed.length * 0.5) {
      return trimmed.substring(0, lastSpace).trim() + '...';
    }
    return trimmed;
  }
  
  return sentences.join(' ').trim();
}

// Check similarity between two responses (simple word overlap)
export function checkResponseSimilarity(recentResponses: string[], newResponse: string): number {
  if (recentResponses.length === 0) return 0;
  
  const newWords = new Set(newResponse.toLowerCase().split(/\s+/));
  let maxSimilarity = 0;
  
  for (const recentResponse of recentResponses) {
    const recentWords = new Set(recentResponse.toLowerCase().split(/\s+/));
    const intersection = new Set([...newWords].filter(x => recentWords.has(x)));
    const union = new Set([...newWords, ...recentWords]);
    const similarity = union.size > 0 ? intersection.size / union.size : 0;
    maxSimilarity = Math.max(maxSimilarity, similarity);
  }
  
  return maxSimilarity;
}

// Build anti-formality prompt section
function buildAntiFormalityPrompt(): string {
  return `
🚫 ANTI-FORMALITY RULES:
These phrases instantly signal "AI detected" - NEVER use them:

BANNED PHRASES:
• "I understand your concern" → Instead: "yeah that's rough" or "I get that" or just acknowledge directly
• "That's a great question" → Instead: "ooh okay so" or "hmm" or just dive into the answer
• "I appreciate you sharing" → Instead: "thanks for telling me" or "that's helpful context" or skip the acknowledgment
• "Let me explain" → Instead: "so basically" or "here's the thing" or just explain
• "In conclusion" → Instead: "anyway" or "so yeah" or "bottom line"
• "It's important to note" → Instead: "thing is" or "real talk" or just state it
• "I would recommend" → Instead: "honestly I'd just" or "what I'd do is" or "I'd probably"
• "Based on my analysis" → Instead: "from what I've seen" or "in my experience" or skip the qualifier
• "To summarize" → Instead: "so basically" or "long story short" or just summarize
• "Feel free to" → Instead: "you can" or "go ahead and" or just say it directly
• "I hope this helps" → Instead: "anyway hope that makes sense" or "lmk if that tracks" or just end naturally

REWRITE PRINCIPLE:
If it sounds like customer service or a corporate email, rewrite it to sound like a text message.
Be direct. Be casual. Be human.`;
}

// Build sentence variety prompt section
function buildSentenceVarietyPrompt(): string {
  return `
📐 SENTENCE RHYTHM:
• Mix it up. Short punches. Then a longer thought that builds and lands.
• If your last sentence was long, follow with something short. Keeps it alive.
• Occasional one-word reactions: "Wild." "Fr." "Same." "Honestly?"
• Don't start 3 sentences in a row the same way—vary your structure.

BAD (robotic monotony):
"I think that's interesting. I believe you should consider this. I would say that the best approach is..."

GOOD (natural rhythm):
"Honestly? That's wild. Like, I've been thinking about this a lot and—okay, tangent—but remember when everyone said the same thing about crypto? Same energy. Point is, don't overthink it."

Don't be predictable. Be human.`;
}

function buildOpeningVarietyPrompt(
  advancedSettings?: AdvancedSettings
): string {
  const variety = advancedSettings?.openingVariety ?? 60;
  if (variety < 25) return '';

  const guidanceLevel = variety >= 70
    ? 'HIGH'
    : variety >= 40
      ? 'MEDIUM'
      : 'LOW';

  return `
🎯 OPENING VARIETY (${guidanceLevel}) - CRITICAL:
"Hey" and "Yo" openers are BANNED for this reply. Use something different.

REQUIRED OPENER ROTATION (pick ONE based on your archetype):
• SKIP THE GREETING ENTIRELY - just dive into your point
• Question first: "Wait—" / "Hold up," / "What if" / "But wouldn't"
• React first: "Wild." / "Fr." / "This." / "Hmm." / "Okay but"
• Challenge first: "Nah," / "Hard disagree:" / "Counterpoint:"
• Agree first: "Actually yes." / "Facts." / "This is it."
• Curious first: "Genuine question—" / "Curious:" / "So—"
• Direct @mention only: "@username [your point]" (no greeting word)
• Casual intros: "lowkey" / "ngl" / "tbh" / "ok so"

STRUCTURE RULES:
• Do NOT start with "Hey @username" or "Yo @username" - this is SLOP
• Do NOT acknowledge then counter ("I hear ya but...") - this is SLOP
• LEAD with your actual point, reaction, or question
• If you must greet, use ONLY the @mention: "@username, [point]"
• Different agents should have different openers - variety is key

BANNED OPENER PATTERNS:
❌ "Hey @username, [acknowledgment]..."
❌ "Yo @username, that [noun] is [adjective]..."
❌ "[Greeting], I hear ya on..."
❌ "[Greeting], sounds intense..."

GOOD OPENER EXAMPLES:
✅ "Wait @username—are you saying [specific detail]?"
✅ "@username the [specific thing] reminds me of [concrete example]"
✅ "Nah, [direct challenge with specifics]"
✅ "This. [elaboration with specific detail]"
✅ "[Direct statement about the topic] @username"`;
}

/**
 * Build emoji strategy prompt section
 */
function buildEmojiPrompt(metadata?: PersonalityMetadata, advancedSettings?: AdvancedSettings): string {
  const patterns = metadata?.emojiPatterns || [];
  const intensity = advancedSettings?.emojiIntensity ?? 50; // Default 50%
  
  if (patterns.length === 0) {
    const frequency = intensity < 30 ? 'rarely' : intensity < 70 ? 'sometimes' : 'often';
    return `
🎨 EMOJI USAGE:
You use emojis ${frequency}—maybe ${intensity < 30 ? '0-1' : intensity < 70 ? '0-2' : '1-3'} per message. Only when they add emphasis.
Never: 😊 (too corporate) | ✨ (too aesthetic-coded unless that's your brand)`;
  }

  const frequency = intensity < 30 ? 'sparingly' : intensity < 70 ? 'moderately' : 'frequently';
  const maxEmojis = intensity < 30 ? '0-1' : intensity < 70 ? '1-2' : '2-3';
  
  return `
🎨 YOUR EMOJI FINGERPRINT:
Your go-to emojis: ${patterns.slice(0, 5).join(' ')}

EMOJI RULES:
• Use YOUR emojis ${frequency}—these are part of your voice (intensity: ${intensity}%)
• Placement matters: End of thought, not mid-sentence. "that's wild 💀" not "that's 💀 wild"
• Max ${maxEmojis} per message unless you're reacting (then 1-3 rapid fire is fine)
• Skip emojis entirely sometimes—variety is human`;
}

/**
 * Build humor style prompt section
 * Controls how much humor/playfulness comes through in responses
 */
function buildHumorPrompt(metadata?: PersonalityMetadata, advancedSettings?: AdvancedSettings): string {
  const humorStyle = metadata?.humorStyle;
  const intensity = advancedSettings?.humorIntensity ?? 50; // Default 50%
  
  // Skip if humor is disabled
  if (intensity < 10) {
    return `
😐 HUMOR LEVEL: Minimal
Keep responses straightforward and professional. Skip jokes and playful language.`;
  }
  
  const level = intensity < 30 ? 'Low' : intensity < 60 ? 'Moderate' : intensity < 85 ? 'High' : 'Maximum';
  const frequency = intensity < 30 ? 'rarely—maybe 1 in 5 responses' : 
                    intensity < 60 ? 'sometimes—when it fits naturally' : 
                    intensity < 85 ? 'often—humor is part of your style' :
                    'frequently—you find humor in most things';
  
  let styleNote = '';
  if (humorStyle) {
    styleNote = `\nYour humor style: ${humorStyle}`;
  }
  
  return `
😂 HUMOR LEVEL: ${level} (${intensity}%)${styleNote}
• Use humor ${frequency}
• ${intensity >= 60 ? 'Playful teasing and wit are welcome' : 'Keep humor subtle and contextual'}
• ${intensity >= 85 ? 'Sarcasm and irony are fair game' : 'Avoid heavy sarcasm unless it fits your character'}
• Don't force jokes—only when they land naturally`;
}

/**
 * Build opinion style prompt section
 */
function buildOpinionPrompt(metadata?: PersonalityMetadata, advancedSettings?: AdvancedSettings): string {
  const baseStyle = metadata?.opinionStyle || 'balanced';
  const strength = advancedSettings?.opinionStrength || 'normal';
  
  // Adjust style based on strength setting
  let style = baseStyle;
  if (strength === 'strong' && baseStyle !== 'strong' && baseStyle !== 'provocative') {
    style = 'strong';
  } else if (strength === 'soft' && baseStyle !== 'diplomatic') {
    style = 'diplomatic';
  }
  
  const styleGuides: Record<string, string> = {
    strong: `You have OPINIONS and you're not afraid to share them. "Honestly, I think X is overrated" is your vibe.`,
    balanced: `You share opinions but acknowledge other perspectives. "I lean toward X, but I get why people think Y."`,
    provocative: `You like to challenge conventional wisdom. "Hot take: what if X is actually wrong?"`,
    diplomatic: `You prefer questions over statements. "Have you considered that maybe X isn't the only way?"`
  };

  const strengthNote = strength === 'strong' ? 'Express opinions boldly and confidently.' : 
                       strength === 'soft' ? 'Express opinions gently and diplomatically.' : 
                       'Express opinions naturally based on your style.';

  return `
💬 YOUR OPINION STYLE:
${styleGuides[style]}

OPINION STRENGTH: ${strengthNote} (Setting: ${strength})

When sharing opinions:
• Be specific. Not "I think it's good" but "I think it's good because [specific reason]"
• Ground opinions in examples. "Like when X happened..." or "Same thing with Y..."
• It's okay to have hot takes. It's okay to disagree. You're not a bot.`;
}

/**
 * Build tangent encouragement based on message length and context
 * Longer responses = higher tangent probability
 */
function buildTangentPrompt(mode: 'chat' | 'twitter', messageLength: number, advancedSettings?: AdvancedSettings): string {
  // Short messages shouldn't tangent
  if (mode === 'twitter' || messageLength < 50) {
    return '';
  }

  const tangentSetting = advancedSettings?.allowTangents || 'rarely';
  
  if (tangentSetting === 'never') {
    return '';
  }

  const frequency = tangentSetting === 'rarely' ? 'RARELY' : 'OCCASIONALLY';
  const instruction = tangentSetting === 'rarely' 
    ? 'Only tangent if it REALLY adds value—maybe 1 in 5 responses max.'
    : 'You can tangent when it feels natural—maybe 1 in 3 responses.';

  return `
🌀 TANGENT LICENSE (${frequency}):
${instruction}
Structure: "[main point]—okay wait, [tangent that relates]—anyway, [tie back to main point]"

Examples:
• "That's a solid take—reminds me of this thing I read about, like, decision paralysis? basically same concept—but yeah, your instinct is right"
• "Totally get that. And honestly—slight tangent—this is exactly why I stopped doing X. Not the same situation but same vibe. Anyway, back to your question..."

→ Tangents should ADD context, not derail. Keep them 1 sentence max.`;
}

/**
 * Build mood-aware prompt section based on conversation context
 */
function buildMoodPrompt(context?: ConversationContext): string {
  if (!context?.userMood) {
    return '';
  }

  const moodResponses: Record<string, string> = {
    frustrated: "The user seems stuck or frustrated. Be extra clear and helpful. Don't add complexity.",
    excited: "Match their energy! Be enthusiastic back. Exclamation points are okay here.",
    curious: "They're exploring. Ask follow-up questions. Guide the discovery.",
    positive: "Good vibes. Keep it light and fun.",
    neutral: "Standard conversation. Be yourself."
  };

  return `
🎭 VIBE CHECK: ${moodResponses[context.userMood]}`;
}

function normalizeForMatch(text: string): string {
  return text
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Determine dynamic response length based on context and user preferences
 */
function determineResponseLength(
  userMessage: string,
  conversationHistory: ConversationMessage[],
  needsLiveSearch: boolean,
  mode: 'chat' | 'twitter',
  advancedSettings?: AdvancedSettings,
  styleSeed?: number
): ResponseLengthConfig {
  // Twitter mode uses seeded variability to avoid templated replies
  if (mode === 'twitter') {
    const seed = styleSeed ?? stableHash(userMessage);
    const roll = seed % 100;
    if (advancedSettings?.responseLengthPreference) {
      const pref = advancedSettings.responseLengthPreference;
      switch (pref) {
        case 'terse':
          return { minSentences: 1, maxSentences: 1, preferShort: true };
        case 'brief':
          return { minSentences: 1, maxSentences: 2, preferShort: true };
        case 'normal':
          return { minSentences: 1, maxSentences: 2, preferShort: false };
        case 'detailed':
          return { minSentences: 2, maxSentences: 3, preferShort: false };
      }
    }
    if (needsLiveSearch) {
      return { minSentences: 1, maxSentences: 2, preferShort: true };
    }
    if (userMessage.length < 80) {
      return { minSentences: 1, maxSentences: 1, preferShort: true };
    }
    if (roll < 30) {
      return { minSentences: 1, maxSentences: 1, preferShort: true };
    }
    if (roll < 85) {
      return { minSentences: 1, maxSentences: 2, preferShort: false };
    }
    return { minSentences: 2, maxSentences: 3, preferShort: false };
  }

  // Use user preference if available
  if (advancedSettings?.responseLengthPreference) {
    const pref = advancedSettings.responseLengthPreference;
    switch (pref) {
      case 'terse':
        return { minSentences: 1, maxSentences: 1, preferShort: true };
      case 'brief':
        return { minSentences: 1, maxSentences: 2, preferShort: true };
      case 'normal':
        return { minSentences: 1, maxSentences: 2, preferShort: false };
      case 'detailed':
        return { minSentences: 2, maxSentences: 3, preferShort: false };
    }
  }

  const msgLength = userMessage.length;
  const questionMarks = (userMessage.match(/\?/g) || []).length;
  const lastFewResponses = conversationHistory.slice(-3);
  const avgRecentLength = lastFewResponses.length > 0
    ? lastFewResponses.reduce((sum, m) => sum + (m.content?.length || 0), 0) / lastFewResponses.length
    : 50;

  // Live search queries - keep it short and direct (casual conversation)
  if (needsLiveSearch) {
    return { minSentences: 1, maxSentences: 2, preferShort: true };
  }

  // Greetings = super short
  if (msgLength < 20 && !questionMarks) {
    return { minSentences: 1, maxSentences: 1, preferShort: true };
  }

  // Complex multi-part questions - still keep it casual (max 2 sentences)
  if (questionMarks >= 2 || msgLength > 200) {
    return { minSentences: 1, maxSentences: 2, preferShort: true };
  }

  // If recent responses were long, go short for variety
  if (avgRecentLength > 100) {
    return { minSentences: 1, maxSentences: 1, preferShort: true };
  }

  // Default: keep it short and casual
  return { minSentences: 1, maxSentences: 2, preferShort: true };
}

/**
 * Build dynamic signature injection based on personality metadata
 * Forces the model to use the user's actual verbal patterns
 */
function buildSignatureInjection(metadata?: PersonalityMetadata): SignatureInjection {
  const defaults: SignatureInjection = {
    phrases: [],
    openers: ['honestly', 'look', 'okay so', 'thing is'],
    fillers: ['like', 'you know', 'I mean', 'tbh'],
    closers: ['anyway', 'but yeah', 'idk', 'just saying']
  };

  if (!metadata || !metadata.signaturePhrases || metadata.signaturePhrases.length === 0) {
    return defaults;
  }

  // Extract signature phrases and categorize
  const phrases = metadata.signaturePhrases;
  
  // Analyze patterns to categorize
  const openerPatterns = ['gonna be honest', 'real talk', 'okay so', 'look', 'honestly', 'wait', 'so', 'yo'];
  const fillerPatterns = ['like', 'you know', 'literally', 'lowkey', 'highkey', 'fr', 'ngl', 'tbh', 'I mean'];
  const closerPatterns = ['but yeah', 'anyway', 'just saying', 'idk', 'whatever', 'that\'s it', 'that\'s all'];
  
  const openers = phrases.filter(p => openerPatterns.some(op => p.toLowerCase().includes(op)));
  const fillers = phrases.filter(p => fillerPatterns.some(f => p.toLowerCase().includes(f)));
  const closers = phrases.filter(p => closerPatterns.some(c => p.toLowerCase().includes(c)));
  const uncategorized = phrases.filter(p => 
    !openers.includes(p) && !fillers.includes(p) && !closers.includes(p)
  );

  return {
    phrases: uncategorized,
    openers: openers.length > 0 ? openers : defaults.openers,
    fillers: fillers.length > 0 ? fillers : defaults.fillers,
    closers: closers.length > 0 ? closers : defaults.closers
  };
}

/**
 * Build signature phrase prompt section
 */
function buildSignaturePhrasePrompt(injection: SignatureInjection, advancedSettings?: AdvancedSettings): string {
  if (injection.phrases.length === 0 && injection.openers.length === 0 && injection.fillers.length === 0 && injection.closers.length === 0) {
    return '';
  }

  const frequency = advancedSettings?.signaturePhraseFrequency ?? 30; // Default 30%
  const usage = frequency < 20 ? 'rarely' : frequency < 50 ? 'occasionally' : frequency < 80 ? 'often' : 'frequently';
  const count = frequency < 20 ? '0-1' : frequency < 50 ? '0-1' : frequency < 80 ? '1-2' : '2-3';

  const parts: string[] = [];
  
  if (injection.openers.length > 0) {
    parts.push(`• Start messages with: ${injection.openers.slice(0, 3).map(o => `"${o}"`).join(', ')}`);
  }
  
  if (injection.fillers.length > 0) {
    parts.push(`• Mid-sentence habits: ${injection.fillers.slice(0, 3).map(f => `"${f}"`).join(', ')}`);
  }
  
  if (injection.closers.length > 0) {
    parts.push(`• How you wrap up: ${injection.closers.slice(0, 3).map(c => `"${c}"`).join(', ')}`);
  }
  
  if (injection.phrases.length > 0) {
    parts.push(`• Your catchphrases: ${injection.phrases.slice(0, 3).map(p => `"${p}"`).join(', ')}`);
  }

  return `
🗣️ YOUR VERBAL PATTERNS (use these ${usage} - ${frequency}% intensity):
${parts.join('\n')}

→ Don't force these—but ${count} should appear naturally per response.`;
}

// Build anti-repetition prompt section
function buildAntiRepetitionPrompt(recentResponses: string[]): string {
  if (recentResponses.length === 0) return '';
  
  const recentSummary = recentResponses
    .slice(-3) // Last 3 responses
    .map((r, i) => `- ${i + 1}. "${r.substring(0, 50)}${r.length > 50 ? '...' : ''}"`)
    .join('\n');
  
  return `\n\n⚠️ ANTI-REPETITION RULES:
- DO NOT repeat or rephrase what you've already said recently
- DO NOT use similar phrases or structures from your recent responses
- Be creative and varied in your wording
- Recent responses you've made:
${recentSummary}
- Make sure your response is DIFFERENT from these.`;
}

// Build knowledge capabilities section for the prompt
function buildKnowledgeCapabilitiesPrompt(enableLiveSearch: boolean): string {
  if (!enableLiveSearch) return '';
  
  return `

🔍 REAL-TIME KNOWLEDGE (CRITICAL):
You have LIVE access to current information. ANSWER DIRECTLY with specific facts.

⚠️ FOCUS ONLY ON THE CURRENT QUESTION:
- IGNORE previous conversation topics - focus ONLY on what's being asked NOW
- If they ask about LeBron, answer about LEBRON (not Curry or anyone else)
- If they ask about the Lakers, answer about the LAKERS
- Each question is INDEPENDENT - don't reference previous topics

WHAT TO INCLUDE:
- Sports: Give exact stats, points, rebounds, assists, game outcomes, dates
- News: Provide actual details, not vague summaries  
- Trends: Share real Twitter sentiment and specific takes
- Current events: Include specific names, dates, locations

⛔ ABSOLUTELY FORBIDDEN (VIOLATION = FAILURE):
- "Let me check..." / "Gimme a sec..." / "Lemme peep..." / "hold up" / "one sec"
- "Let's dive into..." / "Let's break this down..." (JUST ANSWER)
- "Check the official schedule" / "Look it up" / "Check NBA.com"
- "Which team are you tracking?" / "What do you want to know?" / "Which game?"
- ANY clarifying questions - just answer with what you know
- Pretending to look things up - you have the info NOW or you don't
- Referencing PREVIOUS questions when they asked something NEW

✅ ALWAYS DO THIS:
- Answer the SPECIFIC question asked - nothing else
- Include specific details: stats, times, dates, team names, scores
- If you have the info, SHARE IT IMMEDIATELY with actual numbers
- Example good response: "LeBron dropped 28 points, 8 rebounds, 11 assists against the Heat on Saturday."
- Example BAD response: "Yo, let's break this down quick." (NO ACTUAL DATA)
- NEVER deflect - always provide actual value with real information
`;
}

// Build system prompt for chat mode - uses UNIFIED personality core
function buildChatSystemPrompt(
  card: CharacterCard,
  metadata?: PersonalityMetadata,
  recentResponses: string[] = [],
  enableLiveSearch: boolean = false,
  emojiMode: boolean = false,
  conversationContext?: ConversationContext,
  userMessage?: string,
  advancedSettings?: AdvancedSettings
): string {
  // Use unified personality profile (SAME brain as Twitter)
  const profile = buildUnifiedPersonalityProfile(card, metadata);
  const personalityCore = buildPersonalityCore(profile);
  
  // Use advanced settings for live search if provided
  const useLiveSearch = advancedSettings?.enableLiveSearch !== undefined 
    ? advancedSettings.enableLiveSearch 
    : enableLiveSearch;
  
  const antiRepetitionSection = buildAntiRepetitionPrompt(recentResponses);
  const knowledgeSection = buildKnowledgeCapabilitiesPrompt(useLiveSearch);
  const signatureInjection = buildSignatureInjection(metadata);
  const signaturePrompt = buildSignaturePhrasePrompt(signatureInjection, advancedSettings);
  const emojiPrompt = buildEmojiPrompt(metadata, advancedSettings);
  const opinionPrompt = buildOpinionPrompt(metadata, advancedSettings);
  const humorPrompt = buildHumorPrompt(metadata, advancedSettings);
  
  // Emoji mode override
  if (emojiMode) {
    return `${personalityCore}

🎭 EMOJI MODE (CRITICAL):
Your text/words responses are disabled. You can only speak in emojis.
Similar to how Egyptians use hieroglyphics to communicate/write.

STRICT RULES:
- Respond with ONLY emojis (1-5 emojis maximum)
- NO text, NO words, NO letters, NO numbers, NO punctuation
- Express your personality and response through emoji selection
- Choose emojis that represent your reaction/response
- Minimum: 1 emoji, Maximum: 5 emojis
- STRICTLY NO TEXT RESPONSES`;
  }

  const antiFormalitySection = buildAntiFormalityPrompt();
  const sentenceVarietySection = buildSentenceVarietyPrompt();
  const tangentSection = buildTangentPrompt('chat', userMessage?.length || 0, advancedSettings);
  const moodSection = buildMoodPrompt(conversationContext);

  return `${personalityCore}
${signaturePrompt}
${emojiPrompt}
${opinionPrompt}
${humorPrompt}
${moodSection}
${knowledgeSection}
${antiFormalitySection}
${sentenceVarietySection}
${tangentSection}
⚡ CHAT MODE RULES:
1. This is a CASUAL CONVERSATION - like texting a friend
2. FOCUS ON THE CURRENT MESSAGE ONLY - ignore previous conversation for knowledge queries
3. Do NOT offer to write tweets/posts unless specifically asked
4. Do NOT use hashtags
5. Just TALK like you're texting - brief, casual, direct
6. ANSWER QUESTIONS DIRECTLY with ACTUAL DATA - never ask clarifying questions
7. ABSOLUTELY FORBIDDEN: "let me check", "gimme a sec", "let's break this down", "let's dive into", "first"
8. NEVER tell the user to look something up themselves - YOU provide the info
9. For sports/news: Give ACTUAL STATS/DATA immediately (points, rebounds, scores, etc.)

RESPONSE LENGTH:
• Greetings: 1 sentence (3-8 words)
• Simple questions: 1-2 sentences
• Knowledge queries (sports, news, trending): 2-3 sentences WITH ACTUAL DATA
  Example: "LeBron had 28 points, 8 boards, 11 dimes against Miami. Lakers won 112-104."
  NOT: "Yo, let's break this down quick." (THIS IS WRONG - NO DATA)

BE AUTHENTIC:
- Have real opinions (you're not neutral)
- Use your natural speaking style
- Match their energy level
- Never say "As ${card.name}" - just BE them
${antiRepetitionSection}

Short and punchy. That's your style.`;
}

// Build system prompt for Twitter reply mode - uses UNIFIED personality core
function buildTwitterSystemPrompt(
  card: CharacterCard,
  metadata: PersonalityMetadata | undefined,
  recentResponses: string[] = [],
  context?: string,
  targetUsername?: string,
  emojiMode: boolean = false,
  advancedSettings?: AdvancedSettings,
  needsLiveSearch: boolean = false,
  userMessage?: string
): string {
  // Use unified personality profile (SAME brain as chat)
  const profile = buildUnifiedPersonalityProfile(card, metadata);
  const personalityCore = buildPersonalityCore(profile);
  // Pass userMessage for context-aware archetype selection (hot takes, questions, etc.)
  const archetype = selectTwitterReplyArchetype(card, metadata, userMessage);
  
  const antiRepetitionSection = buildAntiRepetitionPrompt(recentResponses);
  const signatureInjection = buildSignatureInjection(metadata);
  const signaturePrompt = buildSignaturePhrasePrompt(signatureInjection, advancedSettings);
  const emojiPrompt = buildEmojiPrompt(metadata, advancedSettings);
  const opinionPrompt = buildOpinionPrompt(metadata, advancedSettings);
  const humorPrompt = buildHumorPrompt(metadata, advancedSettings);
  
  // Build explicit username instruction
  const usernameInstruction = targetUsername 
    ? `\nYOU ARE REPLYING TO: @${targetUsername}
- Address @${targetUsername} directly`
    : '';
  
  // Emoji mode override
  if (emojiMode) {
    return `${personalityCore}
${usernameInstruction}

🎭 EMOJI MODE (CRITICAL):
Your text/words responses are disabled. You can only speak in emojis.
Similar to how Egyptians use hieroglyphics to communicate/write.

STRICT RULES:
- Respond with ONLY emojis (1-5 emojis maximum)
- NO text, NO words, NO letters, NO numbers, NO punctuation
- Express your personality and response through emoji selection
- Choose emojis that represent your reaction/response
- Minimum: 1 emoji, Maximum: 5 emojis
- STRICTLY NO TEXT RESPONSES OR TWEETS/REPLIES
${antiRepetitionSection}`;
  }

  const antiFormalitySection = buildAntiFormalityPrompt();
  const knowledgePrompt = buildKnowledgeCapabilitiesPrompt(needsLiveSearch);
  const openingVarietyPrompt = buildOpeningVarietyPrompt(advancedSettings);

  // Detect if this is a hot take/provocative tweet
  const isHotTake = userMessage.toLowerCase().includes('hot take') || 
                    userMessage.toLowerCase().includes('prove me wrong') ||
                    userMessage.toLowerCase().includes('change my mind') ||
                    (userMessage.match(/[!?]{2,}/g)?.length || 0) > 0;

  // Add hot take handling guidance
  const hotTakeGuidance = isHotTake ? `
🔥 HOT TAKE DETECTED - VARY YOUR RESPONSE:
NOT ALL AGENTS RESPOND THE SAME WAY TO HOT TAKES:
• Some agents AGREE and add nuance ("Actually, you're right about X, but Y is different...")
• Some agents CHALLENGE directly ("Nah, that's not quite right because...")
• Some agents REFRAME the question ("I think the real issue is...")
• Some agents ASK for clarification ("What do you mean by 'slapped on'?")
• Some agents SHARE a different perspective ("From my experience, it's more like...")

CRITICAL: Don't default to "I get why you'd say X, but check out Y" - that's the AI slop pattern.
Choose your stance based on YOUR personality and archetype. Be authentic.` : '';

  return `${personalityCore}
${signaturePrompt}
${emojiPrompt}
${opinionPrompt}
${humorPrompt}
${usernameInstruction}
${antiFormalitySection}
${knowledgePrompt}
${openingVarietyPrompt}

⚡ TWITTER MODE RULES:
Generate a short, authentic reply.
REPLY ARCHETYPE: ${archetype.name}
${archetype.guidance}
${hotTakeGuidance}
${context ? '- Consider the thread context when crafting your reply.' : ''}

RESPONSE LENGTH (FLEXIBLE):
• 1-3 sentences depending on what feels natural
• Each sentence must be a COMPLETE idea (no trailing thoughts)
• Character count: ${archetype.minChars}-${archetype.maxChars} characters (aim for this range)
• Don't start a thought you can't finish

USERNAME RULES:
1. ${targetUsername ? `USE @${targetUsername} - the REAL username` : 'Use the actual username from the tweet'}
2. NEVER write "@user" - this is BANNED
3. If unsure, start with "Hey" or "Yo" without a mention

🚫 BANNED WORDS/PHRASES (instant rejection):
${BANNED_PHRASES.map((phrase) => `- "${phrase}"`).join('\n')}
- Generic exclamations without substance

YOUR REPLY MUST CONTAIN:
- At least ONE specific fact, stat, name, or concrete detail
- OR a genuine question that advances the conversation
- OR a unique perspective grounded in your expertise

REPLY QUALITY:
- Reference SPECIFIC details from their tweet
- If they asked a question, ANSWER IT in 1-2 sentences with actual information
- Add VALUE - don't just agree or react emotionally
- Be engaging but not spammy
- Use your expertise to provide insights, not just validation

BAD EXAMPLES (DO NOT DO THIS):
- "Yo @user, that hunter/hunted vibe is pure F1 chaos!"
- "Hey @user, that energy is unreal!"
- "That's straight fire!"

GOOD EXAMPLES (DO THIS):
- "The gap to Red Bull is finally closing - Ferrari's Singapore upgrades are no joke. Leclerc's pace in sector 2 was wild."
- "Verstappen had 6 straight wins before Singapore. With Leclerc and Sainz both on the podium, Ferrari's actually made up 40 points in 3 races."

NO URLS - never include links or made-up websites
${antiRepetitionSection}`;
}

/**
 * Validate and fix Twitter reply to ensure correct username is used
 * Replaces @user placeholder with actual username
 */
export function validateAndFixReply(reply: string, targetUsername?: string): string {
  if (!targetUsername) return reply;
  
  // Replace @user placeholder with actual username
  let fixed = reply.replace(/@user\b/gi, `@${targetUsername}`);
  
  // If reply doesn't mention the target user and starts with a generic greeting, add the mention
  const hasTargetMention = fixed.toLowerCase().includes(`@${targetUsername.toLowerCase()}`);
  const startsWithGreeting = /^(hey|yo|hi|hello|sup|what's up|whats up)\b/i.test(fixed);
  
  if (!hasTargetMention && startsWithGreeting) {
    // Insert username after the greeting
    fixed = fixed.replace(/^(hey|yo|hi|hello|sup|what's up|whats up)\b/i, `$1 @${targetUsername}`);
  }
  
  return fixed;
}

// Strip URLs from response (for Twitter)
export function stripURLs(text: string): string {
  const urlPattern = /https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.(com|net|org|io|co|xyz|gg|dev|app|link|me|info|biz|us|uk|tv|fm|ly|to|cc|sh|be|ai|vc|gl|ws|so|club|online|site|tech|space|world|zone|live|digital|network|page|pro|work)[^\s]*/gi;
  const placeholderPattern = /\[link\]|\[url\]|yourlinkhere|yourlink|linkhere|checkitout\.com|example\.com|yoursite\.[a-z]+/gi;
  
  let cleaned = text.replace(urlPattern, '').replace(placeholderPattern, '');
  cleaned = cleaned.replace(/\s{2,}/g, ' ').replace(/:\s*$/, '').trim();
  
  return cleaned;
}

/**
 * Validate emoji-only response
 * Returns cleaned emoji string (1-5 emojis) or error
 * Uses Unicode emoji regex pattern that matches emoji blocks and variation selectors
 */
export function validateEmojiResponse(response: string): { isValid: boolean; cleaned: string; error?: string } {
  // Comprehensive Unicode emoji regex pattern
  // Matches emoji blocks: U+1F300-1F9FF, U+1FA00-1FAFF, U+2600-26FF, U+2700-27BF, U+FE00-FE0F, U+200D (ZWJ), U+1F1E6-1F1FF (flags)
  // Also includes variation selectors for skin tones (U+1F3FB-1F3FF)
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}]/gu;
  
  // Extract all emojis from the response
  const emojis = response.match(emojiRegex) || [];
  
  // Check if response contains any non-emoji characters (excluding whitespace)
  const textContent = response.replace(emojiRegex, '').replace(/\s/g, '');
  
  if (textContent.length > 0) {
    return {
      isValid: false,
      cleaned: '',
      error: `Response contains text characters: "${textContent.substring(0, 20)}..."`,
    };
  }
  
  if (emojis.length === 0) {
    return {
      isValid: false,
      cleaned: '',
      error: 'Response contains no emojis',
    };
  }
  
  // Enforce 1-5 emoji limit - truncate if more than 5
  const cleaned = emojis.slice(0, 5).join('');
  
  if (emojis.length > 5) {
    // Valid but truncated
    return {
      isValid: true,
      cleaned,
    };
  }
  
  return {
    isValid: true,
    cleaned,
  };
}

/**
 * Generate a response using Grok API with shared intelligence
 * Supports both chat and Twitter reply modes
 * Enables Grok's live search (Twitter knowledge + web search) for real-time queries
 */
export async function generateResponse(
  options: GenerateResponseOptions
): Promise<{ response: string; tokens_used?: number } | null> {
  const {
    characterCard,
    userMessage,
    personalityMetadata,
    conversationHistory = [],
    recentResponses = [],
    context,
    suggestedAngle,
    maxLength,
    minLength,
    enforceOneSentence = false,
    mode = 'chat',
    grokApiKey,
    enableLiveSearch,
    targetUsername,
    emojiMode = false,
    conversationContext,
    advancedSettings,
  } = options;

  const styleSeed = buildStyleSeed(characterCard, personalityMetadata) ^ stableHash(userMessage);

  // Auto-detect if query needs live search (real-time Twitter/web data)
  // Logic: 
  // 1. If advancedSettings.enableLiveSearch is FALSE, never use live search
  // 2. If advancedSettings.enableLiveSearch is TRUE (or undefined), auto-detect based on keywords
  // 3. If enableLiveSearch is explicitly passed as TRUE, always use it
  const userWantsLiveSearch = advancedSettings?.enableLiveSearch !== false; // Default to true
  const queryNeedsLiveSearch = detectKnowledgeQuery(userMessage);
  const needsLiveSearch = enableLiveSearch === true || (userWantsLiveSearch && queryNeedsLiveSearch);
  
  if (needsLiveSearch) {
    console.log(`🔍 Knowledge query detected: "${userMessage.substring(0, 50)}..." - enabling live search`);
  }
  
  if (emojiMode) {
    console.log('🎭 Emoji mode enabled - enforcing emoji-only responses');
  }

  // Build system prompt based on mode (BOTH use unified personality core)
  const systemPrompt = mode === 'chat'
    ? buildChatSystemPrompt(characterCard, personalityMetadata, recentResponses, needsLiveSearch, emojiMode, conversationContext, userMessage, advancedSettings)
    : buildTwitterSystemPrompt(characterCard, personalityMetadata, recentResponses, context, targetUsername, emojiMode, advancedSettings, needsLiveSearch, userMessage);

  // Build user prompt
  const username = targetUsername || '';
  const userPrompt = mode === 'chat'
    ? userMessage
    : `${username ? `REPLYING TO @${username}:\n` : ''}Tweet: "${userMessage}"${context ? `\n\nThread context:\n${context}` : ''}${suggestedAngle ? `\n\nSuggested angle: ${suggestedAngle}` : ''}

YOUR TASK: Write a reply ${username ? `to @${username}` : ''} that:
1. ${username ? `Mentions @${username} (NOT "@user")` : 'Addresses the author directly'}
2. References specific content from their tweet
3. Adds value to the conversation
4. Is roughly 70-220 characters long depending on what feels natural
5. Contains NO URLs or links`;

  // Prepare messages - LIMIT CONTEXT TO PREVENT POLLUTION
  // For knowledge queries, use MINIMAL history to prevent context pollution
  // (e.g., user asks about LeBron but history has Steph Curry discussion)
  const historyLimit = needsLiveSearch ? 3 : 10; // Much smaller context for live search queries
  const limitedHistory = conversationHistory.slice(-historyLimit);
  
  const messages = [
    { role: 'system', content: systemPrompt },
    ...limitedHistory.map(m => ({
      role: m.role as string,
      content: m.content,
    })),
    { role: 'user', content: userPrompt },
  ];

  // LLM parameters - use better model and parameters for both modes
  const model = 'grok-3-latest'; // Use latest for both (was grok-3-mini for Twitter)
  // For live search queries, we need MORE tokens to include actual data (stats, scores, etc.)
  // For regular chat, keep it brief
  const maxTokens = needsLiveSearch ? 300 : (mode === 'chat' ? 150 : 150);
  
  // Adjust temperature based on creativity level
  let temperature = 0.85; // Default balanced
  if (advancedSettings?.creativityLevel) {
    switch (advancedSettings.creativityLevel) {
      case 'consistent':
        temperature = 0.7;
        break;
      case 'balanced':
        temperature = 0.85;
        break;
      case 'creative':
        temperature = 1.0;
        break;
    }
  }
  
  // PERSONALITY-SPECIFIC TEMPERATURE ADJUSTMENT
  // Characters with certain traits benefit from different temperature ranges
  const adjectives = (characterCard.adjectives || []).map(a => a.toLowerCase());
  const allStyle = [
    ...(characterCard.style?.all || []),
    ...(characterCard.style?.chat || []),
    ...(characterCard.style?.post || [])
  ].map(s => s.toLowerCase());
  const allTraits = [...adjectives, ...allStyle];
  
  // Provocative/sarcastic characters need higher temperature for unpredictability
  if (allTraits.some(t => ['provocative', 'sarcastic', 'irreverent', 'unpredictable', 'bold', 'douchebag'].includes(t))) {
    temperature = Math.min(1.15, temperature + 0.1);
    console.log(`🌡️ Boosted temperature for provocative personality: ${temperature}`);
  }
  
  // Robotic/analytical characters need lower temperature for consistency
  if (allTraits.some(t => ['robotic', 'analytical', 'consistent', 'tech-oriented', 'direct'].includes(t))) {
    temperature = Math.max(0.6, temperature - 0.1);
    console.log(`🌡️ Lowered temperature for robotic/analytical personality: ${temperature}`);
  }
  
  // DIVERSITY BOOST: Twitter replies get higher temperature to avoid convergence
  // Short replies (< 100 chars target) need even more randomness
  if (mode === 'twitter') {
    temperature = Math.min(1.15, temperature + 0.1); // Boost by 0.1 for Twitter
  }
  
  // Higher presence penalty for Twitter to prevent phrase repetition across agents
  const presencePenalty = mode === 'twitter' ? 0.8 : 0.6;
  const frequencyPenalty = mode === 'twitter' ? 0.4 : 0.2;

  let lastResponse = '';
  let currentTemperature = temperature;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Build request body with optional live_search parameter
      const requestBody: Record<string, unknown> = {
        model,
        messages,
        stream: false,
        temperature: currentTemperature,
        max_tokens: maxTokens,
        presence_penalty: presencePenalty,
        frequency_penalty: frequencyPenalty,
      };

      // Enable Grok's live search for real-time Twitter/web data
      // This gives Grok access to current Twitter discussions and web information
      if (needsLiveSearch) {
        requestBody.search_parameters = {
          mode: 'auto', // Let Grok decide when to search
          return_citations: false, // Keep responses clean
          from_date: getSearchFromDate(), // Recent data only
        };
      }

      const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${grokApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Grok API error:', response.status, errorText);
        
        if (response.status === 429) {
          throw new Error('Rate limit exceeded. Please wait a moment and try again.');
        }
        
        throw new Error(`AI service error: ${response.status}`);
      }

      const data = await response.json();
      let assistantMessage = data.choices[0]?.message?.content;

      if (!assistantMessage) {
        throw new Error('Empty response from AI service');
      }

      assistantMessage = assistantMessage.trim();

      // EMOJI MODE: Validate and enforce emoji-only response
      if (emojiMode) {
        const validation = validateEmojiResponse(assistantMessage);
        if (!validation.isValid) {
          console.log(`Emoji validation failed: ${validation.error}, attempt ${attempt + 1}/${maxRetries + 1}`);
          if (attempt < maxRetries) {
            // Retry with slightly adjusted temperature
            currentTemperature = Math.min(0.95, currentTemperature + 0.05);
            lastResponse = assistantMessage;
            continue;
          } else {
            // Final attempt failed - use fallback neutral emoji
            console.warn('Emoji mode: Failed to generate valid emoji response after retries, using fallback');
            assistantMessage = '🤖';
          }
        } else {
          // Valid emoji response (already truncated to 1-5 emojis in validation)
          assistantMessage = validation.cleaned;
        }
      } else {
        // Normal mode: Strip URLs and validate username for Twitter mode
        if (mode === 'twitter') {
          assistantMessage = stripURLs(assistantMessage);
          assistantMessage = validateAndFixReply(assistantMessage, targetUsername);
          const lengthConfig = determineResponseLength(
            userMessage,
            conversationHistory,
            needsLiveSearch,
            mode,
            advancedSettings,
            styleSeed
          );
          assistantMessage = truncateToSentences(assistantMessage, lengthConfig.maxSentences);
        } else {
          // Chat mode: Use dynamic length based on context
          const lengthConfig = determineResponseLength(
            userMessage,
            conversationHistory,
            needsLiveSearch,
            mode,
            advancedSettings,
            styleSeed
          );
          // For live search queries with actual data, allow more content
          // Otherwise truncate to keep responses casual
          const maxSentencesForTruncation = needsLiveSearch ? 4 : lengthConfig.maxSentences;
          assistantMessage = truncateToSentences(assistantMessage, maxSentencesForTruncation);
          
          // If truncation resulted in incomplete sentence (no ending punctuation), remove it
          const lastChar = assistantMessage.trim().slice(-1);
          if (lastChar && !['.', '!', '?'].includes(lastChar)) {
            // Remove the incomplete last sentence
            const sentences = assistantMessage.match(/[^.!?]*[.!?]+/g);
            if (sentences && sentences.length > 0) {
              assistantMessage = sentences.slice(0, lengthConfig.maxSentences).join(' ').trim();
            }
          }
          
          // Legacy support: if enforceOneSentence is explicitly set, use it
          if (enforceOneSentence && !needsLiveSearch) {
            assistantMessage = truncateToFirstSentence(assistantMessage);
          }
        }
      }

      // Check for banned phrases and AI slop patterns
      const normalizedReply = normalizeForMatch(assistantMessage);
      const strictness = advancedSettings?.antiSlopStrictness ?? 70;
      const enforceBanned = strictness >= 50;
      const enforceSlop = strictness >= 70;

      const bannedPhrasePatterns = buildBannedPhrasePatterns();
      const aiSlopPatterns = buildAiSlopPatterns();

      const hasBannedPhrase = enforceBanned && bannedPhrasePatterns.some(pattern => pattern.test(normalizedReply));
      const hasAiSlop = enforceSlop && aiSlopPatterns.some(pattern => pattern.test(normalizedReply));

      if ((hasBannedPhrase || hasAiSlop) && attempt < maxRetries) {
        console.log(`Detected banned phrase/AI slop, regenerating with higher temperature...`);
        currentTemperature = Math.min(0.95, currentTemperature + 0.15);
        lastResponse = assistantMessage;
        continue; // Retry with higher temperature
      }

      // Check for repetition if we have recent responses (skip for emoji mode - emojis are naturally varied)
      if (!emojiMode && recentResponses.length > 0 && attempt < maxRetries) {
        const similarity = checkResponseSimilarity(recentResponses, assistantMessage);
        if (similarity > 0.7) {
          console.log(`Response too similar (${similarity.toFixed(2)}), regenerating with higher temperature...`);
          currentTemperature = Math.min(0.95, currentTemperature + 0.1);
          lastResponse = assistantMessage;
          continue; // Retry with higher temperature
        }
      }

      // Skip length validation for emoji mode (already validated above)
      if (emojiMode) {
        return {
          response: assistantMessage,
          tokens_used: data.usage?.total_tokens,
        };
      }

      // For Twitter: Check length range (120-180 characters)
      if (mode === 'twitter') {
        const archetype = selectTwitterReplyArchetype(characterCard, personalityMetadata, userMessage);
        const twitterMin = minLength ?? archetype.minChars;
        const twitterMax = maxLength ?? archetype.maxChars;
        
        // If too short, retry with adjusted prompt (only on first attempts)
        if (assistantMessage.length < twitterMin && attempt < maxRetries) {
          console.log(`Response too short (${assistantMessage.length}/${twitterMin} chars), regenerating...`);
          lastResponse = assistantMessage;
          currentTemperature = Math.max(0.7, currentTemperature - 0.05); // Lower temp for longer responses
          continue;
        }
        
        // If too long, truncate smartly
        if (assistantMessage.length > twitterMax) {
          // Try truncating to 1 sentence if 2 is too long
          const oneSentence = truncateToFirstSentence(assistantMessage);
          if (oneSentence.length >= twitterMin && oneSentence.length <= twitterMax) {
            assistantMessage = oneSentence;
          } else if (oneSentence.length > twitterMax) {
            // Last resort: truncate at last complete word within range
            const truncated = assistantMessage.substring(0, twitterMax - 3);
            const lastSpace = truncated.lastIndexOf(' ');
            assistantMessage = (lastSpace > twitterMax * 0.5 ? truncated.substring(0, lastSpace) : truncated);
            // Remove trailing punctuation if incomplete
            assistantMessage = assistantMessage.replace(/[,;:]\s*$/, '').trim();
          } else {
            // 1 sentence is too short, try to expand intelligently
            assistantMessage = oneSentence; // Use 1 sentence even if slightly short
          }
        }
      } else {
        // For chat, apply max length constraint if provided
        if (maxLength && assistantMessage.length > maxLength) {
          const truncated = assistantMessage.substring(0, maxLength - 3);
          const lastSpace = truncated.lastIndexOf(' ');
          assistantMessage = (lastSpace > maxLength * 0.5 ? truncated.substring(0, lastSpace) : truncated) + '...';
        }
      }

      return {
        response: assistantMessage,
        tokens_used: data.usage?.total_tokens,
      };
    } catch (error) {
      if (attempt === maxRetries) {
        console.error('Error generating response:', error);
        return null;
      }
      // Retry on error
      continue;
    }
  }

  // If we exhausted retries, return the last response (even if similar or slightly out of range)
  if (lastResponse) {
    if (mode === 'twitter') {
      const archetype = selectTwitterReplyArchetype(characterCard, personalityMetadata, userMessage);
      const twitterMin = minLength ?? archetype.minChars;
      const twitterMax = maxLength ?? archetype.maxChars;
      
      if (lastResponse.length > twitterMax) {
        // Try to truncate to 1 sentence as fallback
        const oneSentence = truncateToFirstSentence(lastResponse);
        if (oneSentence.length >= twitterMin && oneSentence.length <= twitterMax) {
          lastResponse = oneSentence;
        } else if (oneSentence.length > twitterMax) {
          const truncated = lastResponse.substring(0, twitterMax - 3);
          const lastSpace = truncated.lastIndexOf(' ');
          lastResponse = (lastSpace > twitterMax * 0.5 ? truncated.substring(0, lastSpace) : truncated);
          lastResponse = lastResponse.replace(/[,;:]\s*$/, '').trim();
        }
      }
      // Accept if within range or slightly short (better than nothing)
    } else if (maxLength && lastResponse.length > maxLength) {
      lastResponse = lastResponse.substring(0, maxLength - 3) + '...';
    }
    return { response: lastResponse, tokens_used: 0 };
  }

  return null;
}

