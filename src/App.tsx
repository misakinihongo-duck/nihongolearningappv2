/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  doc, 
  updateDoc, 
  deleteDoc, 
  serverTimestamp,
  getDocFromServer
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  BookOpen, 
  PenTool, 
  HelpCircle, 
  FileText, 
  LogOut, 
  Plus, 
  ChevronRight, 
  Trash2, 
  Save, 
  Eye, 
  Edit3, 
  Languages, 
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { diff_match_patch } from 'diff-match-patch';
import { cn } from './lib/utils';

// --- Types ---
interface Writing {
  id: string;
  title: string;
  content: string;
  originalContent?: string;
  correctedContent?: string;
  furiganaContent?: string;
  vocabularyList?: { word: string; reading: string; meaning: string }[];
  authorId: string;
  createdAt: any;
}

interface Quiz {
  id: string;
  topic: string;
  level: string;
  questions: {
    question: string;
    options: string[];
    answerIndex: number;
    explanation: string;
  }[];
  authorId: string;
  createdAt: any;
}

interface Article {
  id: string;
  originalUrl?: string;
  originalText?: string;
  rewrittenText: string;
  level: string;
  authorId: string;
  createdAt: any;
}

type View = 'dashboard' | 'writing-list' | 'writing-detail' | 'quiz-gen' | 'article-rewrite';

// --- Gemini Service ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const geminiModel = "gemini-3-flash-preview";

// --- Components ---

