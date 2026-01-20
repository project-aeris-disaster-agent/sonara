/**
 * Humanizer Module - Removes signs of AI-generated writing from text
 * Based on Wikipedia's "Signs of AI writing" guide (WikiProject AI Cleanup)
 * 
 * This is a plug-and-play module that can be enabled/disabled without affecting
 * the existing response generation flow.
 * 
 * @see https://github.com/blader/humanizer
 * @version 2.1.1
 */

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export type HumanizerStrictness = 'light' | 'moderate' | 'strict';

export interface HumanizerOptions {
  strictness?: HumanizerStrictness;
  preservePersonality?: boolean;  // Don't remove character-specific phrases
  maxTransformations?: number;    // Limit changes per text
}

export interface AIPatternResult {
  pattern: string;
  category: AIPatternCategory;
  match: string;
  index: number;
  suggestion?: string;
}

export interface HumanizerReport {
  originalText: string;
  humanizedText: string;
  patternsDetected: AIPatternResult[];
  transformationsApplied: number;
  aiScore: number;  // 0-100, higher = more AI-like
}

export type AIPatternCategory = 
  | 'content'
  | 'language'
  | 'style'
  | 'communication'
  | 'filler';

// ============================================================================
// PATTERN DEFINITIONS (24 patterns from Wikipedia guide)
// ============================================================================

/**
 * Pattern 1-6: CONTENT PATTERNS
 * Issues with what is being said, not how it's said
 */
const CONTENT_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  replacement?: string | ((match: string) => string);
  description: string;
}> = [
  // 1. Significance inflation
  {
    name: 'significance_inflation',
    pattern: /\b(pivotal|groundbreaking|revolutionary|transformative|game-changing|paradigm-shifting|unprecedented|seminal|monumental|landmark)\s+(moment|development|achievement|breakthrough|innovation|advancement)\b/gi,
    replacement: (match) => match.replace(/pivotal|groundbreaking|revolutionary|transformative|game-changing|paradigm-shifting|unprecedented|seminal|monumental|landmark/gi, 'significant'),
    description: 'Inflating significance with hyperbolic language',
  },
  // 2. Notability name-dropping (vague citations)
  {
    name: 'notability_namedropping',
    pattern: /\b(cited|featured|mentioned|covered|reported)\s+(in|by)\s+(major|leading|prominent|prestigious|top)\s+(publications?|outlets?|media|sources?)\b/gi,
    replacement: '',  // Remove entirely - should be specific or nothing
    description: 'Vague name-dropping without specifics',
  },
  // 3. Superficial -ing analyses
  {
    name: 'ing_analyses',
    pattern: /\b(symbolizing|representing|reflecting|showcasing|demonstrating|illustrating|embodying|exemplifying|highlighting|underscoring)\s+(the|a|an)\b/gi,
    replacement: (match) => match.replace(/symbolizing|representing|reflecting|showcasing|demonstrating|illustrating|embodying|exemplifying|highlighting|underscoring/gi, 'showing'),
    description: 'Superficial -ing word analyses',
  },
  // 4. Promotional language
  {
    name: 'promotional_language',
    pattern: /\b(nestled|situated|boasting|featuring|offering|providing|delivering)\s+(within|in|a|an|the)\s+(breathtaking|stunning|remarkable|exceptional|unparalleled|world-class)\b/gi,
    replacement: (match) => match.replace(/nestled|situated|boasting|featuring|offering|providing|delivering/gi, 'located').replace(/breathtaking|stunning|remarkable|exceptional|unparalleled|world-class/gi, ''),
    description: 'Promotional/marketing language',
  },
  // 5. Vague attributions
  {
    name: 'vague_attributions',
    pattern: /\b(experts?|analysts?|critics?|observers?|many|some)\s+(believe|think|say|argue|suggest|contend|maintain|assert)\s+(that\s+)?(it|this|the)\s+(is|plays?|has|will)\s+(a\s+)?(crucial|vital|key|critical|essential|important)\s+(role|part|factor)\b/gi,
    replacement: '',  // Should be specific or removed
    description: 'Vague expert attributions',
  },
  // 6. Formulaic challenges
  {
    name: 'formulaic_challenges',
    pattern: /\b(despite|in\s+spite\s+of|notwithstanding)\s+(the\s+)?(challenges?|obstacles?|difficulties?|adversity|setbacks?),?\s+(it|they|the|this)\s+(continues?|remains?|persists?|thrives?|perseveres?)\b/gi,
    replacement: (match) => {
      // Simplify to just the subject continuing
      const simplified = match.replace(/despite|in\s+spite\s+of|notwithstanding/gi, 'although facing')
        .replace(/continues?|remains?|persists?|thrives?|perseveres?/gi, 'continues');
      return simplified;
    },
    description: 'Formulaic challenge-then-triumph structure',
  },
];

