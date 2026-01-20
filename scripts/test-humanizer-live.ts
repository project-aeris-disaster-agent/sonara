/**
 * Live test script for the Humanizer module with actual agent responses
 * Tests the humanizer integration with generateResponse()
 * 
 * Run with: 
 *   set GROK_API_KEY=your_key && npx ts-node scripts/test-humanizer-live.ts
 * Or:
 *   $env:GROK_API_KEY="your_key"; npx ts-node scripts/test-humanizer-live.ts
 */

import { generateResponse } from '../supabase/functions/_shared/generateResponse.ts';
import { 
  detectAIPatterns, 
  calculateAIScore,
  getHumanizerDiagnostics 
} from '../supabase/functions/_shared/humanizer.ts';

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

const GROK_API_KEY = process.env.GROK_API_KEY || process.env.VITE_GROK_API_KEY;

if (!GROK_API_KEY) {
  console.error('❌ Error: GROK_API_KEY environment variable is required');
  console.error('Set it with: $env:GROK_API_KEY="your_key"');
  process.exit(1);
}

// Test prompts designed to elicit AI-like responses
const TEST_PROMPTS = [
  {
    name: 'Complex Question',
    message: 'What are the key factors that make Web3 gaming successful?',
    mode: 'chat' as const,
  },
  {
    name: 'Hot Take Tweet',
    message: 'Hot take: AI agents will replace 90% of crypto influencers',
    mode: 'twitter' as const,
    targetUsername: 'cryptobro99',
  },
  {
    name: 'Opinion Request',
    message: 'Do you think NFTs are still relevant in gaming?',
    mode: 'chat' as const,
  },
  {
    name: 'News Discussion Tweet',
    message: 'Breaking: Ethereum just hit $5000! This is huge for the ecosystem.',
    mode: 'twitter' as const,
    targetUsername: 'ethtrader',
  },
];

// Test character card
const TEST_CHARACTER = {
  name: 'TestAgent',
  bio: [
    'AI enthusiast exploring the intersection of gaming and blockchain',
    'Building cool stuff with Web3 technologies',
    'Here to share insights and learn from the community'
  ],
  lore: [
    'Started in crypto during the 2021 bull run',
    'Has experience with multiple blockchain gaming projects'
  ],
  knowledge: [
    'Web3 gaming ecosystems',
    'Blockchain technology',
    'AI and machine learning',
    'Community building'
  ],
  topics: [
    'Gaming',
    'Web3',
    'AI',
    'Blockchain',
    'NFTs'
  ],
  adjectives: ['analytical', 'curious', 'friendly', 'tech-savvy'],
  style: {
    all: ['conversational', 'informative', 'balanced'],
    chat: ['helpful', 'engaging'],
    post: ['concise', 'insightful']
  },
  messageExamples: [],
  postExamples: []
};

const TEST_METADATA = {
  signaturePhrases: ['tbh', 'ngl', 'fr'],
  emojiPatterns: ['🔥', '👀', '💯'],
  humorStyle: 'casual wit',
  vocabularyLevel: 'casual',
  opinionStyle: 'balanced' as const
};

// ============================================================================
// TEST UTILITIES
// ============================================================================

function colorize(text: string, color: 'red' | 'green' | 'yellow' | 'blue' | 'gray' | 'cyan' | 'magenta'): string {
  const colors: Record<string, string> = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
  };
  return `${colors[color]}${text}\x1b[0m`;
}

function printHeader(text: string): void {
  console.log('\n' + '='.repeat(70));
  console.log(colorize(text, 'blue'));
  console.log('='.repeat(70));
}

function printSubheader(text: string): void {
  console.log('\n' + colorize(`--- ${text} ---`, 'yellow'));
}

// ============================================================================
// MAIN TEST
// ============================================================================

async function runTest(
  prompt: typeof TEST_PROMPTS[0],
  withHumanizer: boolean
): Promise<{ response: string; aiScore: number; patterns: number }> {
  const result = await generateResponse({
    characterCard: TEST_CHARACTER,
    userMessage: prompt.message,
    personalityMetadata: TEST_METADATA,
    mode: prompt.mode,
    grokApiKey: GROK_API_KEY,
    targetUsername: prompt.targetUsername,
    advancedSettings: {
      responseLengthPreference: 'normal',
      allowTangents: 'rarely',
      enableLiveSearch: false,
      openingVariety: 60,
      antiSlopStrictness: 70,
      emojiIntensity: 30,
      signaturePhraseFrequency: 30,
      humorIntensity: 50,
      opinionStrength: 'normal',
      creativityLevel: 'balanced',
      // HUMANIZER SETTINGS
      enableHumanizer: withHumanizer,
      humanizerStrictness: 'moderate',
    },
  });

  if (!result) {
    return { response: '[ERROR: No response]', aiScore: 0, patterns: 0 };
  }

  const aiScore = calculateAIScore(result.response, 'moderate');
  const patterns = detectAIPatterns(result.response, 'moderate');

  return {
    response: result.response,
    aiScore,
    patterns: patterns.length,
  };
}

