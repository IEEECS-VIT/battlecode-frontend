"use client";

// Imports
import { useAuth } from "@/contexts/AuthContext";
import { useSocket } from "@/contexts/SocketContext";
import { useRouter } from "next/navigation";
import { useEffect, useState, useMemo, useCallback } from "react";
import Image from "next/image";
import CustomScrollbar from "@/components/shared/CustomScrollbar";
import {
  showSuccessToast,
  showErrorToast,
  showInfoToast,
} from "@/components/shared/CustomToast";
import LoadingOverlay from "@/components/shared/LoadingOverlay";
import { BaseRoundState } from "@/types/roundState";

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

interface MatchFoundData {
  opponent: { userId: string; username: string; rank?: number };
  question: { id: string; title: string };
  startTime: number;
  endTime: number;
  duration: number;
  timeRemaining: number;
}

interface GetStateResponse {
  success: boolean;
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
    opponent?: {
      id: string;
      username: string;
      rank?: number | string;
    };
    problem?: Problem;
  };
  roundSpecific?: {
    nextMatchmakingCycle?: number;
    globalTimeRemaining?: number;
  };
  message?: string;
}

// Component
export default function WaitingRoomR1() {
  const router = useRouter();
  const { socket, isConnected } = useSocket();
  const { userId, userRole, isLoading: authLoading } = useAuth();

  // State Management
  const [allParticipants, setAllParticipants] = useState<Participant[]>([]);
  const [currentUser, setCurrentUser] = useState<Participant | null>(null);
  const [isRoundActive, setIsRoundActive] = useState(false);
  const [roundEndTime, setRoundEndTime] = useState<number | null>(null);
  const [globalTimeRemaining, setGlobalTimeRemaining] = useState(0);
  const [cooldownTimeRemaining, setCooldownTimeRemaining] = useState(0);
  const [nextCycleEndTime, setNextCycleEndTime] = useState<number | null>(null);
  const [nextMatchmakingCycle, setNextMatchmakingCycle] = useState<
    number | null
  >(null);
  const [isLoading, setIsLoading] = useState(true);

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

  const applyNextCycle = (nextCycleMs?: number | null) => {
    if (typeof nextCycleMs === "number" && Number.isFinite(nextCycleMs)) {
      setNextCycleEndTime(Date.now() + Math.max(0, nextCycleMs));
    } else {
      setNextCycleEndTime(null);
    }
  };

  const isAdmin = useMemo(() => userRole === "ADMIN", [userRole]);
  const isInCooldown = useMemo(
    () => currentUser?.status === "cooldown" && cooldownTimeRemaining > 0,
    [currentUser, cooldownTimeRemaining],
  );

  // Functions
  const formatTime = (seconds: number | null | undefined): string => {
    if (typeof seconds !== "number" || seconds < 0 || isNaN(seconds))
      return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const getStatusText = (participant: Participant): string => {
    switch (participant.status) {
      case "lobby":
        return "In Lobby";
      case "waiting":
        if (nextMatchmakingCycle !== null && isRoundActive) {
          return `Next Match: ${formatTime(nextMatchmakingCycle)}`;
        }
        return "Waiting for Match";
      case "in_match":
        return "In Match";
      case "cooldown":
        if (participant.userId === userId) {
          return `Cooldown (${formatTime(cooldownTimeRemaining)})`;
        }
        const remaining = participant.cooldownEndTime
          ? Math.max(
              0,
              Math.ceil((participant.cooldownEndTime - Date.now()) / 1000),
            )
          : 0;
        return `Cooldown (${formatTime(remaining)})`;
      default:
        return participant.status;
    }
  };

  const getStatusColor = (status: string): string =>
    ({
      lobby: "text-gray-400",
      waiting: "text-yellow-400",
      "in-match": "text-green-400",
      cooldown: "text-red-400",
    })[status] || "text-gray-400";

  const handleStartRound = () => {
    if (!isAdmin || !socket) return;
    socket.emit(
      "round1:ready",
      {},
      (response: { success?: boolean; error?: string }) => {
        if (response?.success) {
          showSuccessToast("Round 1 started successfully!");
        } else {
          showErrorToast(response?.error || "Failed to start round");
        }
      },
    );
  };

  const handleState = useCallback(
    (response: GetStateResponse) => {
      console.log("Ehllo");
      console.log(
        "📡 [ROUND1 WAITING] State received:",
        JSON.stringify(response, null, 2),
      );

      if (response?.success) {
        // Check if round status is IN_PROGRESS or LOBBY (allow LOBBY for admin-added users)
        if (
          response.round?.status !== "IN_PROGRESS" &&
          response.round?.status !== "LOBBY"
        ) {
          showErrorToast(
            "Round 1 is not in progress. Redirecting to dashboard...",
          );
          router.push("/dashboard");
          return;
        }

        // If round is in LOBBY, show a message but don't redirect
        if (response.round?.status === "LOBBY") {
          showInfoToast("Round 1 is in lobby. Waiting for round to start...");
        }

        setIsRoundActive(response.round?.isActive ?? false);
        applyRoundEndTime(response.round);
        setAllParticipants(response.participants?.all || []);
        applyNextCycle(response.roundSpecific?.nextMatchmakingCycle);

        const me = response.currentUser;
        if (me) {
          if (me.status === "in_match") {
            if (response.session) {
              showInfoToast("Rejoining your active match...");
              sessionStorage.setItem(
                "round1_match_data",
                JSON.stringify(response.session),
              );
              router.push("/r1/code");
            } else {
              showErrorToast("Match data missing. Returning to dashboard.");
              router.push("/dashboard");
            }
            return;
          }
          setCurrentUser(me);
        }
      } else {
        showErrorToast(response?.error || "Could not get round state.");
        router.push("/dashboard");
      }
      console.log(1);
      setIsLoading(false);
    },
    [router],
  );

  // useEffect Hooks
  useEffect(() => {
    if (!socket || !isConnected) return;

    const handleMatchFound = (data: MatchFoundData) => {
      showSuccessToast("Match found! Redirecting...");
      localStorage.removeItem("battlecode-round-1-code-store");
      sessionStorage.setItem("round1_match_data", JSON.stringify(data));
      router.push("/r1/code");
    };

    const handleGlobalTimer = (data: {
      timeRemaining?: number;
      endTime?: number;
    }) => {
      applyRoundEndTime(data);
    };

    const handleParticipantsUpdate = (
      data: BaseRoundState | { participants: Participant[] },
    ) => {
      // Handle both old array format and new unified schema
      let participantsList: Participant[] = [];

      if ("byStatus" in (data.participants || {})) {
        // New unified schema
        const unifiedData = data as BaseRoundState;
        participantsList = unifiedData.participants?.all || [];
      } else {
        // Old array format (fallback)
        const oldData = data as { participants: Participant[] };
        participantsList = oldData.participants || [];
      }

      setAllParticipants(participantsList);
      if ("round" in data) {
        const unified = data as BaseRoundState;
        applyRoundEndTime(unified.round);
        if (unified.roundSpecific?.nextMatchmakingCycle != null) {
          applyNextCycle(unified.roundSpecific.nextMatchmakingCycle);
        }
      }
      const me = participantsList.find((p) => p.userId === userId);
      if (me) {
        setCurrentUser(me);
      }
    };

    const handleCooldownStart = (data: { cooldownEndTime: number }) => {
      showInfoToast("Match finished. Entering a cooldown period.");
      setCurrentUser((prev) =>
        prev
          ? {
              ...prev,
              status: "cooldown",
              cooldownEndTime: data.cooldownEndTime,
            }
          : null,
      );
    };

    const handleCooldownEnd = () => {
      showSuccessToast("You are back in the matchmaking queue!");
      setCurrentUser((prev) =>
        prev
          ? { ...prev, status: "waiting", cooldownEndTime: undefined }
          : null,
      );
      setCooldownTimeRemaining(0);
    };

    const handleRoundStarted = (data?: GetStateResponse) => {
      showSuccessToast("Round 1 has started!");
      setIsRoundActive(true);
      applyRoundEndTime(data?.round);
    };

    const handleRoundEnd = (data?: { endTime?: number }) => {
      applyRoundEndTime(data);
      showInfoToast("Round 1 has ended.");
      router.push("/dashboard");
    };

    const handleMatchmakingCycle = (data: { nextCycle: number }) => {
      applyNextCycle(data.nextCycle);
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

    socket.on("round1:matchFound", handleMatchFound);
    socket.on("round1:started", handleRoundStarted);
    socket.on("round1:cooldown", handleCooldownStart);
    socket.on("round1:cooldownEnd", handleCooldownEnd);
    socket.on("round1:ended", handleRoundEnd);
    socket.on("round1:participantsUpdate", handleParticipantsUpdate);
    socket.on("round1:globalTimer", handleGlobalTimer);
    socket.on("round1:matchmakingCycle", handleMatchmakingCycle);
    socket.on("round1:adminRemoved", handleAdminRemoved);
    socket.on("round1:adminAdded", handleAdminAdded);

    return () => {
      socket.off("round1:matchFound", handleMatchFound);
      socket.off("round1:started", handleRoundStarted);
      socket.off("round1:cooldown", handleCooldownStart);
      socket.off("round1:cooldownEnd", handleCooldownEnd);
      socket.off("round1:ended", handleRoundEnd);
      socket.off("round1:participantsUpdate", handleParticipantsUpdate);
      socket.off("round1:globalTimer", handleGlobalTimer);
      socket.off("round1:matchmakingCycle", handleMatchmakingCycle);
      socket.off("round1:adminRemoved", handleAdminRemoved);
      socket.off("round1:adminAdded", handleAdminAdded);
    };
  }, [socket, isConnected, router, userId]);

  useEffect(() => {
    if (!socket || !isConnected || !userId) return;
    socket.emit("round1:getState");
  }, [socket, isConnected, userId, router]);

  useEffect(() => {
    if (!socket) return;
    socket.on("round1:state", handleState);

    return () => {
      socket.off("round1:state", handleState);
    };
  }, [socket, handleState]);

  useEffect(() => {
    const cooldownInterval = setInterval(() => {
      if (currentUser?.status === "cooldown" && currentUser.cooldownEndTime) {
        const remaining = Math.max(
          0,
          Math.ceil((currentUser.cooldownEndTime - Date.now()) / 1000),
        );
        setCooldownTimeRemaining(remaining);
      } else {
        if (cooldownTimeRemaining !== 0) {
          setCooldownTimeRemaining(0);
        }
      }
    }, 1000);
    return () => clearInterval(cooldownInterval);
  }, [currentUser, cooldownTimeRemaining]);

  useEffect(() => {
    if (!isRoundActive || !roundEndTime) return;
    const updateTimer = () =>
      setGlobalTimeRemaining(
        Math.max(0, Math.ceil((roundEndTime - Date.now()) / 1000)),
      );
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [isRoundActive, roundEndTime]);

  useEffect(() => {
    if (!isRoundActive || nextCycleEndTime == null) return;
    const updateTimer = () =>
      setNextMatchmakingCycle(
        Math.max(0, Math.ceil((nextCycleEndTime - Date.now()) / 1000)),
      );
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [isRoundActive, nextCycleEndTime]);

  // Early return
  if (authLoading || isLoading) {
    return (
      <LoadingOverlay isLoading={true} message="Loading Waiting Room..." />
    );
  }

  // JSX Return
  return (
    <div className="flex bg-[url('/bg_code.png')] bg-cover h-screen flex-col overflow-hidden relative">
      <div className="flex-shrink-0 ml-3 mt-0 py-4 relative z-10 orbitron">
        <p> &lt;&gt; BattleCode Arena</p>
      </div>
      <div className="flex-1 flex min-h-0 relative z-10">
        <div className="flex-[1]"></div>
        <div className="flex-[6] flex justify-center items-center gap-4 flex-col min-h-0">
          {!isRoundActive ? (
            <>
              <div className="text-5xl text-center bg-gradient-to-r from-[#EEA284] to-[#FF6200] bg-clip-text text-transparent">
                Searching for opponent
              </div>
              <div className="text-gray-200 text-center">
                <p>Waiting for the round to begin...</p>
                <p className="text-orange-400 font-bold mt-2">
                  {allParticipants.length} participants ready
                </p>
                <div className="flex justify-center items-center gap-2 mt-4">
                  <div className="bg-orange-500 rounded-full h-4 w-4 animate-pulse"></div>
                  <div className="bg-orange-500 rounded-full h-4 w-4 animate-pulse [animation-delay:0.5s]"></div>
                  <div className="bg-orange-500 rounded-full h-4 w-4 animate-pulse [animation-delay:1s]"></div>
                </div>
              </div>
              {isAdmin && allParticipants.length > 0 && (
                <button
                  onClick={handleStartRound}
                  className="mt-6 px-8 py-3 bg-gradient-to-r from-orange-500 to-amber-600 text-white font-bold rounded-lg shadow-lg hover:scale-105 transition-all"
                >
                  🚀 Start Round 1 (Admin)
                </button>
              )}
            </>
          ) : (
            <>
              <div className="text-4xl text-center text-green-400">
                Round 1 Active
              </div>
              <div className="text-gray-200 text-center space-y-3">
                <div className="bg-black/40 rounded-lg p-4 border border-amber-600">
                  <p className="text-amber-400 font-bold text-xl">
                    Round Time Remaining: {formatTime(globalTimeRemaining)}
                  </p>
                </div>
                <div className="bg-black/40 rounded-lg p-4 border border-blue-600">
                  <p className="text-blue-400 font-bold">
                    {nextMatchmakingCycle !== null
                      ? `Next Match In: ${formatTime(nextMatchmakingCycle)}`
                      : "Matchmaking in Progress..."}
                  </p>
                  <p className="text-gray-400 text-sm">
                    New matches are formed every 3 minutes.
                  </p>
                </div>
                {isInCooldown && (
                  <div className="bg-red-900/40 rounded-lg p-4 border border-red-600">
                    <p className="text-red-400 font-bold">
                      ⏳ Cooldown: {formatTime(cooldownTimeRemaining)}
                    </p>
                    <p className="text-gray-400 text-sm">
                      You will rejoin matchmaking after cooldown.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <div className="flex-[3] flex flex-col min-h-0">
          <div className="flex-1 max-h-full rounded-lg border-2 mb-4 mr-8 flex flex-col glass-box overflow-hidden">
            <div className="flex-shrink-0 bg-inherit rounded-t-lg z-10 justify-center items-center flex py-4">
              <Image
                src="/leaderboard-img.svg"
                alt="Leaderboard Icon"
                width={16}
                height={16}
              />
              <p className="text-2xl text-orange-500 ml-2">
                Round 1 Participants
              </p>
            </div>
            <CustomScrollbar className="flex-1 overflow-y-auto px-4 pb-4 min-h-0">
              {allParticipants.length > 0 ? (
                <table className="w-full text-left text-sm text-white">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="py-2 px-3 font-bold">#</th>
                      <th className="py-2 px-3 font-bold">Player</th>
                      <th className="py-2 px-3 font-bold">Score</th>
                      <th className="py-2 px-3 font-bold">Status / Timer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allParticipants.map((p) => (
                      <tr
                        key={p.userId}
                        className="border-gray-800 hover:bg-white/5 transition"
                      >
                        <td className="py-2 px-3">{p.rank}</td>
                        <td className="py-2 px-3 max-w-[100px] truncate">
                          {p.username}
                          {p.userId === userId && (
                            <span className="ml-2 text-orange-400 text-xs">
                              (You)
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 font-mono text-cyan-400">
                          {p.eventScore ?? "..."}
                        </td>
                        <td
                          className={`py-2 px-3 ${getStatusColor(p.status)} text-sm`}
                        >
                          {getStatusText(p)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">
                  <p>No participants in the lobby yet.</p>
                </div>
              )}
            </CustomScrollbar>
          </div>
        </div>
      </div>
    </div>
  );
}
