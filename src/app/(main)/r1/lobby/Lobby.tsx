"use client";

// Imports
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
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

// Interfaces
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

interface Problem {
  id: string;
  title: string;
  difficulty: string;
  description?: string;
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
    problem?: Problem;
    problems?: Array<Problem>;
  };
  roundSpecific?: {
    nextMatchmakingCycle?: number;
    globalTimeRemaining?: number;
  };
  message?: string;
}

interface MatchFoundData {
  matchId?: string;
  opponent?: Participant;
  startTime?: number;
  duration?: number;
  [key: string]: unknown;
}

interface SimpleSocketResponse {
  success: boolean;
  error?: string;
}

interface GetStateResponse extends SimpleSocketResponse {
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
    opponent?: {
      id: string;
      username: string;
      rank?: number | string;
    };
  };
  roundSpecific?: {
    nextMatchmakingCycle?: number;
    globalTimeRemaining?: number;
  };
  message?: string;
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

// Component
export default function Lobbyr1() {
  const router = useRouter();
  const { socket, isConnected } = useSocket();
  const { userId, isLoading: authLoading, userRole } = useAuth();

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

  const applyRoundEndTime = (round?: {
    endTime?: number | null;
    timeRemaining?: number | null;
  }) => {
    if (typeof round?.endTime === "number" && Number.isFinite(round.endTime)) {
      setRoundEndTime(round.endTime);
    } else if (round && (round.timeRemaining ?? 0) > 0) {
      setRoundEndTime(Date.now() + (round.timeRemaining as number));
    } else if (round) {
      setRoundEndTime(null);
    }
  };

  // Functions
  const formatTime = (seconds: number) =>
    new Date(seconds * 1000).toISOString().substring(14, 19);

  const handleStartRound = () => {
    if (!socket || participants.length === 0) return;
    socket.emit("round1:ready", {}, (response: SimpleSocketResponse) => {
      if (response.success) {
        showSuccessToast("Round 1 started successfully");
      } else {
        showErrorToast(response.error || "Failed to start the round");
      }
    });
  };

  const handleState = useCallback(
    (response: GetStateResponse) => {
      console.log("use effect 3 ✅");
      console.log(
        "📡 [ROUND1 LOBBY] State received:",
        JSON.stringify(response, null, 2),
      );

      setIsLoading(false);
      setHasAttemptedJoin(true);

      if (!response.success) {
        showErrorToast(response.error || "Could not sync with the server.");
        return;
      }

      // Updated to use new unified schema
      if (response.participants?.byStatus?.lobby) {
        setParticipants(response.participants.byStatus.lobby);
      }

      setIsRoundActive(response.round?.isActive ?? false);
      applyRoundEndTime(response.round);

      if (response.currentUser) {
        if (response.currentUser.status === "in_match") {
          router.push("/r1/code");
        } else if (response.currentUser.status !== "lobby") {
          router.push("/r1/waiting");
        }
      } else {
        socket?.emit(
          "round1:join",
          {},
          (joinResponse: SimpleSocketResponse) => {
            if (joinResponse.success) {
              showSuccessToast("Successfully joined Round 1 lobby");
            } else {
              showErrorToast(joinResponse.error || "Failed to join lobby");
            }
          },
        );
      }
    },
    [router, socket],
  );

  // useEffect Hooks
  useEffect(() => {
    if (!authLoading) setAuthenticationChecked(true);
    if (!authLoading && !userId) router.push("/dashboard");
  }, [authLoading, userId, router]);

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

      if (currentRound.currentRoundNumber !== 1) {
        showErrorToast("Round 1 is not the current round");
        router.back();
        return;
      }

      if (currentRound.currentRoundStatus !== "LOBBY") {
        showErrorToast(
          `Round 1 is currently ${currentRound.currentRoundStatus.toLowerCase()}. Cannot join lobby.`,
        );
        console.log("Current round status:", currentRound.currentRoundStatus);
        router.back();
        return;
      }

      console.log("Round status valid, proceeding to get state");
    });
  }, [socket, isConnected, authenticationChecked, router]);

  useEffect(() => {
    console.log("use effect 1");

    if (
      !socket ||
      !isConnected ||
      !authenticationChecked ||
      hasAttemptedJoin ||
      isCheckingRound
    )
      return;

    console.log("use effect 2");

    socket.emit("round1:getState");
  }, [
    socket,
    isConnected,
    authenticationChecked,
    hasAttemptedJoin,
    isCheckingRound,
  ]);

  useEffect(() => {
    if (!socket) return;
    socket.on("round1:state", handleState);

    return () => {
      socket.off("round1:state", handleState);
    };
  }, [socket, handleState]);

  useEffect(() => {
    if (!socket) return;

    const handleLobbyUpdate = (data: LobbyData) => {
      setIsLoading(false);
      if (data.participants?.byStatus?.lobby) {
        setParticipants(data.participants.byStatus.lobby);
      }
      if (data.round?.isActive !== undefined) {
        setIsRoundActive(data.round.isActive);
      }
      applyRoundEndTime(data.round);
    };

    const handleRoundStarted = (data?: LobbyData) => {
      setRoundStarted(true);
      setIsRoundActive(true);
      applyRoundEndTime(data?.round);
      localStorage.removeItem("battlecode-round-1-code-store");
      showSuccessToast("Round 1 has started! Entering matchmaking...");
      setTimeout(() => router.push("/r1/waiting"), 2000);
    };

    const handleMatchFound = (data: MatchFoundData) => {
      sessionStorage.setItem("round1_match_data", JSON.stringify(data));
      sessionStorage.removeItem("fullscreen_violations");
      showSuccessToast("Match found! Redirecting...");
      setTimeout(() => router.push("/r1/code"), 1500);
    };

    const handleGlobalTimer = (data: {
      timeRemaining?: number;
      endTime?: number;
    }) => {
      applyRoundEndTime(data);
    };

    const handleRoundEnd = (data?: { endTime?: number }) => {
      applyRoundEndTime(data);
      showSuccessToast("Round 1 has ended.");
      router.push("/dashboard");
    };

    const handleAdminRemoved = () => {
      console.log("You have been removed from Round 1 by an admin");
      showErrorToast("You have been removed from Round 1 by an admin");
      localStorage.removeItem("battlecode-round-1-code-store");
      sessionStorage.removeItem("round1_match_data");
      router.push("/");
    };

    const handleAdminAdded = () => {
      console.log("You have been added to Round 1 by an admin");

      if (!currentRoundData) {
        showErrorToast("Round data not available");
        return;
      }

      const { currentRoundNumber, currentRoundStatus } = currentRoundData;

      if (currentRoundNumber !== 1) {
        showErrorToast("Round 1 is not the current round");
        return;
      }

      if (currentRoundStatus === "LOBBY") {
        showSuccessToast("You have been added to Round 1! Already in lobby.");
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
    };

    socket.on("lobby:round1", handleLobbyUpdate);
    socket.on("round1:started", handleRoundStarted);
    socket.on("round1:matchFound", handleMatchFound);
    socket.on("round1:globalTimer", handleGlobalTimer);
    socket.on("round1:ended", handleRoundEnd);
    socket.on("round1:adminRemoved", handleAdminRemoved);
    socket.on("round1:adminAdded", handleAdminAdded);

    return () => {
      socket.off("lobby:round1", handleLobbyUpdate);
      socket.off("round1:started", handleRoundStarted);
      socket.off("round1:matchFound", handleMatchFound);
      socket.off("round1:globalTimer", handleGlobalTimer);
      socket.off("round1:ended", handleRoundEnd);
      socket.off("round1:adminRemoved", handleAdminRemoved);
      socket.off("round1:adminAdded", handleAdminAdded);
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

  // Early return
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

  // JSX Return
  return (
    <div className="flex flex-col bg-[url('/r0_lobby_bg.svg')] bg-center bg-cover h-screen">
      <div
        className="flex-shrink-0 orbitron items-center flex flex-col text-7xl"
        style={{ textShadow: "0 0 10px rgba(217, 119, 6, 1)" }}
      >
        <p className="flex-1 flex items-end pt-8">
          {" "}
          <span className="text-white">ROUND</span>{" "}
          <span className="text-orange-500">&nbsp; 1</span>
        </p>
        <span className="text-orange-500 text-2xl pb-4">LOBBY</span>

        {(roundStarted || isRoundActive) && (
          <div className="mt-3 flex flex-col items-center gap-2">
            {roundStarted ? (
              <>
                <div className="text-base text-center text-green-400">
                  Round 1 Started!
                </div>
                <div className="text-gray-200 text-center text-sm">
                  <p>Entering matchmaking queue...</p>
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
                </div>
              </>
            ) : (
              <>
                <div className="text-base text-center text-green-400">
                  Round 1 Active
                </div>
                <div className="text-gray-200 text-center text-sm">
                  <p>Round is currently in progress</p>
                  <p className="text-orange-400 font-bold mt-1">
                    Time Remaining: {formatTime(timeRemaining)}
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <div className="flex-shrink-0 text-2xl orbitron ml-40 pb-4 text-white">
        Participants: {participants.length}
      </div>
      <div className="flex-1 p-6 min-h-0">
        <CustomScrollbar className="h-full overflow-y-auto">
          <div className="grid grid-cols-3 gap-12 max-w-6xl mx-auto pb-6">
            {isLoading ? (
              Array.from({ length: 9 }).map((_, index) => (
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
              <div className="col-span-3 flex items-center justify-center text-gray-400 text-base py-12">
                No participants yet. Waiting for players to join...
              </div>
            )}
          </div>
        </CustomScrollbar>
      </div>

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
                            Start Round 1
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
