"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Editor, { useMonaco } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { useSocket } from "@/contexts/SocketContext";
import { useAuth } from "@/contexts/AuthContext";
import Button from "@/components/shared/button";
import type { editor } from "monaco-editor";
import {
  showSuccessToast,
  showErrorToast,
  showInfoToast,
} from "@/components/shared/CustomToast";

// Interfaces
interface SavedMatchState {
  currentLanguage: string;
  languages: { [lang: string]: { code: string } };
}

interface MatchData {
  opponent: { id: string; rank?: number };
  question: {
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
  duration: number;
  endTime?: number;
  timeRemaining?: number;
  difficulty?: string;
}

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

// Custom Hook for interval with proper cleanup
function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef<() => void>(() => {});

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    function tick() {
      if (savedCallback.current) {
        savedCallback.current();
      }
    }
    if (delay !== null) {
      const id = setInterval(tick, delay);
      return () => clearInterval(id);
    }
  }, [delay]);
}

export default function R1CodePage() {
  const router = useRouter();
  const { socket } = useSocket();
  const { session, isLoading: authLoading } = useAuth();
  const monaco = useMonaco();

  // State declarations
  const [matchData, setMatchData] = useState<MatchData | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("python");
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [submissionResults, setSubmissionResults] = useState<
    SubmissionResult[] | null
  >(null);
  const [showHints, setShowHints] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [matchPaused, setMatchPaused] = useState(false);
  const [codeEditorHeight, setCodeEditorHeight] = useState(60);
  const [isDragging, setIsDragging] = useState(false);
  const [showViolationModal, setShowViolationModal] = useState(false);
  const [violationModalType, setViolationModalType] = useState<
    "forfeit" | "opponentViolated" | null
  >(null);

  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  // Constants
  const editorOptions = {
    minimap: { enabled: false },
    fontSize: 14,
    lineNumbers: "on" as const,
    roundedSelection: false,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
    wordWrap: "on" as const,
    bracketPairColorization: { enabled: true },
    autoIndent: "full" as const,
    formatOnPaste: true,
    formatOnType: true,
  };

  // Helper Functions
  const getMonacoLanguage = (lang: string) =>
    ({
      python: "python",
      java: "java",
      cpp: "cpp",
      c: "c",
    })[lang] || "python";

  const getMatchStorageKey = (problemId: string) =>
    `round1_match_state_${problemId}`;

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const getTimerDisplay = (): { time: string; className: string } => {
    const isWarning = timeRemaining <= 300;
    const isCritical = timeRemaining <= 60;
    return {
      time: formatTime(timeRemaining),
      className: isCritical
        ? "border-red-600 text-red-400"
        : isWarning
          ? "border-yellow-600 text-yellow-400"
          : "border-amber-600",
    };
  };

  function handleEditorMount(
    editor: editor.IStandaloneCodeEditor,
    monacoInstance: typeof import("monaco-editor"),
  ) {
    editorRef.current = editor;
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
          // Fixed with the specific event type
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

  const formatTestCaseData = (data: unknown): string => {
    if (typeof data === "string") return data;
    if (Array.isArray(data)) return data.join(", ");
    if (typeof data === "object" && data !== null) {
      return Object.entries(data)
        .map(([key, value]) =>
          Array.isArray(value)
            ? `${key} = [${value.join(", ")}]`
            : `${key} = ${value}`,
        )
        .join("\n");
    }
    return String(data);
  };

  const codeRef = useRef(code);
  useEffect(() => {
    codeRef.current = code;
  }, [code]);

  const saveCurrentState = useCallback(() => {
    if (!problem) return;
    const key = getMatchStorageKey(problem.id);
    try {
      const existingStateStr = localStorage.getItem(key);
      const state: SavedMatchState = existingStateStr
        ? JSON.parse(existingStateStr)
        : { currentLanguage: language, languages: {} };
      state.currentLanguage = language;
      if (!state.languages) state.languages = {};
      state.languages[language] = { code: codeRef.current || code };
      localStorage.setItem(key, JSON.stringify(state));
    } catch (e) {
      console.error("Failed to save state:", e);
    }
  }, [problem, language, code]);

  const handleLanguageChange = (newLanguage: string) => {
    if (!problem || language === newLanguage) return;
    saveCurrentState();
    const key = getMatchStorageKey(problem.id);
    const savedStateStr = localStorage.getItem(key);
    let newCode = "";
    if (savedStateStr) {
      try {
        const state: SavedMatchState = JSON.parse(savedStateStr);
        newCode = state.languages?.[newLanguage]?.code || "";
      } catch (e) {
        console.error("Failed to parse saved state on language change", e);
        newCode = "";
      }
    } else {
      newCode = "";
    }
    setCode(newCode);
    setLanguage(newLanguage);
  };

  const handleSubmit = useCallback(async () => {
    if (!problem || !matchData || isSubmitting) return;
    setIsSubmitting(true);
    setSubmissionResults(null);
    showInfoToast("Submitting your solution for final judging...");

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/submit`,
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

      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);

      const result = await response.json();

      if (result.success) {
        setSubmissionResults(result.results || []);
        const { summary, submission } = result;
        if (submission && submission.status === "ACCEPTED") {
          showSuccessToast(
            `🎉 All ${summary.total} test cases passed! You won the match!`,
          );
        } else {
          showErrorToast(
            `${summary.passed}/${summary.total} test cases passed. Keep trying!`,
          );
        }
      } else {
        showErrorToast(result.message || "Submission failed");
        if (result.results) setSubmissionResults(result.results);
      }
    } catch (error) {
      console.error("Submit error:", error);
      showErrorToast(
        `Failed to submit: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [problem, matchData, session, language, code, isSubmitting]);

  const executeCode = async () => {
    if (!problem) {
      showErrorToast("No problem loaded");
      return;
    }
    setIsRunning(true);
    setSubmissionResults(null);
    showInfoToast("Running your code against sample cases...");
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          language,
          source_code: code,
          problemId: problem.id,
        }),
      });
      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);
      const result = await response.json();
      if (result.success) {
        setSubmissionResults(result.results || []);
        showInfoToast(
          `Test run completed: ${result.summary.passed}/${result.summary.total} passed`,
        );
      } else {
        throw new Error(result.error || "Failed to run code");
      }
    } catch (error) {
      console.error("Run error:", error);
      showErrorToast(
        `Failed to run code: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsRunning(false);
    }
  };

  const timerTick = useCallback(() => {
    if (!matchData?.startTime || (!matchData?.duration && !matchData?.endTime))
      return;
    const endTime =
      matchData.endTime || matchData.startTime + matchData.duration;
    const remainingSeconds = Math.max(
      0,
      Math.ceil((endTime - Date.now()) / 1000),
    );
    setTimeRemaining(remainingSeconds);
    if (remainingSeconds <= 0) {
      handleSubmit();
    }
  }, [matchData, handleSubmit]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    e.preventDefault();
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      const container = document.querySelector(
        ".code-results-container",
      ) as HTMLElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const containerHeight = rect.height;
      const mouseY = e.clientY - rect.top;
      const newHeightPercentage = Math.max(
        20,
        Math.min(80, (mouseY / containerHeight) * 100),
      );
      setCodeEditorHeight(newHeightPercentage);
    },
    [isDragging],
  );

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleViolationModalClose = () => {
    setShowViolationModal(false);
    setViolationModalType(null);
    router.push("/r1/waiting");
  };

  const handleMatchPause = (data: { message?: string }) => {
    setMatchPaused(true);
    showInfoToast(data.message || "Match paused - opponent disconnected");
  };

  const handleMatchResume = (data: {
    message?: string;
    startTime?: number;
    duration?: number;
  }) => {
    setMatchPaused(false);
    showSuccessToast(data.message || "Match resumed - opponent reconnected");
    if (data.startTime && data.duration) {
      setMatchData((prev) =>
        prev
          ? { ...prev, startTime: data.startTime!, duration: data.duration! }
          : null,
      );
    }
  };

  const handleCooldown = () => {
    if (problem) localStorage.removeItem(getMatchStorageKey(problem.id));
    showSuccessToast("Match completed! Entering cooldown period...");
    router.push("/r1/waiting");
  };

  const handleRoundEnd = (_data?: { endTime?: number }) => {
    if (problem) localStorage.removeItem(getMatchStorageKey(problem.id));
    showInfoToast("Round 1 has ended");
    router.push("/");
  };

  const handleTimerUpdate = (data: {
    timeRemaining?: number;
    endTime?: number;
  }) => {
    const remainingMs =
      typeof data.endTime === "number"
        ? Math.max(0, data.endTime - Date.now())
        : (data.timeRemaining ?? 0);
    const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));

    if (typeof data.endTime === "number" && Number.isFinite(data.endTime)) {
      setMatchData((prev) => {
        if (!prev || prev.endTime === data.endTime) return prev;
        return { ...prev, endTime: data.endTime };
      });
    }

    setTimeRemaining(remainingSeconds);

    if (remainingSeconds <= 60 && remainingSeconds > 0) {
      showErrorToast(`Only ${remainingSeconds} seconds remaining!`);
    }

    if (remainingSeconds <= 0) {
      showErrorToast("Time's up! Auto-submitting your solution...");
      handleSubmit();
    }
  };

  const handleAdminRemoved = () => {
    if (problem) localStorage.removeItem(getMatchStorageKey(problem.id));
    showErrorToast("You have been removed from Round 1 by an admin");
    router.push("/");
  };

  const handleViolationForfeit = () => {
    if (problem) localStorage.removeItem(getMatchStorageKey(problem.id));
    setViolationModalType("forfeit");
    setShowViolationModal(true);
  };

  const handleOpponentViolated = () => {
    if (problem) localStorage.removeItem(getMatchStorageKey(problem.id));
    setViolationModalType("opponentViolated");
    setShowViolationModal(true);
  };

  const handleState = (data: {
    success?: boolean;
    matchData?: MatchData;
    session?: { endTime?: number; timeRemaining?: number };
    globalTimeRemaining?: number;
  }) => {
    if (!data.success) return;

    if (data.matchData) {
      setMatchData((prev) =>
        prev ? { ...prev, ...data.matchData } : (data.matchData ?? null),
      );
    }

    const remainingMs =
      data.session?.timeRemaining ??
      data.matchData?.timeRemaining ??
      data.globalTimeRemaining;
    if (typeof data.session?.endTime === "number") {
      setMatchData((prev) =>
        prev ? { ...prev, endTime: data.session!.endTime } : prev,
      );
      setTimeRemaining(
        Math.max(0, Math.ceil((data.session.endTime - Date.now()) / 1000)),
      );
    } else if (typeof remainingMs === "number") {
      setTimeRemaining(Math.max(0, Math.ceil(remainingMs / 1000)));
    }
  };

  // useEffect Hooks

  useEffect(() => {
    if (monaco) {
      monaco.editor.defineTheme("custom-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "comment", foreground: "#6A9955" },
          { token: "keyword", foreground: "#569CD6" },
          { token: "string", foreground: "#CE9178" },
          { token: "number", foreground: "#B5CEA8" },
        ],
        colors: {
          "editor.background": "#0a0a0a",
          "editor.foreground": "#ffffff",
          "editor.lineHighlightBackground": "#1a1a1a",
          "editor.selectionBackground": "#264f78",
          "editor.inactiveSelectionBackground": "#3a3d41",
          "editorCursor.foreground": "#f97316",
          "editorLineNumber.foreground": "#858585",
          "editorLineNumber.activeForeground": "#f97316",
          "editor.selectionHighlightBackground": "#ADD6FF26",
          "editor.wordHighlightBackground": "#575757B8",
          "editorBracketMatch.background": "#0064001a",
          "editorBracketMatch.border": "#888888",
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

  useEffect(() => {
    const savedMatchData = sessionStorage.getItem("round1_match_data");
    if (savedMatchData) {
      try {
        const data: MatchData = JSON.parse(savedMatchData);
        setMatchData(data);
        if (data.endTime || (data.startTime && data.duration)) {
          const endTime = data.endTime || data.startTime + data.duration;
          setTimeRemaining(
            Math.max(0, Math.ceil((endTime - Date.now()) / 1000)),
          );
        }
        if (data.question) {
          const problemData: Problem = {
            id: data.question.id,
            title: data.question.title,
            description: data.question.description,
            difficulty: data.question.difficulty,
            constraints: data.question.constraints || [],
            boilerplate: data.question.boilerplate || {},
            sampleTestCases: data.question.sampleTestCases || [],
            hints: data.question.hints || [],
          };
          setProblem(problemData);
          const key = getMatchStorageKey(data.question.id);
          const savedStateStr = localStorage.getItem(key);
          let restoredLanguage = "python";
          let restoredCode = "";
          if (savedStateStr) {
            const savedState: SavedMatchState = JSON.parse(savedStateStr);
            restoredLanguage = savedState.currentLanguage || "python";
            restoredCode = savedState.languages?.[restoredLanguage]?.code || "";
          }
          setLanguage(restoredLanguage);
          setCode(restoredCode);
        }
        setIsLoading(false);
      } catch (error) {
        console.error("Error parsing match data:", error);
        showErrorToast("Failed to load match data");
        router.push("/r1/lobby");
      }
    } else {
      showErrorToast("No match data found");
      router.push("/r1/lobby");
    }
  }, [router]);

  useEffect(() => {
    if (saveIntervalRef.current) clearInterval(saveIntervalRef.current);
    saveIntervalRef.current = setInterval(saveCurrentState, 3000);
    return () => {
      if (saveIntervalRef.current) clearInterval(saveIntervalRef.current);
      saveCurrentState();
    };
  }, [saveCurrentState]);

  useEffect(() => {
    if (!socket) return;

    socket.on("match:pause", handleMatchPause);
    socket.on("match:resume", handleMatchResume);
    socket.on("round1:cooldown", handleCooldown);
    socket.on("round1:ended", handleRoundEnd);
    socket.on("round1:timerUpdate", handleTimerUpdate);
    socket.on("round1:adminRemoved", handleAdminRemoved);
    socket.on("round1:violationForfeit", handleViolationForfeit);
    socket.on("round1:opponentViolated", handleOpponentViolated);

    return () => {
      socket.off("match:pause", handleMatchPause);
      socket.off("match:resume", handleMatchResume);
      socket.off("round1:cooldown", handleCooldown);
      socket.off("round1:ended", handleRoundEnd);
      socket.off("round1:timerUpdate", handleTimerUpdate);
      socket.off("round1:adminRemoved", handleAdminRemoved);
      socket.off("round1:violationForfeit", handleViolationForfeit);
      socket.off("round1:opponentViolated", handleOpponentViolated);
    };
  }, [socket, router, problem, handleSubmit]);

  // Request timer sync when socket and matchData are available
  useEffect(() => {
    if (socket && matchData && matchData.question && !isLoading) {
      socket.emit("round1:getTimerState", {
        questionId: matchData.question.id,
      });

      // Set up periodic timer sync every 10 seconds to stay accurate
      const syncInterval = setInterval(() => {
        if (socket && matchData && matchData.question) {
          socket.emit("round1:getTimerState", {
            questionId: matchData.question.id,
          });
        }
      }, 10000);

      // Also request sync again after a short delay to ensure we get fresh state
      const syncTimer = setTimeout(() => {
        if (socket && matchData && matchData.question) {
          socket.emit("round1:getTimerState", {
            questionId: matchData.question.id,
          });
        }
      }, 1000);

      return () => {
        clearInterval(syncInterval);
        clearTimeout(syncTimer);
      };
    }
  }, [socket, matchData, isLoading]);

  useEffect(() => {
    if (!socket) return;

    socket.on("round1:state", handleState);
    socket.emit("round1:getState"); // request once on mount

    return () => {
      socket.off("round1:state", handleState);
    };
  }, [socket]);

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

  // Timer interval — do not stop when timeRemaining is still 0 on first paint
  useInterval(timerTick, matchPaused ? null : 1000);

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-black/40 text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
          <p>Loading Round 1 Match...</p>
        </div>
      </div>
    );
  }
  if (!problem || !matchData) {
    return (
      <div className="flex items-center justify-center h-screen bg-black/40 text-white">
        <div className="flex flex-col items-center gap-4">
          <p>Failed to load match data...</p>
          <button
            onClick={() => router.push("/r1/lobby")}
            className="px-6 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
          >
            Return to Lobby
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen text-white overflow-hidden bg-[url('/bg-code.svg')] bg-fixed bg-cover bg-center oxanium">
      <div className="flex-shrink-0 flex items-center justify-between p-4 bg-black/60 backdrop-blur-sm border-b border-amber-600">
        <div>
          <h1 className="text-xl font-bold text-amber-400">
            Round 1 - Coding Duel
          </h1>
          <div className="text-sm text-gray-300">
            vs {matchData.opponent.id} | Difficulty:{" "}
            {matchData.difficulty || "Medium"}
          </div>
        </div>
        <div
          className={`text-center p-3 font-mono text-xl bg-gray-800 rounded border ${getTimerDisplay().className}`}
        >
          {matchPaused ? "PAUSED" : getTimerDisplay().time}
        </div>
      </div>

      {matchPaused && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-gray-800 p-8 rounded-lg border border-amber-600 text-center">
            <h2 className="text-2xl font-bold text-amber-400 mb-4">
              Match Paused
            </h2>
            <p className="text-gray-300 mb-4">
              Waiting for opponent to reconnect...
            </p>
            <div className="flex justify-center items-center gap-2">
              <div className="bg-amber-500 rounded-full h-3 w-3 animate-pulse"></div>
              <div
                className="bg-amber-500 rounded-full h-3 w-3 animate-pulse"
                style={{ animationDelay: "0.5s" }}
              ></div>
              <div
                className="bg-amber-500 rounded-full h-3 w-3 animate-pulse"
                style={{ animationDelay: "1s" }}
              ></div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex p-4 gap-4 bg-black/40 min-h-0">
        <div className="w-1/2 flex border rounded-lg border-amber-600 bg-black/40 p-4 flex-col min-h-0 overflow-hidden glass-box">
          <div className="flex justify-between items-start mb-4 flex-shrink-0">
            <div>
              <h2 className="text-2xl font-bold">{problem.title}</h2>
              <div className="flex gap-4 text-sm text-gray-400 mt-1">
                <span>Difficulty: {problem.difficulty}</span>
                <span>Round: 1</span>
              </div>
            </div>
            <Button
              content={showHints ? "Hide" : "Hint💡"}
              onClick={() => setShowHints(!showHints)}
            />
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {showHints && problem.hints && problem.hints.length > 0 && (
              <div className="mb-4 bg-gray-800 p-3 rounded">
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
                <h3 className="font-bold mb-2 text-amber-400">Constraints:</h3>
                <ul className="list-disc list-inside mb-4 text-gray-300 font-mono text-sm">
                  {problem.constraints.map((constraint, i) => (
                    <li key={i}>{constraint}</li>
                  ))}
                </ul>
              </>
            )}
            {problem.sampleTestCases && problem.sampleTestCases.length > 0 && (
              <>
                <h3 className="font-bold mb-4 text-amber-400">Sample Cases:</h3>
                {problem.sampleTestCases.map((testCase, i) => (
                  <div
                    key={i}
                    className="mb-4 bg-gray-800 p-3 rounded font-mono text-sm"
                  >
                    <p className="font-bold text-gray-400">Input:</p>
                    <pre className="bg-gray-900 p-2 rounded mt-1 whitespace-pre-wrap">
                      {formatTestCaseData(
                        testCase.stdin ||
                          testCase.input?.stdin ||
                          testCase.input?.json ||
                          "",
                      )}
                    </pre>
                    <p className="mt-2 font-bold text-gray-400">Output:</p>
                    <pre className="bg-gray-900 p-2 rounded mt-1 whitespace-pre-wrap">
                      {formatTestCaseData(
                        testCase.expected_output ||
                          testCase.output?.stdout ||
                          testCase.output?.json ||
                          "",
                      )}
                    </pre>
                    {testCase.explanation && (
                      <p className="mt-2 text-xs text-gray-400 italic">
                        Explanation: {testCase.explanation}
                      </p>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
        <div
          className="w-1/2 flex flex-col code-results-container border-amber-500"
          style={{ height: "100%" }}
        >
          <div
            className="border border-amber-600 rounded-lg p-4 flex flex-col min-h-0"
            style={{ height: `${codeEditorHeight}%`, minHeight: "200px" }}
          >
            <div className="flex justify-between items-center mb-2 gap-2">
              <div className="flex-1 flex gap-2">
                <select
                  value={language}
                  onChange={(e) => handleLanguageChange(e.target.value)}
                  className="bg-gray-800 flex-1 text-white p-2 rounded border border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  disabled={matchPaused}
                >
                  <option value="python">Python</option>
                  <option value="java">Java</option>
                  <option value="cpp">C++</option>
                  <option value="c">C</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  className="flex items-center gap-2 bg-gray-800 text-white p-2 rounded border border-amber-600 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  onClick={executeCode}
                  disabled={isRunning || isSubmitting || matchPaused}
                >
                  <span>Run</span>
                  <Image
                    src="/run.svg"
                    alt="Run Icon"
                    className="h-4 w-4"
                    width={16}
                    height={16}
                  />
                </button>
                <button
                  className="bg-black text-white p-2 rounded border border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  onClick={handleSubmit}
                  disabled={isSubmitting || isRunning || matchPaused}
                >
                  {isSubmitting ? "Submitting..." : "Submit"}
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
                options={{ ...editorOptions, readOnly: matchPaused }}
                onMount={(editor, monacoInstance) => {
                  editorRef.current = editor;
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
                        // Fixed with the specific event type
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
                }}
                loading={
                  <div className="flex items-center justify-center h-full bg-gray-900">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
                  </div>
                }
              />
            </div>
          </div>
          <div
            className={`h-1 bg-amber-600/20 hover:bg-amber-600/40 cursor-row-resize transition-colors duration-200 flex items-center justify-center ${isDragging ? "bg-amber-600/60" : ""}`}
            onMouseDown={handleMouseDown}
          >
            <div className="w-8 h-1 bg-amber-600 rounded-full"></div>
          </div>
          <div
            className="border border-amber-600 rounded-lg p-4 flex flex-col min-h-0"
            style={{ height: `${100 - codeEditorHeight}%`, minHeight: "150px" }}
          >
            <span className="text-lg font-bold flex-shrink-0">
              Test Results
            </span>
            <div className="mt-2 flex-grow overflow-y-auto">
              {(isSubmitting || isRunning) && (
                <div className="flex items-center gap-2 text-amber-400">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-amber-500"></div>
                  <span>
                    {isSubmitting ? "Submitting" : "Running"} your solution...
                  </span>
                </div>
              )}
              {submissionResults && (
                <div className="space-y-2">
                  {submissionResults.map((result, index) => {
                    const isAccepted =
                      result.status.description === "Accepted" || result.passed;
                    const isError = result.status.id > 3;
                    return (
                      <div
                        key={result.token || index}
                        className={`p-2 rounded ${isAccepted ? "bg-green-800/50" : isError ? "bg-red-800/50" : "bg-yellow-800/50"}`}
                      >
                        <p className="font-bold">
                          Test Case {index + 1}:{" "}
                          <span
                            className={`${isAccepted ? "text-green-400" : isError ? "text-red-400" : "text-yellow-400"}`}
                          >
                            {result.status.description}
                          </span>
                        </p>
                        {!isAccepted &&
                          (result.stderr || result.compile_output) && (
                            <pre className="text-xs text-red-300 mt-1 whitespace-pre-wrap bg-black/30 p-1 rounded">
                              {result.stderr || result.compile_output}
                            </pre>
                          )}
                        {result.time && (
                          <p className="text-xs text-gray-400 mt-1">
                            Time: {result.time}s | Memory: {result.memory}KB
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Violation Modal */}
      {showViolationModal && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50">
          <div className="text-center p-8 bg-gray-900 rounded-lg border-2 max-w-md">
            {violationModalType === "forfeit" ? (
              <>
                <div className="border-red-600 border-2 rounded-lg p-6">
                  <h2 className="text-3xl font-bold text-red-500 mb-4">
                    {" "}
                    Match Forfeited
                  </h2>
                  <p className="text-gray-300 mb-6 text-lg">
                    You have been disqualified for exceeding the maximum allowed
                    security violations.
                  </p>
                  <button
                    onClick={handleViolationModalClose}
                    className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded transition-colors w-full"
                  >
                    Return to Waiting Room
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="border-green-600 border-2 rounded-lg p-6">
                  <h2 className="text-3xl font-bold text-green-500 mb-4">
                    🎉 You Won!
                  </h2>
                  <p className="text-gray-300 mb-6 text-lg">
                    Your opponent has been disqualified for exceeding the
                    maximum allowed security violations.
                  </p>
                  <button
                    onClick={handleViolationModalClose}
                    className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-8 rounded transition-colors w-full"
                  >
                    Return to Waiting Room
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
