"use client";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import Editor, { useMonaco } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import CustomScrollbar from "@/components/shared/CustomScrollbar";
import {
  showSuccessToast,
  showErrorToast,
  showInfoToast,
} from "@/components/shared/CustomToast";
import {
  Save,
  CheckCircle,
  AlertTriangle,
  Lightbulb,
  RotateCcw,
  Play,
  ChevronLeft,
  ChevronRight,
  Lock,
  Swords,
} from "lucide-react";
import HackModal from "@/components/shared/HackModal";
import SecureWrapper from "@/components/shared/SecureWrapper";

// --- Interfaces ---
interface Problem {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  constraints: string[];
  boilerplate: { [key: string]: string };
  sampleTestCases: TestCase[];
  hints: string[];
}

interface HackableSubmission {
  userId: string;
  code: string;
  language: string;
}

interface TestCase {
  stdin?: string;
  expected_output?: string;
  input?: { stdin?: string; json?: unknown };
  output?: { stdout?: string; json?: unknown };
  explanation?: string;
}

interface SubmissionResult {
  token: string;
  status: { id: number; description: string };
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  time: string | null;
  memory: string | null;
  passed?: boolean;
}

interface CodePageProps {
  round: string;
  currentProblem: Problem | null;
  problems: Problem[];
  currentProblemIndex: number;
  timeRemaining: number;
  isLoading: boolean;
  isHackingPhase: boolean;
  lockedQuestionIds: string[];
  hackableSubmissions: { [key: string]: HackableSubmission[] };
  onQuestionSelect: (index: number) => void;
  onLockQuestion: (questionId: string) => void;
  onHackAttempt: (payload: {
    questionId: string;
    testCase: string;
    targetSubmission: HackableSubmission;
  }) => void;
  onReturnToLobby?: () => void;
}

interface CodeContext {
  round: string;
  questionId: string;
  language: string;
}

interface CodeStore {
  [contextKey: string]: string;
}