/**
 * Pattern 7-12: LANGUAGE PATTERNS
 * Specific word choices and constructions that signal AI
 */
const LANGUAGE_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  replacement?: string | ((match: string) => string);
  description: string;
}> = [
  // 7. AI vocabulary (specific words overused by AI)
  {
    name: 'ai_vocabulary',
    pattern: /\b(additionally|moreover|furthermore|testament|landscape|realm|paradigm|delve|tapestry|multifaceted|nuanced|intricacies|myriad|plethora|encompasses|embark|foster|leverage|robust|seamless|holistic|synergy|utilize)\b/gi,
    replacement: (match) => {
      const replacements: Record<string, string> = {
        'additionally': 'also',
        'moreover': 'also',
        'furthermore': 'also',
        'testament': 'proof',
        'landscape': 'area',
        'realm': 'area',
        'paradigm': 'model',
        'delve': 'look',
        'tapestry': 'mix',
        'multifaceted': 'complex',
        'nuanced': 'subtle',
        'intricacies': 'details',
        'myriad': 'many',
        'plethora': 'many',
        'encompasses': 'includes',
        'embark': 'start',
        'foster': 'encourage',
        'leverage': 'use',
        'robust': 'strong',
        'seamless': 'smooth',
        'holistic': 'complete',
        'synergy': 'cooperation',
        'utilize': 'use',
      };
      const lower = match.toLowerCase();
      const replacement = replacements[lower] || match;
      // Preserve original case
      if (match[0] === match[0].toUpperCase()) {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      return replacement;
    },
    description: 'Common AI vocabulary words',
  },
  // 8. Copula avoidance (avoiding "is/are/was/were")
  {
    name: 'copula_avoidance',
    pattern: /\b(serves?\s+as|functions?\s+as|acts?\s+as|stands?\s+as|remains?\s+as|operates?\s+as)\s+(a|an|the)\b/gi,
    replacement: 'is a',
    description: 'Avoiding simple "is" with complex alternatives',
  },
  // 9. Negative parallelisms
  {
    name: 'negative_parallelisms',
    pattern: /\bit['']?s\s+not\s+(just|only|merely|simply)\s+([^,]+),\s*(it['']?s|but)\s+/gi,
    replacement: (match) => {
      // Extract the second part and make it direct
      const parts = match.split(/,\s*(it['']?s|but)\s+/i);
      if (parts.length > 0) {
        return parts[0].replace(/it['']?s\s+not\s+(just|only|merely|simply)\s+/i, '') + ' and ';
      }
      return match;
    },
    description: '"It\'s not just X, it\'s Y" pattern',
  },
  // 10. Rule of three (artificial groupings of three)
  {
    name: 'rule_of_three',
    pattern: /\b(\w+),\s+(\w+),\s+and\s+(\w+)\b/gi,
    replacement: undefined,  // Detection only - context dependent
    description: 'Artificial rule of three groupings',
  },
  // 11. Synonym cycling
  {
    name: 'synonym_cycling',
    pattern: undefined,  // Requires context analysis
    replacement: undefined,
    description: 'Using different synonyms when repetition would be clearer',
  },
  // 12. False ranges
  {
    name: 'false_ranges',
    pattern: /\bfrom\s+([^,]+)\s+to\s+([^,\.]+)/gi,
    replacement: undefined,  // Detection only - context dependent
    description: 'False ranges that don\'t represent actual continuums',
  },
];

/**
 * Pattern 13-18: STYLE PATTERNS
 * Formatting and presentation issues
 */
const STYLE_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  replacement?: string | ((match: string) => string);
  description: string;
}> = [
  // 13. Em dash overuse
  {
    name: 'em_dash_overuse',
    pattern: /—/g,
    replacement: (match, fullText?: string) => {
      // Only flag if there are multiple em dashes
      return ',';  // Replace with comma as default
    },
    description: 'Overuse of em dashes',
  },
  // 14. Boldface overuse (markdown bold)
  {
    name: 'boldface_overuse',
    pattern: /\*\*([^*]+)\*\*/g,
    replacement: '$1',  // Remove bold formatting
    description: 'Overuse of bold text',
  },
  // 15. Inline-header lists
  {
    name: 'inline_header_lists',
    pattern: /\*\*([^*:]+):\*\*\s*/g,
    replacement: '$1: ',  // Remove bold from inline headers
    description: 'Inline headers with bold formatting',
  },
  // 16. Title Case Headings (inappropriate title case)
  {
    name: 'title_case_headings',
    pattern: /\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/g,
    replacement: undefined,  // Detection only - context dependent
    description: 'Inappropriate title case in regular text',
  },
  // 17. Emoji overuse (in formal contexts)
  {
    name: 'emoji_overuse',
    pattern: /[\u{1F300}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]{3,}/gu,
    replacement: (match) => match.slice(0, 2),  // Limit to 2 emojis
    description: 'Overuse of emojis',
  },
  // 18. Curly quotes (smart quotes that should be straight)
  // Using Unicode escapes to avoid parser issues: " U+201C, " U+201D, ' U+2018, ' U+2019
  {
    name: 'curly_quotes',
    pattern: /[\u201C\u201D\u2018\u2019]/g,
    replacement: (match) => {
      if (match === '\u201C' || match === '\u201D') return '"';
      if (match === '\u2018' || match === '\u2019') return "'";
      return match;
    },
    description: 'Curly quotes instead of straight quotes',
  },
];

