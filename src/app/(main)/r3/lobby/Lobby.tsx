"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Rocket } from "lucide-react";
import PlayerCard from "@/components/shared/PlayerCard";
import CustomScrollbar from "@/components/shared/CustomScrollbar";
import { useSocket } from "@/contexts/SocketContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  showSuccessToast,
  showErrorToast,
} from "@/components/shared/CustomToast";
import LoadingOverlay from "@/components/shared/LoadingOverlay";

// --- TYPE DEFINITIONS ---

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
  opponentUsername?: string;
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

interface Round3State {
  success: boolean;
  timestamp: number;
  roundNumber: number;
  round: {
    isActive: boolean;
    status: "LOBBY" | "IN_PROGRESS" | "COMPLETED";
    startTime: number | null;
    endTime: number | null;
    timeRemaining: number;
    duration: number;
  };
  participants: {
    total: number;
    byStatus: {
      lobby: Participant[];
      waiting: Participant[];
      in_match: Participant[];
      cooldown: Participant[];
      finished: Participant[];
      disconnected: Participant[];
    };
    all: Participant[];
  };
  currentUser: Participant | null;
  roundSpecific: {
    lockedQuestionIds: string[];
    questions: Problem[];
    isHackingPhase: boolean;
  };
  message?: string;
  error?: string;
}

interface LobbyData {
  success: boolean;
  error?: string;
  timestamp: number;
  roundNumber: number;
  round: {
    isActive: boolean;
    status: "LOBBY" | "IN_PROGRESS" | "COMPLETED" | "LOCKED";
    startTime: number | null;
    endTime: number | null;
    timeRemaining: number;
    duration: number;
  };
  participants: {
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
  currentUser: Participant | null;
  roundSpecific?: {
    lockedQuestionIds: string[];
    questions: Problem[];
    isHackingPhase: boolean;
  };
  message?: string;
}

interface RoundStartData {
  questions?: unknown[];
  startTime?: number;
  duration?: number;
  [key: string]: unknown;
}

interface SimpleSocketResponse {
  success: boolean;
  error?: string;
}

interface RoundInfo {
  roundNumber: number;
  status: "LOBBY" | "COMPLETED" | "LOCKED" | "IN_PROGRESS";
  isActive: boolean;
  isLocked: boolean;
}

interface CurrentRoundResponse extends SimpleSocketResponse {
  currentRound?: {
    currentRoundNumber: number;
    currentRoundStatus: "LOBBY" | "COMPLETED" | "LOCKED" | "IN_PROGRESS";
    rounds: RoundInfo[];
  };
}

interface TimerData {
  timeRemaining?: number;
  duration?: number;
  elapsed?: number;
  startTime?: number;
  endTime?: number;
}

interface ErrorData {
  message?: string;
  [key: string]: unknown;
}

// --- COMPONENT ---

export default function Lobbyr3() {
  const router = useRouter();
  const { socket, isConnected } = useSocket();
  const { user, userId, isLoading: authLoading, userRole } = useAuth();

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isRoundActive, setIsRoundActive] = useState(false);
  const [roundEndTime, setRoundEndTime] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [roundStarted, setRoundStarted] = useState(false);
  const [hasAttemptedJoin, setHasAttemptedJoin] = useState(false);
  const [authenticationChecked, setAuthenticationChecked] = useState(false);
  const [isCheckingRound, setIsCheckingRound] = useState(true);
  const [currentRoundData, setCurrentRoundData] = useState<
    CurrentRoundResponse["currentRound"] | null
  >(null);

  const isAdmin = userRole === "ADMIN";

  const applyRoundEndTime = useCallback(
    (source?: {
      endTime?: number | null;
      startTime?: number | null;
      duration?: number | null;
      timeRemaining?: number | null;
      elapsed?: number | null;
    }) => {
      if (!source) return;
      if (
        typeof source.endTime === "number" &&
        Number.isFinite(source.endTime)
      ) {
        setRoundEndTime(source.endTime);
      } else if (
        typeof source.startTime === "number" &&
        typeof source.duration === "number"
      ) {
        setRoundEndTime(source.startTime + source.duration);
      } else if (
        typeof source.duration === "number" &&
        typeof source.elapsed === "number"
      ) {
        setRoundEndTime(
          Date.now() + Math.max(0, source.duration - source.elapsed),
        );
      } else if ((source.timeRemaining ?? 0) > 0) {
        setRoundEndTime(Date.now() + (source.timeRemaining as number));
      }
    },
    [],
  );

