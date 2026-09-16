"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Editor, { useMonaco } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { useAuth } from "@/contexts/AuthContext";
import CustomScrollbar from "@/components/shared/CustomScrollbar";
import Button from "@/components/shared/ColoredBtn";
import {
  showErrorToast,
  showInfoToast,
  showSuccessToast,
} from "@/components/shared/CustomToast";
import SecureWrapper from "@/components/shared/SecureWrapper";

interface Problem {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  constraints: string[];
  boilerplate: { [key: string]: string };
  sampleTestCases: TestCase[];
  hiddenTestCases?: TestCase[];
  testCases?: TestCase[];
  hints: string[];
  avgTimeComplexity?: string;
  avgSpaceComplexity?: string;
}

interface TestCase {
  stdin?: string;
  expected_output?: string;
  input?: {
    stdin?: string;
    json?: any;
  };
  output?: {
    stdout?: string;
    json?: any;
  };
  explanation?: string;
}

interface SubmissionResult {
  token: string;
  status: {
    id: number;
    description: string;
  };
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  time: string | null;
  memory: string | null;
}

interface CodePageProps {
  round: string;
  currentProblem: Problem | null;
  problems: Problem[];
  currentProblemIndex: number;
  timeRemaining: number;
  roundDuration: number;
  isRoundActive: boolean;
  isLoading: boolean;
  onNextQuestion?: () => void;
  onReturnToLobby?: () => void;
}

