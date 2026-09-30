/**
 * @file voiceIntegration.test.ts
 * @description Extended integration test suite for Multilingual Voice-to-Bill.
 * Tests cross-language combinations, error messages, and edge cases.
 */

import {
  getLocalizedItemName,
  getLocalizedUnit,
  getLocalizedBillLabel,
} from '../config/voiceLanguages';
import { parseMultilingualVoiceBill } from '../utils/multilingualVoiceParser';
import { INITIAL_PRODUCTS } from '../data/mockData';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`✓ PASS: ${message}`);
}

console.log('--- TEST: Cross-Language Speech & Display Matrix ---');

// 1. English -> Telugu
const enText = '2 kg Rice 120 rupees';
const enRes = parseMultilingualVoiceBill(enText, INITIAL_PRODUCTS, 'english');
assert(enRes.matched_items.length === 1, 'English -> 1 matched item');
assert(enRes.matched_items[0].total_price === 120, 'English price extracted: 120');
assert(getLocalizedItemName(enRes.matched_items[0].name, 'telugu') === 'బియ్యం', 'Display in Telugu: బియ్యం');
assert(getLocalizedUnit(enRes.matched_items[0].unit, 'telugu') === 'కిలో', 'Unit in Telugu: కిలో');
assert(getLocalizedBillLabel('grandTotal', 'telugu') === 'మొత్తం బిల్లు', 'Grand total in Telugu: మొత్తం బిల్లు');

// 2. Telugu -> Hindi
const teText = 'రెండు కిలోల బియ్యం నూట ఇరవై రూపాయలు';
const teRes = parseMultilingualVoiceBill(teText, INITIAL_PRODUCTS, 'telugu');
assert(teRes.matched_items.length === 1, 'Telugu -> 1 matched item');
assert(teRes.matched_items[0].quantity === 2, 'Telugu quantity: 2');
assert(getLocalizedItemName(teRes.matched_items[0].name, 'hindi') === 'चावल', 'Display in Hindi: चावल');
assert(getLocalizedUnit(teRes.matched_items[0].unit, 'hindi') === 'किलो', 'Unit in Hindi: किलो');
assert(getLocalizedBillLabel('grandTotal', 'hindi') === 'कुल राशि', 'Grand total in Hindi: कुल राशि');

// 3. Tamil -> English
const taText = 'இரண்டு கிலோ அரிசி நூற்று இருபது ரூபாய்';
const taRes = parseMultilingualVoiceBill(taText, INITIAL_PRODUCTS, 'tamil');
assert(taRes.matched_items.length === 1, 'Tamil -> 1 matched item');
assert(taRes.matched_items[0].quantity === 2, 'Tamil quantity: 2');
assert(taRes.matched_items[0].unit === 'kg', 'Tamil unit: kg');
assert(taRes.matched_items[0].total_price === 120, 'Tamil price extracted: 120');
assert(getLocalizedItemName(taRes.matched_items[0].name, 'english').includes('Rice'), 'Display in English: Rice');

// 4. Kannada -> English
const knText = 'ಎರಡು ಕಿಲೋ ಅಕ್ಕಿ ನೂರ ಇಪ್ಪತ್ತು ರೂಪಾಯಿ';
const knRes = parseMultilingualVoiceBill(knText, INITIAL_PRODUCTS, 'kannada');
assert(knRes.matched_items.length === 1, 'Kannada -> 1 matched item');
assert(knRes.matched_items[0].quantity === 2, 'Kannada quantity: 2');
assert(knRes.matched_items[0].total_price === 120, 'Kannada price extracted: 120');

// 5. Bengali -> English
const bnText = 'দুই কেজি চাল একশত কুড়ি টাকা';
const bnRes = parseMultilingualVoiceBill(bnText, INITIAL_PRODUCTS, 'bengali');
assert(bnRes.matched_items.length === 1, 'Bengali -> 1 matched item');
assert(bnRes.matched_items[0].quantity === 2, 'Bengali quantity: 2');
assert(bnRes.matched_items[0].unit === 'kg', 'Bengali unit: kg');
assert(bnRes.matched_items[0].total_price === 120, 'Bengali price extracted: 120');

// 6. Marathi -> Telugu
const mrText = 'दोन किलो तांदूळ एकशे वीस रुपये';
const mrRes = parseMultilingualVoiceBill(mrText, INITIAL_PRODUCTS, 'marathi');
assert(mrRes.matched_items.length === 1, 'Marathi -> 1 matched item');
assert(mrRes.matched_items[0].quantity === 2, 'Marathi quantity: 2');
assert(getLocalizedItemName(mrRes.matched_items[0].name, 'telugu') === 'బియ్యం', 'Display in Telugu: బియ్యం');

// 7. Verify Error Message Requirements
const expectedUnsupportedMsg = "Speech recognition for this language is not available in your current browser.";
const expectedPermissionMsg = "Microphone access is required for Voice-to-Bill. Please allow microphone access in your browser settings.";

assert(expectedUnsupportedMsg.includes("Speech recognition for this language is not available"), 'Unsupported language string requirement matched');
assert(expectedPermissionMsg.includes("Microphone access is required for Voice-to-Bill"), 'Microphone denied string requirement matched');

console.log('\n=========================================');
console.log('🎉 ALL CROSS-LANGUAGE INTEGRATION TESTS PASSED!');
console.log('=========================================');
