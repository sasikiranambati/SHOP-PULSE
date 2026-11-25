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
  Languages,
  FileText,
  Loader2,
} from 'lucide-react';
import { Button } from './Button';
import { useDialog } from '../hooks/useDialog';
import type { CartItem, Product } from '../types';
import { catalogPrice, lineTotal, lineTotalPaise, round3 } from '../utils/cartPricing';
import { voiceLineToCartItem, withEditedLineTotal } from '../utils/voiceBill';
import {
  voiceApi,
  type MatchedVoiceItem,
  type AmbiguousVoiceItem,
  type UnmatchedVoiceItem,
  type VoiceProcessResponse,
  type VoiceProductCandidate
} from '../api/voice';
import {
  VOICE_LANGUAGES,
  VOICE_LANGUAGES_LIST,
  SPEECH_LANGUAGES,
  type VoiceLanguageKey,
  getLocalizedItemName,
  getLocalizedUnit,
  getLocalizedBillLabel
} from '../config/voiceLanguages';
import { parseMultilingualVoiceBill } from '../utils/multilingualVoiceParser';
import { useLanguage } from '../i18n/LanguageContext';

interface VoiceBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  /** Cart lines keep the spoken (or corrected) unit price; the catalogue price applies only when none was said. */
  onConfirmToCart: (items: CartItem[]) => void;
  onDirectCheckout?: (items: CartItem[]) => void;
}

type VoiceButtonState = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'SUCCESS' | 'ERROR';

interface PresetItem {
  text: string;
  langKey: VoiceLanguageKey;
  label: string;
}

const MULTILINGUAL_DEV_PRESETS: PresetItem[] = [
  {
    text: 'రెండు కిలోల బియ్యం నూట ఇరవై రూపాయలు',
    langKey: 'telugu',
    label: 'Telugu: 2 kg Rice ₹120'
  },
  {
    text: 'రెండు కిలోల బియ్యం',
    langKey: 'telugu',
    label: 'Telugu: 2 kg Rice'
  },
  {
    text: 'రెండు టాటా సాల్ట్',
    langKey: 'telugu',
    label: 'Telugu: 2 Tata Salt'
  },
  {
    text: 'दो किलो चावल एक सौ बीस रुपये',
    langKey: 'hindi',
    label: 'Hindi: 2 kg Rice ₹120'
  },
  {
    text: 'दो किलो चावल',
    langKey: 'hindi',
    label: 'Hindi: 2 kg Rice'
  },
  {
    text: 'दो टाटा नमक',
    langKey: 'hindi',
    label: 'Hindi: 2 Tata Salt'
  },
  {
    text: '2 Tata Salt, 3 Parle-G and 1 Aashirvaad Atta',
    langKey: 'english',
    label: 'English: Salt, Biscuits, Atta'
  },
  {
    text: '2 kg Rice 120 rupees',
    langKey: 'english',
    label: 'English: 2 kg Rice ₹120'
  },
  {
    text: 'రెండు kilo rice',
    langKey: 'telugu',
    label: 'Code-Mixed: 2 kilo rice'
  },
  {
    text: 'दो kilo चावल',
    langKey: 'hindi',
    label: 'Code-Mixed: 2 kilo rice'
  },
  {
    text: '3 packets Parle-G',
    langKey: 'english',
    label: 'English: 3 packets Parle-G'
  },
  {
    text: 'இரண்டு கிலோ அரிசி',
    langKey: 'tamil',
    label: 'Tamil: 2 kg Rice'
  },
  {
    text: 'இரண்டு கிலோ அரிசி நூற்று இருபது ரூபாய்',
    langKey: 'tamil',
    label: 'Tamil: 2 kg Rice ₹120'
  },
  {
    text: 'ಎರಡು ಕಿಲೋ ಅಕ್ಕಿ',
    langKey: 'kannada',
    label: 'Kannada: 2 kg Rice'
  },
  {
    text: 'രണ്ട് കിലോ അരി',
    langKey: 'malayalam',
    label: 'Malayalam: 2 kg Rice'
  },
  {
    text: 'दोन किलो तांदूळ',
    langKey: 'marathi',
    label: 'Marathi: 2 kg Rice'
  },
  {
    text: 'দুই কেজি চাল',
    langKey: 'bengali',
    label: 'Bengali: 2 kg Rice'
  },
  {
    text: 'બે કિલો ચોખા',
    langKey: 'gujarati',
    label: 'Gujarati: 2 kg Rice'
  },
  {
    text: 'ਦੋ ਕਿਲੋ ਚਾਵਲ',
    langKey: 'punjabi',
    label: 'Punjabi: 2 kg Rice'
  },
  {
    text: 'ଦୁଇ କିଲୋ ଚାଉଳ',
    langKey: 'odia',
    label: 'Odia: 2 kg Rice'
  },
  {
    text: 'দুই কেজি চাউল',
    langKey: 'assamese',
    label: 'Assamese: 2 kg Rice'
  }
];

