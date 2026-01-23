/**
 * Live Anti-Echo Test
 * 
 * Generates fresh responses from multiple agents to test the anti-echo mechanism.
 * Verifies that agents don't repeat key phrases from the original tweet.
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// ANTI-ECHO FUNCTIONS (copied to avoid Deno import issues)
// ============================================================================

function extractEchoablePhrases(tweetText: string): string[] {
  const phrases: Set<string> = new Set();
  
  // Extract crypto tickers
  const tickerPattern = /\$[A-Z]{2,10}\b/gi;
  const tickers = tweetText.match(tickerPattern) || [];
  tickers.forEach(ticker => phrases.add(ticker.toUpperCase()));
  
  // Extract numeric goals
  const numericGoalPatterns = [
    /\$?\d+[MKBkmb]?\s*market\s*cap/gi,
    /\$?\d+[MKBkmb]?\s*(million|billion|thousand)/gi,
    /\d+x\b/gi,
  ];
  
  numericGoalPatterns.forEach(pattern => {
    const matches = tweetText.match(pattern) || [];
    matches.forEach(match => {
      const trimmed = match.trim().toLowerCase();
      if (trimmed.length > 3 && trimmed.length < 50) phrases.add(trimmed);
    });
  });
  
  // Extract action + ticker combinations
  const actionVerbs = ['push', 'get', 'take', 'bring', 'drive', 'pushing', 'getting'];
  actionVerbs.forEach(verb => {
    const verbPattern = new RegExp(`${verb}\\s+\\$?[A-Za-z]+`, 'gi');
    const matches = tweetText.match(verbPattern) || [];
    matches.forEach(match => phrases.add(match.toLowerCase()));
  });
  
  // Extract key compound phrases
  const keyPhrasePatterns = [
    /community\s+(buzz|hype|engagement|growth)/gi,
    /strategic\s+(partnerships?|alliances?)/gi,
    /real\s+utility/gi,
    /unique\s+use\s+cases?/gi,
  ];
  
  keyPhrasePatterns.forEach(pattern => {
    const matches = tweetText.match(pattern) || [];
    matches.forEach(match => phrases.add(match.trim().toLowerCase()));
  });
  
  return Array.from(phrases).filter(p => p.length >= 4 && p.length <= 60).slice(0, 15);
}

function detectEchoSlop(response: string, originalTweet: string, echoablePhrases?: string[]): { isEcho: boolean; reason?: string; matchedPhrases?: string[] } {
  if (!originalTweet || !response) return { isEcho: false };
  
  const normalizedResponse = response.toLowerCase();
  const normalizedOriginal = originalTweet.toLowerCase();
  const phrasesToCheck = echoablePhrases || extractEchoablePhrases(originalTweet);
  const matchedPhrases: string[] = [];
  
  // Direct phrase matching
  for (const phrase of phrasesToCheck) {
    const normalizedPhrase = phrase.toLowerCase();
    if (normalizedResponse.includes(normalizedPhrase)) {
      matchedPhrases.push(phrase);
      continue;
    }
    const phraseWords = normalizedPhrase.split(/\s+/).filter(w => w.length > 2);
    if (phraseWords.length >= 2 && phraseWords.every(word => normalizedResponse.includes(word))) {
      matchedPhrases.push(phrase);
    }
  }
  
  // Check for ticker + market cap pattern
  const tickerPattern = /\$[A-Z]+/gi;
  const originalTickers = originalTweet.match(tickerPattern) || [];
  const responseTickers = response.match(tickerPattern) || [];
  const originalHasMarketCap = /\$?\d+[MKBkmb]?\s*market\s*cap/i.test(originalTweet);
  const responseHasMarketCap = /\$?\d+[MKBkmb]?\s*market\s*cap/i.test(response);
  
  if (originalTickers.length > 0 && responseTickers.length > 0) {
    const sharedTickers = originalTickers.filter(t => responseTickers.some(rt => rt.toLowerCase() === t.toLowerCase()));
    if (sharedTickers.length > 0 && originalHasMarketCap && responseHasMarketCap) {
      matchedPhrases.push(`${sharedTickers[0]} + market cap`);
    }
  }
  
  // Jaccard similarity
  const words1 = new Set(response.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(originalTweet.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 2));
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  const similarity = union.size > 0 ? intersection.size / union.size : 0;
  
  const hasCoreEchoPattern = matchedPhrases.some(p => p.includes('market cap') || (p.includes('$') && /\d/.test(p)));
  
  if (hasCoreEchoPattern) return { isEcho: true, reason: 'Response repeats core thesis (ticker + goal)', matchedPhrases };
  if (matchedPhrases.length >= 2) return { isEcho: true, reason: `Echoes ${matchedPhrases.length} key phrases`, matchedPhrases };
  if (similarity > 0.40) return { isEcho: true, reason: `Too similar (${(similarity * 100).toFixed(0)}% overlap)`, matchedPhrases };
  
  return { isEcho: false };
}

function buildAntiEchoPrompt(phrases: string[]): string {
  if (phrases.length === 0) return '';
  const topPhrases = phrases.slice(0, 5);
  return `
🚫 ANTI-ECHO RULES (CRITICAL):
DO NOT repeat these phrases verbatim:
${topPhrases.map(p => `- "${p}"`).join('\n')}

INSTEAD: Paraphrase, challenge the premise, or share a different perspective.`;
}

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

const TEST_TWEETS = [
  {
    id: 'dare_market_cap',
    author: 'lordsedano',
    content: `@lordsedano, pushing $DARE to a $10M market cap needs a mix of community buzz and real utility. Think strategic partnerships or unique use cases like incentivizing wild stunts, as seen with Dare Markets.`,
    description: 'Crypto market cap goal (the original problem)',
  },
  {
    id: 'nft_launch',
    author: 'nftcollector',
    content: `Launching our new $PIXEL collection tomorrow! 10,000 unique NFTs with staking rewards. Building a strong community is key - join the whitelist and get 2x allocation bonus!`,
    description: 'NFT launch announcement',
  },
  {
    id: 'defi_yield',
    author: 'defichad',
    content: `Hot take: 100% APY yields in DeFi are unsustainable. Projects promising high returns are just ponzis in disguise. Prove me wrong.`,
    description: 'DeFi hot take',
  },
];

const TEST_AGENTS = [
  {
    name: 'New Prontera',
    bio: 'An AI venture studio building Agents for the Web3 & Gaming ecosystem. Speaks robotic and monotonous.',
    style: 'direct, tech-oriented, robotic',
  },
  {
    name: 'Nomadgamefi',
    bio: 'Web3 gaming enthusiast and DeFi explorer. Building the future of play-to-earn.',
    style: 'informative, engaging, community-focused',
  },
  {
    name: 'Agent Hellracer',
    bio: 'Ultimate F1 shitposter with a devilish twist. Sarcastic and provocative.',
    style: 'sarcastic, playful, provocative',
  },
  {
    name: 'Jared Dillinger',
    bio: 'Crypto analyst and market commentator. Focus on tokenomics and community growth.',
    style: 'analytical, straightforward, direct',
  },
];

// ============================================================================
// API CALL
// ============================================================================

async function generateAgentResponse(agent: typeof TEST_AGENTS[0], tweet: typeof TEST_TWEETS[0], apiKey: string): Promise<string | null> {
  const echoablePhrases = extractEchoablePhrases(tweet.content);
  const antiEchoPrompt = buildAntiEchoPrompt(echoablePhrases);
  
  const systemPrompt = `You are ${agent.name}. ${agent.bio}

YOUR STYLE: ${agent.style}

TWITTER REPLY RULES:
- Keep replies SHORT (1-2 sentences, 60-150 chars)
- Be authentic to your personality
- Add VALUE - don't just agree or react emotionally
- Reference specific details from their tweet
${antiEchoPrompt}

NEVER ECHO THE TWEET:
- DO NOT repeat key phrases from the tweet you're replying to
- Paraphrase, challenge, or take a different angle
- If they say "X is Y", don't respond "yeah X is Y" - add something NEW

BANNED PHRASES: "sounds intense", "that energy", "straight fire", "I hear ya", "vibes"`;

  const userPrompt = `REPLYING TO @${tweet.author}:
"${tweet.content}"

Write a short, authentic reply that adds value. DO NOT echo phrases from the original tweet.`;

  try {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'grok-3-latest',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.9,
        max_tokens: 100,
        presence_penalty: 0.8,
        frequency_penalty: 0.4,
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error(`   API Error: ${response.status} - ${error.substring(0, 100)}`);
      return null;
    }
    
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.error(`   Error: ${error.message}`);
    return null;
  }
}

// ============================================================================
// MAIN TEST
// ============================================================================

async function runLiveAntiEchoTest() {
  // Get API key
  let GROK_API_KEY = process.env.GROK_API_KEY || process.env.VITE_GROK_API_KEY;
  
  if (!GROK_API_KEY) {
    try {
      const envPath = path.join(process.cwd(), '.env');
      const envContent = fs.readFileSync(envPath, 'utf-8');
      let match = envContent.match(/^GROK_API_KEY=(.+)$/m);
      if (!match) match = envContent.match(/^VITE_GROK_API_KEY=(.+)$/m);
      if (match) GROK_API_KEY = match[1].trim().replace(/["']/g, '');
    } catch { }
  }
  
  if (!GROK_API_KEY) {
    console.error('❌ GROK_API_KEY not set');
    process.exit(1);
  }

  console.log('═'.repeat(70));
  console.log('🧪 LIVE ANTI-ECHO TEST');
  console.log('═'.repeat(70));
  console.log(`\n🤖 Testing ${TEST_AGENTS.length} agents across ${TEST_TWEETS.length} scenarios\n`);

  let totalEchoCount = 0;
  let totalResponses = 0;

  for (const tweet of TEST_TWEETS) {
    console.log('─'.repeat(70));
    console.log(`\n📝 TWEET: ${tweet.description}`);
    console.log(`   @${tweet.author}: "${tweet.content.substring(0, 70)}..."`);
    
    const phrases = extractEchoablePhrases(tweet.content);
    console.log(`   🔍 Key phrases: ${phrases.slice(0, 4).join(', ')}`);
    
    console.log(`\n   ⏳ Generating responses...`);
    
    const responses: { agent: string; response: string }[] = [];
    
    for (const agent of TEST_AGENTS) {
      process.stdout.write(`      ${agent.name}... `);
      const response = await generateAgentResponse(agent, tweet, GROK_API_KEY);
      
      if (response) {
        responses.push({ agent: agent.name, response });
        console.log('✓');
      } else {
        console.log('✗');
      }
      
      await new Promise(r => setTimeout(r, 1000));
    }
    
    // Analyze
    console.log('\n   📊 RESULTS:');
    let echoCount = 0;
    
    for (const { agent, response } of responses) {
      const echoCheck = detectEchoSlop(response, tweet.content, phrases);
      const status = echoCheck.isEcho ? '🚫' : '✅';
      if (echoCheck.isEcho) echoCount++;
      
      console.log(`\n   ${status} ${agent}:`);
      console.log(`      "${response.substring(0, 90)}${response.length > 90 ? '...' : ''}"`);
      if (echoCheck.isEcho) console.log(`      ⚠️  ${echoCheck.reason}`);
    }
    
    // Cross-similarity
    const similarities: number[] = [];
    for (let i = 0; i < responses.length; i++) {
      for (let j = i + 1; j < responses.length; j++) {
        const w1 = new Set(responses[i].response.toLowerCase().split(/\s+/).filter(w => w.length > 2));
        const w2 = new Set(responses[j].response.toLowerCase().split(/\s+/).filter(w => w.length > 2));
        const inter = new Set([...w1].filter(x => w2.has(x)));
        const union = new Set([...w1, ...w2]);
        similarities.push(union.size > 0 ? inter.size / union.size : 0);
      }
    }
    const avgSim = similarities.length > 0 ? similarities.reduce((a, b) => a + b) / similarities.length : 0;
    
    console.log(`\n   📈 Echo: ${echoCount}/${responses.length} | Similarity: ${(avgSim * 100).toFixed(0)}% | ${avgSim < 0.25 ? 'EXCELLENT' : avgSim < 0.35 ? 'GOOD' : 'NEEDS WORK'}`);
    
    totalEchoCount += echoCount;
    totalResponses += responses.length;
  }

  console.log('\n' + '═'.repeat(70));
  console.log('📊 FINAL SUMMARY');
  console.log('═'.repeat(70));
  console.log(`   Total: ${totalResponses} responses`);
  console.log(`   Echo violations: ${totalEchoCount}`);
  console.log(`   Echo-free: ${((1 - totalEchoCount / totalResponses) * 100).toFixed(0)}%`);
  console.log(`   ${totalEchoCount === 0 ? '🎉 PERFECT!' : totalEchoCount <= 2 ? '✅ GOOD' : '⚠️  NEEDS WORK'}\n`);
}

runLiveAntiEchoTest();