const Button = ({ 
  children, 
  onClick, 
  variant = 'primary', 
  className, 
  disabled, 
  isLoading 
}: { 
  children: React.ReactNode; 
  onClick?: () => void; 
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost'; 
  className?: string;
  disabled?: boolean;
  isLoading?: boolean;
}) => {
  const variants = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700',
    secondary: 'bg-emerald-600 text-white hover:bg-emerald-700',
    outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
    ghost: 'text-gray-600 hover:bg-gray-100'
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className={cn(
        'px-4 py-2 rounded-lg font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        className
      )}
    >
      {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
};

const Card = ({ children, className, onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) => (
  <div 
    onClick={onClick}
    className={cn('bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden', className)}
  >
    {children}
  </div>
);

const Badge = ({ children, color = 'indigo' }: { children: React.ReactNode; color?: string }) => {
  const colors: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    rose: 'bg-rose-50 text-rose-700 border-rose-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
  };
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold border', colors[color] || colors.indigo)}>
      {children}
    </span>
  );
};

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [writings, setWritings] = useState<Writing[]>([]);
  const [selectedWriting, setSelectedWriting] = useState<Writing | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Connection Test
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();
  }, []);

  // Fetch Writings
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'writings'),
      where('authorId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setWritings(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Writing)));
    }, (err) => {
      console.error("Firestore Error:", err);
    });
    return unsubscribe;
  }, [user]);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      setError("ログインに失敗しました。");
    }
  };

  const handleLogout = () => signOut(auth);

  // --- Gemini Functions ---

  const generateFurigana = async (text: string) => {
    setIsProcessing(true);
    try {
      const response = await ai.models.generateContent({
        model: geminiModel,
        contents: `以下の日本語の文章に、全ての漢字にふりがなを振ってください。HTMLの<ruby>タグ形式で出力してください。例：<ruby>漢字<rt>かんじ</rt></ruby>。文章全体をHTMLとして出力してください。\n\n${text}`,
      });
      return response.text || "";
    } catch (err) {
      console.error(err);
      return "";
    } finally {
      setIsProcessing(false);
    }
  };

  const correctWriting = async (text: string) => {
    setIsProcessing(true);
    try {
      const response = await ai.models.generateContent({
        model: geminiModel,
        contents: `あなたは日本語教師です。以下の生徒の作文を、自然な日本語に添削してください。文法の間違いや、より適切な表現があれば修正してください。修正後の文章のみを出力してください。\n\n${text}`,
      });
      return response.text || "";
    } catch (err) {
      console.error(err);
      return "";
    } finally {
      setIsProcessing(false);
    }
  };

  const extractVocabulary = async (text: string) => {
    setIsProcessing(true);
    try {
      const response = await ai.models.generateContent({
        model: geminiModel,
        contents: `以下の文章から、学習者が覚えるべき重要な単語を5〜10個抽出してください。JSON形式で出力してください。形式：[{"word": "単語", "reading": "よみがな", "meaning": "意味"}]`,
        config: { responseMimeType: "application/json" }
      });
      return JSON.parse(response.text || "[]");
    } catch (err) {
      console.error(err);
      return [];
    } finally {
      setIsProcessing(false);
    }
  };

  const generateQuiz = async (topic: string, level: string) => {
    setIsProcessing(true);
    try {
      const response = await ai.models.generateContent({
        model: geminiModel,
        contents: `トピック「${topic}」、JLPTレベル「${level}」に基づいた復習用クイズを3問作成してください。4択形式で、正解のインデックス（0-3）と解説も含めてください。JSON形式で出力してください。形式：{"questions": [{"question": "問題文", "options": ["A", "B", "C", "D"], "answerIndex": 0, "explanation": "解説"}]}`,
        config: { responseMimeType: "application/json" }
      });
      return JSON.parse(response.text || '{"questions": []}');
    } catch (err) {
      console.error(err);
      return { questions: [] };
    } finally {
      setIsProcessing(false);
    }
  };

  const rewriteArticle = async (text: string, level: string) => {
    setIsProcessing(true);
    try {
      const response = await ai.models.generateContent({
        model: geminiModel,
        contents: `以下の文章を、JLPT ${level}レベルの学習者が理解できる語彙と文法を使って、約400字の日本語にリライトしてください。元の意味を保ちつつ、易しい表現にしてください。\n\n${text}`,
      });
      return response.text || "";
    } catch (err) {
      console.error(err);
      return "";
    } finally {
      setIsProcessing(false);
    }
  };

  // --- Views ---

  const Dashboard = () => (
    <div className="space-y-8">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">こんにちは、{user?.displayName}さん</h1>
          <p className="text-gray-500">今日は何を教えますか？</p>
        </div>
        <Button variant="ghost" onClick={handleLogout}>
          <LogOut className="w-4 h-4" /> ログアウト
        </Button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6 hover:border-indigo-300 transition-colors cursor-pointer group" onClick={() => setCurrentView('writing-list')}>
          <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center mb-4 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
            <PenTool className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-bold mb-2">作文ワークスペース</h3>
          <p className="text-gray-600 text-sm">生徒の作文を管理・添削し、ふりがなを振ったり単語を抽出したりします。</p>
        </Card>

        <Card className="p-6 hover:border-emerald-300 transition-colors cursor-pointer group" onClick={() => setCurrentView('quiz-gen')}>
          <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center mb-4 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
            <HelpCircle className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-bold mb-2">クイズ生成</h3>
          <p className="text-gray-600 text-sm">特定の文法や語彙に基づいた復習用クイズを自動作成します。</p>
        </Card>

        <Card className="p-6 hover:border-amber-300 transition-colors cursor-pointer group" onClick={() => setCurrentView('article-rewrite')}>
          <div className="w-12 h-12 bg-amber-100 rounded-lg flex items-center justify-center mb-4 group-hover:bg-amber-600 group-hover:text-white transition-colors">
            <FileText className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-bold mb-2">記事リライト</h3>
          <p className="text-gray-600 text-sm">ニュース記事などをJLPTレベルに合わせて読みやすく書き換えます。</p>
        </Card>
      </div>

      <section>
        <h2 className="text-2xl font-bold mb-4">最近の作文</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {writings.slice(0, 4).map(w => (
            <Card key={w.id} className="p-4 flex justify-between items-center hover:bg-gray-50 cursor-pointer" onClick={() => { setSelectedWriting(w); setCurrentView('writing-detail'); }}>
              <div>
                <h4 className="font-bold text-gray-900">{w.title}</h4>
                <p className="text-xs text-gray-500">{new Date(w.createdAt?.toDate()).toLocaleDateString()}</p>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </Card>
          ))}
          {writings.length === 0 && <p className="text-gray-400 italic">まだ作文がありません。</p>}
        </div>
      </section>
    </div>
  );

  const WritingList = () => {
    const [newTitle, setNewTitle] = useState('');
    const [newContent, setNewContent] = useState('');
    const [isAdding, setIsAdding] = useState(false);

    const handleAdd = async () => {
      if (!newTitle || !newContent || !user) return;
      setIsAdding(true);
      try {
        await addDoc(collection(db, 'writings'), {
          title: newTitle,
          content: newContent,
          originalContent: newContent,
          authorId: user.uid,
          createdAt: serverTimestamp()
        });
        setNewTitle('');
        setNewContent('');
      } catch (err) {
        console.error(err);
      } finally {
        setIsAdding(false);
      }
    };

    return (
      <div className="space-y-6">
        <header className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => setCurrentView('dashboard')}><ArrowLeft className="w-4 h-4" /></Button>
          <h1 className="text-2xl font-bold">作文ワークスペース</h1>
        </header>

        <Card className="p-6">
          <h3 className="text-lg font-bold mb-4">新しい作文を追加</h3>
          <div className="space-y-4">
            <input 
              type="text" 
              placeholder="タイトル (例: 私の週末)" 
              className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
            />
            <textarea 
              placeholder="作文の内容を入力してください..." 
              className="w-full p-2 border rounded-lg h-32 focus:ring-2 focus:ring-indigo-500 outline-none"
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
            />
            <Button onClick={handleAdd} isLoading={isAdding} disabled={!newTitle || !newContent}>
              <Plus className="w-4 h-4" /> 保存する
            </Button>
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4">
          {writings.map(w => (
            <Card key={w.id} className="p-4 flex justify-between items-center hover:bg-gray-50 cursor-pointer" onClick={() => { setSelectedWriting(w); setCurrentView('writing-detail'); }}>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold">{w.title}</h4>
                  <p className="text-sm text-gray-500">{w.content.substring(0, 50)}...</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge color={w.correctedContent ? 'emerald' : 'amber'}>
                  {w.correctedContent ? '添削済み' : '未添削'}
                </Badge>
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  };

  const WritingDetail = () => {
    const [mode, setMode] = useState<'view' | 'edit' | 'furigana' | 'diff'>('view');
    const [editedContent, setEditedContent] = useState(selectedWriting?.content || '');
    const [isSaving, setIsSaving] = useState(false);

    if (!selectedWriting) return null;

    const handleSave = async () => {
      setIsSaving(true);
      try {
        await updateDoc(doc(db, 'writings', selectedWriting.id), {
          content: editedContent
        });
        setSelectedWriting({ ...selectedWriting, content: editedContent });
        setMode('view');
      } catch (err) {
        console.error(err);
      } finally {
        setIsSaving(false);
      }
    };

    const handleFurigana = async () => {
      if (selectedWriting.furiganaContent) {
        setMode('furigana');
        return;
      }
      const furigana = await generateFurigana(selectedWriting.content);
      await updateDoc(doc(db, 'writings', selectedWriting.id), { furiganaContent: furigana });
      setSelectedWriting({ ...selectedWriting, furiganaContent: furigana });
      setMode('furigana');
    };

    const handleCorrect = async () => {
      const corrected = await correctWriting(selectedWriting.content);
      const vocab = await extractVocabulary(selectedWriting.content);
      await updateDoc(doc(db, 'writings', selectedWriting.id), { 
        correctedContent: corrected,
        vocabularyList: vocab
      });
      setSelectedWriting({ ...selectedWriting, correctedContent: corrected, vocabularyList: vocab });
      setMode('diff');
    };

    const handleDelete = async () => {
      if (!confirm("本当に削除しますか？")) return;
      await deleteDoc(doc(db, 'writings', selectedWriting.id));
      setCurrentView('writing-list');
    };

    const DiffView = () => {
      const dmp = new diff_match_patch();
      const diffs = dmp.diff_main(selectedWriting.originalContent || selectedWriting.content, selectedWriting.correctedContent || '');
      dmp.diff_cleanupSemantic(diffs);

      return (
        <div className="p-4 bg-gray-50 rounded-lg border leading-relaxed whitespace-pre-wrap">
          {diffs.map(([type, text], i) => {
            if (type === 0) return <span key={i}>{text}</span>;
            if (type === 1) return <span key={i} className="bg-emerald-100 text-emerald-800 px-0.5 rounded underline decoration-emerald-500">{text}</span>;
            if (type === -1) return <span key={i} className="bg-rose-100 text-rose-800 px-0.5 rounded line-through decoration-rose-500">{text}</span>;
            return null;
          })}
        </div>
      );
    };

    return (
      <div className="space-y-6">
        <header className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => setCurrentView('writing-list')}><ArrowLeft className="w-4 h-4" /></Button>
            <div>
              <h1 className="text-2xl font-bold">{selectedWriting.title}</h1>
              <p className="text-sm text-gray-500">{new Date(selectedWriting.createdAt?.toDate()).toLocaleString()}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleFurigana} isLoading={isProcessing && mode === 'view'}>
              <Languages className="w-4 h-4" /> ふりがな
            </Button>
            <Button variant="secondary" onClick={handleCorrect} isLoading={isProcessing && mode === 'view'}>
              <CheckCircle2 className="w-4 h-4" /> 添削・単語抽出
            </Button>
            <Button variant="danger" onClick={handleDelete}><Trash2 className="w-4 h-4" /></Button>
          </div>
        </header>

        <div className="flex gap-2 border-b">
          <button className={cn('px-4 py-2 font-medium border-b-2 transition-colors', mode === 'view' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500')} onClick={() => setMode('view')}>閲覧</button>
          <button className={cn('px-4 py-2 font-medium border-b-2 transition-colors', mode === 'edit' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500')} onClick={() => setMode('edit')}>編集</button>
          {selectedWriting.furiganaContent && <button className={cn('px-4 py-2 font-medium border-b-2 transition-colors', mode === 'furigana' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500')} onClick={() => setMode('furigana')}>ふりがな</button>}
          {selectedWriting.correctedContent && <button className={cn('px-4 py-2 font-medium border-b-2 transition-colors', mode === 'diff' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500')} onClick={() => setMode('diff')}>添削差分</button>}
        </div>

        <Card className="p-6 min-h-[300px]">
          {mode === 'view' && <div className="whitespace-pre-wrap leading-relaxed text-lg">{selectedWriting.content}</div>}
          {mode === 'edit' && (
            <div className="space-y-4">
              <textarea 
                className="w-full h-64 p-4 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-lg"
                value={editedContent}
                onChange={e => setEditedContent(e.target.value)}
              />
              <Button onClick={handleSave} isLoading={isSaving}><Save className="w-4 h-4" /> 変更を保存</Button>
            </div>
          )}
          {mode === 'furigana' && <div className="text-xl leading-[3] furigana-content" dangerouslySetInnerHTML={{ __html: selectedWriting.furiganaContent || '' }} />}
          {mode === 'diff' && <DiffView />}
        </Card>

        {selectedWriting.vocabularyList && selectedWriting.vocabularyList.length > 0 && (
          <section className="space-y-4">
            <h3 className="text-xl font-bold flex items-center gap-2"><BookOpen className="w-5 h-5 text-indigo-600" /> 重要単語リスト</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {selectedWriting.vocabularyList.map((v, i) => (
                <Card key={i} className="p-4 bg-indigo-50 border-indigo-100">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-lg font-bold text-indigo-900">{v.word}</span>
                    <span className="text-xs text-indigo-500 font-medium">{v.reading}</span>
                  </div>
                  <p className="text-sm text-indigo-700">{v.meaning}</p>
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  };

  const QuizGenerator = () => {
    const [topic, setTopic] = useState('');
    const [level, setLevel] = useState('N3');
    const [quiz, setQuiz] = useState<Quiz | null>(null);
    const [answers, setAnswers] = useState<number[]>([]);
    const [showResults, setShowResults] = useState(false);

    const handleGenerate = async () => {
      const data = await generateQuiz(topic, level);
      setQuiz({ id: 'temp', topic, level, questions: data.questions, authorId: user?.uid || '', createdAt: new Date() });
      setAnswers(new Array(data.questions.length).fill(-1));
      setShowResults(false);
    };

    return (
      <div className="space-y-6">
        <header className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => setCurrentView('dashboard')}><ArrowLeft className="w-4 h-4" /></Button>
          <h1 className="text-2xl font-bold">パーソナライズクイズ生成</h1>
        </header>

        <Card className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">トピック（文法・語彙）</label>
              <input 
                type="text" 
                placeholder="例: 〜たほうがいい, 敬語" 
                className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500"
                value={topic}
                onChange={e => setTopic(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">JLPTレベル</label>
              <select 
                className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500"
                value={level}
                onChange={e => setLevel(e.target.value)}
              >
                {['N5', 'N4', 'N3', 'N2', 'N1'].map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>
          <Button variant="secondary" onClick={handleGenerate} isLoading={isProcessing} disabled={!topic}>
            クイズを作成する
          </Button>
        </Card>

        {quiz && (
          <div className="space-y-8">
            {quiz.questions.map((q, idx) => (
              <Card key={idx} className="p-6">
                <h3 className="text-lg font-bold mb-4">Q{idx + 1}. {q.question}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {q.options.map((opt, optIdx) => (
                    <button
                      key={optIdx}
                      disabled={showResults}
                      onClick={() => {
                        const newAnswers = [...answers];
                        newAnswers[idx] = optIdx;
                        setAnswers(newAnswers);
                      }}
                      className={cn(
                        'p-3 text-left border rounded-lg transition-all',
                        answers[idx] === optIdx ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'hover:bg-gray-50',
                        showResults && optIdx === q.answerIndex && 'bg-emerald-100 border-emerald-500',
                        showResults && answers[idx] === optIdx && optIdx !== q.answerIndex && 'bg-rose-100 border-rose-500'
                      )}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                {showResults && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-4 p-4 bg-gray-50 rounded-lg border">
                    <p className="font-bold text-sm mb-1">{answers[idx] === q.answerIndex ? '✅ 正解！' : '❌ 不正解...'}</p>
                    <p className="text-sm text-gray-600">{q.explanation}</p>
                  </motion.div>
                )}
              </Card>
            ))}
            {!showResults && <Button variant="secondary" className="w-full" onClick={() => setShowResults(true)}>答え合わせをする</Button>}
          </div>
        )}
      </div>
    );
  };

  const ArticleRewriter = () => {
    const [input, setInput] = useState('');
    const [level, setLevel] = useState('N3');
    const [result, setResult] = useState('');

    const handleRewrite = async () => {
      const rewritten = await rewriteArticle(input, level);
      setResult(rewritten);
    };

    return (
      <div className="space-y-6">
        <header className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => setCurrentView('dashboard')}><ArrowLeft className="w-4 h-4" /></Button>
          <h1 className="text-2xl font-bold">トレンド記事変換</h1>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-6 space-y-4">
            <h3 className="text-lg font-bold">元の文章 / URL</h3>
            <textarea 
              placeholder="ニュース記事の本文などを貼り付けてください..." 
              className="w-full h-64 p-4 border rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
              value={input}
              onChange={e => setInput(e.target.value)}
            />
            <div className="flex items-center gap-4">
              <select 
                className="p-2 border rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
                value={level}
                onChange={e => setLevel(e.target.value)}
              >
                {['N5', 'N4', 'N3', 'N2', 'N1'].map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              <Button variant="primary" className="bg-amber-600 hover:bg-amber-700" onClick={handleRewrite} isLoading={isProcessing} disabled={!input}>
                リライトする
              </Button>
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <h3 className="text-lg font-bold">リライト結果 ({level}レベル)</h3>
            <div className="w-full h-64 p-4 border rounded-lg bg-gray-50 overflow-y-auto whitespace-pre-wrap leading-relaxed">
              {result || <p className="text-gray-400 italic">ここに結果が表示されます。</p>}
            </div>
            {result && (
              <Button variant="outline" onClick={() => navigator.clipboard.writeText(result)}>
                コピーする
              </Button>
            )}
          </Card>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-indigo-600 p-4">
        <Card className="max-w-md w-full p-8 text-center space-y-6">
          <div className="w-20 h-20 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto">
            <Languages className="w-10 h-10" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">NIHONGO AI</h1>
            <p className="text-gray-500 mt-2">日本語教師のためのAIアシスタント</p>
          </div>
          <Button className="w-full py-3 text-lg" onClick={handleLogin}>
            Googleでログイン
          </Button>
          <p className="text-xs text-gray-400">ログインすることで利用規約に同意したことになります。</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      <nav className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setCurrentView('dashboard')}>
            <div className="w-8 h-8 bg-indigo-600 text-white rounded-lg flex items-center justify-center">
              <Languages className="w-5 h-5" />
            </div>
            <span className="font-bold text-xl tracking-tight">NIHONGO AI</span>
          </div>
          <div className="flex items-center gap-4">
            <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border" referrerPolicy="no-referrer" />
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentView}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {currentView === 'dashboard' && <Dashboard />}
            {currentView === 'writing-list' && <WritingList />}
            {currentView === 'writing-detail' && <WritingDetail />}
            {currentView === 'quiz-gen' && <QuizGenerator />}
            {currentView === 'article-rewrite' && <ArticleRewriter />}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="max-w-5xl mx-auto px-4 py-12 text-center text-gray-400 text-sm">
        &copy; 2026 NIHONGO AI Assistant. Built for Japanese Teachers.
      </footer>

      {/* Global CSS for Furigana */}
      <style dangerouslySetInnerHTML={{ __html: `
        .furigana-content ruby {
          ruby-position: over;
        }
        .furigana-content rt {
          font-size: 0.5em;
          color: #6366f1;
          user-select: none;
        }
      `}} />
    </div>
  );
}
