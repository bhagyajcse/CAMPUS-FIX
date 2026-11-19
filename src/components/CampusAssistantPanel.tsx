import { useState, useRef, type FormEvent } from 'react';
import { Send, Mic, MicOff, ArrowRight, Loader2 } from 'lucide-react';
import { apiFetch } from '../lib/api';

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

interface PrefillPayload {
  block: string;
  floor: string;
  room: string;
  category: string;
  description: string;
}

interface CampusAssistantPanelProps {
  onApplyPrefill: (prefill: PrefillPayload) => void;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

const EXAMPLE_PROMPTS = [
  'The fan in Block A, 2nd floor, room 204 is making a loud wobbling noise.',
  'There is a sparking electrical wire near the switchboard in Block C 101.',
  'Washroom tap is leaking on 2nd floor east wing of Block A.',
];

export function CampusAssistantPanel({ onApplyPrefill }: CampusAssistantPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: 'Describe any campus facility issue (for example: "The projector in Block A 204 is not turning on") and I will identify the location, check safety urgency, and prepare your maintenance request.',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const [prefill, setPrefill] = useState<PrefillPayload | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  async function sendMessage(textToSend: string) {
    const trimmed = textToSend.trim();
    if (!trimmed || loading) return;

    const nextHistory: Message[] = [...messages, { role: 'user', text: trimmed }];
    setMessages(nextHistory);
    setInput('');
    setLoading(true);
    setError('');

    try {
      const res = await apiFetch<{
        reply: string;
        readyToPrefill: boolean;
        prefill: PrefillPayload;
      }>('/api/agent/assistant', {
        method: 'POST',
        body: JSON.stringify({ history: nextHistory }),
      });

      setMessages((prev) => [...prev, { role: 'assistant', text: res.reply }]);
      if (res.readyToPrefill && res.prefill.description) {
        setPrefill(res.prefill);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assistant error.');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  function toggleVoice() {
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      setError('Speech recognition is not supported in this browser.');
      return;
    }
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }
    const rec = new SpeechRec();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      const spoken = event.results[0]?.[0]?.transcript || '';
      if (spoken) setInput((prev) => (prev ? `${prev} ${spoken}` : spoken));
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl flex flex-col h-[580px]">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">AI Campus Assistant</h2>
            <p className="text-xs text-slate-500">Conversational or voice-assisted maintenance intake</p>
          </div>
          {prefill && (
            <button
              type="button"
              onClick={() => onApplyPrefill(prefill)}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              Open in Complaint Form
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-900 border border-slate-200'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-xl px-4 py-3 bg-slate-100 border border-slate-200 text-xs text-slate-600 inline-flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                Analyzing request...
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mx-6 mb-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-4 border-t border-slate-200 flex items-center gap-2">
          <button
            type="button"
            onClick={toggleVoice}
            aria-label={listening ? 'Stop voice input' : 'Start voice input'}
            className={`p-2.5 rounded-lg border transition-colors ${
              listening
                ? 'bg-red-50 border-red-300 text-red-700'
                : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
            }`}
          >
            {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe the facility problem and location..."
            className="flex-1 px-3.5 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:border-blue-600"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium rounded-lg inline-flex items-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" />
            Send
          </button>
        </form>
      </div>

      <div className="lg:col-span-4 space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Try Sample Queries</h3>
          <div className="space-y-2">
            {EXAMPLE_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => sendMessage(p)}
                className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-blue-600 hover:bg-blue-50/40 text-xs text-slate-700 transition-colors"
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {prefill && (
          <div className="bg-white border border-blue-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-blue-950">Extracted Complaint Draft</h3>
            <div className="text-xs space-y-1.5 text-slate-700">
              <p>
                <span className="text-slate-500">Category:</span> {prefill.category || 'Pending Vision'}
              </p>
              <p>
                <span className="text-slate-500">Location:</span>{' '}
                {[prefill.block, prefill.floor, prefill.room].filter(Boolean).join(' · ') || 'Ask user'}
              </p>
              <p className="text-slate-600">{prefill.description}</p>
            </div>
            <button
              type="button"
              onClick={() => onApplyPrefill(prefill)}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg"
            >
              Pre-fill Complaint Submission
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
