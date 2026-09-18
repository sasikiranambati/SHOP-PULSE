import React, { useState, useRef, useEffect } from 'react';
import { Bot, X, Send, Sparkles, User } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface ChatMessage {
  id: string;
  sender: 'bot' | 'user';
  text: string;
  time: string;
  suggestions?: string[];
}

export const AiChatBox: React.FC = () => {
  const { t, language } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const getInitialMessages = (): ChatMessage[] => [
    {
      id: 'm1',
      sender: 'bot',
      text: t('chatbot.greeting'),
      time: 'Just now',
      suggestions: [
        t('chatbot.qRestock'),
        t('chatbot.qFastest'),
        t('chatbot.qSalesToday'),
        t('chatbot.qRunningLow'),
      ],
    },
  ];

  const [messages, setMessages] = useState<ChatMessage[]>(getInitialMessages);

  // Update initial message when language changes
  useEffect(() => {
    setMessages([
      {
        id: `m_${language}`,
        sender: 'bot',
        text: t('chatbot.greeting'),
        time: 'Just now',
        suggestions: [
          t('chatbot.qRestock'),
          t('chatbot.qFastest'),
          t('chatbot.qSalesToday'),
          t('chatbot.qRunningLow'),
        ],
      },
    ]);
  }, [language]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  const handleSendMessage = (textToSend?: string) => {
    const query = textToSend || input;
    if (!query.trim()) return;

    const userMsg: ChatMessage = {
      id: `usr_${Date.now()}`,
      sender: 'user',
      text: query,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInput('');
    setIsTyping(true);

    // Multi-language AI Response dictionary generator
    setTimeout(() => {
      let botText = '';
      const qLower = query.toLowerCase();

      // Check intent (restock, top sellers, sales today)
      const isRestockIntent = qLower.includes('restock') || qLower.includes('low') || qLower.includes('کم') || qLower.includes('తక్కువ') || qLower.includes('कम') || qLower.includes('குறைவாக');
      const isTopSellerIntent = qLower.includes('fastest') || qLower.includes('top') || qLower.includes('sold') || qLower.includes('అమ్మ') || qLower.includes('बिक') || qLower.includes('விற்ற');
      const isSalesIntent = qLower.includes('sale') || qLower.includes('అమ్మకాలు') || qLower.includes('बिक्री') || qLower.includes('விற்பனை');

      // Generate response in active language
      switch (language) {
        case 'te':
          if (isRestockIntent) {
            botText = '⚠️ **రీస్టాక్ అలర్ట్**: బ్రెడ్ (12 ప్యాకెట్లు), မੈગી నూడుల్స్ (2 ప్యాకెట్లు), మరియు కోడిగుడ్లు (4 ട്രੇలు) స్టాక్ తక్కువగా ఉన్నాయి. ఈరోజు కొత్త ఆర్డర్ ఇవ్వండి.';
          } else if (isTopSellerIntent) {
            botText = '🔥 **ఎక్కువగా అమ్మినవి**: పాలు 500ml (42 అమ్మకాలు), బ్రెడ్ (31 అమ్మకాలు), ಮತ್ತು ਮاری ಗೋಲ್ಡ್ బిస్కెట్లు (26 అమ్మకాలు).';
          } else if (isSalesIntent) {
            botText = '📈 **ఈరోజు అమ్మకాల మొత్తం**: ₹8,450 (42 అమ్మకాల బిల్‌లలో). నిన్నటి కంటే 12% ఎక్కువ!';
          } else {
            botText = `మీరు అడిగిన "${query}" ని పరిశీలిస్తున్నాను. તમારા స్టాక్ వివరాలు భద్రంగా ఉన్నాయి, 3 వస్తువులకు రీస్టాక్ అవసరం.`;
          }
          break;

        case 'hi':
          if (isRestockIntent) {
            botText = '⚠️ **रीस्टॉक अलर्ट**: ब्रेड (12 बाकी), मैगी नूडल्स (2 बाकी), और अंडे (4 ट्रे) का स्टॉक कम है। आज नया ऑर्डर दें।';
          } else if (isTopSellerIntent) {
            botText = '🔥 **टॉप सेलिंग सामान**: दूध 500ml (42 बिके), ब्रेड (31 बिके), और मारी गोल्ड बिस्किट (26 बिके)।';
          } else if (isSalesIntent) {
            botText = '📈 **आज की कुल बिक्री**: ₹8,450 दर्ज हुई है। कल से 12% ज्यादा!';
          } else {
            botText = `मैं "${query}" के लिए आपकी दुकान का स्टॉक देख रहा हूँ। 3 सामानों का रीस्टॉक आवश्यक है।`;
          }
          break;

        case 'ta':
          if (isRestockIntent) {
            botText = '⚠️ **இருப்பு எச்சரிக்கை**: பிரெட், மேகி நூடுல்ஸ் மற்றும் முட்டை இருப்பு குறைவாக உள்ளது. இன்று ஆர்டர் செய்யவும்.';
          } else if (isTopSellerIntent) {
            botText = '🔥 **அதிகம் விற்றவை**: பால் (42 பாக்கெட்டுகள்), பிரெட் (31), மாரிகோல்ட் பிஸ்கட் (26).';
          } else if (isSalesIntent) {
            botText = '📈 **இன்றைய விற்பனை**: ₹8,450 (42 பில்கள்). நேற்று விட 12% அதிகம்!';
          } else {
            botText = `உங்கள் "${query}" தேடலை ஆய்வு செய்கிறேன். 3 பொருட்களுக்கு இருப்பு தேவை.`;
          }
          break;

        case 'ur':
          if (isRestockIntent) {
            botText = '⚠️ **ری اسٹاک الرٹ**: ڈبل روٹی (12 باقی)، میگی نوڈلز (2 باقی)، اور انڈے (4 ٹرے) کا اسٹاک کم ہے۔ آج نیا آرڈر دیں۔';
          } else if (isTopSellerIntent) {
            botText = '🔥 **ٹاپ فروخت شدہ اشیاء**: دودھ (42 پیکٹ)، ڈبل روٹی (31)، اور بسکٹ (26)۔';
          } else if (isSalesIntent) {
            botText = '📈 **آج کی کل فروخت**: ₹8,450 درج ہوئی ہے۔ کل سے 12٪ زیادہ!';
          } else {
            botText = `میں "${query}" کے لیے آپ کی دکان کا اسٹاک دیکھ رہا ہوں۔ 3 اشیاء کا ری اسٹاک ضروری ہے۔`;
          }
          break;

        default: // English & fallback
          if (isRestockIntent) {
            botText = '⚠️ **Restock Alert**: Fresh White Bread (12 left), Maggi Noodles (2 left), and Farm Fresh Eggs (4 trays left) are critically low. Place supplier orders today.';
          } else if (isTopSellerIntent) {
            botText = '🔥 **Top Sellers Today**: Toned Milk 500ml (42 sold), White Bread (31 sold), and Marie Gold Biscuits (26 sold). Dairy represents 42% of total store revenue.';
          } else if (isSalesIntent) {
            botText = "📈 **Today's Sales Total**: ₹8,450 collected across 42 transactions. Up 12% vs yesterday!";
          } else {
            botText = `I am analyzing inventory trends for "${query}". Your store stock levels look healthy overall, but 3 items need reordering soon.`;
          }
          break;
      }

      const botMsg: ChatMessage = {
        id: `bot_${Date.now()}`,
        sender: 'bot',
        text: botText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, botMsg]);
      setIsTyping(false);
    }, 800);
  };

  return (
    <>
      {/* Floating Toggle Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-20 md:bottom-6 right-4 z-40 bg-slate-900 hover:bg-slate-800 text-white p-3.5 rounded-full shadow-xl ring-4 ring-emerald-500/20 flex items-center gap-2.5 active:scale-95 transition-all cursor-pointer group"
          title="Open ShopPulse Assistant"
        >
          <div className="w-7 h-7 rounded-full bg-emerald-600 flex items-center justify-center text-white shrink-0 group-hover:scale-110 transition-transform">
            <Sparkles className="w-4 h-4" />
          </div>
          <span className="text-xs font-black pr-1 hidden sm:inline">Shop Assistant</span>
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
        </button>
      )}

      {/* Assistant Modal / Drawer Sheet */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-lg h-[85vh] sm:h-[620px] rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-slide-up sm:animate-fade-in">
            
            {/* Header */}
            <div className="bg-slate-900 text-white p-4 flex items-center justify-between shrink-0 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-600 flex items-center justify-center text-white shadow-sm shrink-0">
                  <Bot className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base tracking-tight flex items-center gap-1.5">
                    <span>{t('chatbot.title')}</span>
                    <span className="text-[10px] bg-emerald-500/30 text-emerald-300 px-2 py-0.5 rounded-full font-bold border border-emerald-500/40">
                      {t('chatbot.badge')}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-300 font-medium">{t('chatbot.subtitle')}</p>
                </div>
              </div>

              <button
                onClick={() => setIsOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Chat Messages Body */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3.5 bg-slate-50">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-2.5 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.sender === 'bot' && (
                    <div className="w-7 h-7 rounded-xl bg-emerald-600 text-white flex items-center justify-center text-xs shrink-0 mt-1 shadow-xs">
                      <Sparkles className="w-4 h-4" />
                    </div>
                  )}

                  <div className={`max-w-[82%] ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`p-3.5 rounded-2xl text-xs sm:text-sm font-medium leading-relaxed ${
                        msg.sender === 'user'
                          ? 'bg-emerald-600 text-white rounded-tr-xs shadow-xs'
                          : 'bg-white text-slate-800 border border-slate-200/90 rounded-tl-xs shadow-xs'
                      }`}
                    >
                      {msg.text.split('\n').map((line, i) => (
                        <p key={i} className={i > 0 ? 'mt-1.5' : ''}>{line}</p>
                      ))}
                    </div>

                    <p className={`text-[10px] text-slate-400 font-semibold mt-1 px-1 ${msg.sender === 'user' ? 'text-right' : 'text-left'}`}>
                      {msg.time}
                    </p>

                    {/* Quick Suggestion Chips */}
                    {msg.suggestions && msg.suggestions.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        <p className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">
                          {t('chatbot.suggestedHeading')}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {msg.suggestions.map((chip, idx) => (
                            <button
                              key={idx}
                              onClick={() => handleSendMessage(chip)}
                              className="text-left text-xs font-bold text-slate-700 bg-white hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 border border-slate-200 px-3 py-1.5 rounded-xl transition-all cursor-pointer shadow-2xs active:scale-95"
                            >
                              💬 {chip}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {msg.sender === 'user' && (
                    <div className="w-7 h-7 rounded-xl bg-slate-900 text-white flex items-center justify-center text-xs shrink-0 mt-1 shadow-xs">
                      <User className="w-4 h-4" />
                    </div>
                  )}
                </div>
              ))}

              {isTyping && (
                <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold p-2">
                  <div className="w-7 h-7 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
                    <Sparkles className="w-4 h-4 animate-spin" />
                  </div>
                  <div className="bg-white border border-slate-200 px-3.5 py-2 rounded-2xl flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-600 animate-bounce"></span>
                    <span className="w-2 h-2 rounded-full bg-emerald-600 animate-bounce [animation-delay:0.15s]"></span>
                    <span className="w-2 h-2 rounded-full bg-emerald-600 animate-bounce [animation-delay:0.3s]"></span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <div className="p-3 bg-white border-t border-slate-200 shrink-0">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  placeholder={t('chatbot.placeholder')}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs sm:text-sm font-medium bg-slate-50 focus:bg-white"
                />
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="w-10 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>

          </div>
        </div>
      )}
    </>
  );
};