export default function CodePage({
  round,
  currentProblem,
  problems,
  currentProblemIndex,
  timeRemaining,
  roundDuration,
  isRoundActive,
  isLoading,
  onNextQuestion,
  onReturnToLobby,
}: CodePageProps) {
  const router = useRouter();
  const { user, session } = useAuth();

  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("python");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [submissionResults, setSubmissionResults] = useState<
    SubmissionResult[] | null
  >(null);
  const [showHints, setShowHints] = useState(false);

  const codeRef = useRef(code);
  useEffect(() => {
    codeRef.current = code;
  }, [code]);

  const [codeEditorHeight, setCodeEditorHeight] = useState(60);
  const [isDragging, setIsDragging] = useState(false);

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

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

  const getMonacoLanguage = (lang: string) => {
    const languageMap: { [key: string]: string } = {
      python: "python",
      java: "java",
      cpp: "cpp",
      c: "c",
      javascript: "javascript",
    };
    return languageMap[lang] || "python";
  };

  const monaco = useMonaco();

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

  const getStorageKey = () => `battlecode-round-${round}-code-store`;

  // Load code on problem change
  useEffect(() => {
    try {
      if (currentProblem) {
        const key = getStorageKey();
        const stored = localStorage.getItem(key);
        const store = stored ? JSON.parse(stored) : {};
        const contextKey = `${round}:${currentProblem.id}:${language}`;
        const savedCode = store[contextKey];
        setCode(savedCode || "");
      }
    } catch (error) {
      console.error("Error loading code for problem change:", error);
    }
  }, [currentProblem, round, language]);

  const handleLanguageChange = (newLanguage: string) => {
    if (newLanguage === language || !currentProblem) return;
    try {
      const key = getStorageKey();
      const stored = localStorage.getItem(key);
      const store = stored ? JSON.parse(stored) : {};

      const currentCode = codeRef.current;
      // Save current code for old language
      const oldContextKey = `${round}:${currentProblem.id}:${language}`;
      if (currentCode !== undefined) {
        store[oldContextKey] = currentCode;
      }

      // Retrieve code for new language
      const newContextKey = `${round}:${currentProblem.id}:${newLanguage}`;
      const savedCode = store[newContextKey];

      const codeToSet = savedCode || "";

      localStorage.setItem(key, JSON.stringify(store));
      setCode(codeToSet);
      setLanguage(newLanguage);
    } catch (error) {
      console.error("Error changing language:", error);
      setLanguage(newLanguage);
    }
  };

  function handleEditorMount(
    editor: monaco.editor.IStandaloneCodeEditor,
    monacoInstance: typeof import("monaco-editor"),
  ) {
    editorRef.current = editor;

    //comment here to enable copy-paste
    // Disable paste via context menu
    editor.addAction({
      id: "editor.action.clipboardPasteAction",
      label: "Paste",
      keybindings: [
        monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyV,
      ],
      precondition: "false",
      run: () => {
        showErrorToast("Paste is disabled");
      },
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
      monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyV,
      () => {
        showErrorToast("Paste shortcut is disabled");
      },
    );
  }
  //till here

  const executeCode = async (isSubmission = false) => {
    if (!currentProblem) {
      showErrorToast("No problem loaded");
      return;
    }

    const action = isSubmission ? "submitting" : "running";
    showInfoToast(
      `${action.charAt(0).toUpperCase() + action.slice(1)} your code...`,
    );

    if (isSubmission) {
      setIsSubmitting(true);
    } else {
      setIsRunning(true);
    }

    try {
      const languageIds: { [key: string]: number } = {
        python: 71,
        java: 62,
        cpp: 54,
        c: 50,
        javascript: 63,
      };

      const languageId = languageIds[language] || 71;

      const testCasesToRun = isSubmission
        ? currentProblem.hiddenTestCases ||
          currentProblem.testCases ||
          currentProblem.sampleTestCases
        : currentProblem.sampleTestCases;

      if (!testCasesToRun || testCasesToRun.length === 0) {
        throw new Error("No test cases available");
      }

      const submissions = testCasesToRun.map((testCase, index) => {
        try {
          const inputData =
            testCase.stdin ||
            testCase.input?.stdin ||
            JSON.stringify(testCase.input?.json) ||
            "";
          const expectedOutput =
            testCase.expected_output ||
            testCase.output?.stdout ||
            JSON.stringify(testCase.output?.json) ||
            "";

          return {
            language_id: languageId,
            source_code: btoa(code),
            stdin: btoa(inputData),
            expected_output: btoa(expectedOutput),
          };
        } catch (encodeError) {
          console.error(`Error encoding test case ${index}:`, encodeError);
          throw new Error(`Failed to encode test case ${index + 1}`);
        }
      });

      const apiUrl = process.env.NEXT_PUBLIC_API_URL;
      if (!apiUrl) {
        throw new Error("API URL not configured");
      }

      const response = await fetch(`${apiUrl}/execute-batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ submissions }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(
          `HTTP error! status: ${response.status}, message: ${errorText}`,
        );
      }

      const results = await response.json();

      if (!Array.isArray(results)) {
        throw new Error("Invalid response format from execution service");
      }

      const formattedResults: SubmissionResult[] = results.map(
        (result: any, index: number) => ({
          token: result.token || `test_${index}`,
          status: {
            id: result.status?.id || 3,
            description: result.status?.description || "Accepted",
          },
          stdout: result.stdout || null,
          stderr: result.stderr || null,
          compile_output: result.compile_output || null,
          time: result.time || null,
          memory: result.memory || null,
        }),
      );

      setSubmissionResults(formattedResults);

      const passedTests = formattedResults.filter(
        (r) => r.status.description === "Accepted",
      ).length;
      const totalTests = formattedResults.length;

      if (isSubmission) {
        if (passedTests === totalTests) {
          showSuccessToast(`🎉 All ${totalTests} test cases passed!`);
        } else {
          showErrorToast(`${passedTests}/${totalTests} test cases passed`);
        }
      } else {
        showInfoToast(
          `Test run completed: ${passedTests}/${totalTests} passed`,
        );
      }
    } catch (error) {
      console.error("Execution error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      showErrorToast(`Failed to ${action} code: ${errorMessage}`);
    } finally {
      if (isSubmission) {
        setIsSubmitting(false);
      } else {
        setIsRunning(false);
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    e.preventDefault();
  };

  const handleMouseMove = (e: MouseEvent) => {
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
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

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
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging]);

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

  const formatTestCaseData = (data: any): string => {
    if (typeof data === "string") return data;
    if (Array.isArray(data)) return data.join(", ");
    if (typeof data === "object" && data !== null) {
      const entries = Object.entries(data);
      return entries
        .map(([key, value]) => {
          if (Array.isArray(value)) {
            return `${key} = [${value.join(", ")}]`;
          }
          return `${key} = ${value}`;
        })
        .join("\n");
    }
    return String(data);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-black/40 text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
          <p>Loading Round {round}...</p>
        </div>
      </div>
    );
  }

  if (!currentProblem) {
    return (
      <div className="flex items-center justify-center h-screen bg-black/40 text-white">
        <div className="flex flex-col items-center gap-4">
          <p>No active round found or waiting for problems to load...</p>
          <button
            onClick={onReturnToLobby}
            className="px-6 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
          >
            Return to Lobby
          </button>
        </div>
      </div>
    );
  }

  return (
    //remove this securewrapper also to disable copy paste
    <SecureWrapper>
      <div className="flex flex-col h-screen text-white overflow-hidden bg-[url('/bg-code.svg')] bg-fixed bg-cover bg-center oxanium">
        <div className="flex-1 flex p-4 gap-4 bg-black/40 min-h-0">
          <CustomScrollbar className="w-1/2 flex border rounded-lg border-amber-600 bg-black/40 p-4 flex-col min-h-0 overflow-hidden glass-box">
            <div className="flex justify-between items-start mb-4 flex-shrink-0">
              <div>
                <h2 className="text-2xl font-bold">{currentProblem.title}</h2>
                <div className="flex gap-4 text-sm text-gray-400 mt-1">
                  <span>Difficulty: {currentProblem.difficulty}</span>
                  <span>Round: {round}</span>
                  <span>
                    Question: {currentProblemIndex + 1}/{problems.length}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  content={showHints ? "Hide" : "Hint💡"}
                  onClick={() => setShowHints(!showHints)}
                />
                {currentProblemIndex < problems.length - 1 &&
                  onNextQuestion && (
                    <button
                      onClick={onNextQuestion}
                      className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                      Next →
                    </button>
                  )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {showHints &&
                currentProblem.hints &&
                currentProblem.hints.length > 0 && (
                  <div className="mb-4 bg-gray-800 p-3 rounded">
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

              {currentProblem.constraints &&
                currentProblem.constraints.length > 0 && (
                  <>
                    <h3 className="font-bold mb-2 text-amber-400">
                      Constraints:
                    </h3>
                    <ul className="list-disc list-inside mb-4 text-gray-300 font-mono text-sm">
                      {currentProblem.constraints.map((constraint, i) => (
                        <li key={i}>{constraint}</li>
                      ))}
                    </ul>
                  </>
                )}

              {currentProblem.sampleTestCases &&
                currentProblem.sampleTestCases.length > 0 && (
                  <>
                    <h3 className="font-bold mb-4 text-amber-400">
                      Sample Cases:
                    </h3>
                    {currentProblem.sampleTestCases.map((testCase, i) => (
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
          </CustomScrollbar>

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
                  >
                    <option value="python">Python</option>
                    <option value="java">Java</option>
                    <option value="cpp">C++</option>
                    <option value="c">C</option>
                    <option value="javascript">JavaScript</option>
                  </select>
                  <div
                    className={`bg-gray-800 flex-1 text-white p-2 rounded border focus:outline-none focus:ring-2 focus:ring-amber-500 text-center font-mono ${
                      getTimerDisplay().className
                    }`}
                  >
                    {getTimerDisplay().time}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    className="flex items-center gap-2 bg-gray-800 text-white p-2 rounded border border-amber-600 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    onClick={() => executeCode(false)}
                    disabled={isRunning || isSubmitting}
                  >
                    <span>Run</span>
                    <img src="/run.svg" className="h-4 w-4" />
                  </button>
                  <button
                    className="bg-gray-800 text-white p-2 rounded border border-amber-600 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    onClick={() => executeCode(true)}
                    disabled={isSubmitting || isRunning}
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
                  options={editorOptions}
                  onMount={handleEditorMount}
                  loading={
                    <div className="flex items-center justify-center h-full bg-gray-900">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
                    </div>
                  }
                />
              </div>
            </div>

            <div
              className={`h-1 bg-amber-600/20 hover:bg-amber-600/40 cursor-row-resize transition-colors duration-200 flex items-center justify-center ${
                isDragging ? "bg-amber-600/60" : ""
              }`}
              onMouseDown={handleMouseDown}
            >
              <div className="w-8 h-1 bg-amber-600 rounded-full"></div>
            </div>

            <div
              className="border border-amber-600 rounded-lg p-4 flex flex-col min-h-0"
              style={{
                height: `${100 - codeEditorHeight}%`,
                minHeight: "150px",
              }}
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
                        result.status.description === "Accepted";
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
      </div>
    </SecureWrapper>
  );
}