  // Debug: Log participants whenever they change
  useEffect(() => {
    console.log("🔍 [R3 Lobby] Participants state updated:", participants);
    console.log("📊 [R3 Lobby] Participants count:", participants.length);
    if (participants.length > 0) {
      console.log("👥 [R3 Lobby] First participant:", participants[0]);
    }
  }, [participants]);

  // Functions
  const formatTime = (seconds: number) =>
    new Date(seconds * 1000).toISOString().substring(14, 19);

  const handleStartRound = () => {
    if (!socket || participants.length === 0) return;
    localStorage.removeItem("battlecode-round-3-code-store");
    socket.emit("round3:ready", {}, (response: SimpleSocketResponse) => {
      if (response.success) {
        showSuccessToast("Round 3 started successfully");
      } else {
        showErrorToast(response.error || "Failed to start the round");
      }
    });
  };

  const handleState = useCallback(
    (response: Round3State) => {
      console.log("🔵 [R3 Lobby] handleState called with response:", response);
      setIsLoading(false);
      setHasAttemptedJoin(true);

      if (!response.success) {
        console.warn("⚠️ [R3 Lobby] State response failed:", response.error);
        showErrorToast(response.error || "Could not sync with the server.");
        return;
      }

      // Update participants from the new state structure
      if (response.participants?.all && response.participants.all.length > 0) {
        setParticipants(response.participants.all);
      } else if (response.participants?.byStatus) {
        console.log(
          "👥 [R3 Lobby] Participants by status:",
          response.participants.byStatus,
        );
        // Show participants in lobby and waiting status
        const lobbyParticipants = [
          ...(response.participants.byStatus.lobby || []),
          ...(response.participants.byStatus.waiting || []),
        ];
        console.log(
          "✅ [R3 Lobby] Combined lobby participants:",
          lobbyParticipants,
        );
        console.log(
          "📊 [R3 Lobby] Total participants count:",
          lobbyParticipants.length,
        );
        setParticipants(lobbyParticipants);
      } else {
        console.warn("⚠️ [R3 Lobby] No participants in response");
      }

      // Update round active status
      setIsRoundActive(response.round.isActive);
      applyRoundEndTime(response.round);
      console.log(
        "⏰ [R3 Lobby] Round active:",
        response.round.isActive,
        "Time remaining:",
        response.round.timeRemaining,
      );

      // Check current user status
      if (response.currentUser) {
        console.log("👤 [R3 Lobby] Current user:", response.currentUser);
        if (response.currentUser.status === "IN_MATCH") {
          console.log("🎮 [R3 Lobby] User in match, redirecting to code page");
          router.push("/r3/code");
        }
      } else {
        console.log("🔄 [R3 Lobby] User not in round, attempting to join");
        // User is not in the round, attempt to join
        socket?.emit(
          "round3:join",
          { userId, username: user?.user_metadata?.full_name || user?.id },
          (joinResponse: SimpleSocketResponse) => {
            console.log("📥 [R3 Lobby] Join response:", joinResponse);
            if (joinResponse.success) {
              showSuccessToast("Successfully joined Round 3 lobby");
              console.log("✅ [R3 Lobby] User joined successfully");
            } else {
              showErrorToast(joinResponse.error || "Failed to join lobby");
              console.warn("⚠️ [R3 Lobby] Failed to join:", joinResponse.error);
            }
          },
        );
      }
    },
    [router, socket, userId, user, applyRoundEndTime],
  );

  // Authentication check useEffect
  useEffect(() => {
    if (!authLoading) setAuthenticationChecked(true);
    if (!authLoading && !userId) router.push("/dashboard");
  }, [authLoading, userId, router]);

