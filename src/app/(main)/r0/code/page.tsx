"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSocket } from "@/contexts/SocketContext";
import { useAuth } from "@/contexts/AuthContext";
import CodePage from "./CodePage";
import {
  showSuccessToast,
  showErrorToast,
  showInfoToast,
} from "@/components/shared/CustomToast";
import LoadingOverlay from "@/components/shared/LoadingOverlay";

// --- Interfaces ---
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
}

interface TestCase {
  stdin?: string;
  expected_output?: string;
  input?: { stdin?: string; json?: Record<string, unknown> };
  output?: { stdout?: string; json?: Record<string, unknown> };
  explanation?: string;
}

interface TimerData {
  timeRemaining?: number;
  duration?: number;
  elapsed?: number;
  startTime?: number;
  endTime?: number;
}

interface RoundEndData {
  message?: string;
}

interface Participant {
  userId: string;
  username: string;
  email?: string;
  role?: string;
  status: string;
  rank?: number;
  eventScore?: number;
  socketId?: string;
  joinedAt?: string;
  disconnectedAt?: string;
  reconnectedAt?: string;
  finishedAt?: string;
  cooldownEndTime?: number;
  isReady?: boolean;
}

interface UserProgress {
  problemsSolved: number;
  currentProblem: number;
  score: number;
  lastActivity: string;
}

interface StateResponse {
  success?: boolean;
  error?: string;
  timestamp?: number;
  roundNumber?: number;

  round?: {
    isActive: boolean;
    status: "LOBBY" | "IN_PROGRESS" | "COMPLETED" | "LOCKED";
    startTime: number | null;
    endTime: number | null;
    timeRemaining: number;
    duration: number;
  };

  participants?: {
    total: number;
    byStatus: {
      lobby: Array<Participant>;
      waiting: Array<Participant>;
      in_match: Array<Participant>;
      cooldown: Array<Participant>;
      finished: Array<Participant>;
      disconnected: Array<Participant>;
    };
    all: Array<Participant>;
  };

  currentUser?: Participant | null;

  session?: {
    type: "match" | "bounty" | "problem";
    id: string;
    startTime: number;
    endTime: number;
    timeRemaining: number;
    problem?: Problem;
    problems?: Array<Problem>;
    currentProblemIndex?: number;
    totalProblems?: number;
  };

  roundSpecific?: {
    progress?: UserProgress;
  };

  message?: string;
}

interface NextQuestionResponse {
  success?: boolean;
  error?: { message?: string } | string;
  problem?: Problem;
  problemIndex?: number;
  timeRemaining?: number;
  [key: string]: unknown;
}

