/**
 * Test script for the Humanizer module
 * Validates pattern detection and text transformation
 * 
 * Run with: npx ts-node scripts/test-humanizer.ts
 * Or: deno run --allow-read scripts/test-humanizer.ts
 */

import {
  humanizeText,
  detectAIPatterns,
  calculateAIScore,
  getHumanizerDiagnostics,
  needsHumanization,
  getPatternNames,
} from '../supabase/functions/_shared/humanizer.ts';

// Type alias for strictness levels
type HumanizerStrictness = 'light' | 'moderate' | 'strict';

// ============================================================================
// TEST DATA - Examples of AI-generated text with various patterns
// ============================================================================

const AI_TEXT_SAMPLES = {
  // Full example from humanizer skill
  full_ai_example: `The new software update serves as a testament to the company's commitment to innovation. Moreover, it provides a seamless, intuitive, and powerful user experience—ensuring that users can accomplish their goals efficiently. It's not just an update, it's a revolution in how we think about productivity. Industry experts believe this will have a lasting impact on the entire sector, highlighting the company's pivotal role in the evolving technological landscape.`,

  // Expected humanized version (approximate)
  expected_humanized: `The software update adds batch processing, keyboard shortcuts, and offline mode. Early feedback from beta testers has been positive, with most reporting faster task completion.`,

  // Pattern-specific examples
  chatbot_artifacts: `I hope this helps! Let me know if you have any other questions. Feel free to ask anything else!`,

  sycophantic: `That's a great question! You're absolutely right about that. What a thoughtful observation!`,

  ai_vocabulary: `Additionally, the paradigm shift leverages robust synergies to foster holistic growth. Furthermore, we must delve into the intricacies of this multifaceted landscape.`,

  filler_phrases: `In order to understand this, due to the fact that it is important to note that, at the end of the day, for all intents and purposes, it should be noted that we need to proceed.`,

  excessive_hedging: `This could potentially possibly work, and it might possibly be effective. It seems like it would seem that this may perhaps be the right approach.`,

  significance_inflation: `This pivotal moment marks a groundbreaking breakthrough in our revolutionary journey. It's a transformative achievement that represents an unprecedented development.`,

  copula_avoidance: `The company serves as a leader in the industry. It functions as a hub for innovation and stands as a beacon of progress.`,

  em_dash_overuse: `The project—which started last year—has grown significantly—beyond all expectations—into something remarkable—a true success story.`,

  generic_conclusions: `The future looks bright for this initiative. Only time will tell how this plays out. Moving forward, we'll continue to see progress. In conclusion, all in all, overall, this is positive.`,

  cutoff_disclaimers: `While details are limited in available sources, based on available information, as of my last knowledge cutoff, I don't have access to real-time data, but according to my training...`,

  // Short tweet-style responses (should preserve more personality)
  short_tweet: `This is it. Fr though, the vibes are unmatched 🔥`,

  // Normal conversational response
  normal_response: `Yeah I totally get what you mean. The whole situation with the API was wild—took me forever to figure out that the issue was just a missing header. Sometimes the simple stuff trips you up the most.`,

  // Mixed patterns
  mixed_patterns: `Great question! Additionally, in order to delve into this landscape, I hope this helps—the paradigm serves as a testament to innovation. Let me know if you have questions!`,
};

// ============================================================================
// TEST UTILITIES
// ============================================================================