/**
 * Pattern 19-21: COMMUNICATION PATTERNS
 * Chatbot-specific artifacts
 */
const COMMUNICATION_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  replacement?: string | ((match: string) => string);
  description: string;
}> = [
  // 19. Chatbot artifacts
  {
    name: 'chatbot_artifacts',
    pattern: /\b(i\s+hope\s+this\s+helps|let\s+me\s+know\s+if|feel\s+free\s+to\s+ask|don['']t\s+hesitate\s+to|i['']m\s+happy\s+to\s+help|is\s+there\s+anything\s+else|hope\s+that\s+helps|glad\s+to\s+assist|here\s+to\s+help)\b[!.]*/gi,
    replacement: '',  // Remove entirely
    description: 'Chatbot sign-off phrases',
  },
  // 20. Cutoff disclaimers
  {
    name: 'cutoff_disclaimers',
    pattern: /\b(while\s+details\s+are\s+limited|based\s+on\s+available\s+information|as\s+of\s+my\s+(last\s+)?knowledge\s+cutoff|i\s+don['']t\s+have\s+(access\s+to\s+)?real-?time|my\s+training\s+data|according\s+to\s+my\s+training)\b[^.]*[.]?/gi,
    replacement: '',  // Remove entirely
    description: 'Knowledge cutoff disclaimers',
  },
  // 21. Sycophantic tone
  {
    name: 'sycophantic_tone',
    pattern: /\b(great\s+question|excellent\s+(question|point)|you['']re\s+(absolutely|totally)\s+right|that['']s\s+a\s+(great|excellent|wonderful|fantastic)\s+(question|point|observation)|what\s+a\s+(great|thoughtful|insightful)\s+(question|point))[!]*/gi,
    replacement: '',  // Remove entirely
    description: 'Sycophantic/flattering responses',
  },
];

/**
 * Pattern 22-24: FILLER AND HEDGING
 * Unnecessary words and excessive qualification
 */
const FILLER_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  replacement?: string | ((match: string) => string);
  description: string;
}> = [
  // 22. Filler phrases
  {
    name: 'filler_phrases',
    pattern: /\b(in\s+order\s+to|due\s+to\s+the\s+fact\s+that|at\s+the\s+end\s+of\s+the\s+day|at\s+this\s+point\s+in\s+time|for\s+all\s+intents\s+and\s+purposes|it\s+is\s+important\s+to\s+note\s+that|it\s+should\s+be\s+noted\s+that|it\s+is\s+worth\s+mentioning\s+that|the\s+fact\s+that|in\s+terms\s+of|when\s+it\s+comes\s+to)\b/gi,
    replacement: (match) => {
      const lower = match.toLowerCase();
      const replacements: Record<string, string> = {
        'in order to': 'to',
        'due to the fact that': 'because',
        'at the end of the day': '',
        'at this point in time': 'now',
        'for all intents and purposes': 'essentially',
        'it is important to note that': '',
        'it should be noted that': '',
        'it is worth mentioning that': '',
        'the fact that': 'that',
        'in terms of': 'for',
        'when it comes to': 'for',
      };
      return replacements[lower] || '';
    },
    description: 'Wordy filler phrases',
  },
  // 23. Excessive hedging
  {
    name: 'excessive_hedging',
    pattern: /\b(could\s+potentially|might\s+possibly|may\s+perhaps|possibly\s+could|potentially\s+might|perhaps\s+may|it\s+seems\s+like|it\s+appears\s+that|it\s+would\s+seem)\b/gi,
    replacement: (match) => {
      const lower = match.toLowerCase();
      if (lower.includes('could') || lower.includes('might') || lower.includes('may')) {
        return 'may';
      }
      if (lower.includes('seems') || lower.includes('appears')) {
        return 'seems';
      }
      return match;
    },
    description: 'Stacked hedging words',
  },
  // 24. Generic conclusions
  {
    name: 'generic_conclusions',
    pattern: /\b(the\s+future\s+(looks|is)\s+(bright|promising|exciting)|only\s+time\s+will\s+tell|it\s+remains\s+to\s+be\s+seen|moving\s+forward|going\s+forward|in\s+conclusion|to\s+conclude|in\s+summary|to\s+summarize|all\s+in\s+all|overall)\b[^.]*[.]?/gi,
    replacement: '',  // Remove generic conclusions
    description: 'Generic concluding phrases',
  },
];