// --- Component ---
export default function R0Code() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  const { socket, isConnected, isLoading: isSocketLoading } = useSocket();

  // --- State Management ---
  const [currentProblem, setCurrentProblem] = useState<Problem | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [currentProblemIndex, setCurrentProblemIndex] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [roundEndTime, setRoundEndTime] = useState<number | null>(null);
  const [roundDuration, setRoundDuration] = useState(1_200_000);
  const [isRoundActive, setIsRoundActive] = useState(false);
  const [pageIsLoading, setPageIsLoading] = useState(true);

  // --- Refs for Lifecycle Management ---
  const hasInitialized = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // --- Socket Event Listeners ---
  useEffect(() => {
    if (!socket || !isConnected) {
      console.log(
        "[Socket Listeners] Socket not ready. Socket:",
        !!socket,
        "Connected:",
        isConnected,
      );
      return;
    }

    console.log(
      "[Socket Listeners] Setting up socket event listeners for round0",
    );

    const applyDeadline = (
      source?: TimerData | StateResponse["round"] | StateResponse["session"],
    ) => {
      if (!source || !isMountedRef.current) return;
      if (
        typeof source.endTime === "number" &&
        Number.isFinite(source.endTime)
      ) {
        setRoundEndTime(source.endTime);
      } else if (
        "duration" in source &&
        typeof source.startTime === "number" &&
        typeof source.duration === "number"
      ) {
        setRoundEndTime(source.startTime + source.duration);
      } else if (
        "elapsed" in source &&
        "duration" in source &&
        typeof source.duration === "number" &&
        typeof source.elapsed === "number"
      ) {
        setRoundEndTime(
          Date.now() + Math.max(0, source.duration - source.elapsed),
        );
      } else if ((source.timeRemaining ?? 0) > 0) {
        setRoundEndTime(Date.now() + source.timeRemaining!);
      }
    };

    const handleTimerUpdate = (data: TimerData) => {
      applyDeadline(data);
    };

    const handleRoundEnd = (data: RoundEndData) => {
      if (!isMountedRef.current) return;

      localStorage.removeItem(`battlecode-round-0-code-store`);
      sessionStorage.removeItem("round0_data");
      sessionStorage.removeItem("fullscreen_violations");

      setIsRoundActive(false);
      showInfoToast(data.message || "Round 0 has ended!");
      setTimeout(() => {
        if (isMountedRef.current) router.push("/dashboard");
      }, 3000);
    };

    const handleAdminRemoved = () => {
      console.log("You have been removed from Round 0 by an admin");
      showErrorToast("You have been removed from Round 0 by an admin");
      localStorage.removeItem("battlecode-round-0-code-store");
      sessionStorage.removeItem("round0_data");
      sessionStorage.removeItem("fullscreen_violations");
      router.push("/");
    };

    const handleAdminAdded = () => {
      console.log(
        "handleAdminAdded triggered - You have been added to Round 0 by an admin",
      );
      console.log(
        "Socket available:",
        !!socket,
        "Socket connected:",
        isConnected,
      );

      if (!socket || !isConnected) {
        console.error("Socket not available or not connected");
        showErrorToast("Connection error. Please refresh the page.");
        return;
      }

      // Check current round status
      console.log("Emitting user:current-round request...");
      socket.emit(
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
          console.log("user:current-round response received:", response);

          if (!response.success || !response.currentRound) {
            console.error("Failed to get current round:", response);
            showErrorToast("Failed to check round status");
            return;
          }

          const { currentRoundNumber, currentRoundStatus } =
            response.currentRound;
          console.log(
            "Current round number:",
            currentRoundNumber,
            "Status:",
            currentRoundStatus,
          );

          if (currentRoundNumber !== 0) {
            showErrorToast("Round 0 is not the current round");
            return;
          }

          if (currentRoundStatus === "LOBBY") {
            showSuccessToast(
              "You have been added to Round 0! Redirecting to lobby...",
            );
            setTimeout(() => router.push("/r0/lobby"), 1500);
          } else if (currentRoundStatus === "IN_PROGRESS") {
            showSuccessToast(
              "You have been added to Round 0! Joining the round...",
            );
            setTimeout(() => window.location.reload(), 1500);
          } else if (currentRoundStatus === "COMPLETED") {
            showErrorToast("Round 0 has already completed");
          } else if (currentRoundStatus === "LOCKED") {
            showErrorToast("Round 0 is currently locked");
          }
        },
      );
    };

    const handleViolation = () => {
      console.log("round0:violation event received");
      showErrorToast("you have been removed from the round due to violation");
      localStorage.removeItem("battlecode-round-0-code-store");
      sessionStorage.removeItem("round0_data");
      sessionStorage.removeItem("fullscreen_violations");
      router.push("/dashboard");
    };

    socket.on("round0:timer", handleTimerUpdate);
    socket.on("round0:ended", handleRoundEnd);
    socket.on("round0:adminRemoved", handleAdminRemoved);
    socket.on("round0:adminAdded", handleAdminAdded);
    socket.on("round0:violation", handleViolation);

    return () => {
      socket.off("round0:timer", handleTimerUpdate);
      socket.off("round0:ended", handleRoundEnd);
      socket.off("round0:adminRemoved", handleAdminRemoved);
      socket.off("round0:adminAdded", handleAdminAdded);
      socket.off("round0:violation", handleViolation);
    };
  }, [socket, isConnected, router]);

  // --- Main Initialization Logic ---
  useEffect(() => {
    const isAppReady =
      !isAuthLoading && !isSocketLoading && user && socket && isConnected;
    if (!isAppReady || hasInitialized.current) {
      return;
    }
    hasInitialized.current = true;

    // PRIMARY METHOD: Attempt to load data from sessionStorage
    const storedDataRaw = sessionStorage.getItem("round0_data");
    if (storedDataRaw) {
      try {
        const storedData = JSON.parse(storedDataRaw);
        sessionStorage.removeItem("round0_data"); // Clean up immediately

        const { problems: initialProblems, duration, startTime } = storedData;

        setProblems(initialProblems);
        setRoundDuration(duration || 1_200_000);
        if (initialProblems.length > 0) {
          setCurrentProblem(initialProblems[0]);
          setCurrentProblemIndex(0);
        }
        if (typeof startTime === "number") {
          setRoundEndTime(startTime + (duration || 1_200_000));
        }
        setIsRoundActive(true);
        setPageIsLoading(false);
        return; // Success, no need to fetch
      } catch (error) {
        console.error("Failed to parse sessionStorage data:", error);
        // If parsing fails, proceed to fetch from server as a fallback.
      }
    }

    // FALLBACK METHOD: Only runs if sessionStorage is empty (e.g., on page refresh)

    const handleState = (response: StateResponse) => {
      if (!isMountedRef.current) return;

      try {
        if (response?.session?.problem && response?.round?.isActive) {
          setCurrentProblem(response.session.problem);
          setCurrentProblemIndex(response.session.currentProblemIndex || 0);
          if (response.round.endTime) {
            setRoundEndTime(response.round.endTime);
          } else if (response.round.startTime && response.round.duration) {
            setRoundEndTime(response.round.startTime + response.round.duration);
          } else if ((response.session.timeRemaining ?? 0) > 0) {
            setRoundEndTime(Date.now() + response.session.timeRemaining);
          }
          setProblems(response.session.problems || [response.session.problem]);
          setRoundDuration(response.round.duration || 1_200_000);
          setIsRoundActive(true);
        } else {
          const errorMessage = response?.error || "No active round found.";

          showErrorToast(errorMessage);
          localStorage.removeItem(`battlecode-round-0-code-store`);
          router.push("/dashboard");
        }
      } catch (error) {
        console.error("Error processing round state:", error);
        showErrorToast("Failed to load round data. Please try again.");
        router.push("/dashboard");
      } finally {
        setPageIsLoading(false);
      }
    };

    const handleStateError = (err: { error?: string }) => {
      if (!isMountedRef.current) return;

      showErrorToast(err?.error || "Failed to fetch round state");
      setPageIsLoading(false);
      router.push("/dashboard");
    };

    socket.once("round0:state", handleState);
    socket.once("round0:state:error", handleStateError);
    socket.emit("round0:getState");
  }, [isAuthLoading, isSocketLoading, user, socket, isConnected, router]);

  useEffect(() => {
    if (!roundEndTime) return;
    const tick = () =>
      setTimeRemaining(
        Math.max(0, Math.ceil((roundEndTime - Date.now()) / 1000)),
      );
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [roundEndTime]);

  // --- User Action Handlers ---
  const handleNextQuestion = async () => {
    if (!socket || !isConnected) {
      showErrorToast("Not connected to server");
      return;
    }

    setPageIsLoading(true);

    try {
      const handleNext = (response: NextQuestionResponse) => {
        if (!isMountedRef.current) return;

        if (response.problem) setCurrentProblem(response.problem);
        if (response.problemIndex !== undefined)
          setCurrentProblemIndex(response.problemIndex);

        if ((response.timeRemaining ?? 0) > 0) {
          setRoundEndTime(Date.now() + response.timeRemaining!);
        }

        showSuccessToast(
          `Moved to question ${(response.problemIndex ?? 0) + 1}`,
        );

        setPageIsLoading(false);
      };

      const handleNextError = (err: { error?: string }) => {
        if (!isMountedRef.current) return;

        showErrorToast(err?.error || "Failed to get next question");
        setPageIsLoading(false);
      };

      socket.once("round0:next", handleNext);
      socket.once("round0:next:error", handleNextError);
      socket.emit("round0:nextQuestion");
    } catch (error) {
      if (isMountedRef.current) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        showErrorToast(`Error getting next question: ${errorMessage}`);
        setPageIsLoading(false);
      }
    }
  };

  const handleReturnToLobby = () => {
    showInfoToast("Round-0 has ended.");
    router.push("/dashboard");
  };

  // --- Render ---
  return (
    <CodePage
      round="0"
      currentProblem={currentProblem}
      problems={problems}
      currentProblemIndex={currentProblemIndex}
      timeRemaining={timeRemaining}
      roundDuration={roundDuration}
      isRoundActive={isRoundActive}
      isLoading={pageIsLoading}
      onNextQuestion={handleNextQuestion}
      onReturnToLobby={handleReturnToLobby}
    />
  );
}
