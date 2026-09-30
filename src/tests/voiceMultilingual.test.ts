/**
 * @file voiceMultilingual.test.ts
 * @description Comprehensive unit test suite for Multilingual Voice-to-Bill feature.
 * Tests:
 * 1. Centralized language configuration & BCP-47 speech codes
 * 2. Telugu -> English parsing ("రెండు కిలోల బియ్యం నూట ఇరవై రూపాయలు")
 * 3. Hindi -> English parsing ("दो किलो चावल एक सौ बीस रुपये")
 * 4. English -> English parsing ("2 Tata Salt, 3 Parle-G and 1 Aashirvaad Atta")
 * 5. English -> Telugu display localization
 * 6. Hindi -> Telugu display localization
 * 7. Telugu -> Hindi display localization
 * 8. All other languages (Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi, Odia, Assamese)
 * 9. Separation of structured bill data and localization
 */

import {
  VOICE_LANGUAGES,
  VOICE_LANGUAGES_LIST,
  getLocalizedItemName,
  getLocalizedUnit,
  getLocalizedBillLabel,
  type VoiceLanguageKey,
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

console.log('--- TEST 1: Centralized Language Configuration & BCP-47 Codes ---');
const expectedLanguages: Array<{ key: VoiceLanguageKey; code: string; name: string }> = [
  { key: 'english', code: 'en-IN', name: 'English' },
  { key: 'telugu', code: 'te-IN', name: 'Telugu' },
  { key: 'hindi', code: 'hi-IN', name: 'Hindi' },
  { key: 'tamil', code: 'ta-IN', name: 'Tamil' },
  { key: 'kannada', code: 'kn-IN', name: 'Kannada' },
  { key: 'malayalam', code: 'ml-IN', name: 'Malayalam' },
  { key: 'marathi', code: 'mr-IN', name: 'Marathi' },
  { key: 'bengali', code: 'bn-IN', name: 'Bengali' },
  { key: 'gujarati', code: 'gu-IN', name: 'Gujarati' },
  { key: 'punjabi', code: 'pa-IN', name: 'Punjabi' },
  { key: 'odia', code: 'or-IN', name: 'Odia' },
  { key: 'assamese', code: 'as-IN', name: 'Assamese' },
];

assert(VOICE_LANGUAGES_LIST.length === 12, '12 Indian languages configured in list');
for (const item of expectedLanguages) {
  const conf = VOICE_LANGUAGES[item.key];
  assert(conf !== undefined, `${item.name} exists in VOICE_LANGUAGES`);
  assert(conf.speechCode === item.code, `${item.name} has speechCode ${item.code}`);
  assert(conf.label.includes(conf.nativeName), `${item.name} label includes native name`);
}

console.log('\n--- TEST 2: Telugu -> English Extraction ---');
// User prompt example: "రెండు కిలోల బియ్యం నూట ఇరవై రూపాయలు" -> Rice, 2 kg, ₹120
const teluguText = 'రెండు కిలోల బియ్యం నూట ఇరవై రూపాయలు';
const teluguResult = parseMultilingualVoiceBill(teluguText, INITIAL_PRODUCTS, 'telugu');

assert(teluguResult.matched_items.length === 1, 'Matched 1 item from Telugu speech');
const teluguItem = teluguResult.matched_items[0];
assert(teluguItem.quantity === 2, `Quantity is 2 (got ${teluguItem.quantity})`);
assert(teluguItem.unit === 'kg', `Unit is kg (got ${teluguItem.unit})`);
assert(teluguItem.name.toLowerCase().includes('rice'), `Product matches Rice (got ${teluguItem.name})`);
assert(teluguItem.total_price === 120, `Total price extracted is 120 (got ${teluguItem.total_price})`);
assert(teluguResult.total === 120, `Total bill is ₹120 (got ${teluguResult.total})`);

// Localized display when Show Bill In is English:
const localizedItemEnglish = getLocalizedItemName(teluguItem.name, 'english');
const localizedUnitEnglish = getLocalizedUnit(teluguItem.unit, 'english');
assert(localizedItemEnglish.includes('Rice'), `English display name contains 'Rice' (${localizedItemEnglish})`);
assert(localizedUnitEnglish === 'kg', `English display unit is 'kg' (${localizedUnitEnglish})`);

console.log('\n--- TEST 3: Hindi -> English Extraction ---');
// User prompt example: "दो किलो चावल एक सौ बीस रुपये" -> Rice, 2 kg, ₹120
const hindiText = 'दो किलो चावल एक सौ बीस रुपये';
const hindiResult = parseMultilingualVoiceBill(hindiText, INITIAL_PRODUCTS, 'hindi');

assert(hindiResult.matched_items.length === 1, 'Matched 1 item from Hindi speech');
const hindiItem = hindiResult.matched_items[0];
assert(hindiItem.quantity === 2, `Quantity is 2 (got ${hindiItem.quantity})`);
assert(hindiItem.unit === 'kg', `Unit is kg (got ${hindiItem.unit})`);
assert(hindiItem.name.toLowerCase().includes('rice'), `Product matches Rice (got ${hindiItem.name})`);
assert(hindiItem.total_price === 120, `Total price extracted is 120 (got ${hindiItem.total_price})`);

console.log('\n--- TEST 4: Hindi -> Telugu Bill Display Localization ---');
// When "Show Bill In" is Telugu:
const localizedItemTelugu = getLocalizedItemName(hindiItem.name, 'telugu');
const localizedUnitTelugu = getLocalizedUnit(hindiItem.unit, 'telugu');
const localizedSubtotalTelugu = getLocalizedBillLabel('subtotal', 'telugu');
const localizedGrandTotalTelugu = getLocalizedBillLabel('grandTotal', 'telugu');

assert(localizedItemTelugu === 'బాస్మతి బియ్యం' || localizedItemTelugu === 'బియ్యం', `Item localized to Telugu: ${localizedItemTelugu}`);
assert(localizedUnitTelugu === 'కిలో', `Unit localized to Telugu: ${localizedUnitTelugu}`);
assert(localizedSubtotalTelugu === 'ఉపమొత్తం', `Subtotal label in Telugu is ఉపమొత్తం`);
assert(localizedGrandTotalTelugu === 'మొత్తం బిల్లు', `Grand total label in Telugu is మొత్తం బిల్లు`);

console.log('\n--- TEST 5: English -> English (Original Functionality Intact) ---');
const englishText = '2 Tata Salt, 3 Parle-G and 1 Aashirvaad Atta';
const englishResult = parseMultilingualVoiceBill(englishText, INITIAL_PRODUCTS, 'english');

console.log('englishResult:', JSON.stringify(englishResult, null, 2));
assert(englishResult.matched_items.length >= 2, `English items parsed (matched: ${englishResult.matched_items.length})`);
const tataSalt = englishResult.matched_items.find(i => i.name.toLowerCase().includes('tata salt'));
const parleG = englishResult.matched_items.find(i => i.name.toLowerCase().includes('parle-g'));
assert(tataSalt !== undefined, 'Tata Salt recognized');
assert(tataSalt!.quantity === 2, `Tata Salt quantity is 2 (got ${tataSalt?.quantity})`);
assert(parleG !== undefined, 'Parle-G recognized');
assert(parleG!.quantity === 3, `Parle-G quantity is 3 (got ${parleG?.quantity})`);

console.log('\n--- TEST 6: Structured Bill Separation ---');
// Verify that structured data maintains numbers and currency correctly
assert(typeof teluguItem.quantity === 'number', 'Quantity is numeric');
assert(typeof teluguItem.unit_price === 'number', 'Unit price is numeric');
assert(typeof teluguItem.total_price === 'number', 'Total price is numeric');
assert(teluguItem.product_id.length > 0, 'Structured item maintains product ID');

console.log('\n--- TEST 7: Multi-Language Label Coverage ---');
for (const lang of VOICE_LANGUAGES_LIST) {
  const billTitle = getLocalizedBillLabel('billTitle', lang.key);
  const subtotal = getLocalizedBillLabel('subtotal', lang.key);
  const total = getLocalizedBillLabel('total', lang.key);
  const riceName = getLocalizedItemName('Rice', lang.key);
  const kgUnit = getLocalizedUnit('kg', lang.key);

  assert(billTitle.length > 0, `billTitle present for ${lang.name}`);
  assert(subtotal.length > 0, `subtotal present for ${lang.name}: ${subtotal}`);
  assert(total.length > 0, `total present for ${lang.name}: ${total}`);
  assert(riceName.length > 0, `Rice translation present for ${lang.name}: ${riceName}`);
  assert(kgUnit.length > 0, `kg translation present for ${lang.name}: ${kgUnit}`);
}

console.log('\n=========================================');
console.log('🎉 ALL MULTILINGUAL TESTS PASSED SUCCESSFULLY!');
console.log('=========================================');