  // Check current round useEffect
  useEffect(() => {
    if (!socket || !isConnected || !authenticationChecked) return;

    socket.emit("user:current-round", {}, (response: CurrentRoundResponse) => {
      console.log("Current round response:", response);
      setIsCheckingRound(false);

      if (!response.success) {
        showErrorToast(response.error || "Failed to check round status");
        router.back();
        return;
      }

      const currentRound = response.currentRound;

      if (!currentRound) {
        showErrorToast("No active round found");
        router.back();
        return;
      }

      setCurrentRoundData(currentRound);

      if (currentRound.currentRoundNumber !== 3) {
        showErrorToast("Round 3 is not the current round");
        router.back();
        return;
      }

      if (currentRound.currentRoundStatus !== "LOBBY") {
        showErrorToast(
          `Round 3 is currently ${currentRound.currentRoundStatus.toLowerCase()}. Cannot join lobby.`,
        );
        console.log("Current round status:", currentRound.currentRoundStatus);
        router.back();
        return;
      }

      console.log("Round status valid, proceeding to get state");
    });
  }, [socket, isConnected, authenticationChecked, router]);

  // Emit getState useEffect
  useEffect(() => {
    if (
      !socket ||
      !isConnected ||
      !authenticationChecked ||
      hasAttemptedJoin ||
      isCheckingRound
    )
      return;

    console.log("🚀 [R3 Lobby] Emitting round3:getState");
    socket.emit("round3:getState");
  }, [
    socket,
    isConnected,
    authenticationChecked,
    hasAttemptedJoin,
    isCheckingRound,
  ]);

  // Listen to state response useEffect
  useEffect(() => {
    if (!socket) return;
    console.log("👂 [R3 Lobby] Setting up listener for round3:state");
    socket.on("round3:state", handleState);

    return () => {
      console.log("🔇 [R3 Lobby] Removing listener for round3:state");
      socket.off("round3:state", handleState);
    };
  }, [socket, handleState]);

  // Main Socket event listeners useEffect
  useEffect(() => {
    if (!socket) return;

    const handleLobbyUpdate = (data: LobbyData) => {
      console.log("🔄 [R3 Lobby] Lobby update received:", data);
      setIsLoading(false);
      if (data.participants?.all && data.participants.all.length > 0) {
        setParticipants(data.participants.all);
      } else if (data.participants?.byStatus) {
        const lobbyParticipants = [
          ...(data.participants.byStatus.lobby || []),
          ...(data.participants.byStatus.waiting || []),
        ];
        console.log(
          "👥 [R3 Lobby] Updating participants from lobby update:",
          lobbyParticipants,
        );
        setParticipants(lobbyParticipants);
      }
      if (data.round?.isActive !== undefined) {
        console.log(
          "🏁 [R3 Lobby] Round active status update:",
          data.round.isActive,
        );
        setIsRoundActive(data.round.isActive);
      }
      applyRoundEndTime(data.round ?? data);
    };

    const handleRoundStart = (data: RoundStartData) => {
      if (
        data &&
        typeof data === "object" &&
        data.questions &&
        data.startTime
      ) {
        try {
          const dataToStore = {
            problems: data.questions,
            startTime: data.startTime,
            duration: data.duration || 3_600_000,
          };
          sessionStorage.setItem("round3_data", JSON.stringify(dataToStore));
        } catch (error) {
          console.error("Failed to save round data to sessionStorage:", error);
          showErrorToast("Error preparing round. Please try again.");
          return;
        }
      } else {
        console.error("Invalid round start data received:", data);
        showErrorToast("Invalid round data received. Please try again.");
        return;
      }

      setRoundStarted(true);
      setIsRoundActive(true);
      applyRoundEndTime({
        startTime: data.startTime,
        duration: data.duration || 3_600_000,
      });
      localStorage.removeItem("battlecode-round-3-code-store");
      showSuccessToast("Round 3 has started! Redirecting...");

      setTimeout(() => {
        router.push("/r3/code");
      }, 1500);
    };

    const handleTimer = (data: TimerData) => applyRoundEndTime(data);

    const handleRoundEnd = () => {
      showSuccessToast("Round 3 has ended.");
      router.push("/dashboard");
    };

    const handleError = (error: ErrorData) => {
      const errorMessage =
        typeof error === "string"
          ? error
          : error?.message || "An error occurred";
      showErrorToast(errorMessage);
    };

    const handleAdminRemoved = () => {
      console.log("You have been removed from Round 3 by an admin");
      showErrorToast("You have been removed from Round 3 by an admin");
      localStorage.removeItem("battlecode-round-3-code-store");
      sessionStorage.removeItem("round3_data");
      router.push("/");
    };

    const handleAdminAdded = () => {
      console.log("You have been added to Round 3 by an admin");

      if (!currentRoundData) {
        showErrorToast("Round data not available");
        return;
      }

      const { currentRoundNumber, currentRoundStatus } = currentRoundData;

      if (currentRoundNumber !== 3) {
        showErrorToast("Round 3 is not the current round");
        return;
      }

      if (currentRoundStatus === "LOBBY") {
        showSuccessToast("You have been added to Round 3! Already in lobby.");
      } else if (currentRoundStatus === "IN_PROGRESS") {
        showSuccessToast(
          "You have been added to Round 3! Redirecting to coding environment...",
        );
        setTimeout(() => router.push("/r3/code"), 1500);
      } else if (currentRoundStatus === "COMPLETED") {
        showErrorToast("Round 3 has already completed");
      } else if (currentRoundStatus === "LOCKED") {
        showErrorToast("Round 3 is currently locked");
      }
    };

    socket.on("lobby:round3", handleLobbyUpdate);
    socket.on("round3:start", handleRoundStart);
    socket.on("round3:timer", handleTimer);
    socket.on("round3:end", handleRoundEnd);
    socket.on("round3:error", handleError);
    socket.on("round3:adminRemoved", handleAdminRemoved);
    socket.on("round3:adminAdded", handleAdminAdded);

    return () => {
      socket.off("lobby:round3", handleLobbyUpdate);
      socket.off("round3:start", handleRoundStart);
      socket.off("round3:timer", handleTimer);
      socket.off("round3:end", handleRoundEnd);
      socket.off("round3:error", handleError);
      socket.off("round3:adminRemoved", handleAdminRemoved);
      socket.off("round3:adminAdded", handleAdminAdded);
    };
  }, [socket, router, currentRoundData]);

