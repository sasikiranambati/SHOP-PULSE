import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Mic,
  Sparkles,
  X,
  AlertTriangle,
  CheckCircle2,
  Check,
  Trash2,
  Plus,
  Minus,
  ShoppingCart,
  Info,
  Volume2,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react';
import { Button } from './Button';
import { useDialog } from '../hooks/useDialog';
import type { CartItem, Product } from '../types';
import { catalogPrice, lineTotal, lineTotalPaise, round3 } from '../utils/cartPricing';
import {
  computeDraftMatchedItems,
  createEmptyVoiceBillDraft,
  flattenDraftToBase,
  mergeVoiceMatchedItems,
  upsertVoiceUtteranceOutcome,
  voiceLineToCartItem,
  withEditedLineTotal,
  type VoiceBillDraftState,
} from '../utils/voiceBill';
import {
  voiceApi,
  type MatchedVoiceItem,
  type VoiceProcessResponse,
  type VoiceProductCandidate
} from '../api/voice';
import { parseMultilingualVoiceBill } from '../utils/multilingualVoiceParser';

interface VoiceBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  /** Cart lines keep the spoken (or corrected) unit price; the catalogue price applies only when none was said. */
  onConfirmToCart: (items: CartItem[]) => void;
  onDirectCheckout?: (items: CartItem[]) => void;
}

type VoiceButtonState = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'SUCCESS' | 'ERROR';

const VOICE_LANGUAGE_NAME = 'English';
const VOICE_SPEECH_CODE = 'en-IN';

interface PresetItem {
  text: string;
  label: string;
}

const ENGLISH_DEV_PRESETS: PresetItem[] = [
  {
    text: '2 kg Rice 120 rupees',
    label: '2 kg Rice ₹120',
  },
  {
    text: '2 Tata Salt, 3 Parle-G and 1 Aashirvaad Atta',
    label: 'Salt, Biscuits, Atta',
  },
  {
    text: '3 packets Parle-G',
    label: '3 packets Parle-G',
  },
  {
    text: '500 g Sugar and 1 L Sunflower Cooking Oil',
    label: '500g Sugar & 1L Oil',
  },
];

