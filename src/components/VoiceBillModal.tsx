import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Mic,
  Sparkles,
  X,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Plus,
  Minus,
  ShoppingCart,
  Info,
  RefreshCw,
  Volume2,
  ChevronDown,
  Languages
} from 'lucide-react';
import { Button } from './Button';
import type { Product } from '../types';
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
  onConfirmToCart: (items: Array<{ product: Product; quantity: number }>) => void;
  onDirectCheckout?: (items: Array<{ product: Product; quantity: number }>) => void;
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
  const subtotal = useMemo(() => {
    const sum = matchedItems.reduce((acc, item) => acc + item.total_price, 0);
    return Math.round(sum * 100) / 100;
  }, [matchedItems]);
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

  if (!isOpen) return null;

  // Convert current products to candidates format for payload override
  const customProductCandidates: VoiceProductCandidate[] = products.map(p => ({
    id: p.id,
    name: p.name,
    selling_price: p.sellingPrice ?? p.price ?? 0,
    current_stock: p.stock ?? 0,
    unit: p.unit || 'pcs',
    category: String(p.category || 'General'),
    sku: p.sku || p.barcode
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

      if (
        response &&
        (response.matched_items?.length > 0 || response.ambiguous_items?.length > 0)
      ) {
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
    const unitPrice = candidate.selling_price;
    const lineTotal = Math.round(unitPrice * amb.quantity * 100) / 100;

    const newMatchedItem: MatchedVoiceItem = {
      product_id: candidate.id,
      name: candidate.name,
      quantity: amb.quantity,
      unit_price: unitPrice,
      total_price: lineTotal,
      unit: candidate.unit,
      current_stock: candidate.current_stock,
      is_out_of_stock: candidate.current_stock <= 0,
      is_insufficient_stock: amb.quantity > candidate.current_stock,
      available_stock: Math.max(0, candidate.current_stock),
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
          const newQty = item.quantity + delta;
          if (newQty <= 0) return null;
          const newTotal = Math.round(item.unit_price * newQty * 100) / 100;
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

    // Map matched items strictly to existing Product objects from inventory
    const cartItemsToAdd: Array<{ product: Product; quantity: number }> = [];

    for (const item of matchedItems) {
      const prod = products.find(p => p.id === item.product_id) ||
                   products.find(p => p.name.toLowerCase() === item.name.toLowerCase());
      if (prod) {
        cartItemsToAdd.push({ product: prod, quantity: item.quantity });
      }
    }

    if (cartItemsToAdd.length === 0) {
      setErrorMessage("Matched items could not be mapped to catalog inventory. Please check stock.");
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-to-bill-title"
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-emerald-50 via-teal-50 to-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center shadow-md shadow-emerald-500/20 shrink-0">
              <Mic className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="voice-to-bill-title" className="text-base font-black text-slate-900">
                  {getLocalizedBillLabel('billTitle', displayLanguage)}
                </h2>
                {isMockProvider ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-200">
                    Offline / Dev Mode
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200">
                    Live STT
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 font-medium">
                Speak in Telugu, Hindi, English, Tamil & 12 Indian languages
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors cursor-pointer border border-slate-200"
            aria-label="Close Voice-to-Bill"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 sm:space-y-5 flex-1">
          
          {/* Error Banner */}
          {errorMessage && (
            <div 
              role="alert"
              className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl text-xs font-semibold flex items-start gap-2.5 animate-in fade-in"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">{errorMessage}</div>
              <button 
                type="button" 
                onClick={() => setErrorMessage(null)} 
                className="text-rose-500 hover:text-rose-700 text-xs font-bold cursor-pointer"
                aria-label="Dismiss error"
              >
                ✕
              </button>
            </div>
          )}

          {/* ========================================================================= */}
          {/* Voice to Bill Prominent Hero Section with Two Language Selectors */}
          {/* ========================================================================= */}
          <div className="bg-gradient-to-b from-slate-50 via-emerald-50/20 to-slate-100/70 rounded-3xl p-4 sm:p-6 border border-slate-200/90 shadow-xs relative overflow-hidden">
            
            {/* Top Header Badge */}
            <div className="flex items-center justify-between gap-2 pb-3 mb-4 border-b border-slate-200/80">
              <div className="flex items-center gap-2">
                <span className="text-base sm:text-lg">🎤</span>
                <span className="font-black text-sm sm:text-base text-slate-900 tracking-tight">
                  Voice to Bill
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-800 bg-emerald-100/80 border border-emerald-300/60 px-2.5 py-0.5 rounded-full">
                <Languages className="w-3.5 h-3.5 text-emerald-600" />
                <span>12 Indian Languages</span>
              </div>
            </div>

            {/* TWO Language Selectors */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 w-full text-left mb-5">
              
              {/* 🗣️ Language I Speak */}
              <div className="space-y-1.5">
                <label 
                  htmlFor="spoken-lang-dropdown"
                  className="text-xs sm:text-sm font-extrabold text-slate-800 flex items-center gap-1.5"
                >
                  <span className="text-sm">🗣️</span>
                  <span>Language I Speak</span>
                </label>
                <div className="relative">
                  <select
                    id="spoken-lang-dropdown"
                    value={spokenLanguage}
                    onChange={(e) => handleSelectSpokenLanguage(e.target.value as VoiceLanguageKey)}
                    className="w-full pl-3.5 pr-8 py-2.5 bg-white border-2 border-emerald-200 hover:border-emerald-400 focus:border-emerald-600 rounded-xl text-xs sm:text-sm font-bold text-slate-900 shadow-2xs focus:outline-none focus:ring-2 focus:ring-emerald-500/20 cursor-pointer appearance-none transition-all"
                  >
                    {VOICE_LANGUAGES_LIST.map((lang) => (
                      <option key={lang.key} value={lang.key}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-500">
                    <ChevronDown className="w-4 h-4" />
                  </div>
                </div>
                <p className="text-[10px] sm:text-[11px] text-slate-500 font-medium">
                  Voice input language
                </p>
              </div>

              {/* 📝 Show Bill In */}
              <div className="space-y-1.5">
                <label 
                  htmlFor="display-lang-dropdown"
                  className="text-xs sm:text-sm font-extrabold text-slate-800 flex items-center gap-1.5"
                >
                  <span className="text-sm">📝</span>
                  <span>Show Bill In</span>
                </label>
                <div className="relative">
                  <select
                    id="display-lang-dropdown"
                    value={displayLanguage}
                    onChange={(e) => setDisplayLanguage(e.target.value as VoiceLanguageKey)}
                    className="w-full pl-3.5 pr-8 py-2.5 bg-white border-2 border-teal-200 hover:border-teal-400 focus:border-teal-600 rounded-xl text-xs sm:text-sm font-bold text-slate-900 shadow-2xs focus:outline-none focus:ring-2 focus:ring-teal-500/20 cursor-pointer appearance-none transition-all"
                  >
                    {VOICE_LANGUAGES_LIST.map((lang) => (
                      <option key={lang.key} value={lang.key}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-500">
                    <ChevronDown className="w-4 h-4" />
                  </div>
                </div>
                <p className="text-[10px] sm:text-[11px] text-slate-500 font-medium">
                  Generated bill display language
                </p>
              </div>

            </div>

            {/* Prominent Voice-to-Bill Button */}
            <div className="flex flex-col items-center justify-center pt-2">
              
              <div className="relative w-full flex justify-center">
                {/* Subtle soundwave ripple when recording */}
                {isRecording && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="w-full max-w-[360px] h-[80px] rounded-2xl bg-rose-500/25 animate-ping" />
                    <span className="w-full max-w-[390px] h-[95px] rounded-2xl bg-rose-400/15 animate-pulse" />
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleMainButtonClick}
                  disabled={buttonState === 'PROCESSING' || isProcessing}
                  className={`relative group w-full max-w-[340px] h-[66px] sm:h-[72px] px-6 py-4 rounded-2xl font-black text-lg sm:text-[20px] tracking-wide flex items-center justify-center gap-3 transition-all duration-200 select-none shadow-xl cursor-pointer ${
                    buttonState === 'LISTENING'
                      ? 'bg-gradient-to-r from-rose-600 via-red-600 to-rose-700 text-white shadow-rose-600/40 ring-4 ring-rose-200 active:scale-[0.97]'
                      : buttonState === 'PROCESSING'
                      ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white opacity-90 cursor-not-allowed shadow-amber-500/20'
                      : buttonState === 'SUCCESS'
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-emerald-600/40 ring-4 ring-emerald-200'
                      : buttonState === 'ERROR'
                      ? 'bg-gradient-to-r from-rose-500 via-rose-600 to-amber-600 text-white shadow-rose-500/30 hover:scale-[1.02] active:scale-[0.97]'
                      : 'bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-600/35 hover:shadow-2xl hover:shadow-emerald-500/50 hover:scale-[1.02] active:scale-[0.97] ring-4 ring-emerald-100'
                  }`}
                  aria-label="Voice-to-Bill primary action button"
                >
                  {/* Dynamic Visual States */}
                  {buttonState === 'LISTENING' ? (
                    <>
                      <span className="relative flex h-5 w-5 sm:h-6 sm:w-6 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-5 w-5 sm:h-6 sm:w-6 bg-white flex items-center justify-center text-rose-600 font-black text-xs">
                          🔴
                        </span>
                      </span>
                      <span>LISTENING...</span>
                    </>
                  ) : buttonState === 'PROCESSING' ? (
                    <>
                      <RefreshCw className="w-6 h-6 sm:w-7 sm:h-7 animate-spin shrink-0 text-white" />
                      <span>PROCESSING...</span>
                    </>
                  ) : buttonState === 'SUCCESS' ? (
                    <>
                      <CheckCircle2 className="w-6 h-6 sm:w-7 sm:h-7 shrink-0 text-white" />
                      <span>✓ BILL GENERATED</span>
                    </>
                  ) : buttonState === 'ERROR' ? (
                    <>
                      <AlertTriangle className="w-6 h-6 sm:w-7 sm:h-7 shrink-0 text-white" />
                      <span>⚠️ TRY AGAIN</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-6 h-6 sm:w-7 sm:h-7 shrink-0 drop-shadow-sm transition-transform group-hover:scale-110" />
                      <span>🎙️ START SPEAKING</span>
                    </>
                  )}
                </button>
              </div>

              {/* Status & Guidance Subtext */}
              <div className="mt-3 text-center w-full">
                {isRecording ? (
                  <div className="space-y-2">
                    <p className="text-xs sm:text-sm font-black text-rose-600 animate-pulse flex items-center justify-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-rose-600" />
                      Listening in {VOICE_LANGUAGES[spokenLanguage]?.name}... Speak continuously ({recordingSeconds}s)
                    </p>

                    {/* Live streaming interim speech bubble */}
                    {interimTranscript && (
                      <div className="mx-auto max-w-md bg-slate-900 text-white rounded-2xl p-3 shadow-lg border border-slate-700 text-left animate-in fade-in">
                        <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold mb-1">
                          <span className="flex items-center gap-1 text-emerald-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                            Live Speech Stream
                          </span>
                          <span>Auto-commits on pause</span>
                        </div>
                        <p className="text-xs sm:text-sm font-semibold text-emerald-300 italic">
                          &ldquo;{interimTranscript}&rdquo;
                          <span className="inline-block w-1.5 h-3 bg-emerald-400 ml-1 animate-pulse" />
                        </p>

                        {/* Real-time detected items chips */}
                        {livePreviewItems.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-slate-700/80 flex flex-wrap gap-1.5 items-center">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Detected:</span>
                            {livePreviewItems.map((item, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center gap-1 text-[11px] font-black bg-emerald-950 text-emerald-300 border border-emerald-500/50 px-2 py-0.5 rounded-lg"
                              >
                                <span>{item.quantity}×</span>
                                <span>{item.name}</span>
                                {item.price !== undefined && item.price > 0 && (
                                  <span className="text-emerald-400 font-semibold">(₹{item.price})</span>
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
                        className="mt-1 text-xs font-bold text-slate-700 bg-white border border-slate-300 px-3.5 py-1.5 rounded-full hover:bg-slate-50 cursor-pointer shadow-2xs transition-all active:scale-95"
                      >
                        ✓ Done Speaking (Process Now)
                      </button>
                    </div>
                  </div>
                ) : isProcessing ? (
                  <p className="text-xs sm:text-sm font-black text-amber-700 flex items-center justify-center gap-1.5">
                    Analyzing voice and extracting items...
                  </p>
                ) : (
                  <p className="text-xs text-slate-500 font-medium">
                    Speak items naturally in {VOICE_LANGUAGES[spokenLanguage]?.name} (e.g. &ldquo;రెండు కిలోల బియ్యం నూట ఇరవై రూపాయలు&rdquo;)
                  </p>
                )}
              </div>

            </div>

          </div>

          {/* Transcript Display Card */}
          {transcript && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase text-slate-500 tracking-wider flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5 text-slate-500" />
                  {getLocalizedBillLabel('speechTranscript', displayLanguage)}
                </span>
                <button
                  type="button"
                  onClick={() => setIsEditingTranscript(!isEditingTranscript)}
                  className="text-xs font-bold text-emerald-700 hover:underline cursor-pointer"
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
                    className="flex-1 px-3 py-1.5 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium bg-white"
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
                <p className="text-sm font-bold text-slate-800 italic bg-white p-2.5 rounded-xl border border-slate-200/60">
                  &ldquo;{transcript}&rdquo;
                </p>
              )}
            </div>
          )}

          {/* Ambiguity Resolution Section */}
          {ambiguousItems.length > 0 && (
            <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-amber-900 font-black text-xs uppercase tracking-wide">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span>Multiple Matches Detected — Please Select Product</span>
              </div>

              {ambiguousItems.map((amb, ambIdx) => (
                <div key={ambIdx} className="bg-white rounded-xl p-3 border border-amber-200 space-y-2">
                  <p className="text-xs font-extrabold text-slate-800">
                    Which <span className="text-amber-800">&ldquo;{amb.queried_name}&rdquo;</span> did you mean? (Qty: {amb.quantity})
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {amb.candidates.map((cand) => (
                      <button
                        key={cand.id}
                        type="button"
                        onClick={() => handleResolveAmbiguity(ambIdx, cand)}
                        className="p-2.5 text-left rounded-xl border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/50 transition-all cursor-pointer flex flex-col justify-between group active:scale-95"
                      >
                        <p className="text-xs font-extrabold text-slate-900 group-hover:text-emerald-800 truncate">
                          {getLocalizedItemName(cand.name, displayLanguage)}
                        </p>
                        <div className="flex items-center justify-between mt-1 text-[11px] font-bold">
                          <span className="text-emerald-700">₹{cand.selling_price}</span>
                          <span className="text-slate-400 font-medium">
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
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3.5 space-y-2">
              <div className="flex items-center gap-2 text-rose-800 font-black text-xs uppercase tracking-wide">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                <span>Items Not Found in Inventory</span>
              </div>
              <div className="space-y-1.5">
                {unmatchedItems.map((un, unIdx) => (
                  <div key={unIdx} className="flex items-center justify-between text-xs bg-white p-2 rounded-xl border border-rose-100">
                    <span className="font-extrabold text-slate-800">
                      {un.quantity}× {un.queried_name}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-rose-600 font-medium">Not in shop catalog</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveUnmatched(unIdx)}
                        className="text-slate-400 hover:text-rose-600 font-bold cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recognized Bill Items Table - Display Localized via "Show Bill In" */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">
                {getLocalizedBillLabel('recognizedItems', displayLanguage)} ({matchedItems.length})
              </h3>
              {matchedItems.length > 0 && (
                <span className="text-xs font-extrabold text-emerald-700">
                  {getLocalizedBillLabel('subtotal', displayLanguage)}: ₹{subtotal}
                </span>
              )}
            </div>

            {matchedItems.length > 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100 shadow-2xs overflow-hidden">
                {matchedItems.map((item, idx) => (
                  <div key={idx} className="p-3.5 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-extrabold text-xs sm:text-sm text-slate-900 truncate">
                        {getLocalizedItemName(item.name, displayLanguage)}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-slate-500 font-semibold">
                          ₹{item.unit_price} / {getLocalizedUnit(item.unit, displayLanguage)}
                        </span>
                        {item.is_insufficient_stock && (
                          <span className="text-[10px] font-black text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-md">
                            Only {item.available_stock} in stock
                          </span>
                        )}
                        {item.is_out_of_stock && (
                          <span className="text-[10px] font-black text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded-md">
                            {getLocalizedBillLabel('outOfStock', displayLanguage)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Quantity Stepper [-] Qty [+] */}
                    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl shrink-0">
                      <button
                        type="button"
                        onClick={() => handleUpdateQuantity(idx, -1)}
                        className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-700 flex items-center justify-center font-bold active:scale-90 cursor-pointer"
                        aria-label="Decrease quantity"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="font-black text-xs sm:text-sm text-slate-900 w-6 text-center">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleUpdateQuantity(idx, 1)}
                        className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-700 flex items-center justify-center font-bold active:scale-90 cursor-pointer"
                        aria-label="Increase quantity"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Total Price & Delete */}
                    <div className="text-right shrink-0 min-w-[70px]">
                      <p className="text-xs sm:text-sm font-black text-emerald-700">
                        ₹{item.total_price}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleRemoveMatchedItem(idx)}
                        className="text-[11px] font-bold text-slate-400 hover:text-rose-600 mt-0.5 inline-flex items-center gap-0.5 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" /> {getLocalizedBillLabel('remove', displayLanguage)}
                      </button>
                    </div>
                  </div>
                ))}

                {/* Grand Total Summary Bar */}
                <div className="p-3.5 bg-slate-50 flex items-center justify-between border-t border-slate-200">
                  <span className="text-xs font-black uppercase text-slate-600">
                    {getLocalizedBillLabel('grandTotal', displayLanguage)}
                  </span>
                  <span className="text-xl font-black text-emerald-700">
                    ₹{total}
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
                <ShoppingCart className="w-8 h-8 mx-auto text-slate-300 mb-1" />
                <p className="text-xs font-bold text-slate-600">
                  {getLocalizedBillLabel('noItemsYet', displayLanguage)}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {getLocalizedBillLabel('speakHint', displayLanguage)}
                </p>
              </div>
            )}
          </div>

          {/* Development Voice Simulation Drawer */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-3.5 space-y-3">
            <button
              type="button"
              onClick={() => setShowDevPanel(!showDevPanel)}
              className="flex items-center justify-between w-full text-left cursor-pointer"
            >
              <div className="flex items-center gap-1.5 text-xs font-black text-slate-700">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>Multilingual Voice Simulation Presets</span>
                <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800">
                  Zero-Mic Testing
                </span>
              </div>
              <span className="text-xs font-bold text-slate-400">
                {showDevPanel ? '▲' : '▼'}
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
                      className="px-2.5 py-1.5 text-[11px] font-bold rounded-xl bg-white border border-slate-200 hover:border-emerald-500 hover:text-emerald-700 transition-all cursor-pointer active:scale-95 shadow-2xs text-left"
                      title={preset.label}
                    >
                      <span className="text-slate-400 text-[10px] mr-1">[{VOICE_LANGUAGES[preset.langKey]?.name}]:</span>
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
                    className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium bg-white"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleProcessTranscript(simulatedInput, spokenLanguage)}
                    disabled={!simulatedInput.trim() || isProcessing}
                    className="text-xs font-black px-4 rounded-xl cursor-pointer"
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
            <div className="bg-slate-900 text-slate-100 rounded-2xl border border-slate-700/80 p-3.5 space-y-2.5 font-mono text-xs shadow-inner">
              <button
                type="button"
                onClick={() => setShowDebugPanel(!showDebugPanel)}
                className="flex items-center justify-between w-full text-left cursor-pointer select-none"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-extrabold text-slate-200 uppercase tracking-wider text-[11px]">
                    VOICE DEBUG PANEL (Dev Mode)
                  </span>
                </div>
                <span className="text-[11px] font-bold text-slate-400 bg-slate-800 px-2 py-0.5 rounded-md">
                  {showDebugPanel ? '▲ Hide' : '▼ Inspect State'}
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
        <div className="px-5 py-3.5 border-t border-slate-200 bg-white flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-500 w-full sm:w-auto">
            <Info className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              {matchedItems.length} {getLocalizedBillLabel('itemsReady', displayLanguage)}
            </span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              size="md"
              onClick={onClose}
              className="flex-1 sm:flex-initial rounded-xl text-xs font-bold cursor-pointer"
            >
              {getLocalizedBillLabel('cancel', displayLanguage)}
            </Button>

            <Button
              variant="secondary"
              size="md"
              disabled={matchedItems.length === 0}
              onClick={() => handleConfirmBill(false)}
              className="flex-1 sm:flex-initial rounded-xl text-xs font-black cursor-pointer"
              icon={<ShoppingCart className="w-4 h-4" />}
            >
              {getLocalizedBillLabel('addToBill', displayLanguage)} ({matchedItems.length})
            </Button>

            <Button
              variant="primary"
              size="md"
              disabled={matchedItems.length === 0}
              onClick={() => handleConfirmBill(true)}
              className="flex-1 sm:flex-initial rounded-xl text-xs font-black shadow-md shadow-emerald-600/20 cursor-pointer"
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
