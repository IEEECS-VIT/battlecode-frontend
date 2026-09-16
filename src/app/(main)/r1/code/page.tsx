"use client";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Editor, { useMonaco } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import {
  Save,
  CheckCircle,
  AlertTriangle,
  Lightbulb,
  RotateCcw,
  Play,
} from "lucide-react";
import { useSocket } from "@/contexts/SocketContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  showSuccessToast,
  showErrorToast,
  showInfoToast,
} from "@/components/shared/CustomToast";
import CustomScrollbar from "@/components/shared/CustomScrollbar";
import SecureWrapper from "@/components/shared/SecureWrapper";
import LoadingOverlay from "@/components/shared/LoadingOverlay";
import ExpandableTestCase from "@/components/shared/ExpandableTestCase";

// Interfaces
interface MatchData {
  opponent: { id: string; username?: string; rank?: number };
  // Support both old format (question) and new unified schema format (problem)
  question?: {
    id: string;
    title: string;
    description: string;
    difficulty: string;
    duration?: number;
    constraints?: string[];
    boilerplate?: { [key: string]: string };
    sampleTestCases?: TestCase[];
    hints?: string[];
  };
  problem?: {
    id: string;
    title: string;
    description: string;
    difficulty: string;
    duration?: number;
    constraints?: string[];
    boilerplate?: { [key: string]: string };
    sampleTestCases?: TestCase[];
    hints?: string[];
  };
  startTime: number;
  duration?: number;
  endTime?: number;
  timeRemaining?: number;
  type?: string;
  id?: string;
  difficulty?: string;
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
  matchData: MatchData | null;
  timeRemaining: number;
}

interface CodeContext {
  round: string;
  questionId: string;
  language: string;
}

interface CodeStore {
  [contextKey: string]: string;
}

interface GetStateResponse {
  success: boolean;
  error?: string;
  currentUser?: {
    userId: string;
    username: string;
    status: string;
    [key: string]: unknown;
  };
  session?: {
    type: "match" | "bounty" | "problem";
    id: string;
    startTime: number;
    endTime: number;
    timeRemaining: number;
    opponent?: {
      id: string;
      username: string;
      rank?: number | string;
    };
    problem?: {
      id: string;
      title: string;
      description: string;
      difficulty: string;
      duration?: number;
      constraints?: string[];
      boilerplate?: { [key: string]: string };
      sampleTestCases?: any[];
      hints?: string[];
    };
  };
}

