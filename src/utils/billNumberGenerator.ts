/**
 * @file billNumberGenerator.ts
 * @description Date-based, sequential, and unique Bill Number generator for ShopPulse POS receipts.
 * Format: `SP-YYYYMMDD-001`, `SP-YYYYMMDD-002`, etc.
 */

import { doc, type Transaction } from 'firebase/firestore';
import { db } from '../services/firebase';

const COUNTERS_COLLECTION = 'counters';
const LOCAL_COUNTER_KEY_PREFIX = 'shoppulse_bill_seq_';

/**
 * Format date as YYYYMMDD in local timezone.
 */
export function getFormattedDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Format sequential number with 3 digits padding (001, 002, ..., 999).
 */
export function formatSequence(seq: number): string {
  return String(seq).padStart(3, '0');
}

/**
 * Construct standard ShopPulse bill number string.
 */
export function buildBillNumber(dateKey: string, sequence: number): string {
  return `SP-${dateKey}-${formatSequence(sequence)}`;
}

/**
 * Generate sequential bill number within an existing Firestore transaction.
 * Ensures strict atomicity and uniqueness across concurrent checkout registers.
 */
export async function generateTransactionalBillNumber(
  transaction: Transaction,
  date: Date = new Date()
): Promise<{ billNumber: string; sequence: number; dateKey: string }> {
  const dateKey = getFormattedDateKey(date);
  const counterDocRef = doc(db, COUNTERS_COLLECTION, `sales_${dateKey}`);

  const counterSnapshot = await transaction.get(counterDocRef);
  let nextSeq = 1;

  if (counterSnapshot.exists()) {
    const data = counterSnapshot.data();
    const currentSeq = typeof data.count === 'number' ? data.count : 0;
    nextSeq = currentSeq + 1;
    transaction.update(counterDocRef, { 
      count: nextSeq, 
      updatedAt: new Date().toISOString() 
    });
  } else {
    transaction.set(counterDocRef, { 
      dateKey, 
      count: 1, 
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString() 
    });
  }

  const billNumber = buildBillNumber(dateKey, nextSeq);
  return { billNumber, sequence: nextSeq, dateKey };
}

/**
 * Standalone bill number generator (for local offline mode or fallback).
 * Uses local storage sequence and checks against existing sales.
 */
export function generateLocalBillNumber(date: Date = new Date(), existingBills: string[] = []): string {
  const dateKey = getFormattedDateKey(date);
  const storageKey = `${LOCAL_COUNTER_KEY_PREFIX}${dateKey}`;

  let maxSeq = 0;

  // 1. Read stored sequence from localStorage
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed > maxSeq) {
          maxSeq = parsed;
        }
      }
    } catch {
      // Ignore storage read error
    }
  }

  // 2. Cross-check with existing bill numbers for today
  for (const bill of existingBills) {
    if (bill && bill.startsWith(`SP-${dateKey}-`)) {
      const parts = bill.split('-');
      const seqPart = parseInt(parts[2], 10);
      if (!isNaN(seqPart) && seqPart > maxSeq) {
        maxSeq = seqPart;
      }
    }
  }

  const nextSeq = maxSeq + 1;

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(storageKey, String(nextSeq));
    } catch {
      // Ignore storage write error
    }
  }

  return buildBillNumber(dateKey, nextSeq);
}
