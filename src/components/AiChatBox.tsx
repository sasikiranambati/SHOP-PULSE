/**
 * Shelfora business assistant (floating chat).
 *
 * Answers come only from the shop's own records through the existing Insights APIs, via the
 * deterministic pipeline in utils/assistant (intent -> data -> formatted answer). There are no
 * canned replies: a failed request shows an error with a retry button, never sample figures.
 */
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Bot, Database, MessageSquare, RotateCcw, Send, Sparkles, Trash2, User, X } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { useDialog } from '../hooks/useDialog';
import { useShopRole } from '../hooks/useShopRole';
import { answerIntent } from '../utils/assistant/engine';
import { detectIntent } from '../utils/assistant/intents';
import { SUGGESTIONS } from '../utils/assistant/format';
import type { AnswerTone, AssistantAnswer, AssistantIntent, AssistantSuggestion } from '../utils/assistant/types';

interface ChatMessage {
  id: string;
  sender: 'bot' | 'user';
  time: string;
  text?: string;
  answer?: AssistantAnswer;
  /** The intent a bot answer was produced for (used by "Try again"). */
  intent?: AssistantIntent;
}

const TONE_DOT: Record<AnswerTone, string> = {
  critical: 'bg-[#B93838]',
  warning: 'bg-[#D6AE62]',
  positive: 'bg-[#23866A]',
  neutral: 'bg-[#83958A]',
};

const nowLabel = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
let messageCounter = 0;
const nextId = (prefix: string) => `${prefix}_${Date.now()}_${++messageCounter}`;

interface ChipProps {
  suggestion: AssistantSuggestion;
  disabled?: boolean;
  onPick: (s: AssistantSuggestion) => void;
}

const SuggestionChip: React.FC<ChipProps> = ({ suggestion, disabled, onPick }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={() => onPick(suggestion)}
    className="text-left text-xs font-semibold text-[#252D29] bg-white hover:bg-[#E7F3EE] hover:text-[#153D32] hover:border-[#52745D]/40 border border-[#DDE9DF] px-2.5 py-1.5 rounded-lg transition-all cursor-pointer shadow-2xs active:scale-95 flex items-center gap-1.5 min-h-[36px] disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[#153D32]/40"
  >
    <MessageSquare className="w-3 h-3 text-[#5E6C64] shrink-0" aria-hidden="true" />
    <span>{suggestion.label}</span>
  </button>
);

interface AnswerViewProps {
  answer: AssistantAnswer;
  busy?: boolean;
  retryLabel: string;
  onPick: (s: AssistantSuggestion) => void;
  onRetry?: () => void;
}

