"use client";
/**
 * Admin Page - Updated to use Unified Round State Schema
 *
 * This page now uses the BaseRoundState interface from @/types/roundState
 * which provides a consistent structure across all rounds:
 *
 * Key Changes:
 * - Replaced SimpleSocketResponse with BaseRoundState
 * - Updated Participant interface to use userId instead of id
 * - Added support for round-specific data via roundSpecific property
 * - Supports new unified schema with session data, round status, and participants
 * - Compatible with Round 0-3 with their specific features (matchmaking, bounty, etc.)
 */
import { useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  showErrorToast,
  showInfoToast,
  showSuccessToast,
} from "@/components/shared/CustomToast";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSocket } from "@/contexts/SocketContext";
import LoadingOverlay from "@/components/shared/LoadingOverlay";
import CustomScrollbar from "@/components/shared/CustomScrollbar";
import { BaseRoundState, Participant } from "@/types/roundState";

interface RoundStatus {
  roundNumber: number;
  status: string;
  isActive: boolean;
  isLocked: boolean;
}

interface CurrentRoundData {
  currentRoundNumber: number;
  currentRoundStatus: string;
  rounds: RoundStatus[];
}

interface LeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  username: string;
  score: number;
  currentRound: number;
  regNo: string;
  trend: string;
}

type LeaderboardPayload = {
  success?: boolean;
  error?: string;
  leaderboard?: LeaderboardEntry[];
};

const TIMER_DRIFT_SECONDS = 2;

type TimerSource = {
  endTime?: number | null;
  startTime?: number | null;
  duration?: number | null;
  timeRemaining?: number | null;
  elapsed?: number | null;
};

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function deadlineFromSource(source?: TimerSource | null): number | null {
  if (!source) return null;
  if (isPositiveNumber(source.endTime)) return source.endTime;
  if (isPositiveNumber(source.startTime) && isPositiveNumber(source.duration)) {
    return source.startTime + source.duration;
  }
  if (isPositiveNumber(source.duration) && isPositiveNumber(source.elapsed)) {
    return Date.now() + Math.max(0, source.duration - source.elapsed);
  }
  if (isPositiveNumber(source.timeRemaining)) {
    return Date.now() + source.timeRemaining;
  }
  return null;
}

function resolveDeadlineFromResponse(response: {
  roundNumber?: number;
  round?: TimerSource;
  startTime?: number;
  duration?: number;
  timeRemaining?: number;
  elapsed?: number;
  endTime?: number;
}): number | null {
  return (
    deadlineFromSource(response.round) ??
    deadlineFromSource({
      endTime: response.endTime,
      startTime: response.startTime,
      duration: response.duration,
      timeRemaining: response.timeRemaining,
      elapsed: response.elapsed,
    })
  );
}

function hasAbsoluteDeadline(
  _roundNumber: number | undefined,
  round?: TimerSource | null,
): boolean {
  return isPositiveNumber(round?.endTime);
}

function resolveTimerTickEndTime(
  _roundNumber: number,
  data: {
    timeRemaining?: number;
    endTime?: number;
    duration?: number;
    elapsed?: number;
    startTime?: number;
  },
): number | null {
  return deadlineFromSource(data);
}

function shouldCorrectTimer(
  localEndTime: number | null,
  serverEndTime: number,
): boolean {
  if (localEndTime == null) return true;
  const localRemaining = Math.floor((localEndTime - Date.now()) / 1000);
  const serverRemaining = Math.floor((serverEndTime - Date.now()) / 1000);
  return Math.abs(serverRemaining - localRemaining) > TIMER_DRIFT_SECONDS;
}

function hasBackendOpponent(
  user: Pick<Participant, "opponentUsername">,
): boolean {
  const opponent = user.opponentUsername?.trim();
  return Boolean(opponent && opponent !== "undefined");
}

function isPairedInMatch(user: Participant): boolean {
  const inMatch = user.status === "in_match" || user.status === "in-match";
  return inMatch && hasBackendOpponent(user);
}

function activeUserStatusLabel(user: Participant): string {
  if (isPairedInMatch(user)) return "In Match";
  if (user.status === "in_match" || user.status === "in-match")
    return "Playing";
  if (user.status === "in_bounty") return "Bounty";
  return "Waiting";
}

