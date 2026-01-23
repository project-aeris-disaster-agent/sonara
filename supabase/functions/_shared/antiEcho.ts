/**
 * Anti-Echo Module - Prevents agents from repeating key phrases from tweets they're replying to
 * 
 * This module extracts "echoable" phrases from the original tweet and provides
 * mechanisms to detect and prevent verbatim repetition in agent responses.
 */

/**
 * Extract phrases from a tweet that agents might echo verbatim
 * These are typically:
 * - Crypto tickers ($DARE, $BTC)
 * - Numeric goals/claims ("10M market cap", "100x")
 * - Action phrases ("push X to Y", "get X to Y")
 * - Quoted text
 * - Key value propositions
 */
export function extractEchoablePhrases(tweetText: string): string[] {
  const phrases: Set<string> = new Set();
  
  // 1. Extract crypto tickers (e.g., $DARE, $BTC, $ETH) - ALWAYS add these
  const tickerPattern = /\$[A-Z]{2,10}\b/gi;
  const tickers = tweetText.match(tickerPattern) || [];
  tickers.forEach(ticker => {
    phrases.add(ticker.toUpperCase()); // Normalize to uppercase
  });
  
  // 2. Extract numeric goals/claims with context - GRANULAR extraction
  // Patterns like: "$10M market cap", "10M market cap", "100x", "10 million"
  const numericGoalPatterns = [
    /\$?\d+[MKBkmb]?\s*market\s*cap/gi,
    /\$?\d+[MKBkmb]?\s*(million|billion|thousand)/gi,
    /\d+x\b/gi, // Multipliers like "100x"
    /\$?\d+[MKBkmb]?\s*(valuation|goal|target|milestone)/gi,
  ];
  
  numericGoalPatterns.forEach(pattern => {
    const matches = tweetText.match(pattern) || [];
    matches.forEach(match => {
      const trimmed = match.trim().toLowerCase();
      if (trimmed.length > 3 && trimmed.length < 50) {
        phrases.add(trimmed);
      }
    });
  });
  
  // 3. Extract action + ticker + goal combinations
  // e.g., "push $DARE to a $10M market cap" -> extract "push $DARE", "$DARE to", "to a $10M"
  const actionVerbs = ['push', 'get', 'take', 'bring', 'drive', 'move', 'pushing', 'getting', 'taking', 'bringing', 'driving', 'moving'];
  actionVerbs.forEach(verb => {
    const verbPattern = new RegExp(`${verb}\\s+\\$?[A-Za-z]+`, 'gi');
    const matches = tweetText.match(verbPattern) || [];
    matches.forEach(match => {
      phrases.add(match.toLowerCase());
    });
  });
  
  // 4. Extract quoted text (text in quotes)
  const quotedPattern = /[""''`]([^""''`]+)[""''`]/g;
  let quoteMatch;
  while ((quoteMatch = quotedPattern.exec(tweetText)) !== null) {
    const quoted = quoteMatch[1].trim();
    if (quoted.length > 5 && quoted.length < 100) {
      phrases.add(quoted.toLowerCase());
    }
  }
  
  // 5. Extract key compound phrases - the phrases that make replies sound spammy
  const keyPhrasePatterns = [
    /community\s+(buzz|hype|engagement|growth)/gi,
    /strategic\s+(partnerships?|alliances?|collaborations?)/gi,
    /building\s+(community|hype|momentum)/gi,
    /real\s+utility/gi,
    /actual\s+value/gi,
    /unique\s+use\s+cases?/gi,
    /liquidity\s+pools?/gi,
    /community\s+first/gi,
    /more\s+holders/gi,
    /wild\s+stunts?/gi,
  ];
  
  keyPhrasePatterns.forEach(pattern => {
    const matches = tweetText.match(pattern) || [];
    matches.forEach(match => {
      const trimmed = match.trim().toLowerCase();
      if (trimmed.length > 5) {
        phrases.add(trimmed);
      }
    });
  });
  
  // 6. Extract ticker + goal combinations (the core echo pattern)
  // This catches "$DARE to a $10M market cap" type phrases
  const tickerGoalPattern = /\$[A-Z]+\s+to\s+[^.!?,]+/gi;
  const tickerGoalMatches = tweetText.match(tickerGoalPattern) || [];
  tickerGoalMatches.forEach(match => {
    const trimmed = match.trim().toLowerCase();
    if (trimmed.length > 10 && trimmed.length < 60) {
      phrases.add(trimmed);
    }
  });
  
  // 7. Extract "X to Y" patterns where Y contains numbers
  const toPatterns = /to\s+(?:a\s+)?\$?\d+[MKBkmb]?\s*\w+/gi;
  const toMatches = tweetText.match(toPatterns) || [];
  toMatches.forEach(match => {
    phrases.add(match.trim().toLowerCase());
  });
  
  // Filter and sort - prefer shorter, more specific phrases that are likely to be echoed
  const filtered = Array.from(phrases)
    .filter(p => p.length >= 4) // Minimum length
    .filter(p => p.length <= 60) // Maximum length (shorter = more specific)
    .filter(p => !/^\s*$/.test(p)) // Not just whitespace
    .filter(p => !/^[@#]?\w+$/.test(p)) // Not just single words (except tickers)
    .sort((a, b) => {
      // Prioritize phrases with $ (tickers) and numbers
      const aHasTicker = a.includes('$') ? 1 : 0;
      const bHasTicker = b.includes('$') ? 1 : 0;
      const aHasNumber = /\d/.test(a) ? 1 : 0;
      const bHasNumber = /\d/.test(b) ? 1 : 0;
      const aScore = aHasTicker + aHasNumber;
      const bScore = bHasTicker + bHasNumber;
      if (aScore !== bScore) return bScore - aScore;
      return a.length - b.length; // Shorter phrases first (more likely to be echoed exactly)
    });
  
  // Return top 15 most specific phrases
  return filtered.slice(0, 15);
}

/**
 * Calculate Jaccard similarity between two texts
 * Returns a value between 0 and 1, where 1 means identical
 */
function calculateJaccardSimilarity(text1: string, text2: string): number {
  const words1 = new Set(
    text1.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2)
  );
  const words2 = new Set(
    text2.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2)
  );
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * Check if a response echoes the original tweet too closely
 * Returns true if the response is too similar to the original tweet
 */
export function detectEchoSlop(
  response: string,
  originalTweet: string,
  echoablePhrases?: string[]
): { isEcho: boolean; reason?: string; matchedPhrases?: string[] } {
  if (!originalTweet || !response) {
    return { isEcho: false };
  }
  
  const normalizedResponse = response.toLowerCase();
  const normalizedOriginal = originalTweet.toLowerCase();
  
  // Get phrases to check
  const phrasesToCheck = echoablePhrases || extractEchoablePhrases(originalTweet);
  const matchedPhrases: string[] = [];
  
  // 1. Direct phrase matching - check if key phrases appear verbatim or nearly verbatim
  for (const phrase of phrasesToCheck) {
    const normalizedPhrase = phrase.toLowerCase();
    
    // Direct substring match
    if (normalizedResponse.includes(normalizedPhrase)) {
      matchedPhrases.push(phrase);
      continue;
    }
    
    // Fuzzy match - check if all significant words appear close together
    const phraseWords = normalizedPhrase.split(/\s+/).filter(w => w.length > 2);
    if (phraseWords.length >= 2) {
      const allWordsPresent = phraseWords.every(word => normalizedResponse.includes(word));
      if (allWordsPresent) {
        matchedPhrases.push(phrase);
      }
    }
  }
  
  // 2. Check for ticker + goal echo pattern specifically
  // This is the most common spam pattern: "$DARE to a $10M market cap"
  const tickerPattern = /\$[A-Z]+/gi;
  const originalTickers = originalTweet.match(tickerPattern) || [];
  const responseTickers = response.match(tickerPattern) || [];
  
  // Check if response uses same ticker with similar numeric goal
  const originalHasMarketCap = /\$?\d+[MKBkmb]?\s*market\s*cap/i.test(originalTweet);
  const responseHasMarketCap = /\$?\d+[MKBkmb]?\s*market\s*cap/i.test(response);
  
  if (originalTickers.length > 0 && responseTickers.length > 0) {
    const sharedTickers = originalTickers.filter(t => 
      responseTickers.some(rt => rt.toLowerCase() === t.toLowerCase())
    );
    
    // If same ticker AND same "market cap" phrase, it's echo
    if (sharedTickers.length > 0 && originalHasMarketCap && responseHasMarketCap) {
      matchedPhrases.push(`${sharedTickers[0]} + market cap`);
    }
  }
  
  // 3. Check for key compound phrase echoing (only high-signal phrases)
  // These are phrases that indicate the response is repeating the main thesis
  const highSignalCompounds = [
    'community buzz',
    'community hype', 
    'strategic partnerships',
    'real utility',
    'liquidity pools',
    'unique use case',
    'more holders',
    'community first',
  ];
  
  // Low-signal phrases that are okay to reference as specific details
  // (e.g., "wild stunts" can be questioned/challenged without being echo)
  const lowSignalCompounds = [
    'wild stunts',
    'dare markets',
  ];
  
  let highSignalMatches = 0;
  for (const compound of highSignalCompounds) {
    if (normalizedOriginal.includes(compound) && normalizedResponse.includes(compound)) {
      matchedPhrases.push(compound);
      highSignalMatches++;
    }
  }
  
  // 4. Jaccard similarity for overall word overlap
  const similarity = calculateJaccardSimilarity(response, originalTweet);
  
  // 5. Check for the core echo pattern: ticker + numeric goal
  // This is THE spam pattern we want to catch
  const hasCoreEchoPattern = matchedPhrases.some(p => 
    p.includes('market cap') || p.includes('$') && /\d/.test(p)
  );
  
  // DECISION LOGIC:
  // Priority 1: Core echo pattern (ticker + goal) - always reject
  // Priority 2: 2+ high-signal compound phrases - likely echo
  // Priority 3: High similarity (>40%) - too similar overall
  // Priority 4: 1 phrase + moderate similarity (>30%) - borderline echo
  
  if (hasCoreEchoPattern) {
    return {
      isEcho: true,
      reason: `Response repeats core thesis (ticker + goal pattern)`,
      matchedPhrases,
    };
  }
  
  if (highSignalMatches >= 2) {
    return {
      isEcho: true,
      reason: `Response echoes ${highSignalMatches} key marketing phrases from original tweet`,
      matchedPhrases,
    };
  }
  
  if (similarity > 0.40) {
    return {
      isEcho: true,
      reason: `Response too similar to original tweet (${(similarity * 100).toFixed(0)}% word overlap)`,
      matchedPhrases,
    };
  }
  
  if (highSignalMatches >= 1 && similarity > 0.30) {
    return {
      isEcho: true,
      reason: `Response echoes key phrase with significant overlap (${(similarity * 100).toFixed(0)}%)`,
      matchedPhrases,
    };
  }
  
  return { isEcho: false };
}

/**
 * Build a prompt section that instructs the LLM to avoid echoing specific phrases
 */
export function buildAntiEchoPrompt(echoablePhrases: string[]): string {
  if (echoablePhrases.length === 0) {
    return '';
  }
  
  // Format phrases for display (show top 5 most specific)
  const topPhrases = echoablePhrases.slice(0, 5);
  const phraseList = topPhrases.map(p => `- "${p}"`).join('\n');
  
  return `
🚫 ANTI-ECHO RULES (CRITICAL):
The following phrases are from the tweet you're replying to. DO NOT repeat them verbatim:
${phraseList}

INSTEAD OF ECHOING:
• Paraphrase the concept (e.g., "hitting that valuation" instead of "10M market cap")
• Challenge or question the premise ("Is that the right target?")
• Share a different perspective entirely ("What about X instead?")
• Focus on a specific detail they mentioned, not the whole thesis
• Use synonyms or different wording (e.g., "grow the token" instead of "push $DARE")
• Skip the phrase entirely and add something NEW

BAD (echoing):
"To push $DARE to a $10M market cap, you need community buzz and strategic partnerships."

GOOD (paraphrased):
"Getting there requires real utility, not just hype. What's the actual use case?"

GOOD (different angle):
"Market cap is vanity. What's the token actually doing? Show me the product."

CRITICAL: If you catch yourself writing a phrase from the list above, STOP and rewrite it differently.`;
}