  useEffect(() => {
    if (!roundEndTime || !isRoundActive) return;
    const updateTimer = () =>
      setTimeRemaining(
        Math.max(0, Math.ceil((roundEndTime - Date.now()) / 1000)),
      );
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [roundEndTime, isRoundActive]);

  // Early return for loading states
  if (authLoading || !authenticationChecked || isCheckingRound) {
    return (
      <LoadingOverlay
        isLoading={true}
        message={
          authLoading ? "Loading Authentication..." : "Checking Round Status..."
        }
      />
    );
  }

  return (
    <div className="flex flex-col bg-[url('/r0_lobby_bg.svg')] bg-center bg-cover h-screen">
      <div
        className="flex-shrink-0 orbitron items-center flex flex-col text-7xl"
        style={{ textShadow: "0 0 10px rgba(217, 119, 6, 1)" }}
      >
        <p className="flex-1 flex items-end pt-8">
          {" "}
          <span className="text-white">ROUND</span>{" "}
          <span className="text-orange-500">&nbsp; 3</span>
        </p>
        <span className="text-orange-500 text-2xl pb-4">LOBBY</span>

        {/* {(roundStarted || isRoundActive) && (
          <div className="mt-3 flex flex-col items-center gap-2">
            {roundStarted ? (
              <>
                <div className="text-base text-center text-green-400">Round 3 Started!</div>
                <div className="text-gray-200 text-center text-sm">
                  <p>Redirecting to coding environment...</p>
                  <div className="flex justify-center items-center gap-2 mt-2">
                    <div className="bg-green-500 rounded-full h-2 w-2 animate-pulse"></div>
                    <div className="bg-green-500 rounded-full h-2 w-2 animate-pulse" style={{ animationDelay: '0.5s' }}></div>
                    <div className="bg-green-500 rounded-full h-2 w-2 animate-pulse" style={{ animationDelay: '1s' }}></div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="text-base text-center text-green-400">Round 3 Active</div>
                <div className="text-gray-200 text-center text-sm">
                  <p>Round is currently in progress</p>
                  <p className="text-orange-400 font-bold mt-1">Time Remaining: {formatTime(timeRemaining)}</p>
                </div>
              </>
            )}
          </div>
        )}*/}
      </div>

      <div className="flex-shrink-0 text-2xl orbitron ml-40 pb-4 text-white">
        Participants: {participants.length}
      </div>

      <div className="flex-1 p-6 min-h-0">
        <CustomScrollbar className="h-full overflow-y-auto">
          <div className="grid grid-cols-4 gap-12 max-w-6xl mx-auto pb-6">
            {isLoading ? (
              Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="relative w-full h-[90px] mb-3">
                  <div className="absolute inset-0 w-full h-full bg-gray-800/50 animate-pulse rounded-lg"></div>
                </div>
              ))
            ) : participants.length > 0 ? (
              participants.map((participant) => (
                <PlayerCard
                  key={participant.userId}
                  username={participant.username}
                  avatar={`https://ui-avatars.com/api/?name=${encodeURIComponent(participant.username)}&background=ea580c&color=fff`}
                />
              ))
            ) : (
              <div className="col-span-4 flex items-center justify-center text-gray-400 text-base py-12">
                No participants yet. Waiting for players to join...
              </div>
            )}
          </div>
        </CustomScrollbar>
      </div>