export default function Admin() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);
  const { session, isLoading, userRole } = useAuth();
  const [currentRoundData, setCurrentRoundData] =
    useState<CurrentRoundData | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selectedRoundForUsers, setSelectedRoundForUsers] = useState(0);
  const [showEndRoundConfirm, setShowEndRoundConfirm] = useState(false);
  const [roundToEnd, setRoundToEnd] = useState<number | null>(null);
  const [showResetRedisConfirm, setShowResetRedisConfirm] = useState(false);
  const [showResetUsersConfirm, setShowResetUsersConfirm] = useState(false);
  const [matchParticipants, setMatchParticipants] = useState<Participant[]>([]);
  const [selectedRoundForMatches, setSelectedRoundForMatches] = useState(0);
  const [qualifyCount, setQualifyCount] = useState<number | "">("");
  const [isQualifying, setIsQualifying] = useState(false);

  // Helper functions for localStorage persistence
  const saveParticipantsToStorage = useCallback(
    (participantsList: Participant[]) => {
      try {
        localStorage.setItem("participants", JSON.stringify(participantsList));
      } catch (error) {
        console.error("Failed to save participants to localStorage:", error);
      }
    },
    [],
  );

  const loadParticipantsFromStorage = useCallback((): Participant[] => {
    try {
      const saved = localStorage.getItem("participants");
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.error("Failed to load participants from localStorage:", error);
      return [];
    }
  }, []);

  // Match participants localStorage functions
  const saveMatchParticipantsToStorage = useCallback(
    (matchList: Participant[], roundNum: number) => {
      try {
        localStorage.setItem(
          `matchParticipants-round${roundNum}`,
          JSON.stringify(matchList),
        );
      } catch (error) {
        console.error(
          "Failed to save match participants to localStorage:",
          error,
        );
      }
    },
    [],
  );

  const loadMatchParticipantsFromStorage = useCallback(
    (roundNum: number): Participant[] => {
      try {
        const saved = localStorage.getItem(
          `matchParticipants-round${roundNum}`,
        );
        return saved ? JSON.parse(saved) : [];
      } catch (error) {
        console.error(
          "Failed to load match participants from localStorage:",
          error,
        );
        return [];
      }
    },
    [],
  );

  // --- Active Round Section State (generalized for any round) ---
  const [activeRoundNumber, setActiveRoundNumber] = useState<number | null>(
    null,
  );
  const [globalTimeRemaining, setGlobalTimeRemaining] = useState(0);
  const [roundEndTime, setRoundEndTime] = useState<number | null>(null);
  const [nextMatchmakingCycle, setNextMatchmakingCycle] = useState<
    number | null
  >(null);
  const [cooldownTimeRemaining, setCooldownTimeRemaining] = useState(0);
  const [isRoundActive, setIsRoundActive] = useState(false);
  const [currentUser, setCurrentUser] = useState<Participant | null>(null);
  const [allParticipants, setAllParticipants] = useState<Participant[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardLocked, setLeaderboardLocked] = useState(false);

  const { socket } = useSocket();
  const router = useRouter();

  // Load currentRoundData and participants from localStorage on mount
  useEffect(() => {
    if (!socket) {
      console.log("[SOCKET] No socket available for real-time updates");
      return;
    }

    const handleCurrentRound = (data: CurrentRoundData) => {
      setCurrentRoundData(data);
    };

    const handleRedisResetSuccess = () => {
      showSuccessToast("Redis cleared successfully");
    };

    // NEW: Catch the hidden backend errors!
    const handleAdminError = (data: { error: string }) => {
      console.error("[ADMIN ERROR]", data.error);
      showErrorToast(`Backend Error: ${data.error}`);
    };

    socket.on("server:currentRound", handleCurrentRound);
    socket.on("admin:reset:success", handleRedisResetSuccess);
    socket.on("admin:error", handleAdminError); // <-- ADD THIS

    socket.emit("client:getCurrentRound");

    return () => {
      socket.off("server:currentRound", handleCurrentRound);
      socket.off("admin:reset:success", handleRedisResetSuccess);
      socket.off("admin:error", handleAdminError); // <-- ADD THIS
    };
  }, [socket]);

  useEffect(() => {
    if (!socket) return;

    const applyLeaderboard = (data: LeaderboardPayload) => {
      if (data?.success === false) {
        setLeaderboardLocked(true);
        return;
      }
      if (Array.isArray(data?.leaderboard)) {
        setLeaderboard(data.leaderboard);
        setLeaderboardLocked(false);
      }
    };

    const requestLeaderboard = () => {
      socket.emit("user:leaderboard", applyLeaderboard);
    };

    socket.on("server:leaderboard", applyLeaderboard);
    socket.on("connect", requestLeaderboard);
    socket.on("admin:reset:success", requestLeaderboard);
    requestLeaderboard();

    return () => {
      socket.off("server:leaderboard", applyLeaderboard);
      socket.off("connect", requestLeaderboard);
      socket.off("admin:reset:success", requestLeaderboard);
    };
  }, [socket]);

  useEffect(() => {
    if (!socket || !currentRoundData) return;
    const locked =
      currentRoundData.currentRoundNumber === 3 &&
      currentRoundData.currentRoundStatus !== "LOCKED";
    if (locked) {
      setLeaderboardLocked(true);
      return;
    }
    setLeaderboardLocked(false);
    socket.emit("user:leaderboard");
  }, [
    socket,
    currentRoundData?.currentRoundNumber,
    currentRoundData?.currentRoundStatus,
  ]);

  const addUserToRound = async (userEmail: string, roundNumber: number) => {
    console.log("[ADMIN ACTION] Adding user to round:", {
      userEmail,
      roundNumber,
    });

    if (!userEmail || roundNumber === null) {
      console.warn("[ADMIN ACTION] Invalid parameters for addUserToRound");
      showErrorToast("Please enter email and select a round");
      return;
    }

    socket?.emit(
      "admin:adduser",
      { user: { email: userEmail }, round: roundNumber },
      (response: { success: boolean; message: string; error: string }) => {
        console.log("[ADMIN ACTION] Add user response:", response);
        if (response.success) {
          showSuccessToast(`User ${userEmail} added to Round ${roundNumber}`);
        } else {
          showErrorToast(response.error || "Failed to add user");
        }
      },
    );
  };

  const removeUserFromRound = async (
    userEmail: string,
    roundNumber: number,
  ) => {
    console.log("[ADMIN ACTION] Removing user from round:", {
      userEmail,
      roundNumber,
    });

    if (!userEmail || roundNumber === null) {
      console.warn("[ADMIN ACTION] Invalid parameters for removeUserFromRound");
      showErrorToast("Please enter email and select a round");
      return;
    }

    socket?.emit(
      "admin:removeuser",
      { user: { email: userEmail }, round: roundNumber },
      (response: { success: boolean; message: string; error: string }) => {
        console.log("[ADMIN ACTION] Remove user response:", response);
        if (response.success) {
          showSuccessToast(
            `User ${userEmail} removed from Round ${roundNumber}`,
          );
        } else {
          showErrorToast(response.error || "Failed to remove user");
        }
      },
    );
  };

  const fetchLobbyUsers = useCallback(
    (roundNumber: number) => {
      console.log(
        `[FETCH LOBBY CALLED] roundNumber: ${roundNumber}, socket: ${socket ? "connected" : "null"}`,
      );
      if (!socket) {
        console.log("[FETCH LOBBY] Socket is null, returning early");
        return;
      }

      console.log(`[FETCH LOBBY] Requesting state for round ${roundNumber}`);
      const eventName = `round${roundNumber}:getState`;
      console.log(`[FETCH LOBBY] Emitting event: ${eventName}`);
      socket.emit(eventName, {});
    },
    [socket],
  );

  const fetchMatchUsers = useCallback(
    (roundNumber: number) => {
      if (!socket) return;

      const eventName = `round${roundNumber}:getState`;
      socket.emit(eventName, {});
    },
    [socket],
  );

  // Listen for the state response event - consolidated for both match participants and active round detection
  useEffect(() => {
    if (!socket) return;

    const handleStateResponse = (response: BaseRoundState) => {
      console.log("[SOCKET STATE] Received state response:", {
        success: response.success,
        roundNumber: response.roundNumber,
        isActive: response.round?.isActive,
        participantCount: response.participants?.all?.length,
      });

      if (!response.success) {
        console.warn("[SOCKET STATE] Response not successful");
        return;
      }

      const { roundNumber, round, participants, currentUser, session } =
        response;

      // Time lives on round, not on the participants list.
      if (roundNumber === null || roundNumber === undefined || !round) {
        console.warn("[SOCKET STATE] Missing required data in response");
        return;
      }

      // Check if this round is active and update active round state
      if (round.isActive) {
        console.log("[SOCKET STATE] Round is ACTIVE:", {
          roundNumber,
          timeRemaining: round.timeRemaining,
          nextMatchmakingCycle: response.roundSpecific?.nextMatchmakingCycle,
        });

        setActiveRoundNumber(roundNumber);
        setIsRoundActive(true);
        const incomingDeadline = resolveDeadlineFromResponse(response);
        if (incomingDeadline != null) {
          const forceDeadline = hasAbsoluteDeadline(roundNumber, round);
          setRoundEndTime((prev) =>
            forceDeadline || shouldCorrectTimer(prev, incomingDeadline)
              ? incomingDeadline
              : prev,
          );
        }
        setNextMatchmakingCycle(
          response.roundSpecific?.nextMatchmakingCycle != null
            ? Math.max(
                0,
                Math.ceil(response.roundSpecific.nextMatchmakingCycle / 1000),
              )
            : null,
        );
        if (currentUser) {
          console.log("[SOCKET STATE] Current user:", currentUser);
          setCurrentUser(currentUser);
        }

        // Auto-switch to match view when round starts if we're viewing this round's lobby
        if (roundNumber === selectedRoundForUsers) {
          console.log(
            "[SOCKET STATE] Auto-switching to match view for round",
            roundNumber,
          );
          setSelectedRoundForMatches(roundNumber);
        }
      } else if (!round.isActive && activeRoundNumber === roundNumber) {
        console.log("[SOCKET STATE] Round is INACTIVE:", roundNumber);
        setIsRoundActive(false);
        setActiveRoundNumber(null);
        setGlobalTimeRemaining(0);
        setRoundEndTime(null);
        setNextMatchmakingCycle(null);
      }

      if (!participants) {
        return;
      }

      // Update match participants (pre-filtered by backend)
      if (round.isActive && roundNumber === selectedRoundForMatches) {
        console.log(
          "[SOCKET STATE] Updating match participants for round",
          roundNumber,
        );

        // Backend already filtered waiting + in_match + in_bounty users
        const activeUsers = [
          ...(participants.byStatus?.waiting || []),
          ...(participants.byStatus?.in_match || []),
          ...(participants.byStatus?.in_bounty || []),
        ];

        console.log("[SOCKET STATE] Active users count:", {
          waiting: participants.byStatus?.waiting?.length || 0,
          in_match: participants.byStatus?.in_match?.length || 0,
          in_bounty: participants.byStatus?.in_bounty?.length || 0,
          total: activeUsers.length,
        });

        // Only keep an opponent when the backend sent one. Do not invent pairs.
        const activeUsersFromBackend = activeUsers.map((user) =>
          hasBackendOpponent(user)
            ? user
            : { ...user, opponentUsername: undefined },
        );

        console.log(
          "[SOCKET STATE] Setting match participants:",
          activeUsersFromBackend.length,
        );
        setMatchParticipants(activeUsersFromBackend);
        // Save to localStorage
        saveMatchParticipantsToStorage(activeUsersFromBackend, roundNumber);
      } else {
        if (!round.isActive && roundNumber === selectedRoundForMatches) {
          console.log(
            "[SOCKET STATE] Round inactive, clearing match participants for round",
            roundNumber,
          );
          // Round is NOT active - clear match participants for this round
          setMatchParticipants([]);
          saveMatchParticipantsToStorage([], roundNumber);
        }
      }

      // Set all participants for leaderboard/other uses
      if (participants.all && Array.isArray(participants.all)) {
        console.log(
          "[SOCKET STATE] Setting all participants:",
          participants.all.length,
        );
        setAllParticipants(participants.all);
      }

      // Update lobby participants if this is the selected round for users (pre-filtered by backend)
      if (roundNumber === selectedRoundForUsers) {
        const lobbyUsers = participants.byStatus?.lobby || [];
        console.log(
          "[SOCKET STATE] Updating lobby participants for round",
          roundNumber,
          ":",
          lobbyUsers.length,
        );
        setParticipants(lobbyUsers);
        // Save to localStorage
        saveParticipantsToStorage(lobbyUsers);
      }
    };

    // Listen for state responses from all rounds - use same handler since response includes roundNumber
    socket.on("round0:state", handleStateResponse);
    socket.on("round1:state", handleStateResponse);
    socket.on("round2:state", handleStateResponse);
    socket.on("round3:state", handleStateResponse);

    return () => {
      socket.off("round0:state", handleStateResponse);
      socket.off("round1:state", handleStateResponse);
      socket.off("round2:state", handleStateResponse);
      socket.off("round3:state", handleStateResponse);
    };
  }, [
    socket,
    activeRoundNumber,
    selectedRoundForUsers,
    selectedRoundForMatches,
    saveParticipantsToStorage,
    saveMatchParticipantsToStorage,
  ]);

  const handleStartRound = (roundNumber: number) => {
    console.log(
      "[ADMIN ACTION] Starting round:",
      roundNumber,
      "with participants:",
      participants.length,
    );

    if (!socket || participants.length === 0) {
      console.warn(
        "[ADMIN ACTION] Cannot start round - no socket or no participants",
      );
      return;
    }

    socket.emit(
      `round${roundNumber}:ready`,
      {},
      (
        response: BaseRoundState & {
          startTime?: number;
          duration?: number;
          timeRemaining?: number;
        },
      ) => {
        console.log("[ADMIN ACTION] Start round response:", response);

        if (response?.success) {
          showSuccessToast(`Round ${roundNumber} started successfully`);
          setActiveRoundNumber(roundNumber);
          setIsRoundActive(true);

          const startDeadline = resolveDeadlineFromResponse({
            ...response,
            roundNumber: response.roundNumber ?? roundNumber,
          });
          if (startDeadline != null) {
            setRoundEndTime(startDeadline);
          }

          // Clear lobby participants from localStorage
          localStorage.removeItem("participants");
          setParticipants([]);
          console.log("[ADMIN ACTION] Cleared lobby participants");

          // Switch to the match view for this round
          setSelectedRoundForMatches(roundNumber);
          console.log(
            "[ADMIN ACTION] Switched to match view for round",
            roundNumber,
          );

          // Fetch the updated state to get the server deadline and in-progress participants
          setTimeout(() => {
            console.log("[ADMIN ACTION] Fetching updated match state");
            fetchMatchUsers(roundNumber);
          }, 500);
        } else {
          showErrorToast(
            response?.error ||
              (response as { message?: string })?.message ||
              "Failed to start the round",
          );
        }
      },
    );
  };

  const endRound = (roundNumber: number) => {
    console.log("[ADMIN ACTION] Ending round:", roundNumber);

    if (!socket) {
      console.error("[ADMIN ACTION] Socket not connected");
      showErrorToast("Socket not connected");
      return;
    }

    if (!socket.connected) {
      console.error("[ADMIN ACTION] Socket disconnected");
      showErrorToast("Socket disconnected. Please refresh the page.");
      return;
    }

    socket.emit(
      "admin:endRound",
      { roundNumber },
      (response: BaseRoundState) => {
        console.log("[ADMIN ACTION] End round response:", response);

        if (response?.success) {
          showSuccessToast(`Round ${roundNumber} ended successfully`);
          if (roundNumber === activeRoundNumber) {
            setIsRoundActive(false);
            setActiveRoundNumber(null);
            setRoundEndTime(null);
            setGlobalTimeRemaining(0);
          }
        } else {
          showErrorToast(
            response?.error || `Failed to end Round ${roundNumber}`,
          );
        }
      },
    );

    showInfoToast(`Ending Round ${roundNumber}...`);
    setShowEndRoundConfirm(false);
    setRoundToEnd(null);
  };

  const handleEndRoundClick = (roundNumber: number) => {
    setRoundToEnd(roundNumber);
    setShowEndRoundConfirm(true);
  };

  const handleCancelEndRound = () => {
    setShowEndRoundConfirm(false);
    setRoundToEnd(null);
  };

  const handleConfirmEndRound = () => {
    if (roundToEnd !== null) {
      endRound(roundToEnd);
    }
  };

  const resetAllRedis = () => {
    console.log("[ADMIN ACTION] Resetting all Redis data");

    if (!socket) {
      console.error("[ADMIN ACTION] Socket not connected");
      showErrorToast("Socket not connected");
      return;
    }

    socket.emit("admin:reset");
    showInfoToast("Resetting Redis...");
    setShowResetRedisConfirm(false);

    // Clear all participants from localStorage when resetting Redis
    localStorage.removeItem("participants");
    [0, 1, 2, 3].forEach((round) => {
      localStorage.removeItem(`matchParticipants-round${round}`);
    });
    console.log("[ADMIN ACTION] Cleared all localStorage data");

    // Clear current state
    setParticipants([]);
    setMatchParticipants([]);
    console.log("[ADMIN ACTION] Cleared all state");
  };

  const handleResetRedisClick = () => {
    setShowResetRedisConfirm(true);
  };

  const handleCancelResetRedis = () => {
    setShowResetRedisConfirm(false);
  };

  const handleConfirmResetRedis = () => {
    resetAllRedis();
  };

  const resetUsers = () => {
    if (!socket) {
      showErrorToast("Socket not connected");
      return;
    }

    socket.emit(
      "admin:resetUsers",
      {},
      (response: { success?: boolean; error?: string }) => {
        if (response?.success) {
          showSuccessToast(
            "Reset all player and admin scores, R2 roles, and R3 qualification",
          );
          socket.emit("user:leaderboard");
        } else {
          showErrorToast(response?.error || "Failed to reset users");
        }
      },
    );
    setShowResetUsersConfirm(false);
  };

  const handleResetUsersClick = () => {
    setShowResetUsersConfirm(true);
  };

  const handleCancelResetUsers = () => {
    setShowResetUsersConfirm(false);
  };

  const handleConfirmResetUsers = () => {
    resetUsers();
  };

  const handleQualifyR3 = () => {
    if (!qualifyCount || qualifyCount <= 0) {
      showErrorToast("Please enter a valid number of players");
      return;
    }

    setIsQualifying(true);
    socket?.emit(
      "admin:qualifyRound3",
      { count: Number(qualifyCount) },
      (response: any) => {
        setIsQualifying(false);
        if (response?.success) {
          showSuccessToast(
            `Successfully qualified top ${qualifyCount} players for Round 3!`,
          );
          setQualifyCount("");
        } else {
          showErrorToast(response?.error || "Failed to qualify players");
        }
      },
    );
  };

  const fetchRoundData = useCallback(async () => {
    console.log("[API] Fetching round data from API");

    try {
      if (!session?.access_token) {
        console.warn("[API] No access token available");
        return;
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/admin/rounds`,
        {
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      console.log("[API] Round data fetched successfully:", data);

      if (data.success && data.data) {
        setCurrentRoundData(data.data);
        localStorage.setItem("battlecode_rounds", JSON.stringify(data.data));
        console.log("[API] Round data saved to state and localStorage");
      }
    } catch (error) {
      console.error("[API] Error fetching round data:", error);
      // Fallback to localStorage if API fails
      const savedRounds = localStorage.getItem("battlecode_rounds");
      if (savedRounds) {
        try {
          const parsedRounds = JSON.parse(savedRounds);
          console.log(
            "[API] Using fallback round data from localStorage:",
            parsedRounds,
          );
          setCurrentRoundData(parsedRounds);
        } catch (error) {
          console.error("[API] Failed to parse saved rounds:", error);
          localStorage.removeItem("battlecode_rounds");
        }
      }
    }
  }, [session?.access_token]);

  useEffect(() => {
    console.log("[ADMIN INIT] Admin page initializing", {
      isLoading,
      userRole,
      hasToken: !!session?.access_token,
    });

    if (isLoading) {
      console.log("[ADMIN INIT] Still loading, waiting...");
      return;
    }

    const savedRounds = localStorage.getItem("battlecode_rounds");
    if (savedRounds) {
      try {
        const parsedRounds = JSON.parse(savedRounds);
        console.log(
          "[ADMIN INIT] Loading saved rounds from localStorage:",
          parsedRounds,
        );
        setCurrentRoundData(parsedRounds);
      } catch (error) {
        console.error("[ADMIN INIT] Failed to parse saved rounds:", error);
        localStorage.removeItem("battlecode_rounds");
      }
    }

    if (userRole !== "ADMIN") {
      console.warn("[ADMIN INIT] User is not admin, redirecting back");
      router.back();
      return;
    }

    console.log("[ADMIN INIT] User is admin, initializing admin page");
    setIsAdmin(true);

    if (session?.access_token) {
      console.log("[ADMIN INIT] Access token available, fetching round data");
      fetchRoundData();
    }
  }, [isLoading, userRole, router, session?.access_token, fetchRoundData]);

  // Save round data to localStorage whenever it changes
  useEffect(() => {
    if (currentRoundData) {
      console.log(
        "[STATE] Current round data changed, saving to localStorage:",
        currentRoundData,
      );
      localStorage.setItem(
        "battlecode_rounds",
        JSON.stringify(currentRoundData),
      );
    }
  }, [currentRoundData]);

  // Listen for real-time round status updates via socket (same pattern as dashboard)
  useEffect(() => {
    if (!socket) {
      console.log("[SOCKET] No socket available for real-time updates");
      return;
    }

    console.log("[SOCKET] Setting up real-time round status listeners");

    const handleCurrentRound = (data: CurrentRoundData) => {
      console.log("[SOCKET] Received current round update:", data);
      setCurrentRoundData(data);
    };

    const handleRedisResetSuccess = () => {
      console.log("[SOCKET] Redis reset successful");
      showSuccessToast("Redis cleared successfully");
    };

    socket.on("server:currentRound", handleCurrentRound);
    socket.on("admin:reset:success", handleRedisResetSuccess);

    // Request initial round data
    console.log("[SOCKET] Requesting initial round data");
    socket.emit("client:getCurrentRound");

    return () => {
      console.log("[SOCKET] Cleaning up round status listeners");
      socket.off("server:currentRound", handleCurrentRound);
      socket.off("admin:reset:success", handleRedisResetSuccess);
    };
  }, [socket]);

  // Fetch lobby users whenever socket changes or selected round changes
  useEffect(() => {
    if (!socket) {
      console.log("[FETCH] No socket for fetching lobby users");
      return;
    }
    console.log(
      "[FETCH] Fetching lobby users for round",
      selectedRoundForUsers,
    );
    fetchLobbyUsers(selectedRoundForUsers);
  }, [socket, selectedRoundForUsers, fetchLobbyUsers]);

  // Fetch match users whenever socket changes or selected round for matches changes
  useEffect(() => {
    if (!socket) {
      console.log("[FETCH] No socket for fetching match users");
      return;
    }
    console.log(
      "[FETCH] Fetching match users for round",
      selectedRoundForMatches,
    );
    fetchMatchUsers(selectedRoundForMatches);
  }, [socket, selectedRoundForMatches, fetchMatchUsers]);

  const inProgressRoundNumber =
    currentRoundData?.rounds?.find(
      (round) => round.isActive || round.status === "IN_PROGRESS",
    )?.roundNumber ??
    (currentRoundData?.currentRoundStatus === "IN_PROGRESS"
      ? currentRoundData.currentRoundNumber
      : null);

  const isR3LeaderboardLocked =
    currentRoundData?.currentRoundNumber === 3 &&
    currentRoundData?.currentRoundStatus !== "LOCKED";
  const showLeaderboardLocked = currentRoundData
    ? isR3LeaderboardLocked
    : leaderboardLocked;

  // After refresh, ask the active round for its deadline instead of only the default tab (round 0)
  useEffect(() => {
    if (!socket || inProgressRoundNumber == null) return;
    socket.emit(`round${inProgressRoundNumber}:getState`, {});
  }, [socket, inProgressRoundNumber]);

  // Listen for live lobby updates
  useEffect(() => {
    if (!socket) return;

    const handleLobbyUpdate0 = (
      data: BaseRoundState & { timeRemaining?: number },
    ) => {
      if (activeRoundNumber === 0) {
        const lobbyDeadline = resolveDeadlineFromResponse({
          ...data,
          roundNumber: 0,
        });
        if (lobbyDeadline != null) {
          setRoundEndTime((prev) =>
            shouldCorrectTimer(prev, lobbyDeadline) ? lobbyDeadline : prev,
          );
        }
      }
      if (0 === selectedRoundForUsers) {
        console.log("[LOBBY UPDATE Round 0]", data);
        if (data.participants?.byStatus?.lobby) {
          const lobbyUsers = data.participants.byStatus.lobby;
          setParticipants(lobbyUsers);
          saveParticipantsToStorage(lobbyUsers);
        }
      }
    };

    const handleLobbyUpdate1 = (data: BaseRoundState) => {
      if (activeRoundNumber === 1) {
        const lobbyDeadline = resolveDeadlineFromResponse({
          ...data,
          roundNumber: 1,
        });
        if (lobbyDeadline != null) {
          setRoundEndTime((prev) =>
            shouldCorrectTimer(prev, lobbyDeadline) ? lobbyDeadline : prev,
          );
        }
      }
      if (1 === selectedRoundForUsers) {
        console.log("[LOBBY UPDATE Round 1]", data);
        if (data.participants?.byStatus?.lobby) {
          const lobbyUsers = data.participants.byStatus.lobby;
          setParticipants(lobbyUsers);
          saveParticipantsToStorage(lobbyUsers);
        }
      }
    };

    const handleLobbyUpdate2 = (data: BaseRoundState) => {
      if (2 === selectedRoundForUsers) {
        console.log("[LOBBY UPDATE Round 2]", data);
        if (data.participants?.byStatus?.lobby) {
          const lobbyUsers = data.participants.byStatus.lobby;
          setParticipants(lobbyUsers);
          saveParticipantsToStorage(lobbyUsers);
        }
      }
    };

    const handleLobbyUpdate3 = (data: BaseRoundState) => {
      if (activeRoundNumber === 3) {
        const lobbyDeadline = resolveDeadlineFromResponse({
          ...data,
          roundNumber: 3,
        });
        if (lobbyDeadline != null) {
          setRoundEndTime((prev) =>
            shouldCorrectTimer(prev, lobbyDeadline) ? lobbyDeadline : prev,
          );
        }
      }
      if (3 === selectedRoundForUsers) {
        console.log("[LOBBY UPDATE Round 3]", data);
        if (data.participants?.byStatus?.lobby) {
          const lobbyUsers = data.participants.byStatus.lobby;
          setParticipants(lobbyUsers);
          saveParticipantsToStorage(lobbyUsers);
        }
      }
    };

    socket.on("lobby:round0", handleLobbyUpdate0);
    socket.on("lobby:round1", handleLobbyUpdate1);
    socket.on("lobby:round2", handleLobbyUpdate2);
    socket.on("lobby:round3", handleLobbyUpdate3);

    return () => {
      socket.off("lobby:round0", handleLobbyUpdate0);
      socket.off("lobby:round1", handleLobbyUpdate1);
      socket.off("lobby:round2", handleLobbyUpdate2);
      socket.off("lobby:round3", handleLobbyUpdate3);
    };
  }, [
    socket,
    selectedRoundForUsers,
    activeRoundNumber,
    saveParticipantsToStorage,
  ]);

  const resetAllRounds = async () => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/admin/rounds/reset`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
    } catch (error) {
      console.error("Error resetting rounds:", error);
    }
  };

  const updateRoundStatus = async (roundNumber: number, newStatus: string) => {
    console.log("[ADMIN ACTION] Updating round status:", {
      roundNumber,
      newStatus,
    });

    if (!isAdmin || adminLoading) {
      console.warn(
        "[ADMIN ACTION] Cannot update status - not admin or already loading",
      );
      return;
    }
    if (!newStatus || roundNumber === null || roundNumber === undefined) {
      console.warn("[ADMIN ACTION] Invalid parameters for updateRoundStatus");
      return;
    }

    setAdminLoading(true);

    if (
      (newStatus === "COMPLETED" || newStatus === "LOCKED") &&
      roundNumber === 0
    ) {
      console.log("[ADMIN ACTION] Clearing code store for round 0");
      localStorage.removeItem(`battlecode-round-0-code-store`);
    }
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/admin/rounds/${roundNumber}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ status: newStatus }),
        },
      );
      if (response) {
        const data = await response.json();
        console.log("[ADMIN ACTION] Update status response:", data);

        if (data.success) {
          showSuccessToast(`Round ${roundNumber} ${newStatus.toLowerCase()}`);
          await fetchRoundData();
        } else {
          showErrorToast(data.error || "Failed to update round status");
        }
      }
    } catch (error) {
      console.error("[ADMIN ACTION] Error updating round status:", error);
      showErrorToast("Failed to update round status");
    } finally {
      setAdminLoading(false);
    }
  };

  const getStatusButtonColor = (
    currentStatus: string,
    targetStatus: string,
  ) => {
    const statusColors: { [key: string]: string } = {
      LOCKED: "bg-gray-600 hover:bg-gray-500",
      LOBBY: "bg-orange-600 hover:bg-orange-500",
      IN_PROGRESS: "bg-green-600 hover:bg-green-500",
      COMPLETED: "bg-purple-600",
    };

    if (currentStatus === targetStatus) {
      return statusColors[targetStatus] + " opacity-50 cursor-not-allowed";
    }

    return statusColors[targetStatus];
  };

  const canTransition = (currentStatus: string, targetStatus: string) => {
    const validTransitions: { [key: string]: string[] } = {
      LOCKED: ["LOBBY"],
      LOBBY: ["IN_PROGRESS", "LOCKED"],
      IN_PROGRESS: ["COMPLETED", "LOBBY"],
      COMPLETED: ["LOBBY"],
    };

    return validTransitions[currentStatus]?.includes(targetStatus) || false;
  };

  // Listen to timer updates from server and re-anchor only when drifted
  useEffect(() => {
    if (!socket) return;

    const applyTimerTick = (
      roundNumber: number,
      data: { timeRemaining?: number; endTime?: number },
    ) => {
      if (activeRoundNumber !== roundNumber) return;
      const serverEndTime = resolveTimerTickEndTime(roundNumber, data);
      if (serverEndTime == null) return;
      setRoundEndTime((prev) =>
        shouldCorrectTimer(prev, serverEndTime) ? serverEndTime : prev,
      );
    };

    const handleTimer0 = (data: {
      timeRemaining?: number;
      endTime?: number;
      duration?: number;
      elapsed?: number;
      startTime?: number;
    }) => applyTimerTick(0, data);
    const handleGlobalTimer = (data: {
      timeRemaining?: number;
      endTime?: number;
    }) => applyTimerTick(1, data);
    const handleTimer3 = (data: {
      timeRemaining?: number;
      endTime?: number;
      duration?: number;
      elapsed?: number;
      startTime?: number;
    }) => applyTimerTick(3, data);

    const handleMatchmakingCycle = (data: { nextCycle: number }) => {
      if (activeRoundNumber === 1) {
        setNextMatchmakingCycle(Math.max(0, Math.ceil(data.nextCycle / 1000)));
      }
    };

    const handleRound1Ended = (data: { endTime?: number }) => {
      if (activeRoundNumber !== 1) return;
      if (typeof data.endTime === "number" && Number.isFinite(data.endTime)) {
        setRoundEndTime(data.endTime);
      }
      setGlobalTimeRemaining(0);
    };

    socket.on("round0:timer", handleTimer0);
    socket.on("round1:globalTimer", handleGlobalTimer);
    socket.on("round1:matchmakingCycle", handleMatchmakingCycle);
    socket.on("round1:ended", handleRound1Ended);
    socket.on("round3:timer", handleTimer3);

    return () => {
      socket.off("round0:timer", handleTimer0);
      socket.off("round1:globalTimer", handleGlobalTimer);
      socket.off("round1:matchmakingCycle", handleMatchmakingCycle);
      socket.off("round1:ended", handleRound1Ended);
      socket.off("round3:timer", handleTimer3);
    };
  }, [socket, activeRoundNumber]);
  // Cooldown timer logic
  useEffect(() => {
    const cooldownInterval = setInterval(() => {
      if (
        currentUser?.status === "cooldown" &&
        typeof currentUser.cooldownEndTime === "number" &&
        !isNaN(currentUser.cooldownEndTime)
      ) {
        const remaining = Math.max(
          0,
          Math.ceil((currentUser.cooldownEndTime - Date.now()) / 1000),
        );
        setCooldownTimeRemaining(remaining);
      } else {
        if (cooldownTimeRemaining !== 0) setCooldownTimeRemaining(0);
      }
    }, 1000);
    return () => clearInterval(cooldownInterval);
  }, [currentUser, cooldownTimeRemaining]);
  // Display-only countdown from the server deadline
  useEffect(() => {
    if (!roundEndTime || !isRoundActive) {
      return;
    }

    const updateTimer = () => {
      const remaining = Math.max(
        0,
        Math.ceil((roundEndTime - Date.now()) / 1000),
      );
      setGlobalTimeRemaining(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [roundEndTime, isRoundActive]);
  // Format time helper
  const formatTime = (seconds: number | null | undefined): string => {
    if (typeof seconds !== "number" || seconds < 0 || isNaN(seconds))
      return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };
  const isInCooldown =
    currentUser?.status === "cooldown" && cooldownTimeRemaining > 0;

  return (
    <>
      <LoadingOverlay
        isLoading={isLoading || !session}
        message={
          isLoading ? "Verifying authentication..." : "Checking admin access..."
        }
      />
      {isAdmin && (
        <div className="min-h-screen w-full bg-[url('/bg-dashboard.svg')] bg-cover bg-center flex items-center justify-center px-5 py-8">
          {/* End Round Confirmation Modal */}
          {showEndRoundConfirm && (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
              <div className="bg-gray-900 border-2 border-orange-500 rounded-lg p-6 max-w-md w-full">
                <h3 className="text-xl font-bold text-orange-500 mb-4">
                  Confirm End Round
                </h3>
                <p className="text-white mb-6">
                  Are you sure you want to end Round {roundToEnd}? This action
                  cannot be undone.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={handleConfirmEndRound}
                    className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded font-medium transition-all"
                  >
                    Yes, End Round
                  </button>
                  <button
                    onClick={handleCancelEndRound}
                    className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded font-medium transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Reset Users Confirmation Modal */}
          {showResetUsersConfirm && (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
              <div className="bg-gray-900 border-2 border-red-500 rounded-lg p-6 max-w-lg w-full">
                <h3 className="text-xl font-bold text-red-500 mb-2">
                  Confirm Reset Users
                </h3>
                <p className="text-red-200 text-sm mb-4">
                  Postgres User rows only. Redis is not touched.
                </p>
                <div className="text-white text-sm space-y-3 mb-6">
                  <div>
                    <p className="font-semibold text-red-300 mb-1">Clears</p>
                    <ul className="list-disc list-inside text-gray-200 space-y-1">
                      <li>
                        Every user (players and admins):{" "}
                        <span className="font-mono">eventScore = 0</span>
                      </li>
                      <li>
                        <span className="font-mono">round2Role = null</span>
                      </li>
                      <li>
                        <span className="font-mono">
                          qualifiedForR3 = false
                        </span>
                      </li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-300 mb-1">
                      Does not change
                    </p>
                    <ul className="list-disc list-inside text-gray-400 space-y-1">
                      <li>
                        PLAYER/ADMIN <span className="font-mono">role</span>
                      </li>
                      <li>Submissions, round statuses, problems</li>
                      <li>Anything in Redis (live matches, lobbies, etc.)</li>
                    </ul>
                  </div>
                  <p className="text-gray-400">
                    Zeroes scores and Round 2/R3 flags in the DB. Use Reset
                    Redis too if you want a clean live-game slate.
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleConfirmResetUsers}
                    className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded font-medium transition-all"
                  >
                    Yes, Reset Users
                  </button>
                  <button
                    onClick={handleCancelResetUsers}
                    className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded font-medium transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Reset Redis Confirmation Modal */}
          {showResetRedisConfirm && (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
              <div className="bg-gray-900 border-2 border-yellow-500 rounded-lg p-6 max-w-lg w-full">
                <h3 className="text-xl font-bold text-yellow-500 mb-2">
                  Confirm Reset Redis
                </h3>
                <p className="text-yellow-200 text-sm mb-4">
                  Redis only. Postgres is not touched.
                </p>
                <div className="text-white text-sm space-y-3 mb-6">
                  <div>
                    <p className="font-semibold text-yellow-300 mb-1">
                      Clears (FLUSHDB — all keys in this Redis DB)
                    </p>
                    <ul className="list-disc list-inside text-gray-200 space-y-1">
                      <li>Round 0–3 live state, lobbies, and matches</li>
                      <li>Bounties, cooldowns, submit locks</li>
                      <li>Cached leaderboard data</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-300 mb-1">
                      Does not change
                    </p>
                    <ul className="list-disc list-inside text-gray-400 space-y-1">
                      <li>User scores, Round 2 roles, R3 qualification</li>
                      <li>Submissions, round statuses, problems in Postgres</li>
                    </ul>
                  </div>
                  <p className="text-gray-400">
                    Wipes in-memory / live game state, then rebroadcasts the
                    current round. Use Reset Users too if you also want scores
                    and flags zeroed.
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleConfirmResetRedis}
                    className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded font-medium transition-all"
                  >
                    Yes, Reset All Redis
                  </button>
                  <button
                    onClick={handleCancelResetRedis}
                    className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded font-medium transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="w-full max-w-6xl rounded-lg border-2 border-orange-500/50 glass-box p-6">
            {/* Admin Access Information Section */}
            <div className="mb-8 bg-gradient-to-r from-orange-600/20 to-red-600/20 border-2 border-orange-500 rounded-lg p-6">
              <div className="flex items-center justify-center gap-3 mb-3">
                <div className="w-3 h-3 bg-orange-500 rounded-full animate-pulse"></div>
                <h2 className="text-2xl font-bold text-orange-400">
                  Admin Panel Access Restricted
                </h2>
                <div className="w-3 h-3 bg-orange-500 rounded-full animate-pulse"></div>
              </div>
              <div className="text-center space-y-2">
                <p className="text-white text-lg">
                  <span className="text-gray-300">Authorized Admin:</span>{" "}
                  <span className="font-semibold text-orange-300">
                    Aryan Jain (Tech Lead)
                  </span>
                </p>
                <p className="text-white">
                  <span className="text-gray-300">Email:</span>{" "}
                  <span className="font-mono text-orange-200">
                    aryanramesh.jain2023@vitstudent.ac.in
                  </span>
                </p>
                <p className="text-white">
                  <span className="text-gray-300">Registration Number:</span>{" "}
                  <span className="font-mono text-orange-200">23BCT0020</span>
                </p>
              </div>
            </div>

            {/* --- Active Round Section (generalized for any round) --- */}
            <div className="mb-8">
              {isRoundActive && activeRoundNumber !== null && (
                <>
                  <div className="text-4xl text-center text-green-400">
                    Round {activeRoundNumber} Active
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
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center mb-6">
              <div className="w-4 h-4 bg-orange-500 rounded-full mr-3 animate-pulse"></div>
              <h3 className="text-2xl font-bold text-orange-500">
                Admin Controls
              </h3>
              {adminLoading && (
                <div className="ml-3 w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
              )}
            </div>

            <div className="grid grid-cols-4 gap-6">
              {[0, 1, 2, 3].map((roundNum) => {
                const roundData = currentRoundData?.rounds.find(
                  (r) => r.roundNumber === roundNum,
                );
                const currentStatus = roundData?.status || "LOCKED";

                return (
                  <div key={roundNum} className="space-y-3">
                    <h4 className="text-xl font-semibold text-white text-center">
                      Round {roundNum}
                    </h4>
                    <p className="text-sm text-gray-400 text-center">
                      Current:{" "}
                      <span className="text-orange-300 font-medium">
                        {currentStatus}
                      </span>
                    </p>

                    <div className="space-y-2">
                      {["LOBBY", "IN_PROGRESS", "COMPLETED", "LOCKED"].map(
                        (status) => {
                          const isCurrentStatus = currentStatus === status;
                          const canMakeTransition = canTransition(
                            currentStatus,
                            status,
                          );
                          const isDisabled =
                            isCurrentStatus ||
                            !canMakeTransition ||
                            adminLoading;

                          return (
                            <button
                              key={status}
                              onClick={() =>
                                updateRoundStatus(roundNum, status)
                              }
                              disabled={isDisabled}
                              className={`
                              w-full px-3 py-2 text-sm rounded transition-all duration-200
                              ${getStatusButtonColor(currentStatus, status)}
                              ${isDisabled ? "opacity-50 cursor-not-allowed" : "hover:scale-105"}
                              text-white font-medium
                            `}
                            >
                              {status.replace("_", " ")}
                            </button>
                          );
                        },
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Automated R3 Qualification Card */}
            <div className="mt-6 bg-gray-800/80 border border-orange-500/30 rounded-lg p-5">
              <h4 className="text-orange-400 font-bold mb-3 text-lg">
                Automate R3 Qualification
              </h4>
              <p className="text-sm text-gray-300 mb-4">
                Enter the number of top players to automatically qualify based
                on their current event score.
              </p>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    Number of Top Players (X)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={qualifyCount}
                    onChange={(e) =>
                      setQualifyCount(
                        e.target.value ? parseInt(e.target.value) : "",
                      )
                    }
                    className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-orange-500 transition-colors"
                    placeholder="e.g., 40"
                  />
                </div>
                <button
                  onClick={handleQualifyR3}
                  disabled={isQualifying || !qualifyCount}
                  className={`px-6 py-2 rounded font-medium transition-all duration-200 whitespace-nowrap
                    ${
                      isQualifying || !qualifyCount
                        ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                        : "bg-orange-600 text-white hover:bg-orange-500 hover:scale-105 shadow-lg shadow-orange-500/20"
                    }
                  `}
                >
                  {isQualifying ? "Processing..." : "Qualify Players"}
                </button>
              </div>
            </div>

            <div className="mt-6 text-sm text-gray-400 bg-gray-800/50 rounded-lg p-4">
              <h4 className="text-orange-400 font-medium mb-2">
                Status Transitions:
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <p className="text-white">• LOCKED → LOBBY: Open for joining</p>
                <p className="text-white">• LOBBY → IN_PROGRESS: Start round</p>
                <p className="text-white">
                  • IN_PROGRESS → COMPLETED: End round
                </p>
              </div>
            </div>

            {/* User Management Section */}
            <div className="mt-8 bg-gray-800/50 rounded-lg p-6">
              <h4 className="text-orange-400 font-medium mb-4">
                User Management
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Add User */}
                <div className="space-y-3">
                  <input
                    type="email"
                    placeholder="Email to add"
                    data-add-email
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                  />
                  <select
                    defaultValue="0"
                    data-add-round
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                  >
                    <option value="0">Round 0</option>
                    <option value="1">Round 1</option>
                    <option value="2">Round 2</option>
                    <option value="3">Round 3</option>
                  </select>
                  <button
                    onClick={() => {
                      const email =
                        (
                          document.querySelector(
                            "[data-add-email]",
                          ) as HTMLInputElement
                        )?.value || "";
                      const round =
                        (
                          document.querySelector(
                            "[data-add-round]",
                          ) as HTMLSelectElement
                        )?.value || "0";
                      addUserToRound(email, parseInt(round));
                    }}
                    className="w-full px-3 py-2 bg-green-600 hover:bg-green-500 text-white rounded text-sm font-medium"
                  >
                    Add User
                  </button>
                </div>

                {/* Remove User */}
                <div className="space-y-3">
                  <input
                    type="email"
                    placeholder="Email to remove"
                    data-remove-email
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                  />
                  <select
                    defaultValue="0"
                    data-remove-round
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                  >
                    <option value="0">Round 0</option>
                    <option value="1">Round 1</option>
                    <option value="2">Round 2</option>
                    <option value="3">Round 3</option>
                  </select>
                  <button
                    onClick={() => {
                      const email =
                        (
                          document.querySelector(
                            "[data-remove-email]",
                          ) as HTMLInputElement
                        )?.value || "";
                      const round =
                        (
                          document.querySelector(
                            "[data-remove-round]",
                          ) as HTMLSelectElement
                        )?.value || "0";
                      removeUserFromRound(email, parseInt(round));
                    }}
                    className="w-full px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded text-sm font-medium"
                  >
                    Remove User
                  </button>
                </div>
              </div>
            </div>

            {/* End Round Section */}
            <div className="mt-8 bg-gray-800/50 rounded-lg p-6">
              <h4 className="text-orange-400 font-medium mb-4">
                End Round Controls
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[0, 1, 2, 3].map((roundNum) => (
                  <button
                    key={roundNum}
                    onClick={() => handleEndRoundClick(roundNum)}
                    disabled={!socket}
                    className={`px-4 py-3 rounded text-sm font-medium transition-all ${
                      !socket
                        ? "bg-gray-600 cursor-not-allowed opacity-50"
                        : "bg-red-600 hover:bg-red-500 hover:scale-105"
                    } text-white`}
                  >
                    End Round {roundNum}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-3">
                Note: This will trigger the end of the selected round via socket
                event.
              </p>
            </div>

            {/* Reset Redis Section */}
            <div className="mt-8 bg-gray-800/50 rounded-lg p-6">
              <h4 className="text-orange-400 font-medium mb-4">
                Reset Redis Controls
              </h4>
              <div className="flex justify-center">
                <button
                  onClick={handleResetRedisClick}
                  disabled={!socket}
                  className={`px-6 py-3 rounded text-sm font-medium transition-all ${
                    !socket
                      ? "bg-gray-600 cursor-not-allowed opacity-50"
                      : "bg-yellow-600 hover:bg-yellow-500 hover:scale-105"
                  } text-white`}
                >
                  Reset All Redis Data
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-3 text-center">
                Redis only (FLUSHDB). Wipes live game state. Does not change
                Postgres scores or R2/R3 flags.
              </p>
            </div>

            {/* Reset Users Section */}
            <div className="mt-8 bg-gray-800/50 rounded-lg p-6">
              <h4 className="text-orange-400 font-medium mb-4">
                Reset User Controls
              </h4>
              <div className="flex justify-center">
                <button
                  onClick={handleResetUsersClick}
                  disabled={!socket}
                  className={`px-6 py-3 rounded text-sm font-medium transition-all ${
                    !socket
                      ? "bg-gray-600 cursor-not-allowed opacity-50"
                      : "bg-red-600 hover:bg-red-500 hover:scale-105"
                  } text-white`}
                >
                  Reset Users
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-3 text-center">
                Postgres only. Zeroes eventScore, clears round2Role and
                qualifiedForR3. Does not change Redis or PLAYER/ADMIN role.
              </p>
            </div>

            {/* Lobby Users Section */}
            <div className="mt-8 bg-gray-800/50 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-orange-400 font-medium">
                  Lobby Users by Round
                </h4>
                {participants.length > 0 && (
                  <button
                    onClick={() => handleStartRound(selectedRoundForUsers)}
                    disabled={!socket || participants.length === 0}
                    className={`px-4 py-2 rounded text-sm font-medium transition-all ${
                      !socket || participants.length === 0
                        ? "bg-gray-600 cursor-not-allowed opacity-50"
                        : "bg-green-600 hover:bg-green-500 hover:scale-105"
                    } text-white`}
                  >
                    Start Round {selectedRoundForUsers}
                  </button>
                )}
              </div>
              <div className="space-y-4">
                <div className="flex gap-2">
                  {[0, 1, 2, 3].map((round) => (
                    <button
                      key={round}
                      onClick={() => {
                        console.log(
                          `[BUTTON CLICKED] Round ${round} button was pressed`,
                        );
                        console.log(
                          `[CURRENT STATE] selectedRoundForUsers: ${selectedRoundForUsers}, socket: ${socket ? "connected" : "not connected"}`,
                        );
                        console.log(
                          `[FETCHING LOBBY USERS FOR ROUND ${round}]`,
                        );
                        setSelectedRoundForUsers(round);
                        fetchLobbyUsers(round);
                      }}
                      className={`px-4 py-2 rounded text-sm font-medium transition-all ${
                        selectedRoundForUsers === round
                          ? "bg-orange-500 text-white"
                          : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                      }`}
                    >
                      Round {round}
                    </button>
                  ))}
                </div>

                <div className="bg-gray-700/50 rounded-lg p-4">
                  {participants.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-gray-300 text-sm mb-3">
                        {participants.length} user
                        {participants.length !== 1 ? "s" : ""} in lobby
                      </p>
                      <div className="max-h-64 overflow-y-auto space-y-2">
                        {participants.map((participant, idx) => (
                          <div
                            key={`participant-${participant.userId}-${idx}`}
                            className="flex items-center justify-between bg-gray-600/50 px-3 py-2 rounded text-sm"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                              <span className="text-white">
                                {/* FIX: Add fallbacks so names don't show up blank */}
                                {participant.username ||
                                  participant.userId ||
                                  "Unknown"}
                              </span>
                            </div>
                            <span className="text-gray-400 text-xs">
                              Rank: {participant.rank}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-400 text-sm text-center py-4">
                      No users in lobby for Round {selectedRoundForUsers}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Match Users Section - IN_PROGRESS Users */}
            <div className="mt-8 bg-gray-800/50 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-orange-400 font-medium">
                  Active Users in IN_PROGRESS Rounds
                </h4>
              </div>
              <div className="space-y-4">
                <div className="flex gap-2">
                  {[0, 1, 2, 3].map((round) => (
                    <button
                      key={round}
                      onClick={() => {
                        // Clear match participants immediately when switching rounds
                        setMatchParticipants([]);
                        setSelectedRoundForMatches(round);
                        fetchMatchUsers(round);
                      }}
                      className={`px-4 py-2 rounded text-sm font-medium transition-all ${
                        selectedRoundForMatches === round
                          ? "bg-orange-500 text-white"
                          : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                      }`}
                    >
                      Round {round}
                    </button>
                  ))}
                </div>

                <div className="bg-gray-700/50 rounded-lg p-4">
                  {matchParticipants.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-gray-300 text-sm mb-3">
                        {matchParticipants.length} active user
                        {matchParticipants.length !== 1 ? "s" : ""}
                      </p>
                      <div className="max-h-96 overflow-y-auto space-y-2">
                        {matchParticipants.map((participant, idx) => {
                          const paired = isPairedInMatch(participant);
                          return (
                            <div
                              key={`match-${participant.userId}-${idx}`}
                              className={`bg-gray-600/50 px-4 py-3 rounded border-l-4 ${
                                paired ? "border-blue-500" : "border-yellow-500"
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div
                                    className={`w-2 h-2 rounded-full ${
                                      paired ? "bg-blue-500" : "bg-yellow-500"
                                    }`}
                                  ></div>
                                  <div className="flex flex-col">
                                    <span className="text-white font-medium">
                                      {/* FIX: Add fallbacks so names don't show up blank */}
                                      {participant.username ||
                                        participant.userId ||
                                        "Unknown"}
                                    </span>
                                    {paired && participant.opponentUsername && (
                                      <span className="text-sm text-blue-300 mt-1">
                                        🎮 vs{" "}
                                        <span className="font-semibold text-blue-200">
                                          {participant.opponentUsername}
                                        </span>
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <span
                                  className={`text-xs font-semibold uppercase ${
                                    paired ? "text-blue-400" : "text-yellow-400"
                                  }`}
                                >
                                  {activeUserStatusLabel(participant)}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-400 text-sm text-center py-4">
                      No active users for Round {selectedRoundForMatches}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Event-wide leaderboard from server:leaderboard */}
            <div className="mt-8 bg-gray-800/50 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
                <div className="flex items-center">
                  <img
                    src="/leaderboard-img.svg"
                    alt="Leaderboard Icon"
                    width={16}
                    height={16}
                  />
                  <p className="text-2xl text-orange-500 ml-2">
                    Live Leaderboard
                  </p>
                </div>
                <p className="text-sm text-gray-400">
                  {leaderboard.length}{" "}
                  {leaderboard.length === 1 ? "player" : "players"}
                </p>
              </div>
              {showLeaderboardLocked && (
                <p className="text-sm text-yellow-400 mb-4">
                  Leaderboard updates are locked while Round 3 is live. Showing
                  the last received list.
                </p>
              )}
              <CustomScrollbar className="max-h-[32rem] overflow-y-auto overflow-x-auto">
                {leaderboard.length > 0 ? (
                  <table className="w-full text-left text-sm text-white">
                    <thead className="sticky top-0 bg-gray-800">
                      <tr className="border-b border-gray-700">
                        <th className="py-2 px-3 font-bold">Rank</th>
                        <th className="py-2 px-3 font-bold">Player</th>
                        <th className="py-2 px-3 font-bold">Score</th>
                        <th className="py-2 px-3 font-bold">Round</th>
                        <th className="py-2 px-3 font-bold">Reg No</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.map((entry, idx) => (
                        <tr
                          key={entry.id || idx}
                          className="border-gray-800 hover:bg-white/5 transition"
                        >
                          <td className="py-2 px-3">{entry.rank}</td>
                          <td className="py-2 px-3">
                            <div className="flex flex-col">
                              <span className="font-medium">
                                {entry.username && entry.username !== "Not Set"
                                  ? entry.username
                                  : entry.name || "Unknown"}
                              </span>
                              {entry.username &&
                                entry.username !== "Not Set" &&
                                entry.name && (
                                  <span className="text-xs text-gray-400">
                                    {entry.name}
                                  </span>
                                )}
                            </div>
                          </td>
                          <td className="py-2 px-3 font-mono text-cyan-400">
                            {entry.score}
                          </td>
                          <td className="py-2 px-3">{entry.currentRound}</td>
                          <td className="py-2 px-3 text-gray-300">
                            {entry.regNo || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="flex items-center justify-center py-8 text-gray-400">
                    <p>
                      {showLeaderboardLocked
                        ? "Leaderboard is locked during Round 3."
                        : "Waiting for leaderboard..."}
                    </p>
                  </div>
                )}
              </CustomScrollbar>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