// CodePage Component
function CodePageComponent({ matchData, timeRemaining }: CodePageProps) {
  const { session } = useAuth();

  // State declarations
  const [problem, setProblem] = useState<MatchData["question"] | null>(null);
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState(() => {
    try {
      return localStorage.getItem("battlecode-round-1-language") || "python";
    } catch {
      return "python";
    }
  });
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

  const codeRef = useRef(code);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  // Keep codeRef in sync with code state
  useEffect(() => {
    codeRef.current = code;
  }, [code]);

  // Helper Functions & Managers
  const contextManager = useMemo(
    () => ({
      getStorageKey: (round: string) => `battlecode-round-${round}-code-store`,
      generateContextKey: (round: string, qId: string, lang: string) =>
        `${round}:${qId}:${lang}`,
      loadCodeStore: (round: string): CodeStore => {
        try {
          const stored = localStorage.getItem(
            contextManager.getStorageKey(round),
          );
          return stored ? JSON.parse(stored) : {};
        } catch {
          return {};
        }
      },
      saveCodeStore: (round: string, store: CodeStore) => {
        try {
          localStorage.setItem(
            contextManager.getStorageKey(round),
            JSON.stringify(store),
          );
          return true;
        } catch {
          return false;
        }
      },
      getBoilerplate: (p: MatchData["question"] | null, lang: string) =>
        p?.boilerplate?.[lang] || "",
      createContext: (round: string, qId: string, lang: string) => ({
        round,
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

  const getMonacoLanguage = (lang: string) => {
    const languageMap: { [key: string]: string } = {
      python: "python",
      java: "java",
      cpp: "cpp",
      c: "c",
    };
    return languageMap[lang] || "python";
  };

  const scheduleAutoSave = useCallback(() => {
    if (!currentContext || !codeRef.current) return;
    const codeToSave = codeRef.current;
    const boilerplate = contextManager.getBoilerplate(
      problem,
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
        const success = contextManager.saveCodeStore("1", updatedStore);
        setSaveStatus(success ? "saved" : "error");
        setTimeout(() => setSaveStatus("idle"), 2000);
        return updatedStore;
      });
    }, 600);
  }, [currentContext, problem, contextManager]);

  const handleContextTransition = useCallback(
    (
      newProblem: NonNullable<MatchData["question"] | MatchData["problem"]>,
      newLanguage: string,
    ) => {
      const newContext = contextManager.createContext(
        "1",
        newProblem.id,
        newLanguage,
      );

      if (
        currentContext &&
        contextManager.contextEquals(currentContext, newContext)
      )
        return;

      let updatedStore = { ...codeStore };

      if (currentContext) {
        const currentCode = codeRef.current;
        if (currentCode) {
          updatedStore = contextManager.setCodeForContext(
            updatedStore,
            currentContext,
            currentCode,
          );
          contextManager.saveCodeStore("1", updatedStore);
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
      setActiveTab("testcases");
    },
    [currentContext, problem, codeStore, contextManager],
  );

  const handleLanguageChange = (newLanguage: string) => {
    if (newLanguage === language) return;
    setLanguage(newLanguage);
    if (problem) {
      handleContextTransition(problem, newLanguage);
    }
  };

  const executeCode = useCallback(
    async (isFinalSubmission: boolean) => {
      if (!problem || !matchData || isSubmitting || isRunning) return;
      const action = isFinalSubmission ? "Submitting" : "Running";

      if (isFinalSubmission) setIsSubmitting(true);
      else setIsRunning(true);

      setSubmissionResults(null);
      setActiveTab("results");
      showInfoToast(`${action} for judging...`);

      const endpoint = isFinalSubmission
        ? "/api/submit/submit"
        : "/api/submit/run";
      try {
        // ✅ Log the request
        console.log("[SUBMIT] Sending request:", {
          endpoint: `${process.env.NEXT_PUBLIC_API_URL}${endpoint}`,
          payload: { language, problemId: problem.id, roundNumber: 1 },
          hasToken: !!session?.access_token,
        });

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}${endpoint}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({
              language,
              source_code: code,
              problemId: problem.id,
              roundNumber: 1,
            }),
          },
        );

        // ✅ Log the raw response
        console.log(
          "[SUBMIT] Response status:",
          response.status,
          response.statusText,
        );

        const result = await response.json();

        // ✅ Log the parsed result
        console.log("[SUBMIT] Response data:", result);

        if (result.success) {
          setSubmissionResults(result.results || []);
          const summary = result.summary || {
            passed: 0,
            total: (result.results || []).length,
          };

          const status = isFinalSubmission
            ? result.submission?.status
            : result.summary?.status;

          if (
            status === "TIME_LIMIT_EXCEEDED" ||
            status === "MEMORY_LIMIT_EXCEEDED"
          ) {
            showErrorToast(
              status === "MEMORY_LIMIT_EXCEEDED"
                ? "Memory Limit Exceeded"
                : "Time Limit Exceeded",
            );
          } else if (isFinalSubmission) {
            if (result.submission?.status !== "ACCEPTED") {
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
          // ✅ Log the failure reason
          console.error("[SUBMIT] Backend returned success: false", result);
          throw new Error(result.message || result.error || "Request failed");
        }
      } catch (error) {
        // ✅ Log the full error
        console.error("[SUBMIT] Caught error:", error);
        showErrorToast(
          `Failed to ${action.toLowerCase()}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      } finally {
        if (isFinalSubmission) setIsSubmitting(false);
        else setIsRunning(false);
      }
    },
    [
      problem,
      matchData,
      isSubmitting,
      isRunning,
      session?.access_token,
      language,
      code,
    ],
  );

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

  const resetCodeToBoilerplate = () => {
    if (!problem || !currentContext) return;
    const boilerplate = contextManager.getBoilerplate(problem, language);
    setCode(boilerplate);
    setCodeStore((prev) => {
      const updated = contextManager.removeCodeForContext(prev, currentContext);
      contextManager.saveCodeStore("1", updated);
      return updated;
    });
    showInfoToast("Code has been reset to boilerplate");
  };

  const getSaveStatusDisplay = () => {
    if (!currentContext) return { text: "", className: "", icon: null };
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

  // Constants
  const monaco = useMonaco();
  const editorOptions = {
    minimap: { enabled: false },
    fontSize: 14,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    wordWrap: "on" as const,
  };

  // useEffect Hooks
  useEffect(() => {
    // Handle both old format (question) and new unified schema format (problem)
    const problemData = matchData?.question || matchData?.problem;

    if (!problemData || isContextInitialized) return;

    const loadedStore = contextManager.loadCodeStore("1");
    setCodeStore(loadedStore);
    const initialContext = contextManager.createContext(
      "1",
      problemData.id,
      language,
    );
    setCurrentContext(initialContext);
    const savedCode = contextManager.getCodeForContext(
      loadedStore,
      initialContext,
    );
    setCode(savedCode || "");
    setProblem(problemData);
    setIsContextInitialized(true);
  }, [matchData, language, isContextInitialized, contextManager]);

  useEffect(() => {
    if (isContextInitialized && problem) {
      handleContextTransition(problem, language);
    }
  }, [language, problem, isContextInitialized, handleContextTransition]);

  // Trigger auto-save when code changes
  useEffect(() => {
    if (isContextInitialized && code && currentContext) {
      scheduleAutoSave();
    }
  }, [code, isContextInitialized, currentContext, scheduleAutoSave]);

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

  console.log("Rendering CodePage with context:", {
    currentContext,
    saveStatus,
    timeRemaining,
    problem,
    matchData,
  });

  if (!problem || !matchData)
    return (
      <div className="text-white text-center p-8">Initializing editor...</div>
    );

  const saveStatusDisplay = getSaveStatusDisplay();
  const timerDisplay = getTimerDisplay();
  function handleEditorMount(
    editor: monaco.editor.IStandaloneCodeEditor,
    monacoInstance: typeof import("monaco-editor"),
  ) {
    editorRef.current = editor;

    //commment here to enable
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
          // Correct type is now used
          e.preventDefault();
          showErrorToast("Paste is disabled");
        },
        true,
      );
    }
    // Block keyboard shortcut Ctrl/Cmd+V
    editor.addCommand(
      monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyV,
      () => {
        showErrorToast("Paste shortcut is disabled");
      },
    );
  }
  //till here

  return (
    //remove this securewrapper also to disable copy paste
    <SecureWrapper>
      <div className="flex flex-col h-screen text-white overflow-hidden bg-[url('/bg-code.svg')] bg-fixed bg-cover bg-center oxanium">
        <div className="flex-1 flex p-4 gap-4 bg-black/40 min-h-0">
          <CustomScrollbar className="w-1/2 flex border rounded-lg border-amber-600 bg-black/40 p-4 flex-col min-h-0 overflow-hidden glass-box">
            <div className="flex justify-between items-start mb-4 flex-shrink-0">
              <div>
                <h2 className="text-2xl font-bold">{problem.title}</h2>
                <div className="flex gap-4 text-sm text-gray-400 mt-1">
                  <span>
                    vs {matchData.opponent.username || matchData.opponent.id}
                  </span>
                </div>
              </div>
              {problem.hints && problem.hints.length > 0 && (
                <button
                  onClick={() => setShowHints(!showHints)}
                  className="rounded-lg border p-4 h-12 text-white border-amber-600 font-oxanium w-30 justify-center items-center flex bg-black/20 backdrop-blur-sm hover:bg-amber-600 hover:text-black transition-colors duration-300 gap-2"
                >
                  <Lightbulb className="h-4 w-4" />{" "}
                  {showHints ? "Hide" : "Hint"}
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {showHints && problem.hints && problem.hints.length > 0 && (
                <div className="mb-4 bg-black p-3 rounded">
                  <h3 className="font-bold mb-2 text-amber-400">Hints:</h3>
                  <ul className="list-disc list-inside text-gray-300 space-y-2">
                    {problem.hints.map((hint, i) => (
                      <li key={i}>{hint}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="mb-4 text-gray-300 whitespace-pre-wrap">
                {problem.description}
              </p>

              {problem.constraints && problem.constraints.length > 0 && (
                <>
                  <h3 className="font-bold mb-2 text-amber-400">
                    Constraints:
                  </h3>
                  <ul className="list-disc list-inside mb-4 text-gray-300 font-mono text-sm">
                    {problem.constraints.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </>
              )}

              {problem.sampleTestCases &&
                problem.sampleTestCases.length > 0 && (
                  <>
                    <h3 className="font-bold mb-4 text-amber-400">
                      Sample Cases:
                    </h3>
                    {problem.sampleTestCases.map((tc, i) => (
                      <div
                        key={i}
                        className="mb-4 min-w-0 overflow-hidden bg-black/20 border-amber-600/50 mr-2 border-2 p-3 rounded font-mono text-sm"
                      >
                        <p className="font-bold text-gray-400">Input:</p>
                        <ExpandableTestCase
                          value={
                            tc.stdin || tc.input?.stdin || tc.input?.json || ""
                          }
                        />
                        <p className="mt-2 font-bold text-gray-400">Output:</p>
                        <ExpandableTestCase
                          value={
                            tc.expected_output ||
                            tc.output?.stdout ||
                            tc.output?.json ||
                            ""
                          }
                        />
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
                >
                  <option value="python">Python</option>
                  <option value="java">Java</option>
                  <option value="cpp">C++</option>
                  <option value="c">C</option>
                </select>
                <div
                  className={`text-center px-4 py-2 font-mono text-xl bg-black rounded border border-amber-600 ${timerDisplay.className}`}
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
                  <button
                    onClick={() => executeCode(false)}
                    disabled={isRunning || isSubmitting}
                    className="flex items-center bg-black text-white p-2 rounded border border-amber-600 hover:bg-amber-600 hover:text-black transition-colors disabled:opacity-50"
                  >
                    <span className="pl-2">Run</span>
                    <Play className="ml-2 h-4 w-4" />
                  </button>
                  <button
                    onClick={() => executeCode(true)}
                    disabled={isSubmitting || isRunning}
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
                    className="flex items-center gap-2 bg-black text-white p-2 rounded border border-amber-600 hover:bg-amber-600 hover:text-black transition-colors"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 rounded overflow-hidden border border-gray-700">
                <Editor
                  height="100%"
                  language={getMonacoLanguage(language)}
                  value={code}
                  onChange={(value) => setCode(value || "")}
                  theme="custom-dark"
                  options={editorOptions}
                  onMount={handleEditorMount}
                  loading={
                    <div className="flex items-center justify-center h-full bg-black">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
                    </div>
                  }
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
                <CustomScrollbar className="h-full overflow-y-auto">
                  {activeTab === "testcases" && (
                    <div className="space-y-3 pr-2">
                      {problem.sampleTestCases?.length ? (
                        problem.sampleTestCases.map((tc, i) => (
                          <div
                            key={i}
                            className="min-w-0 overflow-hidden border border-gray-600 rounded-lg p-3 bg-black/20"
                          >
                            <h4 className="font-semibold text-amber-400">
                              Case {i + 1}
                            </h4>
                            <div className="space-y-2 mt-2">
                              <div>
                                <p className="text-sm font-medium text-gray-300 mb-1">
                                  Input:
                                </p>
                                <ExpandableTestCase
                                  value={
                                    tc.stdin ||
                                    tc.input?.stdin ||
                                    tc.input?.json ||
                                    ""
                                  }
                                />
                              </div>
                              <div>
                                <p className="text-sm font-medium text-gray-300 mb-1">
                                  Expected Output:
                                </p>
                                <ExpandableTestCase
                                  value={
                                    tc.expected_output ||
                                    tc.output?.stdout ||
                                    tc.output?.json ||
                                    ""
                                  }
                                />
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-center text-gray-400 py-8">
                          <p>No sample test cases.</p>
                        </div>
                      )}
                    </div>
                  )}
                  {activeTab === "results" && (
                    <div className="pr-2">
                      {(isRunning || isSubmitting) && (
                        <div className="flex items-center gap-2 text-amber-400">
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-amber-500"></div>
                          <span>Processing...</span>
                        </div>
                      )}
                      {submissionResults?.length ? (
                        <div className="space-y-2">
                          {submissionResults.map((res, i) => {
                            const isAccepted =
                              res.status.description === "Accepted";
                            return (
                              <div
                                key={res.token || i}
                                className={`p-3 rounded border ${isAccepted ? "bg-green-800/30 border-green-600/50" : "bg-red-800/30 border-red-600/50"}`}
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <p className="font-bold">Test Case {i + 1}</p>
                                  <span
                                    className={`text-sm font-medium px-2 py-1 rounded ${isAccepted ? "text-green-400 bg-green-900/50" : "text-red-400 bg-red-900/50"}`}
                                  >
                                    {res.status.description}
                                  </span>
                                </div>

                                {/* Display stdout if available */}
                                {res.stdout && (
                                  <div className="mt-2">
                                    <p className="text-xs font-semibold text-gray-300 mb-1">
                                      Output:
                                    </p>
                                    <pre className="text-xs text-gray-200 whitespace-pre-wrap bg-black/40 p-2 rounded border border-gray-600 max-h-32 overflow-y-auto">
                                      {res.stdout}
                                    </pre>
                                  </div>
                                )}

                                {!isAccepted &&
                                  (res.stderr || res.compile_output) && (
                                    <div className="mt-2">
                                      <p className="text-xs font-semibold text-red-300 mb-1">
                                        Error:
                                      </p>
                                      <pre className="text-xs text-red-300 whitespace-pre-wrap bg-black/50 p-2 rounded border border-gray-700 max-h-32 overflow-y-auto">
                                        {res.stderr || res.compile_output}
                                      </pre>
                                    </div>
                                  )}

                                {res.time && (
                                  <div className="flex gap-4 text-xs text-gray-400 mt-2">
                                    <span>Runtime: {res.time}s</span>
                                    <span>Memory: {res.memory}KB</span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        !isRunning &&
                        !isSubmitting && (
                          <div className="text-center text-gray-400 py-8">
                            <p>Run or submit code to see results</p>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </CustomScrollbar>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SecureWrapper>
  );
}

// ============================================================================
// Main Page Component (REFACTORED WITH DEFINITIVE FIX)
// ============================================================================
export default function R1CodePage() {
  const router = useRouter();
  const { isLoading: isAuthLoading } = useAuth();
  const { socket, isConnected } = useSocket();

  const [matchData, setMatchData] = useState<MatchData | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [pageIsLoading, setPageIsLoading] = useState(true);

  const [showMatchEndPopup, setShowMatchEndPopup] = useState(false);
  const [matchEndData, setMatchEndData] = useState<{
    type: "win" | "lose" | "timeout" | "admin_end";
    message?: string;
  } | null>(null);

  const matchEndedRef = useRef(false);

  // ✅ FIX: This is the new, robust loading and verification logic.
  useEffect(() => {
    // Don't do anything until authentication and socket are ready.
    if (isAuthLoading || !isConnected || !socket) {
      return;
    }

    // STEP 1: Prioritize data from sessionStorage. This is the fastest and most reliable
    // method because the Waiting Room places data here just before redirecting.
    const storedDataRaw = sessionStorage.getItem("round1_match_data");

    if (storedDataRaw) {
      try {
        const data: MatchData = JSON.parse(storedDataRaw);
        if (
          !data.endTime &&
          typeof data.timeRemaining === "number" &&
          data.timeRemaining > 0
        ) {
          data.endTime = Date.now() + data.timeRemaining;
        }
        setMatchData(data);
        setPageIsLoading(false); // Success! We have data, no need to ask the server.
        return; // Exit the effect early.
      } catch (error) {
        console.error("Failed to parse match data:", error);
        // If the data is corrupted, clear it and fall through to the server sync.
        showErrorToast("Corrupted match data, re-syncing.");
        sessionStorage.removeItem("round1_match_data");
      }
    }

    // STEP 2: Fallback to server sync. This only runs if sessionStorage is empty,
    // which happens on a page refresh or direct URL access.
    showInfoToast("Re-syncing with server...");
    socket.emit("round1:getState", {}, (response: GetStateResponse) => {
      // Log the response for debugging
      console.log("[GET STATE RESPONSE]", {
        success: response.success,
        currentUser: response.currentUser,
        session: response.session,
        hasSession: !!response.session,
        userStatus: response.currentUser?.status,
        hasProblem: !!response.session?.problem,
        problemId: response.session?.problem?.id,
        problemTitle: response.session?.problem?.title,
      });

      // Handle both 'in_match' and 'in-match' formats for backward compatibility
      const isInMatch =
        response.currentUser?.status === "in_match" ||
        response.currentUser?.status === "in-match";

      if (response.success && isInMatch && response.session) {
        showSuccessToast("Successfully re-synced match!");

        // Additional validation
        if (!response.session.problem) {
          console.error(
            "[MISSING PROBLEM DATA] Session exists but problem is missing:",
            response.session,
          );
          showErrorToast("Match data incomplete - missing problem.");
          router.push("/r1/waiting");
          setPageIsLoading(false);
          return;
        }

        // Convert session data to old MatchData format
        const data: MatchData = {
          opponent: {
            id: response.session.opponent?.id || "",
            username: response.session.opponent?.username,
            rank:
              typeof response.session.opponent?.rank === "number"
                ? response.session.opponent.rank
                : undefined,
          },
          question: {
            id: response.session.problem?.id || "",
            title: response.session.problem?.title || "",
            description: response.session.problem?.description || "",
            difficulty: response.session.problem?.difficulty || "",
            duration: response.session.problem?.duration,
            constraints: response.session.problem?.constraints || [],
            boilerplate: response.session.problem?.boilerplate || {},
            sampleTestCases: response.session.problem?.sampleTestCases || [],
            hints: response.session.problem?.hints || [],
          },
          startTime: response.session.startTime,
          endTime: response.session.endTime,
          duration: response.session.endTime - response.session.startTime,
        };
        sessionStorage.setItem("round1_match_data", JSON.stringify(data));
        setMatchData(data);
      } else {
        showErrorToast("No active match found on server.");
        router.push("/r1/waiting");
      }
      setPageIsLoading(false);
    });
  }, [isAuthLoading, isConnected, socket, router]);

  const matchEndTime =
    matchData &&
    (matchData.endTime ||
      (matchData.startTime
        ? matchData.startTime + (matchData.duration || 0)
        : 0));

  // Client-side timer from a stable endTime. Do not depend on matchData —
  // timerUpdate used to replace that object every second and restart this effect.
  useEffect(() => {
    if (!matchEndTime) return;

    const tick = () => {
      const remainingMs = matchEndTime - Date.now();
      setTimeRemaining(Math.max(0, Math.ceil(remainingMs / 1000)));
      if (remainingMs <= 0 && !showMatchEndPopup && !matchEndedRef.current) {
        matchEndedRef.current = true;
        setMatchEndData({ type: "timeout" });
        setShowMatchEndPopup(true);
      }
    };

    tick();
    const timerInterval = setInterval(tick, 1000);
    return () => clearInterval(timerInterval);
  }, [matchEndTime, showMatchEndPopup]);

  // Listens for authoritative match/round end events from the server.
  useEffect(() => {
    if (!socket || !isConnected) return;

    const handleMatchEnd = (data: {
      type: "win" | "lose" | "timeout" | "admin_end";
    }) => {
      // ✅ PRIORITY HANDLING: admin_end ALWAYS overrides other match end states
      if (data.type === "admin_end") {
        console.log(
          "[MATCH END] Admin override accepted, overriding any previous state",
        );
        matchEndedRef.current = true;
        sessionStorage.removeItem("round1_match_data");
        sessionStorage.removeItem("fullscreen_violations");
        setMatchEndData(data);
        setShowMatchEndPopup(true);
        return;
      }

      // For other types (win/lose/timeout), check if already handled
      if (matchEndedRef.current) {
        console.log(
          "[MATCH END] Already handled, ignoring duplicate:",
          data.type,
        );
        return;
      }

      matchEndedRef.current = true;
      sessionStorage.removeItem("round1_match_data");
      sessionStorage.removeItem("fullscreen_violations"); // Clear violations on match end
      console.log("[MATCH END] Processing:", data.type);
      setMatchEndData(data);
      setShowMatchEndPopup(true);
    };

    const handleRoundEnd = (_data?: { endTime?: number }) => {
      sessionStorage.removeItem("round1_match_data");
      sessionStorage.removeItem("fullscreen_violations"); // Clear violations on round end

      if (showMatchEndPopup) {
        console.log("[ROUND END] Popup already shown, letting user dismiss it");
        return;
      }

      showInfoToast("Round 1 has ended");
      console.log("[ROUND END] No popup shown, redirecting to dashboard");
      setTimeout(() => router.push("/"), 3000);
    };

    const handleAdminRemoved = () => {
      console.log("You have been removed from Round 1 by an admin");
      showErrorToast("You have been removed from Round 1 by an admin");
      localStorage.removeItem("battlecode-round-1-code-store");
      sessionStorage.removeItem("round1_match_data");
      sessionStorage.removeItem("fullscreen_violations"); // Clear violations when admin removes
      router.push("/");
    };

    const handleAdminAdded = () => {
      console.log("You have been added to Round 1 by an admin");

      // Check current round status
      socket?.emit(
        "user:current-round",
        {},
        (response: {
          success: boolean;
          currentRound?: {
            currentRoundNumber: number;
            currentRoundStatus:
              | "LOBBY"
              | "COMPLETED"
              | "LOCKED"
              | "IN_PROGRESS";
          };
          error?: string;
        }) => {
          if (!response.success || !response.currentRound) {
            showErrorToast("Failed to check round status");
            return;
          }

          const { currentRoundNumber, currentRoundStatus } =
            response.currentRound;
          console.log(currentRoundNumber, currentRoundStatus);

          if (currentRoundNumber !== 1) {
            showErrorToast("Round 1 is not the current round");
            return;
          }

          if (currentRoundStatus === "LOBBY") {
            showSuccessToast(
              "You have been added to Round 1! Redirecting to lobby...",
            );
            setTimeout(() => router.push("/r1/lobby"), 1500);
          } else if (currentRoundStatus === "IN_PROGRESS") {
            showSuccessToast(
              "You have been added to Round 1! Redirecting to waiting room...",
            );
            setTimeout(() => router.push("/r1/waiting"), 1500);
          } else if (currentRoundStatus === "COMPLETED") {
            showErrorToast("Round 1 has already completed");
          } else if (currentRoundStatus === "LOCKED") {
            showErrorToast("Round 1 is currently locked");
          }
        },
      );
    };

    const handleTimerUpdate = (data: {
      timeRemaining?: number;
      endTime?: number;
    }) => {
      if (typeof data.endTime !== "number" || !Number.isFinite(data.endTime)) {
        return;
      }
      setMatchData((prev) => {
        if (!prev || prev.endTime === data.endTime) return prev;
        return { ...prev, endTime: data.endTime };
      });
    };

    socket.on("round1:matchEnd", handleMatchEnd);
    socket.on("round1:ended", handleRoundEnd);
    socket.on("round1:timerUpdate", handleTimerUpdate);
    socket.on("round1:adminRemoved", handleAdminRemoved);
    socket.on("round1:adminAdded", handleAdminAdded);

    return () => {
      socket.off("round1:matchEnd", handleMatchEnd);
      socket.off("round1:ended", handleRoundEnd);
      socket.off("round1:timerUpdate", handleTimerUpdate);
      socket.off("round1:adminRemoved", handleAdminRemoved);
      socket.off("round1:adminAdded", handleAdminAdded);
    };
  }, [socket, isConnected, router, matchEndData]); //

  const handleMatchEndClose = () => {
    setShowMatchEndPopup(false);

    console.log("[MATCH END CLOSE] matchEndData:", matchEndData);

    if (matchEndData?.type === "admin_end") {
      showInfoToast("Round ended by admin. Redirecting to Dashboard...");
      console.log("[MATCH END CLOSE] Admin end - redirecting to dashboard");
      setTimeout(() => router.push("/"), 1000);
    } else {
      showInfoToast("Returning to the waiting room for your next match...");
      router.push("/r1/waiting");
    }
  };

  const getPopupContent = (type: "win" | "lose" | "timeout" | "admin_end") => {
    switch (type) {
      case "win":
        return {
          title: "🎉 Victory!",
          message:
            "You won the duel! You will enter a cooldown before the next match.",
          className: "text-green-400",
        };
      case "lose":
        return {
          title: "😔 Defeat",
          message:
            "You lost this duel. You will enter a cooldown before the next match.",
          className: "text-red-400",
        };
      case "timeout":
        return {
          title: "⏰ Time's Up!",
          message:
            "The match ended in a draw. You will enter a cooldown before the next match.",
          className: "text-yellow-400",
        };
      case "admin_end":
        return {
          title: "🛑 Round Ended",
          message:
            "The admin has ended Round 1. You will be redirected to the dashboard.",
          className: "text-orange-400",
          buttonText: "Return to Dashboard",
        };
    }
  };

  if (pageIsLoading || isAuthLoading) {
    return (
      <LoadingOverlay isLoading={true} message="Loading Round 1 Match..." />
    );
  }

  const popupContent = matchEndData ? getPopupContent(matchEndData.type) : null;

  return (
    <>
      <CodePageComponent matchData={matchData} timeRemaining={timeRemaining} />
      {showMatchEndPopup && popupContent && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800 p-8 rounded-lg border-2 border-orange-500 text-center max-w-md">
            <h2 className={`text-3xl font-bold mb-4 ${popupContent.className}`}>
              {popupContent.title}
            </h2>
            <p className="text-white text-lg mb-6">{popupContent.message}</p>
            <button
              onClick={handleMatchEndClose}
              className="px-6 py-2 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg transition-colors"
            >
              {popupContent.buttonText || "Continue to Waiting Room"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