      {/* --- BOTTOM STATUS AND CONTROLS SECTION --- */}
      {!isRoundActive && !roundStarted && (
        <div className="flex-shrink-0 p-4 flex flex-col items-center gap-3 mb-3">
          <div className="text-sm text-gray-200 text-center">
            {!isConnected ? (
              <div>
                <p className="text-red-400">Connecting to server...</p>
                <div className="flex justify-center items-center gap-2 mt-2">
                  <div className="bg-red-500 rounded-full h-2 w-2 animate-pulse"></div>
                  <div
                    className="bg-red-500 rounded-full h-2 w-2 animate-pulse"
                    style={{ animationDelay: "0.5s" }}
                  ></div>
                  <div
                    className="bg-red-500 rounded-full h-2 w-2 animate-pulse"
                    style={{ animationDelay: "1s" }}
                  ></div>
                </div>
              </div>
            ) : participants.length > 0 ? (
              <div>
                <p className="text-green-400">
                  Connected to lobby. Waiting for more participants...
                </p>
                {!isLoading && (
                  <div className="flex justify-center items-center gap-2 mt-2">
                    <div className="bg-green-500 rounded-full h-2 w-2 animate-pulse"></div>
                    <div
                      className="bg-green-500 rounded-full h-2 w-2 animate-pulse"
                      style={{ animationDelay: "0.5s" }}
                    ></div>
                    <div
                      className="bg-green-500 rounded-full h-2 w-2 animate-pulse"
                      style={{ animationDelay: "1s" }}
                    ></div>
                  </div>
                )}
              </div>
            ) : isLoading ? (
              <div>
                <p className="text-blue-400">Joining lobby...</p>
                <div className="flex justify-center items-center gap-2 mt-2">
                  <div className="bg-blue-500 rounded-full h-2 w-2 animate-pulse"></div>
                  <div
                    className="bg-blue-500 rounded-full h-2 w-2 animate-pulse"
                    style={{ animationDelay: "0.5s" }}
                  ></div>
                  <div
                    className="bg-blue-500 rounded-full h-2 w-2 animate-pulse"
                    style={{ animationDelay: "1s" }}
                  ></div>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-green-400">
                  Connected. Waiting for participants to join...
                </p>
                <div className="flex justify-center items-center gap-2 mt-2">
                  <div className="bg-orange-500 rounded-full h-2 w-2 animate-pulse"></div>
                  <div
                    className="bg-orange-500 rounded-full h-2 w-2 animate-pulse"
                    style={{ animationDelay: "0.5s" }}
                  ></div>
                  <div
                    className="bg-orange-500 rounded-full h-2 w-2 animate-pulse"
                    style={{ animationDelay: "1s" }}
                  ></div>
                </div>
              </div>
            )}
          </div>

          {/* {isAdmin && !isLoading && participants.length > 0 && (
            <button
              onClick={handleStartRound}
              className="px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-600 text-white font-bold rounded-lg shadow-lg hover:scale-105 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-amber-400 text-sm flex items-center gap-2"
              disabled={isLoading}
            >
              <Rocket className="h-4 w-4" />
              Start Round 3
            </button>
          )} */}
        </div>
      )}

      {/* Powered by Judge0 Footer */}
      <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2">
        <p className="text-white/60 text-sm font-oxanium">
          Powered by{" "}
          <span className="text-orange-500 font-semibold">Judge0</span>
        </p>
      </div>
    </div>
  );
}
//                 disabled={isLoading}
//               >
//                 <Rocket className="h-4 w-4" />
//                 Start Round 3 (All users are admin for testing)
//               </button>
//             )}
//           </div>
//         )}
//       </div>
//     </>
//   );
// }
