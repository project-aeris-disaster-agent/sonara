/**
 * Test script for anti-echo mechanism
 * Tests multiple agents replying to the same tweet to verify they don't echo keywords
 */

import { extractEchoablePhrases, detectEchoSlop, buildAntiEchoPrompt } from '../supabase/functions/_shared/antiEcho.ts';

// The exact tweet from the screenshot that caused echo problems
const TEST_TWEET = `@lordsedano, pushing $DARE to a $10M market cap needs a mix of community buzz and real utility. Think strategic partnerships or unique use cases like incentivizing wild stunts, as seen with Dare Markets.`;

// Example replies that echo too much (from the screenshot)
const ECHO_REPLIES = [
  `@lordsedano, to push $DARE to a $10M market cap, focus on building community hype and strategic partnerships. Think liquidity pools or collabs with gaming projects in Web3.`,
  `@lordsedano, getting $DARE to a $10M market cap is a tough grind, but doable. Focus on building a strong community first—more holders mean more stability.`,
  `@jdaredevil2, getting $DARE to a $10M market cap means building real utility and community hype. Look at projects like Dare Markets—they've raised $2M by tying crypto to wild stunts.`,
];

// Example replies that DON'T echo (what we want)
const GOOD_REPLIES = [
  `@lordsedano Wait, are wild stunts really the play here? I'd focus on the product first. What's the actual utility beyond speculation?`,
  `@lordsedano Nah, forget the valuation targets. Show me what the token actually does. Utility first, numbers follow.`,
  `@lordsedano The real question is: what problem is this solving? Market caps are vanity metrics if there's no substance.`,
];

console.log('='.repeat(60));
console.log('🧪 ANTI-ECHO MECHANISM TEST');
console.log('='.repeat(60));

// Test 1: Extract echoable phrases from the original tweet
console.log('\n📝 TEST 1: Extracting echoable phrases from tweet');
console.log('-'.repeat(40));
console.log(`Original tweet: "${TEST_TWEET}"`);
console.log('');

const echoablePhrases = extractEchoablePhrases(TEST_TWEET);
console.log('Extracted echoable phrases:');
echoablePhrases.forEach((phrase, i) => {
  console.log(`  ${i + 1}. "${phrase}"`);
});

// Test 2: Check if echo replies are detected
console.log('\n📝 TEST 2: Detecting echo in BAD replies (should all be detected)');
console.log('-'.repeat(40));

let echoDetectedCount = 0;
ECHO_REPLIES.forEach((reply, i) => {
  const result = detectEchoSlop(reply, TEST_TWEET, echoablePhrases);
  const status = result.isEcho ? '🚫 ECHO DETECTED' : '✅ No echo';
  if (result.isEcho) echoDetectedCount++;
  console.log(`\nReply ${i + 1}: ${status}`);
  console.log(`  "${reply.substring(0, 80)}..."`);
  if (result.reason) {
    console.log(`  Reason: ${result.reason}`);
  }
  if (result.matchedPhrases && result.matchedPhrases.length > 0) {
    console.log(`  Matched: ${result.matchedPhrases.slice(0, 2).join(', ')}`);
  }
});

console.log(`\n📊 Echo detection rate for bad replies: ${echoDetectedCount}/${ECHO_REPLIES.length} (expected: ${ECHO_REPLIES.length}/${ECHO_REPLIES.length})`);

// Test 3: Check if good replies pass
console.log('\n📝 TEST 3: Checking GOOD replies (should NOT be detected as echo)');
console.log('-'.repeat(40));

let falsePositiveCount = 0;
GOOD_REPLIES.forEach((reply, i) => {
  const result = detectEchoSlop(reply, TEST_TWEET, echoablePhrases);
  const status = result.isEcho ? '🚫 ECHO DETECTED (false positive!)' : '✅ No echo (correct)';
  if (result.isEcho) falsePositiveCount++;
  console.log(`\nReply ${i + 1}: ${status}`);
  console.log(`  "${reply.substring(0, 80)}..."`);
});

console.log(`\n📊 False positive rate for good replies: ${falsePositiveCount}/${GOOD_REPLIES.length} (expected: 0/${GOOD_REPLIES.length})`);

// Test 4: Show the anti-echo prompt that would be generated
console.log('\n📝 TEST 4: Generated anti-echo prompt');
console.log('-'.repeat(40));
const antiEchoPrompt = buildAntiEchoPrompt(echoablePhrases);
console.log(antiEchoPrompt);

// Summary
console.log('\n' + '='.repeat(60));
console.log('📊 TEST SUMMARY');
console.log('='.repeat(60));
console.log(`✅ Echoable phrases extracted: ${echoablePhrases.length}`);
console.log(`✅ Echo detection on bad replies: ${echoDetectedCount}/${ECHO_REPLIES.length} detected`);
console.log(`✅ False positives on good replies: ${falsePositiveCount}/${GOOD_REPLIES.length}`);

const allTestsPassed = echoDetectedCount >= 2 && falsePositiveCount === 0;
console.log('');
console.log(allTestsPassed ? '🎉 ALL TESTS PASSED!' : '⚠️  SOME TESTS NEED ATTENTION');