// ============================================================================
// PATTERN DETECTION
// ============================================================================

/**
 * Get all patterns based on strictness level
 */
function getPatternsByStrictness(strictness: HumanizerStrictness) {
  const allPatterns = [
    ...CONTENT_PATTERNS.map(p => ({ ...p, category: 'content' as AIPatternCategory })),
    ...LANGUAGE_PATTERNS.map(p => ({ ...p, category: 'language' as AIPatternCategory })),
    ...STYLE_PATTERNS.map(p => ({ ...p, category: 'style' as AIPatternCategory })),
    ...COMMUNICATION_PATTERNS.map(p => ({ ...p, category: 'communication' as AIPatternCategory })),
    ...FILLER_PATTERNS.map(p => ({ ...p, category: 'filler' as AIPatternCategory })),
  ];

  switch (strictness) {
    case 'light':
      // Only most obvious AI patterns
      return allPatterns.filter(p => 
        ['chatbot_artifacts', 'sycophantic_tone', 'cutoff_disclaimers', 'ai_vocabulary', 'filler_phrases'].includes(p.name)
      );
    case 'moderate':
      // Most patterns except subtle ones
      return allPatterns.filter(p => 
        !['rule_of_three', 'synonym_cycling', 'false_ranges', 'title_case_headings'].includes(p.name)
      );
    case 'strict':
      // All patterns
      return allPatterns;
    default:
      return allPatterns;
  }
}

/**
 * Detect AI patterns in text
 * @param text The text to analyze
 * @param strictness How strict the detection should be
 * @returns Array of detected patterns with locations
 */
export function detectAIPatterns(
  text: string,
  strictness: HumanizerStrictness = 'moderate'
): AIPatternResult[] {
  const results: AIPatternResult[] = [];
  const patterns = getPatternsByStrictness(strictness);

  for (const patternDef of patterns) {
    if (!patternDef.pattern) continue;  // Skip patterns without regex

    // Reset regex state
    patternDef.pattern.lastIndex = 0;
    
    let match;
    while ((match = patternDef.pattern.exec(text)) !== null) {
      results.push({
        pattern: patternDef.name,
        category: patternDef.category,
        match: match[0],
        index: match.index,
        suggestion: patternDef.description,
      });
      
      // Prevent infinite loops for patterns without global flag
      if (!patternDef.pattern.global) break;
    }
  }

  // Sort by position in text
  return results.sort((a, b) => a.index - b.index);
}

/**
 * Calculate an "AI score" for the text (0-100)
 * Higher score = more AI-like writing detected
 */
export function calculateAIScore(text: string, strictness: HumanizerStrictness = 'moderate'): number {
  const patterns = detectAIPatterns(text, strictness);
  const wordCount = text.split(/\s+/).length;
  
  if (wordCount === 0) return 0;
  
  // Weight patterns by category
  const weights: Record<AIPatternCategory, number> = {
    content: 8,
    language: 5,
    style: 3,
    communication: 10,
    filler: 4,
  };

  let score = 0;
  for (const pattern of patterns) {
    score += weights[pattern.category] || 5;
  }

  // Normalize to 0-100 based on text length
  // More patterns per 100 words = higher score
  const normalizedScore = (score / wordCount) * 100;
  
  return Math.min(100, Math.round(normalizedScore));
}

// ============================================================================
// TEXT TRANSFORMATION
// ============================================================================

/**
 * Apply a single transformation to text
 */