/** Renders one structured answer. Exported for tests. */
export const AssistantAnswerView: React.FC<AnswerViewProps> = ({ answer, busy, retryLabel, onPick, onRetry }) => {
  const isError = answer.kind === 'error' || answer.kind === 'restricted';
  return (
    <div data-testid="assistant-answer" data-kind={answer.kind} className="space-y-2">
      <p className={`font-bold ${isError ? 'text-[#B93838]' : 'text-[#153D32]'}`}>{answer.title}</p>
      {answer.lines.map((line, i) => (
        <p key={`l${i}`}>{line}</p>
      ))}
      {answer.items.length > 0 && (
        <ul className="space-y-1.5" data-testid="assistant-items">
          {answer.items.map((item, i) => (
            <li key={`i${i}`} className="flex gap-2">
              <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${TONE_DOT[item.tone ?? 'neutral']}`} aria-hidden="true" />
              <span className="min-w-0">
                <span className="font-semibold break-words">{item.primary}</span>
                {item.secondary && <span className="block text-[11px] sm:text-xs text-[#5E6C64] break-words">{item.secondary}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {answer.warnings.length > 0 && (
        <div className="rounded-lg border border-[#D6AE62]/40 bg-[#FEF9EB] p-2 space-y-1" data-testid="assistant-warnings">
          {answer.warnings.map((w, i) => (
            <p key={`w${i}`} className="flex gap-1.5 text-[11px] sm:text-xs text-[#7A5A1C]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{w}</span>
            </p>
          ))}
        </div>
      )}
      {answer.source && (
        <p className="flex items-center gap-1 text-[10px] sm:text-[11px] text-[#5E6C64] font-semibold" data-testid="assistant-source">
          <Database className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span>{answer.source}</span>
        </p>
      )}
      {answer.retryable && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-[#153D32] hover:bg-[#0F2D25] px-3 py-1.5 rounded-lg min-h-[36px] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          {retryLabel}
        </button>
      )}
      {answer.followUps.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {answer.followUps.map((f) => (
            <SuggestionChip key={f.id} suggestion={f} disabled={busy} onPick={onPick} />
          ))}
        </div>
      )}
    </div>
  );
};

export interface AiChatBoxProps {
  /** Start with the panel open (used by tests). */
  defaultOpen?: boolean;
}

export const AiChatBox: React.FC<AiChatBoxProps> = ({ defaultOpen = false }) => {
  const { t, language } = useLanguage();
  const { canAccessAnalytics, loading: roleLoading } = useShopRole();
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasCart, setHasCart] = useState(false);
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  /** Bumped on "clear": answers to requests from before the clear are dropped. */
  const conversationRef = useRef(0);
  const pendingRef = useRef(false);

  const panelRef = useDialog<HTMLDivElement>({
    isOpen,
    onClose: () => setIsOpen(false),
    initialFocusRef: inputRef,
  });

  // Localised starter questions; each carries its intent, so routing never depends on the language
  const starters: AssistantSuggestion[] = canAccessAnalytics
    ? [
        { ...SUGGESTIONS.salesToday, label: t('chatbot.qSalesToday') },
        { ...SUGGESTIONS.topSellers, label: t('chatbot.qFastest') },
        { ...SUGGESTIONS.lowStock, label: t('chatbot.qRunningLow') },
        { ...SUGGESTIONS.reorder, label: t('chatbot.qRestock') },
        { ...SUGGESTIONS.runout, label: t('chatbot.qRunout') },
        { ...SUGGESTIONS.summary, label: t('chatbot.qSummary') },
      ]
    : [];

  const run = useCallback(
    async (intent: AssistantIntent) => {
      const conversation = conversationRef.current;
      pendingRef.current = true;
      setPending(true);
      const answer = await answerIntent(intent, { canAccessAnalytics });
      if (conversation !== conversationRef.current) return; // conversation was cleared meanwhile
      pendingRef.current = false;
      setPending(false);
      setMessages((prev) => [...prev, { id: nextId('bot'), sender: 'bot', time: nowLabel(), answer, intent }]);
    },
    [canAccessAnalytics]
  );

  const ask = (text: string, intent?: AssistantIntent) => {
    const question = text.trim();
    if (!question || pendingRef.current) return;
    nearBottomRef.current = true; // the user just asked: follow the conversation
    setMessages((prev) => [...prev, { id: nextId('usr'), sender: 'user', time: nowLabel(), text: question }]);
    setInput('');
    void run(intent ?? detectIntent(question));
  };

  const pick = (s: AssistantSuggestion) => ask(s.label, s.intent);

  const retry = (msg: ChatMessage) => {
    if (!msg.intent || pendingRef.current) return;
    nearBottomRef.current = true;
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    void run(msg.intent);
  };

  const clear = () => {
    conversationRef.current += 1;
    pendingRef.current = false;
    setPending(false);
    setMessages([]);
    setInput('');
    inputRef.current?.focus();
  };

  // Keep the newest message in view only when the user is already at the bottom (or just asked)
  useEffect(() => {
    const el = scrollRef.current;
    if (!isOpen || !el || !nearBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, pending, isOpen]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  // Detect mobile cart presence so the floating trigger smoothly elevates above the cart bar
  useEffect(() => {
    const checkCart = () => {
      setHasCart(document.body.getAttribute('data-mobile-cart-active') === 'true');
    };
    checkCart();
    const observer = new MutationObserver(checkCart);
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-mobile-cart-active'] });
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {/* Floating Toggle Button */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Open Shelfora Assistant"
          className={`fixed ${
            hasCart
              ? 'bottom-[calc(8.75rem+env(safe-area-inset-bottom,0px))]'
              : 'bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))]'
          } md:bottom-6 right-3.5 sm:right-4 z-30 bg-[#153D32] hover:bg-[#0F2D25] text-white p-2.5 sm:p-3.5 rounded-full shadow-lg ring-4 ring-[#153D32]/20 flex items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer group min-h-[44px] min-w-[44px]`}
          title="Open Shelfora Assistant"
        >
          <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#0F2D25] flex items-center justify-center text-white shrink-0 group-hover:scale-110 transition-transform">
            <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-300" aria-hidden="true" />
          </div>
          <span className="text-xs font-bold pr-1 hidden sm:inline">Shop Assistant</span>
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true"></span>
        </button>
      )}

      {/* Assistant Modal / Drawer Sheet */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs"
          onClick={() => setIsOpen(false)}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="bg-white w-full max-w-lg h-[88vh] h-[88dvh] sm:h-[620px] rounded-t-2xl sm:rounded-xl shadow-xl border border-[#DDE9DF] flex flex-col overflow-hidden animate-slide-up sm:animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-[#153D32] text-white p-3 sm:p-4 flex items-center justify-between gap-2 shrink-0 border-b border-[#0F2D25]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[#0F2D25] flex items-center justify-center text-white shadow-sm shrink-0 border border-white/10">
                  <Bot className="w-6 h-6 text-emerald-300" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 id={titleId} className="font-bold text-base tracking-tight flex items-center gap-1.5 flex-wrap">
                    <span>{t('chatbot.title')}</span>
                    <span className="text-[10px] bg-white/20 text-emerald-100 px-2 py-0.5 rounded-full font-bold border border-white/20 inline-flex items-center gap-1">
                      <Database className="w-3 h-3" aria-hidden="true" />
                      {t('chatbot.dataBadge')}
                    </span>
                  </h2>
                  <p className="text-xs text-emerald-100 font-medium truncate">{t('chatbot.subtitle')}</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={clear}
                  disabled={messages.length === 0 && !pending}
                  aria-label={t('chatbot.clearChat')}
                  title={t('chatbot.clearChat')}
                  className="w-10 h-10 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer min-h-[40px] min-w-[40px] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close assistant"
                  className="w-10 h-10 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer min-h-[40px] min-w-[40px]"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Conversation */}
            <div
              ref={scrollRef}
              onScroll={onScroll}
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              aria-busy={pending}
              className="flex-1 p-3.5 sm:p-4 overflow-y-auto space-y-3.5 bg-[#F8FAFC] overscroll-contain"
            >
              {messages.length === 0 && (
                <div data-testid="assistant-empty" className="space-y-3">
                  <div className="bg-white text-[#252D29] border border-[#DDE9DF] rounded-xl p-3 sm:p-3.5 text-xs sm:text-sm font-medium leading-relaxed shadow-xs space-y-1.5">
                    <p>{t('chatbot.greeting')}</p>
                    <p className="flex items-start gap-1.5 text-[11px] sm:text-xs text-[#5E6C64] font-semibold">
                      <Database className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{t('chatbot.dataNote')}</span>
                    </p>
                    {language !== 'en' && <p className="text-[11px] sm:text-xs text-[#5E6C64]">{t('chatbot.englishNote')}</p>}
                    {!roleLoading && !canAccessAnalytics && (
                      <p data-testid="assistant-restricted-note" className="text-[11px] sm:text-xs text-[#B93838] font-semibold">
                        {t('chatbot.restrictedNote')}
                      </p>
                    )}
                  </div>
                  {starters.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-bold text-[#5E6C64] uppercase tracking-wider">{t('chatbot.suggestedHeading')}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {starters.map((s) => (
                          <SuggestionChip key={s.id} suggestion={s} disabled={pending} onPick={pick} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {messages.map((msg) => (
                <div key={msg.id} className={`flex gap-2.5 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.sender === 'bot' && (
                    <div className="w-7 h-7 rounded-lg bg-[#153D32] text-white flex items-center justify-center text-xs shrink-0 mt-1 shadow-xs">
                      <Sparkles className="w-4 h-4" aria-hidden="true" />
                    </div>
                  )}
                  <div className={`max-w-[85%] sm:max-w-[82%] min-w-0 ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`p-3 sm:p-3.5 rounded-xl text-xs sm:text-sm font-medium leading-relaxed break-words ${
                        msg.sender === 'user'
                          ? 'bg-[#153D32] text-white rounded-tr-xs shadow-xs'
                          : 'bg-white text-[#252D29] border border-[#DDE9DF] rounded-tl-xs shadow-xs'
                      }`}
                    >
                      {msg.answer ? (
                        <AssistantAnswerView
                          answer={msg.answer}
                          busy={pending}
                          retryLabel={t('chatbot.retry')}
                          onPick={pick}
                          onRetry={() => retry(msg)}
                        />
                      ) : (
                        <p>{msg.text}</p>
                      )}
                    </div>
                    <p className={`text-[10px] text-[#5E6C64] font-semibold mt-1 px-1 ${msg.sender === 'user' ? 'text-right' : 'text-left'}`}>
                      {msg.time}
                    </p>
                  </div>
                  {msg.sender === 'user' && (
                    <div className="w-7 h-7 rounded-lg bg-[#252D29] text-white flex items-center justify-center text-xs shrink-0 mt-1 shadow-xs">
                      <User className="w-4 h-4" aria-hidden="true" />
                    </div>
                  )}
                </div>
              ))}

              {pending && (
                <div className="flex items-center gap-2 text-[#5E6C64] text-xs font-semibold p-2" data-testid="assistant-loading">
                  <div className="w-7 h-7 rounded-lg bg-[#153D32] text-white flex items-center justify-center">
                    <Database className="w-4 h-4 animate-pulse" aria-hidden="true" />
                  </div>
                  <span className="bg-white border border-[#DDE9DF] px-3.5 py-2 rounded-xl">{t('chatbot.checking')}</span>
                </div>
              )}
            </div>

            {/* Input Bar with safe-area-inset-bottom */}
            <div className="p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] bg-white border-t border-[#DDE9DF] shrink-0">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  ask(input);
                }}
                className="flex items-center gap-2"
              >
                <input
                  ref={inputRef}
                  type="text"
                  placeholder={t('chatbot.placeholder')}
                  aria-label={t('chatbot.placeholder')}
                  value={input}
                  maxLength={300}
                  onChange={(e) => setInput(e.target.value)}
                  className="flex-1 min-w-0 px-4 py-2.5 rounded-lg border border-[#DDE9DF] focus:outline-none focus:ring-2 focus:ring-[#153D32]/20 focus:border-[#153D32] text-base sm:text-sm font-medium bg-[#FAF8F2] focus:bg-white text-[#252D29]"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || pending}
                  aria-label="Send message"
                  className="w-10 h-10 rounded-lg bg-[#153D32] hover:bg-[#0F2D25] text-white flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0 min-h-[40px] min-w-[40px]"
                >
                  <Send className="w-4 h-4" aria-hidden="true" />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