export const VoiceBillModal: React.FC<VoiceBillModalProps> = ({
  isOpen,
  onClose,
  products,
  onConfirmToCart,
  onDirectCheckout,
}) => {

  // Recording & Primary Button visual state
  const [buttonState, setButtonState] = useState<VoiceButtonState>('IDLE');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Status & Transcript
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [livePreviewItems, setLivePreviewItems] = useState<Array<{ name: string; quantity: number; price?: number }>>([]);
  const [isEditingTranscript, setIsEditingTranscript] = useState(false);
  const [editedTranscript, setEditedTranscript] = useState('');
  const [isMockProvider, setIsMockProvider] = useState(true);

  // Recognized items state (accumulated cleanly across multiple utterances via functional fold reducer)
  const [draft, setDraft] = useState<VoiceBillDraftState>(() => createEmptyVoiceBillDraft());
  const matchedItems = useMemo(() => computeDraftMatchedItems(draft), [draft]);
  const ambiguousItems = draft.ambiguousItems;
  const unmatchedItems = draft.unmatchedItems;
  const utteranceSeqRef = useRef(0);
  const lastUtteranceSeqRef = useRef<number | null>(null);
  const lastUtteranceTextRef = useRef<string>('');

  // Computed subtotal and total
  // Sum of the rounded lines in paise (exact; the same total the sale saves)
  const subtotal = useMemo(
    () => Number(matchedItems.reduce((acc, item) => acc + lineTotalPaise(1, item.total_price), 0n)) / 100,
    [matchedItems],
  );
  const total = subtotal;

  // Dev Simulation panel
  const [showDevPanel, setShowDevPanel] = useState(true);
  const [simulatedInput, setSimulatedInput] = useState('');

  // Voice Debug Panel state (Development only)
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [debugInfo, setDebugInfo] = useState<{
    selectedLanguage: string;
    speechCode: string;
    hasSpeechRecognition: boolean;
    recognitionState: string;
    rawTranscript: string;
    detectedLanguage: string;
    normalizedTranscript: string;
    extractedItems: any[];
    inventoryMatches: any[];
    apiRequest: string;
    apiResponse: string;
    error: string | null;
  }>(() => ({
    selectedLanguage: VOICE_LANGUAGE_NAME,
    speechCode: VOICE_SPEECH_CODE,
    hasSpeechRecognition: typeof window !== 'undefined' && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition),
    recognitionState: 'IDLE',
    rawTranscript: '',
    detectedLanguage: '',
    normalizedTranscript: '',
    extractedItems: [],
    inventoryMatches: [],
    apiRequest: '',
    apiResponse: '',
    error: null,
  }));

  // Audio recording refs
  const speechRecognitionRef = useRef<any>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<any>(null);
  const silenceTimeoutRef = useRef<any>(null);
  const debouncedPreviewTimerRef = useRef<any>(null);
  const accumulatedFinalRef = useRef<string>('');
  const interimOnlyRef = useRef<string>('');
  const sttConfidenceRef = useRef<number | null>(null);
  const speechAlternativesRef = useRef<string[]>([]);
  const lastFinalChunkRef = useRef<string>('');
  const buttonResetTimerRef = useRef<any>(null);
  const isStartingRef = useRef<boolean>(false);
  const isProcessingRef = useRef<boolean>(false);
  const activeRequestSeqRef = useRef<number>(0);

  const transitionButtonState = useCallback((nextState: VoiceButtonState, autoResetMs?: number) => {
    if (buttonResetTimerRef.current) {
      clearTimeout(buttonResetTimerRef.current);
      buttonResetTimerRef.current = null;
    }
    setButtonState(nextState);
    if (autoResetMs && autoResetMs > 0) {
      buttonResetTimerRef.current = setTimeout(() => {
        buttonResetTimerRef.current = null;
        setButtonState('IDLE');
      }, autoResetMs);
    }
  }, []);

  // Keep error alert scrolled into view whenever an error occurs while scrolled down
  useEffect(() => {
    if (errorMessage && bodyScrollRef.current) {
      bodyScrollRef.current.scrollTop = 0;
    }
  }, [errorMessage]);

  const stopRecording = useCallback(() => {
    // Stop Web Speech API recognition session
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.abort();
      } catch (err) {
        console.warn('Error stopping speech recognition:', err);
      }
      speechRecognitionRef.current = null;
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }

    if (debouncedPreviewTimerRef.current) {
      clearTimeout(debouncedPreviewTimerRef.current);
      debouncedPreviewTimerRef.current = null;
    }

    isStartingRef.current = false;
    setIsRecording(false);
    setButtonState(prev => (prev === 'LISTENING' ? 'IDLE' : prev));
  }, []);

  const handleModalClose = useCallback(() => {
    if (isProcessingRef.current || isProcessing) return;
    stopRecording();
    onClose();
  }, [isProcessing, onClose, stopRecording]);

  // Check backend voice status on open
  useEffect(() => {
    if (!isOpen) return;

    voiceApi.getStatus()
      .then(status => {
        setIsMockProvider(status.is_mock);
      })
      .catch(() => {
        setIsMockProvider(true);
      });

    return () => {
      stopRecording();
      transitionButtonState('IDLE');
    };
  }, [isOpen, stopRecording, transitionButtonState]);

  const panelRef = useDialog<HTMLDivElement>({
    isOpen,
    onClose: handleModalClose,
    closeOnEscape: !isRecording && !isProcessing,
  });

  // Convert current products to candidates format for payload override (memoized to avoid per-render work)
  const customProductCandidates: VoiceProductCandidate[] = useMemo(
    () =>
      products.map(p => ({
        id: p.id,
        name: p.name,
        selling_price: p.sellingPrice ?? p.price ?? 0,
        current_stock: p.stock ?? 0,
        unit: p.unit || 'pcs',
        category: String(p.category || 'General'),
        sku: p.sku || p.barcode,
        price_basis_quantity: (p as any).priceBasisQuantity ?? (p as any).price_basis_quantity ?? 1.0,
        price_basis_unit: (p as any).priceBasisUnit ?? (p as any).price_basis_unit ?? p.unit,
        pricing_status: (p as any).pricingStatus ?? (p as any).pricing_status ?? 'VERIFIED',
        mrp: p.mrp,
        mrp_basis_quantity: (p as any).mrpBasisQuantity ?? (p as any).mrp_basis_quantity,
        mrp_basis_unit: (p as any).mrpBasisUnit ?? (p as any).mrp_basis_unit,
      })),
    [products],
  );

  if (!isOpen) return null;

  // ---------------------------------------------------------------------------
  // Pipeline Processing (English-only, multi-utterance safe)
  // ---------------------------------------------------------------------------
  const handleProcessTranscript = async (
    textToProcess: string,
    options: { replaceLast?: boolean; sttConfidence?: number | null; speechAlternatives?: string[] } = {},
  ) => {
    if (isProcessingRef.current) {
      return;
    }

    const cleanedText = textToProcess.trim();
    if (!cleanedText) {
      setErrorMessage("No speech detected. Please speak clearly or enter items to simulate.");
      transitionButtonState('ERROR', 2500);
      return;
    }

    const isReprocess = Boolean(options.replaceLast && lastUtteranceSeqRef.current !== null);
    if (isReprocess && cleanedText === lastUtteranceTextRef.current) {
      setIsEditingTranscript(false);
      return;
    }

    const seq = isReprocess && lastUtteranceSeqRef.current !== null
      ? lastUtteranceSeqRef.current
      : ++utteranceSeqRef.current;
    activeRequestSeqRef.current = seq;
    lastUtteranceSeqRef.current = seq;
    lastUtteranceTextRef.current = cleanedText;

    setTranscript(cleanedText);
    setEditedTranscript(cleanedText);
    setIsEditingTranscript(false);
    setInterimTranscript('');
    setLivePreviewItems([]);
    setErrorMessage(null);
    transitionButtonState('PROCESSING');
    isProcessingRef.current = true;
    setIsProcessing(true);

    const parseCtxOptions = {
      sttConfidence: options.sttConfidence,
      speechAlternatives: options.speechAlternatives,
      hasActiveBillContext: matchedItems.length > 0,
    };

    setDebugInfo(prev => ({
      ...prev,
      selectedLanguage: VOICE_LANGUAGE_NAME,
      speechCode: VOICE_SPEECH_CODE,
      recognitionState: 'PROCESSING',
      rawTranscript: cleanedText,
      detectedLanguage: VOICE_LANGUAGE_NAME,
      normalizedTranscript: options.speechAlternatives?.length
        ? `STT alts: ${options.speechAlternatives.join(' | ')}`
        : '',
      apiRequest: 'POST /api/v1/voice/process',
      error: null
    }));

    // STEP 1: Instant zero-latency (<1ms) client-side preview while keeping button in PROCESSING until backend settles
    let instantSuccess = false;
    try {
      const localResult = parseMultilingualVoiceBill(cleanedText, products, 'english', parseCtxOptions);

      if (localResult.matched_items.length > 0 || localResult.ambiguous_items.length > 0) {
        setDraft(prev =>
          upsertVoiceUtteranceOutcome(prev, seq, localResult, {
            replaceLast: isReprocess,
            mode: 'preview',
          }),
        );
        instantSuccess = true;
      }
    } catch (e) {
      console.warn("Client instant parser notice:", e);
    }

    // STEP 2: Concurrently validate & reconcile with backend FastAPI service
    try {
      const response: VoiceProcessResponse = await voiceApi.processVoiceBill({
        simulation_text: cleanedText,
        language_code: VOICE_SPEECH_CODE,
        custom_products: customProductCandidates,
        stt_confidence: options.sttConfidence ?? undefined,
        speech_alternatives: options.speechAlternatives?.length ? options.speechAlternatives : undefined,
      });

      if (activeRequestSeqRef.current !== seq) {
        return;
      }

      setDebugInfo(prev => ({
        ...prev,
        apiResponse: `HTTP 200 (matched: ${response.matched_items?.length || 0}, ambiguous: ${response.ambiguous_items?.length || 0}, unmatched: ${response.unmatched_items?.length || 0})`
      }));

      // Backend result replaces ONLY this utterance's optimistic entry (preserving all earlier utterances)
      if (response) {
        const nothingFound =
          !(response.matched_items?.length || response.ambiguous_items?.length || response.unmatched_items?.length);
        if (nothingFound) {
          setDraft(prev => ({
            ...prev,
            entries: prev.entries.filter(e => e.seq !== seq),
          }));
          setErrorMessage("Could not detect items. Please try speaking item name and quantity clearly.");
          transitionButtonState('ERROR', 3000);
          return;
        }
        setTranscript(response.transcript || cleanedText);
        setEditedTranscript(response.transcript || cleanedText);
        setDraft(prev =>
          upsertVoiceUtteranceOutcome(prev, seq, response, {
            replaceLast: isReprocess,
            mode: 'authoritative',
          }),
        );
        setIsMockProvider(response.is_mock);

        setDebugInfo(prev => ({
          ...prev,
          recognitionState: 'SUCCESS',
          extractedItems: response.matched_items.map(m => ({
            item: m.name,
            quantity: m.quantity,
            price: m.unit_price,
            qty_source: m.quantity_source,
            qty_confidence: m.quantity_confidence,
          })),
          inventoryMatches: response.matched_items
        }));

        transitionButtonState('SUCCESS', 2800);
        return;
      }
    } catch (backendErr: any) {
      if (backendErr?.category === 'AUTHENTICATION_ERROR' || backendErr?.status === 401) {
        const authErrMsg = 'Your session expired. Sign in again — any active POS bill draft has been saved.';
        setDraft(prev => ({
          ...prev,
          entries: prev.entries.filter(e => e.seq !== seq),
        }));
        setErrorMessage(authErrMsg);
        setDebugInfo(prev => ({ ...prev, error: authErrMsg, recognitionState: 'ERROR' }));
        transitionButtonState('ERROR', 4000);
        return;
      }
      console.warn("Backend voice processing unavailable, relying on client-side parser:", backendErr);
      setDebugInfo(prev => ({
        ...prev,
        apiResponse: `Backend offline/fallback (${backendErr.message || 'Network'}), using local parser`
      }));
    } finally {
      isProcessingRef.current = false;
      setIsProcessing(false);
    }

    // STEP 3: Fallback handling if backend failed and instant preview had nothing yet
    if (instantSuccess) {
      transitionButtonState('SUCCESS', 2800);
    } else {
      try {
        const fallbackResult = parseMultilingualVoiceBill(cleanedText, products, 'english', parseCtxOptions);
        setDraft(prev =>
          upsertVoiceUtteranceOutcome(prev, seq, fallbackResult, {
            replaceLast: isReprocess,
            mode: 'authoritative',
          }),
        );

        if (fallbackResult.matched_items.length > 0) {
          transitionButtonState('SUCCESS', 2800);
        } else if (fallbackResult.unmatched_items.length > 0 || fallbackResult.ambiguous_items.length > 0) {
          transitionButtonState('IDLE');
        } else {
          const err = "Could not detect items. Please try speaking item name and quantity clearly.";
          setErrorMessage(err);
          setDebugInfo(prev => ({ ...prev, error: err, recognitionState: 'ERROR' }));
          transitionButtonState('ERROR', 3000);
        }
      } catch (err: any) {
        const errStr = err.message || "Failed to process voice bill.";
        setErrorMessage(errStr);
        setDebugInfo(prev => ({ ...prev, error: errStr, recognitionState: 'ERROR' }));
        transitionButtonState('ERROR', 3000);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Microphone Capture (Fixed English Speech Recognition)
  // ---------------------------------------------------------------------------
  const startRecording = () => {
    // Prevent repeated or simultaneous sessions (including synchronous double-taps before onstart fires)
    if (isStartingRef.current || isRecording || isProcessing || isProcessingRef.current || buttonState === 'PROCESSING') {
      return;
    }

    // Clean up any stale session
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.abort();
      } catch (e) {
        console.warn("Error aborting previous speech recognition:", e);
      }
      speechRecognitionRef.current = null;
    }

    isStartingRef.current = true;
    setErrorMessage(null);
    accumulatedFinalRef.current = '';
    interimOnlyRef.current = '';
    sttConfidenceRef.current = null;
    speechAlternativesRef.current = [];
    lastFinalChunkRef.current = '';
    setInterimTranscript('');
    setLivePreviewItems([]);

    // Check if browser supports Web Speech API
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      isStartingRef.current = false;
      const msg = "Speech recognition is not supported in this browser. Please use a supported browser or enable the required speech service.";
      setErrorMessage(msg);
      setDebugInfo(prev => ({
        ...prev,
        hasSpeechRecognition: false,
        recognitionState: 'UNSUPPORTED',
        error: msg
      }));
      transitionButtonState('ERROR', 4000);
      return;
    }

    try {
      // Create fresh SpeechRecognition instance for each session
      const recognition = new SpeechRecognition();
      speechRecognitionRef.current = recognition;

      // Enable real-time streaming interim results, multi-alternatives, and continuous speech in English
      recognition.lang = VOICE_SPEECH_CODE;
      recognition.interimResults = true;
      recognition.maxAlternatives = 5;
      recognition.continuous = true;

      if (import.meta.env.DEV) {
        console.log(`VOICE DEBUG:\nlanguage = ${VOICE_LANGUAGE_NAME}\nspeech code = ${VOICE_SPEECH_CODE}\nrecognition language = ${recognition.lang}`);
      }

      setDebugInfo(prev => ({
        ...prev,
        selectedLanguage: VOICE_LANGUAGE_NAME,
        speechCode: VOICE_SPEECH_CODE,
        hasSpeechRecognition: true,
        recognitionState: 'LISTENING',
        error: null
      }));

      recognition.onstart = () => {
        if (speechRecognitionRef.current !== recognition) return;
        isStartingRef.current = false;
        setIsRecording(true);
        transitionButtonState('LISTENING');
        setRecordingSeconds(0);
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => {
          setRecordingSeconds(s => s + 1);
        }, 1000);
      };

      recognition.onresult = (event: any) => {
        if (speechRecognitionRef.current !== recognition) return;
        let interimText = '';
        let newFinalChunk = '';
        const collectedAlts: string[] = [];
        let bestConf: number | null = null;

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          if (res.isFinal) {
            // Multi-alternative evaluation: prefer explicit unambiguous numeric quantities + catalog matches + confidence
            let bestAltText = (res[0]?.transcript || '').trim();
            bestConf = typeof res[0]?.confidence === 'number' && res[0].confidence > 0 ? res[0].confidence : null;
            if (res.length > 0) {
              let highestScore = -1;
              for (let a = 0; a < res.length; a++) {
                const candText = res[a]?.transcript?.trim();
                if (!candText) continue;
                collectedAlts.push(candText);
                const parsed = parseMultilingualVoiceBill(candText, products, 'english');
                const explicitQtyBonus = parsed.matched_items.reduce(
                  (acc, m) => acc + (m.quantity_source === 'explicit' ? 4 : 0),
                  0,
                );
                const altConf = typeof res[a].confidence === 'number' ? res[a].confidence : 0;
                const score =
                  (parsed.matched_items.length * 10) +
                  explicitQtyBonus +
                  (altConf * 5) -
                  (parsed.unmatched_items.length * 2);
                if (score > highestScore) {
                  highestScore = score;
                  bestAltText = candText;
                  if (altConf > 0) bestConf = altConf;
                }
              }
            }
            // Deduplicate consecutive identical final emissions from Chrome/Android Web Speech API
            if (bestAltText && bestAltText.toLowerCase() !== lastFinalChunkRef.current.toLowerCase()) {
              lastFinalChunkRef.current = bestAltText;
              newFinalChunk += (newFinalChunk ? ' ' : '') + bestAltText;
            }
          } else {
            interimText += (interimText ? ' ' : '') + (res[0]?.transcript || '');
          }
        }

        if (newFinalChunk) {
          accumulatedFinalRef.current = (accumulatedFinalRef.current + ' ' + newFinalChunk).trim();
        }
        if (collectedAlts.length > 0) {
          speechAlternativesRef.current = Array.from(new Set([...speechAlternativesRef.current, ...collectedAlts])).slice(0, 6);
        }
        if (bestConf !== null) {
          sttConfidenceRef.current = bestConf;
        }
        interimOnlyRef.current = interimText.trim();

        const fullCurrentTranscript = (accumulatedFinalRef.current + ' ' + interimOnlyRef.current).trim();
        setInterimTranscript(fullCurrentTranscript);

        // Real-time live item detection preview
        if (debouncedPreviewTimerRef.current) {
          clearTimeout(debouncedPreviewTimerRef.current);
        }
        debouncedPreviewTimerRef.current = setTimeout(() => {
          if (fullCurrentTranscript) {
            try {
              const liveParsed = parseMultilingualVoiceBill(fullCurrentTranscript, products, 'english', {
                sttConfidence: sttConfidenceRef.current,
                speechAlternatives: speechAlternativesRef.current,
                hasActiveBillContext: matchedItems.length > 0,
              });
              setLivePreviewItems(
                liveParsed.matched_items.map(m => ({
                  name: m.name,
                  quantity: m.quantity,
                  price: m.total_price,
                }))
              );
            } catch {
              // Ignore preview parse errors
            }
          }
        }, 100);

        // Smart Silence Finalizer: Auto-commit when speech pauses for 1.8s
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
        }
        if (fullCurrentTranscript) {
          silenceTimeoutRef.current = setTimeout(() => {
            if (speechRecognitionRef.current !== recognition) return;
            const finalText = (accumulatedFinalRef.current + ' ' + interimOnlyRef.current).trim();
            const capturedConf = sttConfidenceRef.current;
            const capturedAlts = [...speechAlternativesRef.current];
            accumulatedFinalRef.current = '';
            interimOnlyRef.current = '';
            sttConfidenceRef.current = null;
            speechAlternativesRef.current = [];
            lastFinalChunkRef.current = '';
            if (finalText) {
              stopRecording();
              handleProcessTranscript(finalText, {
                sttConfidence: capturedConf,
                speechAlternatives: capturedAlts,
              });
            }
          }, 1800);
        }
      };

      recognition.onerror = (event: any) => {
        if (speechRecognitionRef.current !== recognition) return;
        isStartingRef.current = false;
        accumulatedFinalRef.current = '';
        interimOnlyRef.current = '';
        sttConfidenceRef.current = null;
        speechAlternativesRef.current = [];
        lastFinalChunkRef.current = '';
        stopRecording();
        const errType = event.error;
        let msg = `Speech recognition error: ${errType || 'Unknown error'}`;

        if (errType === 'not-allowed' || errType === 'permission-denied') {
          msg = "Microphone access is required for Voice-to-Bill. Please allow microphone access in your browser settings.";
        } else if (errType === 'language-not-supported') {
          msg = "English speech recognition is not available in your current browser.";
        } else if (errType === 'no-speech') {
          msg = "No speech detected. Please speak clearly into the microphone.";
        } else if (errType === 'network') {
          msg = "Speech recognition could not connect. Please check your connection and try again.";
        } else if (errType === 'aborted') {
          transitionButtonState('IDLE');
          return;
        }

        setErrorMessage(msg);
        setDebugInfo(prev => ({
          ...prev,
          recognitionState: 'ERROR',
          error: msg
        }));
        transitionButtonState('ERROR', 4000);
      };

      recognition.onend = () => {
        if (speechRecognitionRef.current !== recognition) return;
        isStartingRef.current = false;
        const pendingText = (accumulatedFinalRef.current + ' ' + interimOnlyRef.current).trim();
        const capturedConf = sttConfidenceRef.current;
        const capturedAlts = [...speechAlternativesRef.current];
        accumulatedFinalRef.current = '';
        interimOnlyRef.current = '';
        sttConfidenceRef.current = null;
        speechAlternativesRef.current = [];
        lastFinalChunkRef.current = '';
        stopRecording();
        if (pendingText) {
          handleProcessTranscript(pendingText, {
            sttConfidence: capturedConf,
            speechAlternatives: capturedAlts,
          });
        }
      };

      recognition.start();
    } catch (e: any) {
      isStartingRef.current = false;
      console.warn("SpeechRecognition start failed:", e);
      stopRecording();
      const msg = e.message || "Failed to start speech recognition.";
      setErrorMessage(msg);
      setDebugInfo(prev => ({ ...prev, error: msg, recognitionState: 'ERROR' }));
      transitionButtonState('ERROR', 4000);
    }
  };

  const handleStopRecordingAndProcess = () => {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    const textToCommit = (accumulatedFinalRef.current + ' ' + interimOnlyRef.current).trim();
    const capturedConf = sttConfidenceRef.current;
    const capturedAlts = [...speechAlternativesRef.current];
    accumulatedFinalRef.current = '';
    interimOnlyRef.current = '';
    sttConfidenceRef.current = null;
    speechAlternativesRef.current = [];
    lastFinalChunkRef.current = '';
    stopRecording();
    if (textToCommit) {
      handleProcessTranscript(textToCommit, {
        sttConfidence: capturedConf,
        speechAlternatives: capturedAlts,
      });
    } else {
      setButtonState('IDLE');
    }
  };

  const handleMainButtonClick = () => {
    // Disable repeated clicks while processing
    if (buttonState === 'PROCESSING' || isProcessing) {
      return;
    }

    if (isRecording || buttonState === 'LISTENING') {
      handleStopRecordingAndProcess();
    } else {
      startRecording();
    }
  };

  // ---------------------------------------------------------------------------
  // Ambiguity Resolution: User picks specific variant or confirms contextual qty
  // ---------------------------------------------------------------------------
  const handleResolveAmbiguityOption = (ambiguousIndex: number, chosenLine: MatchedVoiceItem) => {
    setDraft(prev => {
      const flat = flattenDraftToBase(prev);
      return {
        ...flat,
        baseItems: mergeVoiceMatchedItems(flat.baseItems, [chosenLine]),
        ambiguousItems: flat.ambiguousItems.filter((_, idx) => idx !== ambiguousIndex),
      };
    });
  };

  const handleResolveAmbiguity = (ambiguousIndex: number, candidate: VoiceProductCandidate) => {
    const amb = ambiguousItems[ambiguousIndex];
    if (!amb) return;
    // The backend prepares each candidate's line (unit converted, spoken price kept); use it as is
    const prepared = amb.options?.find((o) => o.product_id === candidate.id);
    if (amb.options && !prepared) {
      setErrorMessage(`${candidate.name} cannot be sold as said (check the unit or quantity). Choose another product or correct the request.`);
      return;
    }
    const spokenTotal = typeof amb.spoken_price === 'number' && amb.spoken_price > 0 ? amb.spoken_price : null;
    const catRate = catalogPrice(candidate as any);
    const unitPrice = spokenTotal !== null ? spokenTotal / amb.quantity : catRate;
    const newMatchedItem: MatchedVoiceItem = prepared ?? {
      product_id: candidate.id,
      name: candidate.name,
      quantity: amb.quantity,
      unit_price: Math.round(unitPrice * 1000) / 1000,
      unit_price_exact: unitPrice,
      total_price: spokenTotal ?? lineTotal(amb.quantity, catRate),
      unit: candidate.unit,
      current_stock: candidate.current_stock,
      is_out_of_stock: candidate.current_stock <= 0,
      is_insufficient_stock: amb.quantity > candidate.current_stock,
      available_stock: Math.max(0, candidate.current_stock),
      price_source: spokenTotal !== null ? 'spoken' : 'catalogue',
    };

    setDraft(prev => {
      const flat = flattenDraftToBase(prev);
      return {
        ...flat,
        baseItems: mergeVoiceMatchedItems(flat.baseItems, [newMatchedItem]),
        ambiguousItems: flat.ambiguousItems.filter((_, idx) => idx !== ambiguousIndex),
      };
    });
  };

  // ---------------------------------------------------------------------------
  // Item Editing & Deletion
  // ---------------------------------------------------------------------------
  const handleUpdateQuantity = (index: number, delta: number) => {
    setDraft(prev => {
      const flat = flattenDraftToBase(prev);
      const nextBase = flat.baseItems.map((item, idx) => {
        if (idx === index) {
          const newQty = round3(item.quantity + delta);
          if (newQty <= 0) return null;
          const newTotal = lineTotal(newQty, item.unit_price_exact ?? item.unit_price);
          return {
            ...item,
            quantity: newQty,
            total_price: newTotal,
            is_insufficient_stock: newQty > item.current_stock,
          };
        }
        return item;
      }).filter(Boolean) as MatchedVoiceItem[];
      return { ...flat, baseItems: nextBase };
    });
  };

  /** Manual correction of a line's total before saving: the unit price follows; nothing else changes. */
  const handleEditLineTotal = (index: number, value: string) => {
    const total = Number(value);
    if (value.trim() === '' || !Number.isFinite(total) || total < 0) return;
    setDraft(prev => {
      const flat = flattenDraftToBase(prev);
      return {
        ...flat,
        baseItems: flat.baseItems.map((item, idx) => (idx === index ? withEditedLineTotal(item, total) : item)),
      };
    });
  };

  const handleRemoveMatchedItem = (index: number) => {
    setDraft(prev => {
      const flat = flattenDraftToBase(prev);
      return {
        ...flat,
        baseItems: flat.baseItems.filter((_, idx) => idx !== index),
      };
    });
  };

  const handleRemoveUnmatched = (index: number) => {
    setDraft(prev => ({
      ...prev,
      unmatchedItems: prev.unmatchedItems.filter((_, idx) => idx !== index),
    }));
  };

  const handleClearBill = () => {
    setDraft(createEmptyVoiceBillDraft());
    setTranscript('');
    setEditedTranscript('');
    setErrorMessage(null);
    lastUtteranceSeqRef.current = null;
    lastUtteranceTextRef.current = '';
  };

  // ---------------------------------------------------------------------------
  // Bill Confirmation & Existing Cart Integration
  // ---------------------------------------------------------------------------
  const handleConfirmBill = (directCheckout: boolean = false) => {
    if (matchedItems.length === 0) {
      setErrorMessage("No recognized items to add. Please record or select products first.");
      return;
    }
    if (isProcessing) {
      setErrorMessage("Still checking the items and prices. Please wait a moment.");
      return;
    }

    // Map matched items strictly to existing Product objects from inventory. A spoken or corrected
    // price travels with the line; it is never replaced by the catalogue selling price.
    const cartItemsToAdd: CartItem[] = [];
    const notMapped: string[] = [];

    for (const item of matchedItems) {
      const prod = products.find(p => p.id === item.product_id) ||
        products.find(p => p.name.toLowerCase() === item.name.toLowerCase());
      if (prod) {
        cartItemsToAdd.push(voiceLineToCartItem(item, prod));
      } else {
        notMapped.push(item.name);
      }
    }

    // Never add part of a bill silently: every recognised line must reach the cart
    if (notMapped.length > 0) {
      setErrorMessage(`These items could not be found in the current inventory: ${notMapped.join(', ')}. Remove them or refresh the product list.`);
      return;
    }

    if (directCheckout && onDirectCheckout) {
      onDirectCheckout(cartItemsToAdd);
    } else {
      onConfirmToCart(cartItemsToAdd);
    }

    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#141E18]/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={() => {
        if (!isRecording && !isProcessing) {
          stopRecording();
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        className="bg-white rounded-t-2xl sm:rounded-xl shadow-2xl border border-[#DDE9DF] w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden animate-in slide-in-from-bottom sm:zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-to-bill-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Screen Reader Voice State Announcement */}
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {buttonState === 'LISTENING' && 'Listening in English... Speak now.'}
          {buttonState === 'PROCESSING' && 'Processing voice recording and matching products...'}
          {buttonState === 'SUCCESS' && `Bill generated with ${matchedItems.length} items.`}
          {buttonState === 'ERROR' && (errorMessage || 'Voice recognition error occurred.')}
        </div>

        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-[#DDE9DF] flex items-center justify-between bg-[#FAF8F2]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#E7F3EE] text-[#153D32] border border-[#23866A]/25 flex items-center justify-center shadow-2xs shrink-0">
              <Mic className="w-5 h-5" strokeWidth={2} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="voice-to-bill-title" className="text-base font-bold text-[#153D32]">
                  Voice-to-Bill
                </h2>
                {isMockProvider ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FEF9EB] text-[#A07828] border border-[#D6AE62]/40">
                    Offline / Dev Mode
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E7F3EE] text-[#153D32] border border-[#23866A]/25">
                    Live STT
                  </span>
                )}
              </div>
              <p className="text-xs text-[#5E6C64] font-medium mt-0.5">
                Speak items clearly in English to create a bill
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleModalClose}
            className="w-8 h-8 rounded-lg bg-white hover:bg-[#F3EFE3] text-[#5E6C64] hover:text-[#252D29] flex items-center justify-center transition-colors cursor-pointer border border-[#DDE9DF] shrink-0"
            aria-label="Close Voice-to-Bill"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div ref={bodyScrollRef} className="p-3.5 sm:p-5 overflow-y-auto overflow-x-hidden space-y-4 sm:space-y-5 flex-1 bg-white">

          {/* Error Banner */}
          {errorMessage && (
            <div
              role="alert"
              className="p-3 bg-[#FDF1EF] border border-[#EF806D]/40 text-[#B93838] rounded-xl text-xs font-semibold flex items-start gap-2.5 animate-in fade-in"
            >
              <AlertTriangle className="w-4 h-4 text-[#B93838] shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">{errorMessage}</div>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="text-[#B93838]/70 hover:text-[#B93838] p-0.5 rounded transition-colors cursor-pointer"
                aria-label="Dismiss error"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* ========================================================================= */}
          {/* Voice to Bill Primary Card (English Speech -> English Transcript -> Bill) */}
          {/* ========================================================================= */}
          <div className="bg-[#FAF8F2] rounded-2xl p-4 sm:p-5 border border-[#DDE9DF] shadow-2xs space-y-4">

            {/* Card Sub-Header */}
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#DDE9DF]">
              <div className="flex items-center gap-2">
                <Mic className="w-4 h-4 text-[#153D32]" strokeWidth={2} />
                <span className="font-bold text-sm text-[#153D32] tracking-tight">
                  Voice to Bill
                </span>
              </div>
              <span className="text-[11px] font-semibold text-[#153D32] bg-[#E7F3EE] border border-[#23866A]/25 px-2.5 py-0.5 rounded-full">
                English Only
              </span>
            </div>

            {/* Primary Action: Microphone Control */}
            <div className="flex flex-col items-center justify-center pt-1">
              <div className="relative w-full flex justify-center">
                <button
                  type="button"
                  onClick={handleMainButtonClick}
                  disabled={buttonState === 'PROCESSING' || isProcessing}
                  className={`relative group w-full max-w-sm h-14 sm:h-15 px-6 rounded-xl font-bold text-sm sm:text-base tracking-wide flex items-center justify-center gap-2.5 transition-all duration-150 select-none shadow-sm cursor-pointer ${buttonState === 'LISTENING'
                    ? 'bg-[#B93838] hover:bg-[#9E2E2E] text-white ring-4 ring-[#B93838]/20 active:scale-[0.99]'
                    : buttonState === 'PROCESSING'
                      ? 'bg-[#FBF4E7] text-[#8A6118] border border-[#D6AE62] cursor-not-allowed shadow-none'
                      : buttonState === 'SUCCESS'
                        ? 'bg-[#23866A] text-white ring-4 ring-[#23866A]/20'
                        : buttonState === 'ERROR'
                          ? 'bg-[#B93838] hover:bg-[#9E2E2E] text-white active:scale-[0.99]'
                          : 'bg-[#153D32] hover:bg-[#0A241D] text-[#FAF8F2] active:scale-[0.99] ring-4 ring-[#153D32]/10'
                    }`}
                  aria-label="Voice-to-Bill primary action button"
                >
                  {/* Dynamic Visual States */}
                  {buttonState === 'LISTENING' ? (
                    <>
                      <span className="relative flex h-3 w-3 shrink-0" aria-hidden="true">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-white" />
                      </span>
                      <span>Listening... Tap to Stop</span>
                    </>
                  ) : buttonState === 'PROCESSING' ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin shrink-0" strokeWidth={2} />
                      <span>Processing Voice...</span>
                    </>
                  ) : buttonState === 'SUCCESS' ? (
                    <>
                      <CheckCircle2 className="w-5 h-5 shrink-0" strokeWidth={2} />
                      <span>Bill Updated</span>
                    </>
                  ) : buttonState === 'ERROR' ? (
                    <>
                      <AlertTriangle className="w-5 h-5 shrink-0" strokeWidth={2} />
                      <span>Try Again</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-5 h-5 shrink-0" strokeWidth={2} />
                      <span>Start Speaking</span>
                    </>
                  )}
                </button>
              </div>

              {/* Status & Input Feedback */}
              <div className="mt-3 text-center w-full">
                {isRecording ? (
                  <div className="space-y-2.5">
                    <p className="text-xs font-bold text-[#B93838] flex items-center justify-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#B93838] animate-pulse" />
                      Listening in English ({recordingSeconds}s)
                    </p>

                    {/* Live streaming interim transcript box */}
                    {interimTranscript && (
                      <div className="mx-auto max-w-md bg-white text-[#252D29] rounded-xl p-3 shadow-xs border border-[#23866A]/40 text-left animate-in fade-in">
                        <div className="flex items-center justify-between text-[10px] text-[#5E6C64] font-bold mb-1">
                          <span className="flex items-center gap-1.5 text-[#23866A] uppercase tracking-wider">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#23866A] animate-pulse" />
                            Live Speech Stream
                          </span>
                          <span>Auto-commits on pause</span>
                        </div>
                        <p className="text-xs sm:text-sm font-semibold text-[#153D32]">
                          &ldquo;{interimTranscript}&rdquo;
                        </p>

                        {/* Real-time detected items chips */}
                        {livePreviewItems.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-[#DDE9DF] flex flex-wrap gap-1.5 items-center">
                            <span className="text-[10px] text-[#5E6C64] font-bold uppercase tracking-wider">Detected:</span>
                            {livePreviewItems.map((item, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center gap-1 text-[11px] font-bold bg-[#E7F3EE] text-[#153D32] border border-[#23866A]/25 px-2 py-0.5 rounded-md"
                              >
                                <span>{item.quantity}x</span>
                                <span>{item.name}</span>
                                {item.price !== undefined && item.price > 0 && (
                                  <span className="text-[#23866A] font-semibold">(₹{item.price})</span>
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div>
                      <button
                        type="button"
                        onClick={handleStopRecordingAndProcess}
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-[#153D32] bg-white border border-[#DDE9DF] px-3.5 py-1.5 rounded-lg hover:bg-[#F3EFE3] cursor-pointer shadow-2xs transition-colors"
                      >
                        <Check className="w-3.5 h-3.5 text-[#23866A]" strokeWidth={2.5} />
                        <span>Done Speaking (Process Now)</span>
                      </button>
                    </div>
                  </div>
                ) : isProcessing ? (
                  <p className="text-xs font-semibold text-[#A07828]">
                    Analyzing voice transcript and matching shop inventory...
                  </p>
                ) : (
                  <p className="text-xs text-[#5E6C64]">
                    Speak items naturally in English (e.g., &ldquo;2 kg rice 120 rupees&rdquo;)
                  </p>
                )}
              </div>

            </div>

          </div>

          {/* Transcript Display Card */}
          {transcript && (
            <div className="bg-[#FAF8F2] border border-[#DDE9DF] rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase text-[#5E6C64] tracking-wider flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5 text-[#23866A]" />
                  Speech Transcript
                </span>
                <button
                  type="button"
                  onClick={() => setIsEditingTranscript(!isEditingTranscript)}
                  className="text-xs font-bold text-[#153D32] hover:text-[#23866A] hover:underline cursor-pointer"
                >
                  {isEditingTranscript ? 'Cancel' : 'Edit'}
                </button>
              </div>

              {isEditingTranscript ? (
                <div className="flex flex-wrap sm:flex-nowrap gap-2 min-w-0">
                  <input
                    type="text"
                    value={editedTranscript}
                    onChange={(e) => setEditedTranscript(e.target.value)}
                    className="flex-1 min-w-0 px-3 py-1.5 text-xs rounded-lg border border-[#DDE9DF] focus:outline-none focus:ring-2 focus:ring-[#153D32]/20 focus:border-[#153D32] font-medium bg-white text-[#252D29]"
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => handleProcessTranscript(editedTranscript, { replaceLast: true })}
                    className="text-xs font-bold py-1 px-3"
                  >
                    Reprocess
                  </Button>
                </div>
              ) : (
                <p className="text-sm font-semibold text-[#153D32] bg-white px-3 py-2 rounded-lg border border-[#DDE9DF]">
                  &ldquo;{transcript}&rdquo;
                </p>
              )}
            </div>
          )}

          {/* Ambiguity Resolution Section */}
          {ambiguousItems.length > 0 && (
            <div className="bg-[#FEF9EB] border border-[#D6AE62] rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-[#8A6118] font-bold text-xs uppercase tracking-wide">
                <AlertTriangle className="w-4 h-4 text-[#A07828]" />
                <span>
                  {ambiguousItems.every(a => a.ambiguity_type === 'quantity')
                    ? 'Confirm Quantity Interpretation'
                    : 'Multiple Matches Detected — Select Product'}
                </span>
              </div>

              {ambiguousItems.map((amb, ambIdx) => (
                amb.ambiguity_type === 'quantity' && amb.options && amb.options.length >= 2 ? (
                  <div key={ambIdx} className="bg-white rounded-xl p-3 border border-[#D6AE62]/50 space-y-2.5" data-testid="quantity-confirmation-card">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-[#153D32]">
                        Did you mean?{' '}
                        <span className="font-normal text-[#5E6C64]">(&ldquo;{amb.raw_phrase || amb.queried_name}&rdquo;)</span>
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft(prev => ({
                            ...prev,
                            ambiguousItems: prev.ambiguousItems.filter((_, idx) => idx !== ambIdx),
                          }))
                        }
                        className="text-[#5E6C64] hover:text-[#B93838] p-0.5 rounded transition-colors cursor-pointer"
                        aria-label="Dismiss quantity suggestion"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleResolveAmbiguityOption(ambIdx, amb.options![0])}
                        className="p-2.5 text-left rounded-lg border border-[#23866A]/40 bg-[#E7F3EE]/50 hover:bg-[#E7F3EE] transition-colors cursor-pointer flex items-center justify-between gap-2"
                      >
                        <span className="text-xs font-bold text-[#153D32]">
                          {amb.options[0].quantity} × {amb.options[0].name}
                        </span>
                        <span className="text-xs font-extrabold text-[#23866A] tabular-nums shrink-0">
                          ₹{amb.options[0].total_price}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleResolveAmbiguityOption(ambIdx, amb.options![1])}
                        className="p-2.5 text-left rounded-lg border border-[#DDE9DF] hover:border-[#153D32] hover:bg-[#FAF8F2] transition-colors cursor-pointer flex items-center justify-between gap-2"
                      >
                        <span className="text-xs font-semibold text-[#252D29]">
                          Add {amb.options[1].name} without quantity
                        </span>
                        <span className="text-xs font-bold text-[#5E6C64] tabular-nums shrink-0">
                          1 × ₹{amb.options[1].total_price}
                        </span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={ambIdx} className="bg-white rounded-xl p-3 border border-[#D6AE62]/50 space-y-2">
                    <p className="text-xs font-bold text-[#252D29]">
                      Which <span className="text-[#8A6118]">&ldquo;{amb.queried_name}&rdquo;</span> did you mean? (Qty: {amb.quantity})
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {amb.candidates.map((cand) => (
                        <button
                          key={cand.id}
                          type="button"
                          onClick={() => handleResolveAmbiguity(ambIdx, cand)}
                          className="p-2.5 text-left rounded-lg border border-[#DDE9DF] hover:border-[#23866A] hover:bg-[#E7F3EE]/40 transition-colors cursor-pointer flex flex-col justify-between group"
                        >
                          <p className="text-xs font-bold text-[#153D32] group-hover:text-[#0A241D] truncate">
                            {cand.name}
                          </p>
                          <div className="flex items-center justify-between mt-1 text-[11px] font-semibold">
                            <span className="text-[#23866A] tabular-nums">₹{cand.selling_price}</span>
                            <span className="text-[#5E6C64]">
                              {cand.current_stock} in stock
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              ))}
            </div>
          )}

          {/* Unmatched Items Alert */}
          {unmatchedItems.length > 0 && (
            <div className="bg-[#FDF1EF] border border-[#EF806D]/40 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center gap-2 text-[#B93838] font-bold text-xs uppercase tracking-wide">
                <AlertTriangle className="w-4 h-4 text-[#B93838]" />
                <span>Items Not Found in Inventory</span>
              </div>
              <div className="space-y-1.5">
                {unmatchedItems.map((un, unIdx) => (
                  <div key={unIdx} className="flex flex-wrap items-center justify-between gap-2 text-xs bg-white px-3 py-2 rounded-lg border border-[#EF806D]/30 min-w-0">
                    <span className="font-bold text-[#252D29] break-words">
                      {un.quantity}x {un.queried_name}
                    </span>
                    <div className="flex items-center gap-2.5">
                      <span className="text-[11px] text-[#B93838] font-medium">{un.reason || 'Not in shop catalog'}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveUnmatched(unIdx)}
                        className="text-[#5E6C64] hover:text-[#B93838] p-0.5 rounded transition-colors cursor-pointer"
                        aria-label={`Remove unmatched item ${un.queried_name}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recognized Bill Items Table */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between px-0.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#5E6C64]">
                Recognized Bill Items ({matchedItems.length})
              </h3>
              {(matchedItems.length > 0 || unmatchedItems.length > 0 || ambiguousItems.length > 0) && (
                <div className="flex items-center gap-3">
                  {matchedItems.length > 0 && (
                    <span className="text-xs font-bold text-[#153D32] tabular-nums">
                      Subtotal: ₹{subtotal}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleClearBill}
                    className="text-[11px] font-bold text-[#5E6C64] hover:text-[#B93838] cursor-pointer transition-colors"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            {matchedItems.length > 0 ? (
              <div className="bg-white border border-[#DDE9DF] rounded-xl divide-y divide-[#DDE9DF] shadow-2xs overflow-hidden">
                {matchedItems.map((item, idx) => (
                  <div key={`${item.product_id}-${idx}`} className="p-3.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 hover:bg-[#FAF8F2]/60 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-xs sm:text-sm text-[#153D32] truncate">
                        {item.name}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <span className="text-xs text-[#5E6C64] font-medium tabular-nums">
                          ₹{item.unit_price} / {item.unit}
                        </span>
                        {item.price_source && item.price_source !== 'catalogue' ? (
                          <span
                            data-testid="voice-price-source"
                            className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#E7F3EE] text-[#153D32] border border-[#23866A]/25"
                          >
                            {item.price_source === 'spoken' ? 'Spoken price' : 'Edited price'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-[#FAF8F2] text-[#5E6C64] border border-[#DDE9DF]">
                            Catalog price
                          </span>
                        )}
                        {item.price_source &&
                          item.price_source !== 'catalogue' &&
                          typeof item.catalog_line_total === 'number' &&
                          Math.abs(item.total_price - item.catalog_line_total) > 0.01 && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-[#FEF9EB] text-[#8A6118] border border-[#D6AE62]/40">
                              Catalog ₹{item.catalog_line_total}
                            </span>
                          )}
                        {item.spoken_quantity && (
                          <span className="text-[10px] font-medium text-[#5E6C64]">
                            said {item.spoken_quantity}
                          </span>
                        )}
                        {item.package_size && (
                          <span className="text-[10px] font-medium text-[#5E6C64] bg-[#FAF8F2] border border-[#DDE9DF] px-1.5 py-0.5 rounded-md">
                            {item.package_size} pack
                          </span>
                        )}
                        {item.is_out_of_stock ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#FDF1EF] text-[#B93838] border border-[#EF806D]/40">
                            <AlertTriangle className="w-3 h-3" />
                            Out of stock
                          </span>
                        ) : item.is_insufficient_stock ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#FEF9EB] text-[#A07828] border border-[#D6AE62]/40">
                            <AlertTriangle className="w-3 h-3" />
                            Only {item.available_stock} in stock
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-[#E7F3EE] text-[#23866A] border border-[#23866A]/20">
                            <CheckCircle2 className="w-3 h-3" />
                            Matched
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Quantity Stepper [-] Qty [+] */}
                    <div className="flex items-center gap-1 bg-[#FAF8F2] border border-[#DDE9DF] p-1 rounded-lg shrink-0">
                      <button
                        type="button"
                        onClick={() => handleUpdateQuantity(idx, -1)}
                        className="w-7 h-7 rounded-md bg-white border border-[#DDE9DF] text-[#252D29] hover:border-[#153D32] flex items-center justify-center font-bold transition-colors cursor-pointer"
                        aria-label="Decrease quantity"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="font-bold text-xs sm:text-sm text-[#153D32] w-7 text-center tabular-nums">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleUpdateQuantity(idx, 1)}
                        className="w-7 h-7 rounded-md bg-white border border-[#DDE9DF] text-[#252D29] hover:border-[#153D32] flex items-center justify-center font-bold transition-colors cursor-pointer"
                        aria-label="Increase quantity"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Total Price & Delete */}
                    <div className="text-right shrink-0 min-w-[76px]">
                      <label className="inline-flex items-center gap-0.5 text-xs sm:text-sm font-extrabold text-[#153D32] tabular-nums">
                        ₹
                        <input
                          key={`${item.product_id}-${idx}-${item.total_price}`}
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          defaultValue={item.total_price}
                          onBlur={(e) => {
                            const raw = e.currentTarget.value;
                            const parsed = Number(raw);
                            if (raw.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
                              e.currentTarget.value = String(item.total_price);
                              return;
                            }
                            handleEditLineTotal(idx, raw);
                          }}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          aria-label={`Line total for ${item.name}`}
                          className="w-16 text-right bg-transparent border-b border-dashed border-[#23866A]/60 focus:outline-none focus:border-[#153D32] tabular-nums"
                        />
                      </label>
                      <div>
                        <button
                          type="button"
                          onClick={() => handleRemoveMatchedItem(idx)}
                          className="text-[11px] font-semibold text-[#5E6C64] hover:text-[#B93838] mt-1 inline-flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <Trash2 className="w-3 h-3" /> Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Grand Total Summary Bar */}
                <div className="px-4 py-3.5 bg-[#FAF8F2] flex items-center justify-between border-t border-[#DDE9DF]">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#5E6C64]">
                    Grand Total
                  </span>
                  <span className="text-xl font-extrabold text-[#153D32] tabular-nums">
                    ₹{total}
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center bg-[#FAF8F2] border border-dashed border-[#DDE9DF] rounded-xl">
                <ShoppingCart className="w-7 h-7 mx-auto text-[#5E6C64]/50 mb-1.5" strokeWidth={1.75} />
                <p className="text-xs font-bold text-[#153D32]">
                  No items recognized yet
                </p>
                <p className="text-[11px] text-[#5E6C64] mt-0.5">
                  Tap the microphone or choose an English preset below
                </p>
              </div>
            )}
          </div>

          {/* Development Voice Simulation Drawer */}
          <div className="bg-[#FAF8F2] rounded-xl border border-[#DDE9DF] p-3.5 space-y-3">
            <button
              type="button"
              onClick={() => setShowDevPanel(!showDevPanel)}
              className="flex items-center justify-between w-full text-left cursor-pointer"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-[#153D32]">
                <Sparkles className="w-3.5 h-3.5 text-[#D6AE62]" />
                <span>English Voice Simulation Presets</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-[#FEF9EB] text-[#A07828] border border-[#D6AE62]/40">
                  Zero-Mic Testing
                </span>
              </div>
              <span className="text-[#5E6C64] shrink-0">
                {showDevPanel ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </span>
            </button>

            {showDevPanel && (
              <div className="space-y-2.5 pt-1">
                <div className="flex flex-wrap gap-1.5">
                  {ENGLISH_DEV_PRESETS.map((preset, pIdx) => (
                    <button
                      key={pIdx}
                      type="button"
                      onClick={() => {
                        setSimulatedInput(preset.text);
                        handleProcessTranscript(preset.text);
                      }}
                      className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg bg-white border border-[#DDE9DF] hover:border-[#23866A] hover:text-[#153D32] transition-colors cursor-pointer shadow-2xs text-left"
                      title={preset.label}
                    >
                      &ldquo;{preset.text}&rdquo;
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap sm:flex-nowrap gap-2 pt-1 min-w-0">
                  <input
                    type="text"
                    placeholder="Type an English voice sentence to simulate..."
                    value={simulatedInput}
                    onChange={(e) => setSimulatedInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleProcessTranscript(simulatedInput);
                      }
                    }}
                    className="flex-1 min-w-[160px] px-3 py-2 text-xs rounded-lg border border-[#DDE9DF] focus:outline-none focus:ring-2 focus:ring-[#153D32]/15 focus:border-[#153D32] font-medium bg-white text-[#252D29]"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleProcessTranscript(simulatedInput)}
                    disabled={!simulatedInput.trim() || isProcessing}
                    className="text-xs font-bold px-4 rounded-lg cursor-pointer"
                  >
                    Simulate
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* ========================================================================= */}
          {/* Dev-Only Voice Debug Panel (Hidden in Production) */}
          {/* ========================================================================= */}
          {import.meta.env.DEV && (
            <div className="bg-slate-900 text-slate-100 rounded-xl border border-slate-700/80 p-3.5 space-y-2.5 font-mono text-xs shadow-inner">
              <button
                type="button"
                onClick={() => setShowDebugPanel(!showDebugPanel)}
                className="flex items-center justify-between w-full text-left cursor-pointer select-none"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="font-bold text-slate-200 uppercase tracking-wider text-[11px]">
                    VOICE DEBUG PANEL (Dev Mode)
                  </span>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-300 bg-slate-800 px-2 py-0.5 rounded-md">
                  {showDebugPanel ? (
                    <>
                      <ChevronUp className="w-3.5 h-3.5" /> Hide
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" /> Inspect State
                    </>
                  )}
                </span>
              </button>

              {showDebugPanel && (
                <div className="space-y-2 pt-2 border-t border-slate-800 text-[11px]">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-950/70 p-2.5 rounded-xl border border-slate-800">
                    <div>
                      <span className="text-slate-400">Selected language:</span>{' '}
                      <span className="text-emerald-400 font-bold">{debugInfo.selectedLanguage}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Speech code:</span>{' '}
                      <span className="text-emerald-400 font-bold">{debugInfo.speechCode}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Browser SpeechRecognition:</span>{' '}
                      <span className={debugInfo.hasSpeechRecognition ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                        {debugInfo.hasSpeechRecognition ? 'Supported' : 'Not supported'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Recognition state:</span>{' '}
                      <span className="text-amber-400 font-bold">{debugInfo.recognitionState}</span>
                    </div>
                  </div>

                  <div className="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800 space-y-1.5">
                    <div>
                      <span className="text-slate-400">Raw transcript:</span>{' '}
                      <span className="text-white font-bold">&ldquo;{debugInfo.rawTranscript || '-'}&rdquo;</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Detected language:</span>{' '}
                      <span className="text-cyan-400 font-bold">{debugInfo.detectedLanguage || '-'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Normalized transcript:</span>{' '}
                      <span className="text-slate-200">{debugInfo.normalizedTranscript || '-'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">API request:</span>{' '}
                      <span className="text-slate-300">{debugInfo.apiRequest || '-'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">API response:</span>{' '}
                      <span className="text-slate-300">{debugInfo.apiResponse || '-'}</span>
                    </div>
                    {debugInfo.error && (
                      <div>
                        <span className="text-slate-400">Error:</span>{' '}
                        <span className="text-rose-400 font-bold">{debugInfo.error}</span>
                      </div>
                    )}
                  </div>

                  <div>
                    <span className="text-slate-400 block mb-1 font-semibold">Extracted items:</span>
                    <pre className="p-2 bg-slate-950 rounded-xl text-emerald-300 text-[10px] overflow-x-auto max-h-28 border border-slate-800">
                      {debugInfo.extractedItems.length > 0
                        ? JSON.stringify(debugInfo.extractedItems, null, 2)
                        : '// No items extracted yet'}
                    </pre>
                  </div>

                  <div>
                    <span className="text-slate-400 block mb-1 font-semibold">Inventory matches:</span>
                    <pre className="p-2 bg-slate-950 rounded-xl text-teal-300 text-[10px] overflow-x-auto max-h-28 border border-slate-800">
                      {debugInfo.inventoryMatches.length > 0
                        ? JSON.stringify(
                          debugInfo.inventoryMatches.map(m => ({
                            product_id: m.product_id,
                            name: m.name,
                            quantity: m.quantity,
                            unit_price: m.unit_price,
                            total_price: m.total_price,
                            stock: m.current_stock
                          })),
                          null,
                          2
                        )
                        : '// No inventory matches yet'}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Modal Footer with Actions */}
        <div className="px-4 sm:px-5 py-3 sm:py-3.5 border-t border-[#DDE9DF] bg-white flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          <div className="flex items-center gap-2 text-xs text-[#5E6C64]">
            <Info className="w-4 h-4 text-[#153D32] shrink-0" />
            <span>
              {matchedItems.length} {matchedItems.length === 1 ? 'item' : 'items'} ready to transfer to billing
            </span>
          </div>

          <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              size="md"
              onClick={handleModalClose}
              className="col-span-2 sm:col-span-1 sm:flex-initial rounded-lg text-xs font-bold cursor-pointer border-[#DDE9DF] text-[#252D29] hover:bg-[#FAF8F2] min-h-[44px]"
            >
              Cancel
            </Button>

            <Button
              variant="secondary"
              size="md"
              disabled={matchedItems.length === 0 || isProcessing}
              onClick={() => handleConfirmBill(false)}
              className="sm:flex-initial rounded-lg text-xs font-bold cursor-pointer min-h-[44px]"
              icon={<ShoppingCart className="w-4 h-4" />}
            >
              Add to Bill ({matchedItems.length})
            </Button>

            <Button
              variant="primary"
              size="md"
              disabled={matchedItems.length === 0 || isProcessing}
              onClick={() => handleConfirmBill(true)}
              className="sm:flex-initial rounded-lg text-xs font-bold cursor-pointer min-h-[44px]"
              icon={<CheckCircle2 className="w-4 h-4" />}
            >
              Confirm &amp; Pay (₹{total})
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
};