// ============================================================================
// --- MAIN COMPONENT ---
// ============================================================================
export default function CodePage({
  round,
  currentProblem,
  problems,
  currentProblemIndex,
  timeRemaining,
  isLoading,
  isHackingPhase,
  lockedQuestionIds,
  hackableSubmissions,
  onQuestionSelect,
  onLockQuestion,
  onHackAttempt,
}: CodePageProps) {
  const { session } = useAuth();

  const [code, setCode] = useState("");
  const [language, setLanguage] = useState(() => {
    try {
      return localStorage.getItem("battlecode-round-3-language") || "python";
    } catch {
      return "python";
    }
  });
  const [hasSubmittedCurrent, setHasSubmittedCurrent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [submissionResults, setSubmissionResults] = useState<
    SubmissionResult[] | null
  >(null);
  const [showHints, setShowHints] = useState(false);
  const [activeTab, setActiveTab] = useState<"testcases" | "results">(
    "testcases",
  );
  const [codeEditorHeight, setCodeEditorHeight] = useState(60);
  const [isDragging, setIsDragging] = useState(false);
  const [currentContext, setCurrentContext] = useState<CodeContext | null>(
    null,
  );
  const [codeStore, setCodeStore] = useState<CodeStore>({});
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [isContextInitialized, setIsContextInitialized] = useState(false);
  const [isHackModalOpen, setIsHackModalOpen] = useState(false);

  const codeRef = useRef(code);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    codeRef.current = code;
  }, [code]);
  useEffect(() => {
    localStorage.setItem(`battlecode-round-${round}-language`, language);
  }, [language, round]);

  const isLocked = useMemo(
    () => lockedQuestionIds.includes(currentProblem?.id || ""),
    [lockedQuestionIds, currentProblem],
  );

  const contextManager = useMemo(
    () => ({
      getStorageKey: (r: string) => `battlecode-round-${r}-code-store`,
      generateContextKey: (r: string, qId: string, lang: string) =>
        `${r}:${qId}:${lang}`,
      loadCodeStore: (r: string): CodeStore => {
        try {
          const stored = localStorage.getItem(contextManager.getStorageKey(r));
          return stored ? JSON.parse(stored) : {};
        } catch {
          return {};
        }
      },
      saveCodeStore: (r: string, store: CodeStore) => {
        try {
          localStorage.setItem(
            contextManager.getStorageKey(r),
            JSON.stringify(store),
          );
          return true;
        } catch {
          return false;
        }
      },
      getBoilerplate: (p: Problem | null, lang: string) =>
        p?.boilerplate?.[lang] || "",
      createContext: (r: string, qId: string, lang: string) => ({
        round: r,
        questionId: qId,
        language: lang,
      }),
      contextEquals: (a: CodeContext | null, b: CodeContext | null) =>
        a &&
        b &&
        a.round === b.round &&
        a.questionId === b.questionId &&
        a.language === b.language,
      getCodeForContext: (store: CodeStore, context: CodeContext) =>
        store[
          contextManager.generateContextKey(
            context.round,
            context.questionId,
            context.language,
          )
        ] || "",
      setCodeForContext: (
        store: CodeStore,
        context: CodeContext,
        newCode: string,
      ) => {
        const key = contextManager.generateContextKey(
          context.round,
          context.questionId,
          context.language,
        );
        return { ...store, [key]: newCode };
      },
      removeCodeForContext: (
        store: CodeStore,
        context: CodeContext,
      ): CodeStore => {
        const key = contextManager.generateContextKey(
          context.round,
          context.questionId,
          context.language,
        );
        const newStore = { ...store };
        delete newStore[key];
        return newStore;
      },
    }),
    [],
  );

  const scheduleAutoSave = useCallback(() => {
    if (isLocked || !currentContext || !codeRef.current) return;
    const codeToSave = codeRef.current;
    const boilerplate = contextManager.getBoilerplate(
      currentProblem,
      currentContext.language,
    );
    if (codeToSave === boilerplate) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    setSaveStatus("saving");
    saveTimeoutRef.current = setTimeout(() => {
      setCodeStore((prev) => {
        const updatedStore = contextManager.setCodeForContext(
          prev,
          currentContext,
          codeToSave,
        );
        const success = contextManager.saveCodeStore(round, updatedStore);
        setSaveStatus(success ? "saved" : "error");
        setTimeout(() => setSaveStatus("idle"), 2000);
        return updatedStore;
      });
    }, 600);
  }, [currentContext, currentProblem, contextManager, round, isLocked]);

  useEffect(() => {
    if (isContextInitialized && code && currentContext) {
      scheduleAutoSave();
    }
  }, [code, isContextInitialized, currentContext, scheduleAutoSave]);

  const handleContextTransition = useCallback(
    (newProblem: Problem, newLanguage: string) => {
      const newContext = contextManager.createContext(
        round,
        newProblem.id,
        newLanguage,
      );
      if (
        currentContext &&
        contextManager.contextEquals(currentContext, newContext)
      )
        return;

      let updatedStore = { ...codeStore };

      if (currentContext && !isLocked) {
        const currentCode = codeRef.current;
        if (currentCode) {
          updatedStore = contextManager.setCodeForContext(
            updatedStore,
            currentContext,
            currentCode,
          );
          contextManager.saveCodeStore(round, updatedStore);
        }
      }

      const savedCode = contextManager.getCodeForContext(
        updatedStore,
        newContext,
      );
      const codeToSet = savedCode || "";

      setCodeStore(updatedStore);
      setCode(codeToSet);
      setCurrentContext(newContext);
      setSubmissionResults(null);
      setHasSubmittedCurrent(false);
      setActiveTab("testcases");
    },
    [
      currentContext,
      currentProblem,
      codeStore,
      contextManager,
      round,
      isLocked,
    ],
  );

  const handleLanguageChange = (newLanguage: string) => {
    if (newLanguage === language) return;
    setLanguage(newLanguage);
    if (currentProblem) {
      handleContextTransition(currentProblem, newLanguage);
    }
  };

  useEffect(() => {
    if (!currentProblem || isContextInitialized) return;
    const loadedStore = contextManager.loadCodeStore(round);
    setCodeStore(loadedStore);
    const initialContext = contextManager.createContext(
      round,
      currentProblem.id,
      language,
    );
    setCurrentContext(initialContext);
    const savedCode = contextManager.getCodeForContext(
      loadedStore,
      initialContext,
    );
    setCode(savedCode || "");
    setIsContextInitialized(true);
  }, [currentProblem, language, isContextInitialized, contextManager, round]);

  useEffect(() => {
    if (isContextInitialized && currentProblem) {
      handleContextTransition(currentProblem, language);
    }
  }, [language, currentProblem, isContextInitialized, handleContextTransition]);

  const monaco = useMonaco();
  useEffect(() => {
    if (monaco) {
      monaco.editor.defineTheme("custom-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [],
        colors: {
          "editor.background": "#0a0a0a",
          "editor.foreground": "#ffffff",
          "editor.lineHighlightBackground": "#1a1a1a",
          "editor.selectionBackground": "#264f78",
          "editorCursor.foreground": "#f97316",
          "editorLineNumber.foreground": "#858585",
          "editorLineNumber.activeForeground": "#f97316",
        },
      });
      monaco.editor.setTheme("custom-dark");
    }
  }, [monaco]);

  useEffect(() => {
    if (monaco && editorRef.current) {
      let internalClipboard = "";
      const editor = editorRef.current;

      // intercept copy
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC, () => {
        const sel = editor.getSelection();
        if (sel) {
          const selection = editor.getModel()?.getValueInRange(sel);
          if (selection) {
            internalClipboard = selection;
          }
        }
      });

      // intercept cut
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX, () => {
        const sel = editor.getSelection();
        if (sel) {
          const selection = editor.getModel()?.getValueInRange(sel);
          if (selection) {
            internalClipboard = selection;
            editor.executeEdits("cut", [
              { range: sel, text: "", forceMoveMarkers: true },
            ]);
          }
        }
      });

      // intercept paste
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, () => {
        const sel = editor.getSelection();
        if (internalClipboard && sel) {
          editor.executeEdits("paste", [
            { range: sel, text: internalClipboard, forceMoveMarkers: true },
          ]);
        }
      });

      // disable right-click menu
      editor.updateOptions({ contextmenu: false });
    }
  }, [monaco]);

  const editorOptions = {
    minimap: { enabled: false },
    fontSize: 14,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    wordWrap: "on" as const,
    readOnly: isLocked,
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    e.preventDefault();
  };
  const handleMouseUp = () => setIsDragging(false);
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      const container = document.querySelector(
        ".code-results-container",
      ) as HTMLElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const newHeight = Math.max(
        20,
        Math.min(80, ((e.clientY - rect.top) / rect.height) * 100),
      );
      setCodeEditorHeight(newHeight);
    },
    [isDragging],
  );

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    } else {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, handleMouseMove]);

  const executeCode = useCallback(
    async (isFinalSubmission: boolean) => {
      if (!currentProblem || isSubmitting || isRunning) return;
      const action = isFinalSubmission ? "Submitting" : "Running";

      if (isFinalSubmission) {
        setIsSubmitting(true);
        setHasSubmittedCurrent(true);
      } else {
        setIsRunning(true);
      }

      setSubmissionResults(null);
      setActiveTab("results");
      showInfoToast(`${action} for judging...`);

      const endpoint = isFinalSubmission ? "/submit" : "/run";
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/submit${endpoint}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({
              language,
              source_code: code,
              problemId: currentProblem.id,
              roundNumber: parseInt(round),
            }),
          },
        );
        const result = await response.json();
        if (result.success) {
          setSubmissionResults(result.results || []);
          const summary = result.summary || {
            passed: 0,
            total: (result.results || []).length,
          };

          if (isFinalSubmission) {
            if (result.submission?.status === "ACCEPTED") {
              showSuccessToast(
                `Submission Accepted! All ${summary.total} test cases passed.`,
              );
            } else {
              showErrorToast(
                `${summary.passed}/${summary.total} test cases passed.`,
              );
            }
          } else {
            showInfoToast(
              `Test run completed: ${summary.passed}/${summary.total} passed`,
            );
          }
        } else {
          throw new Error(result.message || "Request failed");
        }
      } catch (error) {
        showErrorToast(
          `Failed to ${action.toLowerCase()}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      } finally {
        if (isFinalSubmission) setIsSubmitting(false);
        else setIsRunning(false);
      }
    },
    [
      currentProblem,
      isSubmitting,
      isRunning,
      session?.access_token,
      language,
      code,
      round,
    ],
  );

  const resetCodeToBoilerplate = () => {
    if (isLocked || !currentProblem || !currentContext) return;
    const boilerplate = contextManager.getBoilerplate(currentProblem, language);
    setCode(boilerplate);
    setCodeStore((prev) => {
      const updated = contextManager.removeCodeForContext(prev, currentContext);
      contextManager.saveCodeStore(round, updated);
      return updated;
    });
    showInfoToast("Code has been reset to boilerplate");
  };

  const formatTime = (seconds: number) =>
    `${Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  const getTimerDisplay = () => ({
    time: formatTime(timeRemaining),
    className:
      timeRemaining <= 60
        ? "text-red-400"
        : timeRemaining <= 300
          ? "text-yellow-400"
          : "",
  });
  const formatTestCaseData = (data: unknown): string => {
    if (typeof data === "string") return data;
    if (typeof data === "object" && data !== null)
      return JSON.stringify(data, null, 2);
    return String(data);
  };
  const getSaveStatusDisplay = () => {
    if (!currentContext || isLocked)
      return { text: "", className: "", icon: null };
    switch (saveStatus) {
      case "saving":
        return {
          text: "Saving...",
          className: "text-yellow-400",
          icon: <Save className="h-3 w-3" />,
        };
      case "saved":
        return {
          text: "Saved",
          className: "text-green-400",
          icon: <CheckCircle className="h-3 w-3" />,
        };
      case "error":
        return {
          text: "Save Error",
          className: "text-red-400",
          icon: <AlertTriangle className="h-3 w-3" />,
        };
      default:
        const savedCode = contextManager.getCodeForContext(
          codeStore,
          currentContext,
        );
        return savedCode
          ? {
              text: "Saved",
              className: "text-green-400",
              icon: <CheckCircle className="h-3 w-3" />,
            }
          : { text: "", icon: null };
    }
  };

  if (isLoading)
    return (
      <div className="flex items-center justify-center h-screen bg-black/40 text-white">
        <p>Loading Round...</p>
      </div>
    );
  if (!currentProblem)
    return (
      <div className="flex items-center justify-center h-screen bg-black/40 text-white">
        <p>Problem data not available. Please wait or return to the lobby.</p>
      </div>
    );

  const saveStatusDisplay = getSaveStatusDisplay();
  const timerDisplay = getTimerDisplay();

  const handleHackSubmit = (
    testCase: string,
    targetSubmission: HackableSubmission,
  ) => {
    if (!currentProblem) return;
    onHackAttempt({
      questionId: currentProblem.id,
      testCase,
      targetSubmission,
    });
    setIsHackModalOpen(false);
  };

  return (
    //remove this securewrapper also to disable copy paste
    <SecureWrapper>
      <>
        <HackModal
          isOpen={isHackModalOpen}
          onClose={() => setIsHackModalOpen(false)}
          submissions={hackableSubmissions[currentProblem.id] || []}
          onSubmitHack={handleHackSubmit}
        />
        <div className="flex flex-col h-screen text-white overflow-hidden bg-[url('/bg-code.svg')] bg-fixed bg-cover bg-center oxanium">
          <div className="flex-1 flex p-4 gap-4 bg-black/40 min-h-0">
            <CustomScrollbar className="w-1/2 flex border rounded-lg border-amber-600 bg-black/40 p-4 flex-col min-h-0 overflow-hidden glass-box">
              <div className="flex justify-between items-start mb-4 flex-shrink-0">
                <div>
                  <h2 className="text-2xl font-bold">{currentProblem.title}</h2>
                  <div className="flex items-center gap-4 text-sm text-gray-400 mt-2">
                    {/* <span>Difficulty: {currentProblem.difficulty}</span> */}
                    <span>Round: {round.toUpperCase()}</span>
                    <div className="flex items-center gap-2 border border-gray-600 rounded-md p-1">
                      <button
                        onClick={() =>
                          onQuestionSelect(currentProblemIndex - 1)
                        }
                        disabled={currentProblemIndex === 0}
                        className="p-1 rounded-md hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <span className="font-mono text-xs">
                        {currentProblemIndex + 1} / {problems.length}
                      </span>
                      <button
                        onClick={() =>
                          onQuestionSelect(currentProblemIndex + 1)
                        }
                        disabled={currentProblemIndex >= problems.length - 1}
                        className="p-1 rounded-md hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
                {currentProblem.hints && currentProblem.hints.length > 0 && (
                  <button
                    onClick={() => setShowHints(!showHints)}
                    className="rounded-lg border p-4 h-12 text-white border-amber-600 font-oxanium w-30 justify-center items-center flex bg-black/20 backdrop-blur-sm hover:bg-amber-600 hover:text-black transition-colors duration-300 gap-2"
                  >
                    <Lightbulb className="h-4 w-4" />{" "}
                    {showHints ? "Hide" : "Hint"}
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto min-h-0 pr-2">
                {showHints && currentProblem.hints && (
                  <div className="mb-4 bg-black p-3 rounded">
                    <h3 className="font-bold mb-2 text-amber-400">Hints:</h3>
                    <ul className="list-disc list-inside text-gray-300 space-y-2">
                      {currentProblem.hints.map((hint, i) => (
                        <li key={i}>{hint}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="mb-4 text-gray-300 whitespace-pre-wrap">
                  {currentProblem.description}
                </p>
                {currentProblem.constraints && (
                  <>
                    <h3 className="font-bold mb-2 text-amber-400">
                      Constraints:
                    </h3>
                    <ul className="list-disc list-inside mb-4 text-gray-300 font-mono text-sm">
                      {currentProblem.constraints.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </>
                )}
                {currentProblem.sampleTestCases && (
                  <>
                    <h3 className="font-bold mb-4 text-amber-400">
                      Sample Cases:
                    </h3>
                    {currentProblem.sampleTestCases.map((tc, i) => (
                      <div
                        key={i}
                        className="mb-4 bg-black/20 border-amber-600/50 mr-2 border-2 p-3 rounded font-mono text-sm"
                      >
                        <p className="font-bold text-gray-400">Input:</p>
                        <pre className="bg-gray-800/60 p-2 rounded mt-1 whitespace-pre-wrap">
                          {formatTestCaseData(
                            tc.stdin || tc.input?.stdin || tc.input?.json || "",
                          )}
                        </pre>
                        <p className="mt-2 font-bold text-gray-400">Output:</p>
                        <pre className="bg-gray-800/60 p-2 rounded mt-1 whitespace-pre-wrap">
                          {formatTestCaseData(
                            tc.expected_output ||
                              tc.output?.stdout ||
                              tc.output?.json ||
                              "",
                          )}
                        </pre>
                        {tc.explanation && (
                          <p className="mt-2 text-xs text-gray-400 italic">
                            Explanation: {tc.explanation}
                          </p>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </CustomScrollbar>

            <div className="w-1/2 flex flex-col code-results-container gap-1">
              <div
                className="border border-amber-600 rounded-lg p-4 flex flex-col min-h-0 glass-box"
                style={{ height: `${codeEditorHeight}%` }}
              >
                <div className="flex justify-between items-center mb-2 gap-2">
                  <select
                    value={language}
                    onChange={(e) => handleLanguageChange(e.target.value)}
                    className="bg-black text-white p-2 rounded border w-32 border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    disabled={isLocked}
                  >
                    <option value="python">Python</option>
                    <option value="java">Java</option>
                    <option value="cpp">C++</option>
                    <option value="c">C</option>
                  </select>
                  <div
                    className={`text-center p-2 font-mono text-xl bg-gray-800 rounded border border-amber-600 ${timerDisplay.className}`}
                  >
                    {timerDisplay.time}
                  </div>
                  <div className="flex-1 flex justify-end items-center gap-2">
                    {saveStatusDisplay.text && (
                      <span
                        className={`text-xs ${saveStatusDisplay.className} flex items-center gap-1`}
                      >
                        {saveStatusDisplay.icon}
                        {saveStatusDisplay.text}
                      </span>
                    )}

                    {isLocked ? (
                      <button
                        onClick={() => setIsHackModalOpen(true)}
                        disabled={!isHackingPhase}
                        title={
                          isHackingPhase
                            ? "Hack other solutions for this problem"
                            : "Hacking is not yet active"
                        }
                        className="flex items-center gap-2 bg-red-600 text-white p-2 rounded border border-red-500 hover:bg-red-500 transition-colors font-bold disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-600"
                      >
                        <Swords size={16} />
                        Hack
                      </button>
                    ) : (
                      <button
                        onClick={() => onLockQuestion(currentProblem.id)}
                        disabled={!hasSubmittedCurrent || !isHackingPhase}
                        title={
                          !isHackingPhase
                            ? "Locking is only available in the hacking phase"
                            : !hasSubmittedCurrent
                              ? "You must submit your code at least once"
                              : "Lock this question to view others' code"
                        }
                        className="flex items-center gap-2 bg-red-800/50 text-white p-2 rounded border border-red-600 hover:bg-red-700/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-800/50"
                      >
                        <Lock className="h-4 w-4" />
                        Lock
                      </button>
                    )}

                    <button
                      onClick={() => executeCode(false)}
                      disabled={isRunning || isSubmitting || isLocked}
                      className="flex items-center bg-black text-white p-2 rounded border border-amber-600 hover:bg-amber-600 hover:text-black transition-colors disabled:opacity-50"
                    >
                      <span className="pl-2">Run</span>
                      <Play className="ml-2 h-4 w-4" />
                    </button>
                    <button
                      onClick={() => executeCode(true)}
                      disabled={isSubmitting || isRunning || isLocked}
                      className="flex items-center gap-2 bg-black text-white p-2 rounded border border-amber-600 hover:bg-amber-600 hover:text-black transition-colors disabled:opacity-50"
                    >
                      <p className="pl-2">
                        {isSubmitting ? "Submitting..." : "Submit"}
                      </p>
                      <Image
                        src="/submit_2.png"
                        alt="submit"
                        width={16}
                        height={16}
                        className="mr-2"
                      />
                    </button>
                    <button
                      onClick={resetCodeToBoilerplate}
                      title="Reset to boilerplate"
                      disabled={isLocked}
                      className="flex items-center gap-2 bg-black text-white p-2 rounded border border-amber-600 hover:bg-amber-600 hover:text-black transition-colors disabled:opacity-50"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div
                  className={`flex-1 rounded overflow-hidden border border-gray-700 ${isLocked ? "bg-gray-800/50" : ""}`}
                >
                  <Editor
                    height="100%"
                    language={language}
                    value={code}
                    onChange={(v) => setCode(v || "")}
                    theme="custom-dark"
                    options={editorOptions}
                    onMount={(editor, monacoInstance) => {
                      editorRef.current = editor;

                      //comment here to enable copy-paste
                      // Disable paste via context menu
                      editor.addAction({
                        id: "disable-paste",
                        label: "Paste",
                        keybindings: [],
                        precondition: "false",
                        run: () => {},
                      });
                      // Block DOM paste events
                      const domNode = editor.getDomNode();
                      if (domNode) {
                        domNode.addEventListener(
                          "paste",
                          (e: ClipboardEvent) => {
                            e.preventDefault();
                            showErrorToast("Paste is disabled");
                          },
                          true,
                        );
                      }
                      // Block keyboard shortcut Ctrl/Cmd+V
                      editor.addCommand(
                        monacoInstance.KeyMod.CtrlCmd |
                          monacoInstance.KeyCode.KeyV,
                        () => {
                          showErrorToast("Paste shortcut is disabled");
                        },
                      );
                      //till here
                    }}
                  />
                </div>
              </div>

              <div
                onMouseDown={handleMouseDown}
                className={`h-1 bg-amber-600/20 hover:bg-amber-600/40 cursor-row-resize transition-colors flex items-center justify-center ${isDragging ? "bg-amber-600/60" : ""}`}
              >
                <div className="w-8 h-1 bg-amber-600 rounded-full"></div>
              </div>

              <div
                className="border border-amber-600 rounded-lg p-4 flex flex-col glass-box"
                style={{ height: `${100 - codeEditorHeight}%` }}
              >
                <div className="flex border-b border-amber-600/30 mb-3 flex-shrink-0">
                  <button
                    onClick={() => setActiveTab("testcases")}
                    className={`px-4 py-2 font-medium ${activeTab === "testcases" ? "border-b-2 border-amber-500 text-amber-400" : "text-gray-400"}`}
                  >
                    Test Cases
                  </button>
                  <button
                    onClick={() => setActiveTab("results")}
                    className={`px-4 py-2 font-medium ${activeTab === "results" ? "border-b-2 border-amber-500 text-amber-400" : "text-gray-400"}`}
                  >
                    Test Results{" "}
                    {submissionResults && (
                      <span className="ml-2 text-xs bg-amber-600 text-black px-2 py-1 rounded-full">
                        {submissionResults.length}
                      </span>
                    )}
                  </button>
                </div>
                <div className="flex-1 min-h-0">
                  {/* Results panel content... */}
                </div>
              </div>
            </div>
          </div>
        </div>
      </>
    </SecureWrapper>
  );
}
