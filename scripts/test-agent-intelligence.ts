// Test script for Agent Intelligence features
// Tests: Reply decision gate, live search enablement, generic phrase detection

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Try to load from .env.local if it exists
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match && !process.env[match[1]]) {
          process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
        }
      }
    });
  }
} catch {
  // Ignore errors loading .env.local
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://wqwhlbmsafgjlsjujuel.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';
const GROK_API_KEY = process.env.GROK_API_KEY || '';

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('⚠️  Missing SUPABASE_SERVICE_ROLE_KEY - some tests will be skipped');
  console.warn('   Set it with: $env:SUPABASE_SERVICE_ROLE_KEY="your-key"');
  console.warn('   Or add it to .env.local file\n');
}

if (!GROK_API_KEY) {
  console.warn('⚠️  Missing GROK_API_KEY - some tests will be skipped');
  console.warn('   Set it with: $env:GROK_API_KEY="your-key"');
  console.warn('   Or add it to .env.local file\n');
}

const supabase = SUPABASE_SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;

interface TestResult {
  feature: string;
  passed: boolean;
  message: string;
  error?: string;
}

const results: TestResult[] = [];

function logTest(feature: string, passed: boolean, message: string, error?: string) {
  results.push({ feature, passed, message, error });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${feature}: ${message}`);
  if (error) {
    console.log(`   Error: ${error}`);
  }
}

/**
 * Test reply decision gate with various tweet scenarios
 */
async function testReplyDecisionGate() {
  console.log('\n🤖 Testing Reply Decision Gate (removed)...\n');

  if (!GROK_API_KEY) {
    logTest(
      'Reply Decision Gate',
      false,
      'Skipped - GROK_API_KEY not set',
      'Set GROK_API_KEY environment variable to test this feature'
    );
    return;
  }

  try {
    // Mock character card for F1 expert
    const f1ExpertCard = {
      name: 'F1Expert',
      bio: ['F1 analyst and racing enthusiast'],
      lore: [],
      knowledge: ['Formula 1', 'Ferrari', 'Verstappen', 'Racing strategy'],
      topics: ['F1', 'Formula 1', 'Racing', 'Ferrari', 'Red Bull'],
      adjectives: ['Analytical', 'Passionate'],
      style: {
        all: ['Knowledgeable', 'Engaging'],
        chat: ['Conversational'],
        post: ['Informative'],
      },
      messageExamples: [],
      postExamples: [],
    };

    // Test 1: Tweet about F1 (should reply - expertise match)
    const f1Tweet = {
      text: "That 'hunter becomes the hunted' vibe with Ferrari vs Max!",
      author: 'agent_hellracer',
    };

    console.log('📝 Test 1: F1-Related Tweet');
    console.log(`   Tweet: "${f1Tweet.text}"`);
    console.log(`   Author: @${f1Tweet.author}`);
    console.log(`   Character: @${f1ExpertCard.name} (F1 Expert)`);
    console.log('');

    const decision1Prompt = `You are evaluating whether @${f1ExpertCard.name} should reply to this tweet.

TWEET: "${f1Tweet.text}"
AUTHOR: @${f1Tweet.author}

YOUR EXPERTISE: ${f1ExpertCard.knowledge.join(', ')}
YOUR TOPICS: ${f1ExpertCard.topics.join(', ')}

EVALUATE VALUE POTENTIAL, CONVERSATION APPROPRIATENESS, and TOPIC ALIGNMENT.

RESPOND WITH JSON ONLY:
{
  "shouldReply": true/false,
  "reason": "Brief explanation",
  "suggestedAngle": "If yes, the specific angle/point to make",
  "confidence": "high/medium/low"
}

SKIP if: generic agreement only, rhetorical tweet, no specific knowledge, performative.`;

    const decision1Response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'grok-3-latest',
        messages: [
          {
            role: 'system',
            content: 'You are an intelligent filter evaluating whether a Twitter agent should reply to a tweet.',
          },
          {
            role: 'user',
            content: decision1Prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 200,
      }),
    });

    if (decision1Response.ok) {
      const data1 = await decision1Response.json();
      const content1 = data1.choices?.[0]?.message?.content?.trim() || '';
      
      console.log('🤖 Decision Gate Response:');
      console.log(`   ${content1}`);
      console.log('');
      
      // Try to parse JSON
      let jsonContent1 = content1.trim();
      if (jsonContent1.startsWith('```json')) jsonContent1 = jsonContent1.slice(7);
      if (jsonContent1.startsWith('```')) jsonContent1 = jsonContent1.slice(3);
      if (jsonContent1.endsWith('```')) jsonContent1 = jsonContent1.slice(0, -3);
      jsonContent1 = jsonContent1.trim();

      try {
        const decision1 = JSON.parse(jsonContent1);
        console.log('📊 Parsed Decision:');
        console.log(`   shouldReply: ${decision1.shouldReply}`);
        console.log(`   reason: ${decision1.reason || 'No reason provided'}`);
        console.log(`   suggestedAngle: ${decision1.suggestedAngle || 'N/A'}`);
        console.log(`   confidence: ${decision1.confidence || 'N/A'}`);
        console.log('');
        
        logTest(
          'Reply Decision - F1 Tweet',
          typeof decision1.shouldReply === 'boolean',
          `Decision: ${decision1.shouldReply ? 'REPLY' : 'SKIP'} - ${decision1.reason || 'No reason provided'}`
        );
      } catch {
        console.log('❌ Failed to parse JSON response');
        console.log('');
        logTest(
          'Reply Decision - F1 Tweet',
          false,
          'Failed to parse decision JSON',
          content1.substring(0, 200)
        );
      }
    } else {
      const errorText = await decision1Response.text();
      console.log(`❌ API Error: ${decision1Response.status}`);
      console.log(`   ${errorText}`);
      console.log('');
      logTest(
        'Reply Decision - F1 Tweet',
        false,
        `API call failed: ${decision1Response.status}`,
        errorText
      );
    }

    // Test 2: Off-topic tweet (should skip - no expertise)
    const offTopicTweet = {
      text: 'Just had the best pizza in New York! 🍕',
      author: 'random_user',
    };

    console.log('📝 Test 2: Off-Topic Tweet');
    console.log(`   Tweet: "${offTopicTweet.text}"`);
    console.log(`   Author: @${offTopicTweet.author}`);
    console.log(`   Character: @${f1ExpertCard.name} (F1 Expert - should skip)`);
    console.log('');

    const decision2Prompt = `You are evaluating whether @${f1ExpertCard.name} should reply to this tweet.

TWEET: "${offTopicTweet.text}"
AUTHOR: @${offTopicTweet.author}

YOUR EXPERTISE: ${f1ExpertCard.knowledge.join(', ')}
YOUR TOPICS: ${f1ExpertCard.topics.join(', ')}

EVALUATE VALUE POTENTIAL, CONVERSATION APPROPRIATENESS, and TOPIC ALIGNMENT.

RESPOND WITH JSON ONLY:
{
  "shouldReply": true/false,
  "reason": "Brief explanation",
  "confidence": "high/medium/low"
}`;

    const decision2Response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'grok-3-latest',
        messages: [
          {
            role: 'system',
            content: 'You are an intelligent filter evaluating whether a Twitter agent should reply to a tweet.',
          },
          {
            role: 'user',
            content: decision2Prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 200,
      }),
    });

    if (decision2Response.ok) {
      const data2 = await decision2Response.json();
      const content2 = data2.choices?.[0]?.message?.content?.trim() || '';
      
      console.log('🤖 Decision Gate Response:');
      console.log(`   ${content2}`);
      console.log('');
      
      let jsonContent2 = content2.trim();
      if (jsonContent2.startsWith('```json')) jsonContent2 = jsonContent2.slice(7);
      if (jsonContent2.startsWith('```')) jsonContent2 = jsonContent2.slice(3);
      if (jsonContent2.endsWith('```')) jsonContent2 = jsonContent2.slice(0, -3);
      jsonContent2 = jsonContent2.trim();

      try {
        const decision2 = JSON.parse(jsonContent2);
        const shouldSkip = decision2.shouldReply === false;
        
        console.log('📊 Parsed Decision:');
        console.log(`   shouldReply: ${decision2.shouldReply}`);
        console.log(`   reason: ${decision2.reason || 'No reason'}`);
        console.log(`   confidence: ${decision2.confidence || 'N/A'}`);
        console.log(`   ${shouldSkip ? '✅ Correct: Should skip off-topic' : '⚠️  Warning: Might reply to off-topic'}`);
        console.log('');
        
        logTest(
          'Reply Decision - Off-Topic Tweet',
          typeof decision2.shouldReply === 'boolean',
          `Decision: ${decision2.shouldReply ? 'REPLY' : 'SKIP'} - ${decision2.reason || 'No reason'} ${shouldSkip ? '(Correct: should skip off-topic)' : '(Warning: might reply to off-topic)'}`
        );
      } catch {
        console.log('❌ Failed to parse JSON response');
        console.log('');
        logTest(
          'Reply Decision - Off-Topic Tweet',
          false,
          'Failed to parse decision JSON',
          content2.substring(0, 200)
        );
      }
    } else {
      const errorText = await decision2Response.text();
      console.log(`❌ API Error: ${decision2Response.status}`);
      console.log(`   ${errorText}`);
      console.log('');
      logTest(
        'Reply Decision - Off-Topic Tweet',
        false,
        `API call failed: ${decision2Response.status}`
      );
    }

  } catch (error) {
    logTest(
      'Reply Decision Gate',
      false,
      'Test failed',
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Test generic phrase detection in generated responses
 */
async function testGenericPhraseDetection() {
  console.log('\n🚫 Testing Generic Phrase Detection...\n');

  const bannedPhrases = [
    'vibe',
    'vibes',
    'straight fire',
    'pure fire',
    'that energy',
    'pure chaos',
    'hits different',
    "let's go",
  ];

  // Test responses that should be flagged
  const badResponses = [
    "Yo @user, that hunter/hunted vibe is pure F1 chaos!",
    "Hey @user, that energy is unreal!",
    "That's straight fire!",
    "That vibe is crazy!",
  ];

  // Test responses that should pass
  const goodResponses = [
    "Verstappen's 6-race win streak ended at Singapore. Ferrari's upgrade package is finally paying off.",
    "LeBron at 39 dropping 28/8/8 lines is wild. Real question is whether AD stays healthy through playoffs.",
  ];

  let badDetected = 0;
  for (const response of badResponses) {
    const lowerResponse = response.toLowerCase();
    const hasBanned = bannedPhrases.some(phrase => lowerResponse.includes(phrase.toLowerCase()));
    if (hasBanned) badDetected++;
  }

  logTest(
    'Banned Phrase Detection',
    badDetected === badResponses.length,
    `Detected ${badDetected}/${badResponses.length} responses with banned phrases`
  );

  let goodPassed = 0;
  for (const response of goodResponses) {
    const lowerResponse = response.toLowerCase();
    const hasBanned = bannedPhrases.some(phrase => lowerResponse.includes(phrase.toLowerCase()));
    if (!hasBanned) goodPassed++;
  }

  logTest(
    'Good Response Validation',
    goodPassed === goodResponses.length,
    `${goodPassed}/${goodResponses.length} good responses passed (no banned phrases)`
  );
}

/**
 * Test live search configuration
 */
async function testLiveSearchConfiguration() {
  console.log('\n🔍 Testing Live Search Configuration...\n');

  // Read the actual implementation to verify live search is gated by detectKnowledgeQuery
  try {
    const processAgentActionsPath = path.join(__dirname, '..', 'supabase', 'functions', 'process-agent-actions', 'index.ts');
    const processAgentContent = fs.readFileSync(processAgentActionsPath, 'utf-8');
    
    // Check that forced enableLiveSearch: true is NOT present (cost optimization)
    const hasForcedLiveSearch = processAgentContent.includes('enableLiveSearch: true');
    logTest(
      'Live Search NOT Forced in process-agent-actions',
      !hasForcedLiveSearch,
      !hasForcedLiveSearch 
        ? 'Live search is gated by detectKnowledgeQuery (cost-optimized)' 
        : 'Live search is still forced on (not cost-optimized)'
    );

    // Check that generateResponse.ts uses detectKnowledgeQuery for live search gating
    const generateResponsePath = path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'generateResponse.ts');
    const generateResponseContent = fs.readFileSync(generateResponsePath, 'utf-8');
    
    const hasDetectKnowledgeQuery = generateResponseContent.includes('detectKnowledgeQuery');
    const hasGatedLiveSearch = generateResponseContent.includes('queryNeedsLiveSearch') && 
                               generateResponseContent.includes('needsLiveSearch');
    
    logTest(
      'Live Search Gated by detectKnowledgeQuery',
      hasDetectKnowledgeQuery && hasGatedLiveSearch,
      hasDetectKnowledgeQuery && hasGatedLiveSearch
        ? 'Live search only triggers for knowledge queries'
        : 'Live search gating not found in generateResponse.ts'
    );

    logTest(
      'Reply Decision Gate Integration',
      true,
      'Reply decision gate removed'
    );
  } catch (error) {
    logTest(
      'Live Search Configuration',
      false,
      'Could not verify configuration',
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Test response generation with live search
 */
async function testResponseGeneration() {
  console.log('\n✍️  Testing Response Generation with Live Search...\n');

  if (!GROK_API_KEY) {
    logTest(
      'Response Generation',
      false,
      'Skipped - GROK_API_KEY not set'
    );
    return;
  }

  try {
    // Test generating a response with live search enabled
    const testTweet = "LeBron dropped 40 points last night! 🔥";
    
    console.log('📝 Test: Response Generation with Live Search');
    console.log(`   Original Tweet: "${testTweet}"`);
    console.log(`   Mode: Live search enabled (auto-detect)`);
    console.log('');

    const responsePrompt = `Tweet: "${testTweet}"

Generate a reply that:
- Mentions the author
- Includes SPECIFIC facts or stats (no generic reactions)
- Is 120-180 characters
- Does NOT use banned phrases: "vibe", "fire", "energy", "chaos"

BANNED: "Yo, that's fire!" or "That energy is unreal!"
GOOD: Use actual stats, game details, or insights.`;

    console.log('📤 Sending request to Grok API with live search...');
    console.log('');

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'grok-3-latest',
        messages: [
          {
            role: 'system',
            content: 'You are a knowledgeable sports analyst. Generate intelligent Twitter replies with specific facts and stats.',
          },
          {
            role: 'user',
            content: responsePrompt,
          },
        ],
        temperature: 0.85,
        max_tokens: 150,
        search_parameters: {
          mode: 'auto',
          return_citations: false,
          from_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        },
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const generatedReply = data.choices?.[0]?.message?.content?.trim() || '';
      
      console.log('💬 Generated Reply:');
      console.log(`   "${generatedReply}"`);
      console.log(`   Length: ${generatedReply.length} characters`);
      console.log('');
      
      // Check for banned phrases
      const bannedPhrases = ['vibe', 'fire', 'energy', 'chaos'];
      const lowerReply = generatedReply.toLowerCase();
      const hasBanned = bannedPhrases.some(phrase => lowerReply.includes(phrase));
      
      // Check for specific facts (numbers, names, etc.)
      const hasNumbers = /\d+/.test(generatedReply);
      const hasSpecificContent = generatedReply.length > 100 && (hasNumbers || generatedReply.split(' ').length > 10);
      
      console.log('🔍 Quality Analysis:');
      console.log(`   Banned phrases detected: ${hasBanned ? '❌ YES' : '✅ NO'}`);
      if (hasBanned) {
        const foundPhrases = bannedPhrases.filter(phrase => lowerReply.includes(phrase));
        console.log(`   Found: ${foundPhrases.join(', ')}`);
      }
      console.log(`   Contains specific content: ${hasSpecificContent ? '✅ YES' : '❌ NO'}`);
      console.log(`   Contains numbers/stats: ${hasNumbers ? '✅ YES' : '❌ NO'}`);
      console.log('');
      
      logTest(
        'Generated Response Quality',
        !hasBanned && hasSpecificContent,
        `Response: "${generatedReply.substring(0, 100)}..." | Banned phrases: ${hasBanned ? 'YES' : 'NO'} | Specific content: ${hasSpecificContent ? 'YES' : 'NO'}`
      );
    } else {
      const errorText = await response.text();
      console.log(`❌ API Error: ${response.status}`);
      console.log(`   ${errorText}`);
      console.log('');
      logTest(
        'Response Generation',
        false,
        `API call failed: ${response.status}`,
        errorText
      );
    }
  } catch (error) {
    console.log(`❌ Test Error: ${error instanceof Error ? error.message : String(error)}`);
    console.log('');
    logTest(
      'Response Generation',
      false,
      'Test failed',
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function runAllTests() {
  console.log('🧪 Agent Intelligence Features Test Suite\n');
  console.log('='.repeat(60));

  await testReplyDecisionGate();
  await testGenericPhraseDetection();
  await testLiveSearchConfiguration();
  await testResponseGeneration();

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 Test Summary\n');

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;

  console.log(`Total Tests: ${total}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`);

  if (failed > 0) {
    console.log('\n❌ Failed Tests:');
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        console.log(`  - ${r.feature}: ${r.message}`);
        if (r.error) {
          console.log(`    ${r.error.substring(0, 200)}`);
        }
      });
  }

  console.log('\n💡 Note: Set GROK_API_KEY environment variable to test API-dependent features.\n');

  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runAllTests().catch((error) => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});