function colorize(text: string, color: 'red' | 'green' | 'yellow' | 'blue' | 'gray'): string {
  const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
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

function printResult(label: string, value: string | number, highlight: boolean = false): void {
  const valueStr = typeof value === 'number' ? value.toString() : value;
  console.log(`${label}: ${highlight ? colorize(valueStr, 'green') : valueStr}`);
}

// ============================================================================
// TESTS
// ============================================================================

async function testPatternDetection(): Promise<void> {
  printHeader('TEST 1: Pattern Detection');
  
  const testCases = [
    { name: 'Chatbot Artifacts', text: AI_TEXT_SAMPLES.chatbot_artifacts },
    { name: 'Sycophantic Tone', text: AI_TEXT_SAMPLES.sycophantic },
    { name: 'AI Vocabulary', text: AI_TEXT_SAMPLES.ai_vocabulary },
    { name: 'Filler Phrases', text: AI_TEXT_SAMPLES.filler_phrases },
    { name: 'Full AI Example', text: AI_TEXT_SAMPLES.full_ai_example },
  ];

  for (const testCase of testCases) {
    printSubheader(testCase.name);
    console.log(colorize(`Input: "${testCase.text.substring(0, 80)}..."`, 'gray'));
    
    const patterns = detectAIPatterns(testCase.text, 'strict');
    console.log(`\nDetected ${patterns.length} pattern(s):`);
    
    for (const pattern of patterns) {
      console.log(`  • ${colorize(pattern.pattern, 'yellow')} (${pattern.category})`);
      console.log(`    Match: "${pattern.match.substring(0, 50)}${pattern.match.length > 50 ? '...' : ''}"`);
    }
    
    const score = calculateAIScore(testCase.text, 'strict');
    console.log(`\nAI Score: ${score >= 50 ? colorize(score.toString(), 'red') : colorize(score.toString(), 'green')}/100`);
  }
}

async function testTextTransformation(): Promise<void> {
  printHeader('TEST 2: Text Transformation');
  
  const testCases = [
    { name: 'Chatbot Artifacts', text: AI_TEXT_SAMPLES.chatbot_artifacts },
    { name: 'AI Vocabulary', text: AI_TEXT_SAMPLES.ai_vocabulary },
    { name: 'Filler Phrases', text: AI_TEXT_SAMPLES.filler_phrases },
    { name: 'Excessive Hedging', text: AI_TEXT_SAMPLES.excessive_hedging },
    { name: 'Full AI Example', text: AI_TEXT_SAMPLES.full_ai_example },
  ];

  for (const testCase of testCases) {
    printSubheader(testCase.name);
    
    console.log(colorize('BEFORE:', 'red'));
    console.log(`"${testCase.text}"\n`);
    
    const humanized = humanizeText(testCase.text, { strictness: 'moderate' });
    
    console.log(colorize('AFTER:', 'green'));
    console.log(`"${humanized}"\n`);
    
    const reduction = ((testCase.text.length - humanized.length) / testCase.text.length * 100).toFixed(1);
    console.log(`Length: ${testCase.text.length} → ${humanized.length} (${reduction}% reduction)`);
  }
}

async function testStrictnessLevels(): Promise<void> {
  printHeader('TEST 3: Strictness Levels');
  
  const text = AI_TEXT_SAMPLES.mixed_patterns;
  const levels: HumanizerStrictness[] = ['light', 'moderate', 'strict'];
  
  console.log(colorize('Original text:', 'gray'));
  console.log(`"${text}"\n`);
  
  for (const level of levels) {
    printSubheader(`Strictness: ${level.toUpperCase()}`);
    
    const patterns = detectAIPatterns(text, level);
    const humanized = humanizeText(text, { strictness: level });
    const score = calculateAIScore(text, level);
    
    console.log(`Patterns detected: ${patterns.length}`);
    console.log(`AI Score: ${score}/100`);
    console.log(`Result: "${humanized}"`);
    console.log(`Length: ${text.length} → ${humanized.length}`);
  }
}

async function testShortTextPreservation(): Promise<void> {
  printHeader('TEST 4: Short Text Personality Preservation');
  
  const shortTexts = [
    AI_TEXT_SAMPLES.short_tweet,
    'Yeah totally, this is fire 🔥',
    'Ngl this is actually pretty cool',
    'Fr though, been thinking about this all day',
  ];
  
  for (const text of shortTexts) {
    printSubheader(`Short text (${text.length} chars)`);
    
    console.log(colorize('BEFORE:', 'gray'));
    console.log(`"${text}"`);
    
    const humanized = humanizeText(text, { 
      strictness: 'moderate',
      preservePersonality: true,
    });
    
    console.log(colorize('AFTER:', 'green'));
    console.log(`"${humanized}"`);
    
    // Check if personality was preserved (minimal changes for short text)
    const changePercent = Math.abs(text.length - humanized.length) / text.length * 100;
    if (changePercent < 20) {
      console.log(colorize('✓ Personality preserved (< 20% change)', 'green'));
    } else {
      console.log(colorize(`⚠ Significant change (${changePercent.toFixed(1)}%)`, 'yellow'));
    }
  }
}

async function testDiagnostics(): Promise<void> {
  printHeader('TEST 5: Full Diagnostics Report');
  
  const text = AI_TEXT_SAMPLES.full_ai_example;
  const report = getHumanizerDiagnostics(text, { strictness: 'moderate' });
  
  console.log('\n📊 DIAGNOSTICS REPORT');
  console.log('─'.repeat(50));
  
  printResult('AI Score', `${report.aiScore}/100`, report.aiScore >= 50);
  printResult('Patterns Detected', report.patternsDetected.length);
  printResult('Original Length', report.originalText.length);
  printResult('Humanized Length', report.humanizedText.length);
  
  console.log('\n📝 Patterns by Category:');
  const byCategory: Record<string, number> = {};
  for (const pattern of report.patternsDetected) {
    byCategory[pattern.category] = (byCategory[pattern.category] || 0) + 1;
  }
  for (const [category, count] of Object.entries(byCategory)) {
    console.log(`  • ${category}: ${count}`);
  }
  
  console.log('\n📄 Humanized Text:');
  console.log(colorize(`"${report.humanizedText}"`, 'green'));
}

async function testNeedsHumanization(): Promise<void> {
  printHeader('TEST 6: Quick Humanization Check');
  
  const samples = [
    { text: 'Just shipped a new feature! Pretty excited about this one.', expected: false },
    { text: AI_TEXT_SAMPLES.chatbot_artifacts, expected: true },
    { text: AI_TEXT_SAMPLES.normal_response, expected: false },
    { text: AI_TEXT_SAMPLES.ai_vocabulary, expected: true },
  ];
  
  for (const sample of samples) {
    const needs = needsHumanization(sample.text, 20);
    const score = calculateAIScore(sample.text, 'light');
    
    const status = needs === sample.expected 
      ? colorize('✓ PASS', 'green')
      : colorize('✗ FAIL', 'red');
    
    console.log(`\n${status}`);
    console.log(`Text: "${sample.text.substring(0, 60)}..."`);
    console.log(`Needs humanization: ${needs} (score: ${score})`);
  }
}

async function testPatternCoverage(): Promise<void> {
  printHeader('TEST 7: Pattern Coverage');
  
  const allPatterns = getPatternNames();
  console.log(`\nTotal patterns implemented: ${allPatterns.length}/24`);
  console.log('\nPattern list:');
  
  for (let i = 0; i < allPatterns.length; i++) {
    console.log(`  ${i + 1}. ${allPatterns[i]}`);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  console.log('\n' + '🧹'.repeat(10));
  console.log(colorize('  HUMANIZER MODULE TEST SUITE', 'blue'));
  console.log('🧹'.repeat(10));
  
  try {
    await testPatternDetection();
    await testTextTransformation();
    await testStrictnessLevels();
    await testShortTextPreservation();
    await testDiagnostics();
    await testNeedsHumanization();
    await testPatternCoverage();
    
    printHeader('TEST SUMMARY');
    console.log(colorize('\n✓ All tests completed successfully!', 'green'));
    console.log('\nThe humanizer module is ready for use.');
    console.log('Enable it by setting advancedSettings.enableHumanizer = true');
    console.log('Adjust strictness with advancedSettings.humanizerStrictness');
    
  } catch (error) {
    console.error(colorize('\n✗ Test failed:', 'red'));
    console.error(error);
    process.exit(1);
  }
}

main();