function applyTransformation(
  text: string,
  patternDef: { pattern?: RegExp; replacement?: string | ((match: string, fullText?: string) => string) }
): string {
  if (!patternDef.pattern || patternDef.replacement === undefined) {
    return text;
  }

  // Reset regex state
  patternDef.pattern.lastIndex = 0;

  if (typeof patternDef.replacement === 'function') {
    return text.replace(patternDef.pattern, (match) => patternDef.replacement!(match, text));
  }
  
  return text.replace(patternDef.pattern, patternDef.replacement);
}

/**
 * Clean up text after transformations
 * - Remove double spaces
 * - Fix punctuation
 * - Trim whitespace
 */
function cleanupText(text: string): string {
  return text
    // Remove multiple spaces
    .replace(/\s{2,}/g, ' ')
    // Fix space before punctuation
    .replace(/\s+([.,!?;:])/g, '$1')
    // Fix double punctuation
    .replace(/([.,!?;:]){2,}/g, '$1')
    // Remove leading/trailing whitespace from sentences
    .replace(/\.\s*\./g, '.')
    // Trim
    .trim();
}

/**
 * Humanize text by removing AI writing patterns
 * @param text The text to humanize
 * @param options Configuration options
 * @returns Humanized text
 */
export function humanizeText(
  text: string,
  options: HumanizerOptions = {}
): string {
  const {
    strictness = 'moderate',
    preservePersonality = true,
    maxTransformations = 50,
  } = options;

  if (!text || text.length === 0) {
    return text;
  }

  let result = text;
  let transformationCount = 0;
  const patterns = getPatternsByStrictness(strictness);

  // Apply transformations in order of impact
  // Communication patterns first (most obviously AI)
  // Then filler, then language, then content, then style
  const orderedPatterns = patterns.sort((a, b) => {
    const order: Record<AIPatternCategory, number> = {
      communication: 1,
      filler: 2,
      language: 3,
      content: 4,
      style: 5,
    };
    return order[a.category] - order[b.category];
  });

  for (const patternDef of orderedPatterns) {
    if (transformationCount >= maxTransformations) break;
    if (!patternDef.pattern || patternDef.replacement === undefined) continue;

    const before = result;
    result = applyTransformation(result, patternDef);
    
    if (before !== result) {
      transformationCount++;
    }
  }

  // Cleanup
  result = cleanupText(result);

  // If preservePersonality is true, don't over-transform short responses
  // (likely chat/Twitter where personality matters more)
  if (preservePersonality && text.length < 280) {
    // For short text, only apply critical transformations
    // Re-run with just communication patterns
    const criticalPatterns = patterns.filter(p => p.category === 'communication');
    let criticalResult = text;
    for (const patternDef of criticalPatterns) {
      if (!patternDef.pattern || patternDef.replacement === undefined) continue;
      criticalResult = applyTransformation(criticalResult, patternDef);
    }
    criticalResult = cleanupText(criticalResult);
    
    // Use the less aggressive result for short text
    if (criticalResult.length > result.length * 0.5) {
      result = criticalResult;
    }
  }

  return result;
}

// ============================================================================
// DIAGNOSTICS
// ============================================================================

/**
 * Get detailed diagnostics report for text
 * Useful for testing and debugging
 */
export function getHumanizerDiagnostics(
  text: string,
  options: HumanizerOptions = {}
): HumanizerReport {
  const { strictness = 'moderate' } = options;
  
  const patternsDetected = detectAIPatterns(text, strictness);
  const humanizedText = humanizeText(text, options);
  const aiScore = calculateAIScore(text, strictness);

  return {
    originalText: text,
    humanizedText,
    patternsDetected,
    transformationsApplied: patternsDetected.length,
    aiScore,
  };
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

/**
 * Check if text likely needs humanization
 * Quick check before full processing
 */
export function needsHumanization(text: string, threshold: number = 20): boolean {
  const score = calculateAIScore(text, 'light');
  return score >= threshold;
}

/**
 * Get list of all pattern names for reference
 */
export function getPatternNames(): string[] {
  return [
    ...CONTENT_PATTERNS.map(p => p.name),
    ...LANGUAGE_PATTERNS.map(p => p.name),
    ...STYLE_PATTERNS.map(p => p.name),
    ...COMMUNICATION_PATTERNS.map(p => p.name),
    ...FILLER_PATTERNS.map(p => p.name),
  ];
}

/**
 * Export pattern categories for external use
 */
export const PATTERN_CATEGORIES: AIPatternCategory[] = [
  'content',
  'language',
  'style',
  'communication',
  'filler',
];
