"""
ShopPulse Grocery Invoice Scanner - OCR Benchmarking & Error Measurement Layer.

Computes Character Error Rate (CER), Word Error Rate (WER), precision, and recall
against ground truth text and expected invoice items.
"""

from typing import Any, Dict, List, Tuple
from pydantic import BaseModel, Field


def levenshtein_distance(seq1: List[Any], seq2: List[Any]) -> int:
    """Computes Levenshtein edit distance between two arbitrary token sequences."""
    m, n = len(seq1), len(seq2)
    if m == 0:
        return n
    if n == 0:
        return m

    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        dp[i][0] = i
    for j in range(n + 1):
        dp[0][j] = j

    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if seq1[i - 1] == seq2[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(
                    dp[i - 1][j],      # Deletion
                    dp[i][j - 1],      # Insertion
                    dp[i - 1][j - 1],  # Substitution
                )

    return dp[m][n]


class OCREvaluationResult(BaseModel):
    """Evaluation metrics comparing OCR output against ground truth."""
    cer: float = Field(..., ge=0.0, description="Character Error Rate (0.0 to 1.0+)")
    wer: float = Field(..., ge=0.0, description="Word Error Rate (0.0 to 1.0+)")
    accuracy_chars: float = Field(..., ge=0.0, le=1.0, description="1.0 - min(1.0, CER)")
    accuracy_words: float = Field(..., ge=0.0, le=1.0, description="1.0 - min(1.0, WER)")
    reference_length_chars: int = Field(..., ge=0)
    hypothesis_length_chars: int = Field(..., ge=0)
    reference_length_words: int = Field(..., ge=0)
    hypothesis_length_words: int = Field(..., ge=0)
    char_edit_distance: int = Field(..., ge=0)
    word_edit_distance: int = Field(..., ge=0)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "cer": round(self.cer, 4),
            "wer": round(self.wer, 4),
            "accuracy_chars": round(self.accuracy_chars, 4),
            "accuracy_words": round(self.accuracy_words, 4),
            "char_edits": self.char_edit_distance,
            "word_edits": self.word_edit_distance,
            "ref_chars": self.reference_length_chars,
            "hyp_chars": self.hypothesis_length_chars,
        }


class OCREvaluator:
    """
    Standard OCR accuracy evaluation engine.
    Calculates CER and WER per standard speech and document processing definitions:
    CER = (Substitutions + Deletions + Insertions) / Total Reference Characters
    WER = (Substitutions + Deletions + Insertions) / Total Reference Words
    """

    @staticmethod
    def calculate_cer(reference: str, hypothesis: str, case_sensitive: bool = False) -> Tuple[float, int]:
        """Calculates Character Error Rate (CER) and edit distance."""
        ref = reference if case_sensitive else reference.lower()
        hyp = hypothesis if case_sensitive else hypothesis.lower()

        # Remove extraneous consecutive whitespaces
        ref_chars = list(" ".join(ref.split()))
        hyp_chars = list(" ".join(hyp.split()))

        if not ref_chars:
            return (0.0, 0) if not hyp_chars else (1.0, len(hyp_chars))

        dist = levenshtein_distance(ref_chars, hyp_chars)
        cer = dist / len(ref_chars)
        return cer, dist

    @staticmethod
    def calculate_wer(reference: str, hypothesis: str, case_sensitive: bool = False) -> Tuple[float, int]:
        """Calculates Word Error Rate (WER) and edit distance."""
        ref = reference if case_sensitive else reference.lower()
        hyp = hypothesis if case_sensitive else hypothesis.lower()

        ref_words = ref.split()
        hyp_words = hyp.split()

        if not ref_words:
            return (0.0, 0) if not hyp_words else (1.0, len(hyp_words))

        dist = levenshtein_distance(ref_words, hyp_words)
        wer = dist / len(ref_words)
        return wer, dist

    def evaluate(
        self,
        reference_text: str,
        hypothesis_text: str,
        case_sensitive: bool = False,
    ) -> OCREvaluationResult:
        """Evaluates hypothesis against ground truth reference text."""
        cer, char_dist = self.calculate_cer(reference_text, hypothesis_text, case_sensitive)
        wer, word_dist = self.calculate_wer(reference_text, hypothesis_text, case_sensitive)

        ref_words = reference_text.split()
        hyp_words = hypothesis_text.split()

        return OCREvaluationResult(
            cer=round(cer, 4),
            wer=round(wer, 4),
            accuracy_chars=round(max(0.0, 1.0 - min(1.0, cer)), 4),
            accuracy_words=round(max(0.0, 1.0 - min(1.0, wer)), 4),
            reference_length_chars=len(reference_text),
            hypothesis_length_chars=len(hypothesis_text),
            reference_length_words=len(ref_words),
            hypothesis_length_words=len(hyp_words),
            char_edit_distance=char_dist,
            word_edit_distance=word_dist,
        )

    def evaluate_ground_truth_coverage(
        self,
        extracted_text: str,
        expected_items: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Calculates item-level recall: what percentage of expected grocery product
        names and prices appear in the extracted text stream.
        """
        extracted_lower = extracted_text.lower()
        found_names = 0
        found_prices = 0
        total_items = len(expected_items)

        if total_items == 0:
            return {"name_recall": 1.0, "price_recall": 1.0, "total_items": 0}

        for item in expected_items:
            name = str(item.get("name", "")).strip().lower()
            # Test key tokens of the product name (e.g. "Aashirvaad", "Atta")
            tokens = [t for t in name.split() if len(t) >= 3]
            if tokens and any(t in extracted_lower for t in tokens):
                found_names += 1

            rate = item.get("rate")
            mrp = item.get("mrp")
            for price in [rate, mrp]:
                if price is not None:
                    p_str = f"{price:.2f}" if isinstance(price, (int, float)) else str(price)
                    if p_str in extracted_text or str(int(price) if isinstance(price, (int, float)) else price) in extracted_text:
                        found_prices += 1
                        break

        return {
            "total_items": total_items,
            "found_names": found_names,
            "name_recall": round(found_names / total_items, 4),
            "found_prices": found_prices,
            "price_recall": round(found_prices / total_items, 4),
        }