async function main(): Promise<void> {
  console.log('\n' + '🧹'.repeat(10));
  console.log(colorize('  HUMANIZER LIVE TEST - Actual Agent Responses', 'cyan'));
  console.log('🧹'.repeat(10));
  console.log(colorize(`\nUsing API Key: ${GROK_API_KEY.substring(0, 10)}...`, 'gray'));

  const results: Array<{
    prompt: string;
    mode: string;
    withoutHumanizer: { response: string; aiScore: number; patterns: number };
    withHumanizer: { response: string; aiScore: number; patterns: number };
  }> = [];

  for (const prompt of TEST_PROMPTS) {
    printHeader(`TEST: ${prompt.name} (${prompt.mode} mode)`);
    console.log(colorize(`Prompt: "${prompt.message}"`, 'gray'));
    
    // Test WITHOUT humanizer
    printSubheader('WITHOUT Humanizer');
    console.log('Generating response...');
    const withoutHumanizer = await runTest(prompt, false);
    console.log(colorize(`Response: "${withoutHumanizer.response}"`, 'yellow'));
    console.log(`AI Score: ${withoutHumanizer.aiScore}/100 | Patterns detected: ${withoutHumanizer.patterns}`);

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test WITH humanizer
    printSubheader('WITH Humanizer');
    console.log('Generating response...');
    const withHumanizer = await runTest(prompt, true);
    console.log(colorize(`Response: "${withHumanizer.response}"`, 'green'));
    console.log(`AI Score: ${withHumanizer.aiScore}/100 | Patterns detected: ${withHumanizer.patterns}`);

    // Comparison
    printSubheader('Comparison');
    const scoreDiff = withoutHumanizer.aiScore - withHumanizer.aiScore;
    const patternDiff = withoutHumanizer.patterns - withHumanizer.patterns;
    
    if (scoreDiff > 0) {
      console.log(colorize(`✓ AI Score reduced by ${scoreDiff} points`, 'green'));
    } else if (scoreDiff < 0) {
      console.log(colorize(`⚠ AI Score increased by ${Math.abs(scoreDiff)} points`, 'yellow'));
    } else {
      console.log('AI Score unchanged');
    }

    if (patternDiff > 0) {
      console.log(colorize(`✓ ${patternDiff} fewer AI patterns detected`, 'green'));
    } else if (patternDiff < 0) {
      console.log(colorize(`⚠ ${Math.abs(patternDiff)} more AI patterns detected`, 'yellow'));
    } else {
      console.log('Pattern count unchanged');
    }

    results.push({
      prompt: prompt.name,
      mode: prompt.mode,
      withoutHumanizer,
      withHumanizer,
    });

    // Delay between tests
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  // Final summary
  printHeader('FINAL SUMMARY');
  
  console.log('\n' + '┌' + '─'.repeat(68) + '┐');
  console.log('│' + ' Test'.padEnd(25) + '│' + ' Mode'.padEnd(10) + '│' + ' Score (before→after)'.padEnd(22) + '│' + ' Patterns'.padEnd(12) + '│');
  console.log('├' + '─'.repeat(68) + '┤');
  
  let totalScoreReduction = 0;
  let totalPatternReduction = 0;
  
  for (const result of results) {
    const scoreBefore = result.withoutHumanizer.aiScore;
    const scoreAfter = result.withHumanizer.aiScore;
    const patternsBefore = result.withoutHumanizer.patterns;
    const patternsAfter = result.withHumanizer.patterns;
    
    const scoreChange = scoreBefore - scoreAfter;
    const patternChange = patternsBefore - patternsAfter;
    
    totalScoreReduction += scoreChange;
    totalPatternReduction += patternChange;
    
    const scoreStr = `${scoreBefore} → ${scoreAfter}`;
    const patternStr = `${patternsBefore} → ${patternsAfter}`;
    
    console.log('│' + ` ${result.prompt}`.padEnd(25) + '│' + ` ${result.mode}`.padEnd(10) + '│' + ` ${scoreStr}`.padEnd(22) + '│' + ` ${patternStr}`.padEnd(12) + '│');
  }
  
  console.log('└' + '─'.repeat(68) + '┘');
  
  console.log('\n' + colorize('Overall Results:', 'cyan'));
  console.log(`  Average AI Score reduction: ${(totalScoreReduction / results.length).toFixed(1)} points`);
  console.log(`  Average Pattern reduction: ${(totalPatternReduction / results.length).toFixed(1)} patterns`);
  
  if (totalScoreReduction > 0) {
    console.log(colorize('\n✓ Humanizer is effectively reducing AI-like writing patterns!', 'green'));
  } else {
    console.log(colorize('\n⚠ Humanizer may need tuning for these specific prompts', 'yellow'));
  }
}

main().catch(console.error);