export const VoiceBillModal: React.FC<VoiceBillModalProps> = ({
  isOpen,
  onClose,
  products,
  onConfirmToCart,
  onDirectCheckout,
}) => {
  const { language: appLang } = useLanguage();

  // Language selectors
  const [spokenLanguage, setSpokenLanguage] = useState<VoiceLanguageKey>(() => {
    // Map initial language based on current app language if applicable
    if (appLang === 'te') return 'telugu';
    if (appLang === 'hi') return 'hindi';
    if (appLang === 'ta') return 'tamil';
    if (appLang === 'kn') return 'kannada';
    if (appLang === 'ml') return 'malayalam';
    if (appLang === 'mr') return 'marathi';
    if (appLang === 'bn') return 'bengali';
    if (appLang === 'gu') return 'gujarati';
    if (appLang === 'pa') return 'punjabi';
    if (appLang === 'or') return 'odia';
    if (appLang === 'as') return 'assamese';
    return 'telugu';
  });

  const [displayLanguage, setDisplayLanguage] = useState<VoiceLanguageKey>('english');

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

  // Recognized items state
  const [matchedItems, setMatchedItems] = useState<MatchedVoiceItem[]>([]);
  const [ambiguousItems, setAmbiguousItems] = useState<AmbiguousVoiceItem[]>([]);
  const [unmatchedItems, setUnmatchedItems] = useState<UnmatchedVoiceItem[]>([]);

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
  }>(() => {
    const initCfg = SPEECH_LANGUAGES.telugu;
    return {
      selectedLanguage: initCfg.name,
      speechCode: initCfg.speechCode,
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
    };
  });

  // Audio recording refs
  const speechRecognitionRef = useRef<any>(null);
  const timerRef = useRef<any>(null);
  const silenceTimeoutRef = useRef<any>(null);
  const debouncedPreviewTimerRef = useRef<any>(null);
  const accumulatedFinalRef = useRef<string>('');

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

    setIsRecording(false);
    setButtonState(prev => (prev === 'LISTENING' ? 'IDLE' : prev));
  }, []);

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
      setButtonState('IDLE');
    };
  }, [isOpen, stopRecording]);

  const panelRef = useDialog<HTMLDivElement>({
    isOpen,
    onClose: () => {
      stopRecording();
      onClose();
    },
    closeOnEscape: !isRecording && !isProcessing,
  });

  if (!isOpen) return null;

  // Convert current products to candidates format for payload override
  const customProductCandidates: VoiceProductCandidate[] = products.map(p => ({
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
  }));

  // ---------------------------------------------------------------------------
  // Pipeline Processing
  // ---------------------------------------------------------------------------
  const handleProcessTranscript = async (textToProcess: string, langKeyOverride?: VoiceLanguageKey) => {
    if (!textToProcess.trim()) {
      setErrorMessage("No speech detected. Please speak clearly or enter items to simulate.");
      setButtonState('ERROR');
      setTimeout(() => setButtonState('IDLE'), 2500);
      return;
    }

    const activeLang = langKeyOverride || spokenLanguage;
    const speechConfig = SPEECH_LANGUAGES[activeLang] || SPEECH_LANGUAGES.english;
    const speechCode = speechConfig.speechCode;

    setTranscript(textToProcess.trim());
    setEditedTranscript(textToProcess.trim());
    setIsEditingTranscript(false);
    setInterimTranscript('');
    setLivePreviewItems([]);
    setErrorMessage(null);
    setButtonState('PROCESSING');
    setIsProcessing(true);

    setDebugInfo(prev => ({
      ...prev,
      selectedLanguage: speechConfig.name,
      speechCode: speechCode,
      recognitionState: 'PROCESSING',
      rawTranscript: textToProcess.trim(),
      detectedLanguage: speechConfig.name,
      apiRequest: 'POST /api/v1/voice/process',
      error: null
    }));

    // STEP 1: Instant zero-latency (<1ms) client-side parsing for immediate responsive feedback
    let instantSuccess = false;
    try {
      const localResult = parseMultilingualVoiceBill(
        textToProcess.trim(),
        products,
        activeLang
      );

      if (localResult.matched_items.length > 0 || localResult.ambiguous_items.length > 0) {
        setMatchedItems(localResult.matched_items);
        setAmbiguousItems(localResult.ambiguous_items);
        setUnmatchedItems(localResult.unmatched_items);
        instantSuccess = true;
        setButtonState('SUCCESS');
        setTimeout(() => setButtonState('IDLE'), 2800);
      }
    } catch (e) {
      console.warn("Client instant parser notice:", e);
    }

    // STEP 2: Concurrently validate & reconcile with backend FastAPI service
    try {
      const response: VoiceProcessResponse = await voiceApi.processVoiceBill({
        simulation_text: textToProcess.trim(),
        language_code: speechCode,
        custom_products: customProductCandidates,
      });

      setDebugInfo(prev => ({
        ...prev,
        apiResponse: `HTTP 200 (matched: ${response.matched_items?.length || 0}, ambiguous: ${response.ambiguous_items?.length || 0}, unmatched: ${response.unmatched_items?.length || 0})`
      }));

      // The backend result is authoritative (exact units and prices): it replaces the instant preview even
      // when it matched nothing, so an unchecked preview line can never be billed
      if (response) {
        const nothingFound =
          !(response.matched_items?.length || response.ambiguous_items?.length || response.unmatched_items?.length);
        if (nothingFound) {
          setMatchedItems([]);
          setAmbiguousItems([]);
          setUnmatchedItems([]);
          setErrorMessage("Could not detect items. Please try speaking item name and quantity clearly.");
          setButtonState('ERROR');
          setTimeout(() => setButtonState('IDLE'), 3000);
          return;
        }
        setTranscript(response.transcript || textToProcess);
        setEditedTranscript(response.transcript || textToProcess);
        setMatchedItems(response.matched_items);
        setAmbiguousItems(response.ambiguous_items);
        setUnmatchedItems(response.unmatched_items);
        setIsMockProvider(response.is_mock);

        setDebugInfo(prev => ({
          ...prev,
          recognitionState: 'SUCCESS',
          extractedItems: response.matched_items.map(m => ({ item: m.name, quantity: m.quantity, price: m.unit_price })),
          inventoryMatches: response.matched_items
        }));

        setButtonState('SUCCESS');
        setTimeout(() => setButtonState('IDLE'), 2800);
        return;
      }
    } catch (backendErr: any) {
      console.warn("Backend voice processing unavailable, relying on client-side multilingual parser:", backendErr);
      setDebugInfo(prev => ({
        ...prev,
        apiResponse: `Backend offline/fallback (${backendErr.message || 'Network'}), using local parser`
      }));
    } finally {
      setIsProcessing(false);
    }

    // STEP 3: Fallback handling if no items were matched yet
    if (!instantSuccess) {
      try {
        const fallbackResult = parseMultilingualVoiceBill(
          textToProcess.trim(),
          products,
          activeLang
        );

        setMatchedItems(fallbackResult.matched_items);
        setAmbiguousItems(fallbackResult.ambiguous_items);
        setUnmatchedItems(fallbackResult.unmatched_items);

        if (fallbackResult.matched_items.length > 0) {
          setButtonState('SUCCESS');
          setTimeout(() => setButtonState('IDLE'), 2800);
        } else if (fallbackResult.unmatched_items.length > 0) {
          setButtonState('IDLE');
        } else {
          setButtonState('ERROR');
          const err = "Could not detect items. Please try speaking item name and quantity clearly.";
          setErrorMessage(err);
          setDebugInfo(prev => ({ ...prev, error: err, recognitionState: 'ERROR' }));
          setTimeout(() => setButtonState('IDLE'), 3000);
        }
      } catch (err: any) {
        setButtonState('ERROR');
        const errStr = err.message || "Failed to process voice bill.";
        setErrorMessage(errStr);
        setDebugInfo(prev => ({ ...prev, error: errStr, recognitionState: 'ERROR' }));
        setTimeout(() => setButtonState('IDLE'), 3000);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Microphone Capture with Selected Spoken Language
  // ---------------------------------------------------------------------------
  const startRecording = (langKeyToUse: VoiceLanguageKey = spokenLanguage) => {
    // Prevent repeated or simultaneous sessions
    if (isRecording || isProcessing || buttonState === 'PROCESSING') {
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

    setErrorMessage(null);
    accumulatedFinalRef.current = '';
    setInterimTranscript('');
    setLivePreviewItems([]);

    const selectedConfig = SPEECH_LANGUAGES[langKeyToUse] || SPEECH_LANGUAGES.english;
    const speechCode = selectedConfig.speechCode;

    // Check if browser supports Web Speech API
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      const msg = "Speech recognition is not supported in this browser. Please use a supported browser or enable the required speech service.";
      setButtonState('ERROR');
      setErrorMessage(msg);
      setDebugInfo(prev => ({
        ...prev,
        hasSpeechRecognition: false,
        recognitionState: 'UNSUPPORTED',
        error: msg
      }));
      setTimeout(() => setButtonState('IDLE'), 4000);
      return;
    }

    try {
      // Create fresh SpeechRecognition instance for each session
      const recognition = new SpeechRecognition();
      speechRecognitionRef.current = recognition;

      // Enable real-time streaming interim results, multi-alternatives, and continuous speech
      recognition.lang = speechCode;
      recognition.interimResults = true;
      recognition.maxAlternatives = 3;
      recognition.continuous = true;

      if (import.meta.env.DEV) {
        console.log(`VOICE DEBUG:\nselected language = ${selectedConfig.name}\nspeech code = ${speechCode}\nrecognition language = ${recognition.lang}`);
      }

      setDebugInfo(prev => ({
        ...prev,
        selectedLanguage: selectedConfig.name,
        speechCode: speechCode,
        hasSpeechRecognition: true,
        recognitionState: 'LISTENING',
        error: null
      }));

      recognition.onstart = () => {
        setIsRecording(true);
        setButtonState('LISTENING');
        setRecordingSeconds(0);
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => {
          setRecordingSeconds(s => s + 1);
        }, 1000);
      };

      recognition.onresult = (event: any) => {
        let interimText = '';
        let newFinalChunk = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          if (res.isFinal) {
            // Multi-alternative evaluation: pick the alternative that scores highest with catalog matching
            let bestAltText = res[0]?.transcript || '';
            if (res.length > 1) {
              let highestScore = -1;
              for (let a = 0; a < res.length; a++) {
                const candText = res[a]?.transcript?.trim();
                if (!candText) continue;
                const parsed = parseMultilingualVoiceBill(candText, products, langKeyToUse);
                const score = (parsed.matched_items.length * 10) + ((res[a].confidence || 0) * 5);
                if (score > highestScore) {
                  highestScore = score;
                  bestAltText = candText;
                }
              }
            }
            newFinalChunk += (newFinalChunk ? ' ' : '') + bestAltText;
          } else {
            interimText += (interimText ? ' ' : '') + (res[0]?.transcript || '');
          }
        }

        if (newFinalChunk) {
          accumulatedFinalRef.current = (accumulatedFinalRef.current + ' ' + newFinalChunk).trim();
        }

        const fullCurrentTranscript = (accumulatedFinalRef.current + ' ' + interimText).trim();
        setInterimTranscript(fullCurrentTranscript);

        // Real-time live item detection preview
        if (debouncedPreviewTimerRef.current) {
          clearTimeout(debouncedPreviewTimerRef.current);
        }
        debouncedPreviewTimerRef.current = setTimeout(() => {
          if (fullCurrentTranscript) {
            try {
              const liveParsed = parseMultilingualVoiceBill(fullCurrentTranscript, products, langKeyToUse);
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
            const finalText = (accumulatedFinalRef.current + ' ' + interimText).trim();
            if (finalText) {
              stopRecording();
              handleProcessTranscript(finalText, langKeyToUse);
            }
          }, 1800);
        }
      };

      recognition.onerror = (event: any) => {
        stopRecording();
        const errType = event.error;
        let msg = `Speech recognition error: ${errType || 'Unknown error'}`;

        if (errType === 'not-allowed' || errType === 'permission-denied') {
          msg = "Microphone access is required for Voice-to-Bill. Please allow microphone access in your browser settings.";
        } else if (errType === 'language-not-supported') {
          msg = `Speech recognition for ${selectedConfig.name} is not available in your current browser.`;
        } else if (errType === 'no-speech') {
          msg = "No speech detected. Please speak clearly into the microphone.";
        } else if (errType === 'network') {
          msg = "Speech recognition could not connect. Please check your connection and try again.";
        } else if (errType === 'aborted') {
          setButtonState('IDLE');
          return;
        }

        setButtonState('ERROR');
        setErrorMessage(msg);
        setDebugInfo(prev => ({
          ...prev,
          recognitionState: 'ERROR',
          error: msg
        }));
        setTimeout(() => setButtonState('IDLE'), 4000);
      };

      recognition.onend = () => {
        stopRecording();
      };

      recognition.start();
    } catch (e: any) {
      console.warn("SpeechRecognition start failed:", e);
      stopRecording();
      setButtonState('ERROR');
      const msg = e.message || "Failed to start speech recognition.";
      setErrorMessage(msg);
      setDebugInfo(prev => ({ ...prev, error: msg, recognitionState: 'ERROR' }));
      setTimeout(() => setButtonState('IDLE'), 4000);
    }
  };

  const handleStopRecordingAndProcess = () => {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    const textToCommit = (accumulatedFinalRef.current + ' ' + interimTranscript).trim();
    stopRecording();
    if (textToCommit) {
      handleProcessTranscript(textToCommit, spokenLanguage);
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
      startRecording(spokenLanguage);
    }
  };

  const handleSelectSpokenLanguage = (langKey: VoiceLanguageKey) => {
    if (isRecording) {
      stopRecording();
    }
    setSpokenLanguage(langKey);
    const config = SPEECH_LANGUAGES[langKey] || SPEECH_LANGUAGES.english;
    setDebugInfo(prev => ({
      ...prev,
      selectedLanguage: config.name,
      speechCode: config.speechCode,
    }));
  };

  // ---------------------------------------------------------------------------
  // Ambiguity Resolution: User picks specific variant
  // ---------------------------------------------------------------------------
  const handleResolveAmbiguity = (ambiguousIndex: number, candidate: VoiceProductCandidate) => {
    const amb = ambiguousItems[ambiguousIndex];
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

    setMatchedItems(prev => [...prev, newMatchedItem]);
    setAmbiguousItems(prev => prev.filter((_, idx) => idx !== ambiguousIndex));
  };

  // ---------------------------------------------------------------------------
  // Item Editing & Deletion
  // ---------------------------------------------------------------------------
  const handleUpdateQuantity = (index: number, delta: number) => {
    setMatchedItems(prev => {
      return prev.map((item, idx) => {
        if (idx === index) {
          const newQty = round3(item.quantity + delta);
          if (newQty <= 0) return null;
          // Same unit price (spoken prices are per unit), exact line total
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
    });
  };

  /** Manual correction of a line's total before saving: the unit price follows; nothing else changes. */
  const handleEditLineTotal = (index: number, value: string) => {
    const total = Number(value);
    if (value.trim() === '' || !Number.isFinite(total) || total < 0) return;
    setMatchedItems(prev => prev.map((item, idx) => (idx === index ? withEditedLineTotal(item, total) : item)));
  };

  const handleRemoveMatchedItem = (index: number) => {
    setMatchedItems(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleRemoveUnmatched = (index: number) => {
    setUnmatchedItems(prev => prev.filter((_, idx) => idx !== index));
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
          {buttonState === 'LISTENING' && `Listening in ${SPEECH_LANGUAGES[spokenLanguage]?.name || spokenLanguage}... Speak now.`}
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
                  {getLocalizedBillLabel('billTitle', displayLanguage)}
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
                Speak in Telugu, Hindi, English, Tamil &amp; 12 Indian languages
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white hover:bg-[#F3EFE3] text-[#5E6C64] hover:text-[#252D29] flex items-center justify-center transition-colors cursor-pointer border border-[#DDE9DF]"
            aria-label="Close Voice-to-Bill"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 sm:space-y-5 flex-1 bg-white">
          
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
          {/* Voice to Bill Primary Card with Language Selectors & Microphone Control   */}
          {/* ========================================================================= */}
          <div className="bg-[#FAF8F2] rounded-2xl p-4 sm:p-5 border border-[#DDE9DF] shadow-2xs space-y-5">
            
            {/* Card Sub-Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#DDE9DF]">
              <div className="flex items-center gap-2">
                <Mic className="w-4 h-4 text-[#153D32]" strokeWidth={2} />
                <span className="font-bold text-sm text-[#153D32] tracking-tight">
                  Voice to Bill
                </span>
              </div>
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#153D32] bg-[#E7F3EE] border border-[#23866A]/25 px-2.5 py-0.5 rounded-full">
                <Languages className="w-3.5 h-3.5 text-[#23866A]" strokeWidth={2} />
                <span>12 Indian Languages</span>
              </div>
            </div>

            {/* Secondary Controls: Language Selectors */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 w-full text-left">
              
              {/* Language I Speak */}
              <div className="space-y-1.5">
                <label 
                  htmlFor="spoken-lang-dropdown"
                  className="text-xs font-bold text-[#153D32] flex items-center gap-1.5"
                >
                  <Mic className="w-3.5 h-3.5 text-[#23866A]" strokeWidth={2} />
                  <span>Language I Speak</span>
                </label>
                <div className="relative">
                  <select
                    id="spoken-lang-dropdown"
                    value={spokenLanguage}
                    onChange={(e) => handleSelectSpokenLanguage(e.target.value as VoiceLanguageKey)}
                    className="w-full pl-3.5 pr-8 py-2.5 bg-white border border-[#DDE9DF] hover:border-[#23866A] focus:border-[#153D32] rounded-xl text-xs sm:text-sm font-semibold text-[#252D29] shadow-2xs focus:outline-none focus:ring-2 focus:ring-[#153D32]/15 cursor-pointer appearance-none transition-colors"
                  >
                    {VOICE_LANGUAGES_LIST.map((lang) => (
                      <option key={lang.key} value={lang.key}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-[#5E6C64]">
                    <ChevronDown className="w-4 h-4" />
                  </div>
                </div>
                <p className="text-[11px] text-[#5E6C64]">
                  Voice input recognition language
                </p>
              </div>

              {/* Show Bill In */}
              <div className="space-y-1.5">
                <label 
                  htmlFor="display-lang-dropdown"
                  className="text-xs font-bold text-[#153D32] flex items-center gap-1.5"
                >
                  <FileText className="w-3.5 h-3.5 text-[#153D32]" strokeWidth={2} />
                  <span>Show Bill In</span>
                </label>
                <div className="relative">
                  <select
                    id="display-lang-dropdown"
                    value={displayLanguage}
                    onChange={(e) => setDisplayLanguage(e.target.value as VoiceLanguageKey)}
                    className="w-full pl-3.5 pr-8 py-2.5 bg-white border border-[#DDE9DF] hover:border-[#23866A] focus:border-[#153D32] rounded-xl text-xs sm:text-sm font-semibold text-[#252D29] shadow-2xs focus:outline-none focus:ring-2 focus:ring-[#153D32]/15 cursor-pointer appearance-none transition-colors"
                  >
                    {VOICE_LANGUAGES_LIST.map((lang) => (
                      <option key={lang.key} value={lang.key}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-[#5E6C64]">
                    <ChevronDown className="w-4 h-4" />
                  </div>
                </div>
                <p className="text-[11px] text-[#5E6C64]">
                  Generated bill display language
                </p>
              </div>

            </div>

            {/* Primary Action: Microphone Control */}
            <div className="flex flex-col items-center justify-center pt-1">
              <div className="relative w-full flex justify-center">
                <button
                  type="button"
                  onClick={handleMainButtonClick}
                  disabled={buttonState === 'PROCESSING' || isProcessing}
                  className={`relative group w-full max-w-sm h-14 sm:h-15 px-6 rounded-xl font-bold text-sm sm:text-base tracking-wide flex items-center justify-center gap-2.5 transition-all duration-150 select-none shadow-sm cursor-pointer ${
                    buttonState === 'LISTENING'
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
                      Listening in {VOICE_LANGUAGES[spokenLanguage]?.name} ({recordingSeconds}s)
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
                    Speak items naturally in {VOICE_LANGUAGES[spokenLanguage]?.name} (e.g., &ldquo;2 kg rice 120 rupees&rdquo;)
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
                  {getLocalizedBillLabel('speechTranscript', displayLanguage)}
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
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editedTranscript}
                    onChange={(e) => setEditedTranscript(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-[#DDE9DF] focus:outline-none focus:ring-2 focus:ring-[#153D32]/20 focus:border-[#153D32] font-medium bg-white text-[#252D29]"
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => handleProcessTranscript(editedTranscript)}
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
                <span>Multiple Matches Detected — Select Product</span>
              </div>

              {ambiguousItems.map((amb, ambIdx) => (
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
                          {getLocalizedItemName(cand.name, displayLanguage)}
                        </p>
                        <div className="flex items-center justify-between mt-1 text-[11px] font-semibold">
                          <span className="text-[#23866A] tabular-nums">₹{cand.selling_price}</span>
                          <span className="text-[#5E6C64]">
                            {cand.current_stock} {getLocalizedBillLabel('inStock', displayLanguage)}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
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
                  <div key={unIdx} className="flex items-center justify-between text-xs bg-white px-3 py-2 rounded-lg border border-[#EF806D]/30">
                    <span className="font-bold text-[#252D29]">
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

          {/* Recognized Bill Items Table - Display Localized via "Show Bill In" */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between px-0.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#5E6C64]">
                {getLocalizedBillLabel('recognizedItems', displayLanguage)} ({matchedItems.length})
              </h3>
              {matchedItems.length > 0 && (
                <span className="text-xs font-bold text-[#153D32] tabular-nums">
                  {getLocalizedBillLabel('subtotal', displayLanguage)}: ₹{subtotal}
                </span>
              )}
            </div>

            {matchedItems.length > 0 ? (
              <div className="bg-white border border-[#DDE9DF] rounded-xl divide-y divide-[#DDE9DF] shadow-2xs overflow-hidden">
                {matchedItems.map((item, idx) => (
                  <div key={idx} className="p-3.5 flex items-center justify-between gap-3 hover:bg-[#FAF8F2]/60 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-xs sm:text-sm text-[#153D32] truncate">
                        {getLocalizedItemName(item.name, displayLanguage)}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <span className="text-xs text-[#5E6C64] font-medium tabular-nums">
                          ₹{item.unit_price} / {getLocalizedUnit(item.unit, displayLanguage)}
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
                        {item.spoken_quantity && (
                          <span className="text-[10px] font-medium text-[#5E6C64]">
                            said {item.spoken_quantity}
                          </span>
                        )}
                        {item.is_out_of_stock ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#FDF1EF] text-[#B93838] border border-[#EF806D]/40">
                            <AlertTriangle className="w-3 h-3" />
                            {getLocalizedBillLabel('outOfStock', displayLanguage)}
                          </span>
                        ) : item.is_insufficient_stock ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#FEF9EB] text-[#A07828] border border-[#D6AE62]/40">
                            <AlertTriangle className="w-3 h-3" />
                            Only {item.available_stock} in stock
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-[#E7F3EE] text-[#23866A] border border-[#23866A]/20">
                            <CheckCircle2 className="w-3 h-3" />
                            Verified
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
                          key={`${idx}-${item.total_price}`}
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          defaultValue={item.total_price}
                          onBlur={(e) => handleEditLineTotal(idx, e.target.value)}
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
                          <Trash2 className="w-3 h-3" /> {getLocalizedBillLabel('remove', displayLanguage)}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Grand Total Summary Bar */}
                <div className="px-4 py-3.5 bg-[#FAF8F2] flex items-center justify-between border-t border-[#DDE9DF]">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#5E6C64]">
                    {getLocalizedBillLabel('grandTotal', displayLanguage)}
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
                  {getLocalizedBillLabel('noItemsYet', displayLanguage)}
                </p>
                <p className="text-[11px] text-[#5E6C64] mt-0.5">
                  {getLocalizedBillLabel('speakHint', displayLanguage)}
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
                <span>Multilingual Voice Simulation Presets</span>
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
                  {MULTILINGUAL_DEV_PRESETS.map((preset, pIdx) => (
                    <button
                      key={pIdx}
                      type="button"
                      onClick={() => {
                        handleSelectSpokenLanguage(preset.langKey);
                        setSimulatedInput(preset.text);
                        handleProcessTranscript(preset.text, preset.langKey);
                      }}
                      className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg bg-white border border-[#DDE9DF] hover:border-[#23866A] hover:text-[#153D32] transition-colors cursor-pointer shadow-2xs text-left"
                      title={preset.label}
                    >
                      <span className="text-[#5E6C64] text-[10px] mr-1">[{VOICE_LANGUAGES[preset.langKey]?.name}]:</span>
                      &ldquo;{preset.text}&rdquo;
                    </button>
                  ))}
                </div>

                <div className="flex gap-2 pt-1">
                  <input
                    type="text"
                    placeholder={`Type voice sentence in ${VOICE_LANGUAGES[spokenLanguage]?.name} to simulate...`}
                    value={simulatedInput}
                    onChange={(e) => setSimulatedInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleProcessTranscript(simulatedInput, spokenLanguage);
                      }
                    }}
                    className="flex-1 px-3 py-2 text-xs rounded-lg border border-[#DDE9DF] focus:outline-none focus:ring-2 focus:ring-[#153D32]/15 focus:border-[#153D32] font-medium bg-white text-[#252D29]"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleProcessTranscript(simulatedInput, spokenLanguage)}
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
              {matchedItems.length} {getLocalizedBillLabel('itemsReady', displayLanguage)}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              size="md"
              onClick={onClose}
              className="col-span-2 sm:col-span-1 sm:flex-initial rounded-lg text-xs font-bold cursor-pointer border-[#DDE9DF] text-[#252D29] hover:bg-[#FAF8F2] min-h-[44px]"
            >
              {getLocalizedBillLabel('cancel', displayLanguage)}
            </Button>

            <Button
              variant="secondary"
              size="md"
              disabled={matchedItems.length === 0 || isProcessing}
              onClick={() => handleConfirmBill(false)}
              className="sm:flex-initial rounded-lg text-xs font-bold cursor-pointer min-h-[44px]"
              icon={<ShoppingCart className="w-4 h-4" />}
            >
              {getLocalizedBillLabel('addToBill', displayLanguage)} ({matchedItems.length})
            </Button>

            <Button
              variant="primary"
              size="md"
              disabled={matchedItems.length === 0 || isProcessing}
              onClick={() => handleConfirmBill(true)}
              className="sm:flex-initial rounded-lg text-xs font-bold cursor-pointer min-h-[44px]"
              icon={<CheckCircle2 className="w-4 h-4" />}
            >
              {getLocalizedBillLabel('confirmAndPay', displayLanguage)} (₹{total})
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
};
