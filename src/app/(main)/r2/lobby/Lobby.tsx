"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Rocket } from "lucide-react";
import PlayerCard from "@/components/shared/PlayerCard";
import CustomScrollbar from "@/components/shared/CustomScrollbar";
import { useSocket } from "@/contexts/SocketContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  showSuccessToast,
  showErrorToast,
  showInfoToast,
} from "@/components/shared/CustomToast";
import LoadingOverlay from "@/components/shared/LoadingOverlay";

// --- Type Definitions ---

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

interface SimpleSocketResponse {
  success: boolean;
  error?: string;
  message?: string;
}

const getLobbyParticipants = (payload: {
  participants?: {
    byStatus?: {
      lobby?: Participant[];
      waiting?: Participant[];
      in_match?: Participant[];
      in_bounty?: Participant[];
      cooldown?: Participant[];
      finished?: Participant[];
      disconnected?: Participant[];
    };
    all?: Participant[];
  };
}): Participant[] | null => {
  if (
    Array.isArray(payload.participants?.all) &&
    payload.participants.all.length > 0
  ) {
    return payload.participants.all;
  }
  if (payload.participants?.byStatus) {
    const { lobby = [], waiting = [] } = payload.participants.byStatus;
    const combined = [...lobby, ...waiting];
    if (combined.length > 0) return combined;
  }
  return Array.isArray(payload.participants?.all)
    ? payload.participants.all
    : null;
};

const isAlreadyInRoundError = (res?: SimpleSocketResponse) =>
  /already|joined|in (the )?round|in lobby/i.test(
    `${res?.error || ""} ${res?.message || ""}`,
  );

// --- Component ---

export default function LobbyR2() {
  const router = useRouter();
  const { socket, isConnected, isLoading: socketLoading } = useSocket();
  const { userId, isLoading: authLoading, userRole } = useAuth();

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [authenticationChecked, setAuthenticationChecked] = useState(false);
  const [isCheckingRound, setIsCheckingRound] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [roundStatus, setRoundStatus] = useState<
    "LOBBY" | "IN_PROGRESS" | "COMPLETED" | "LOCKED"
  >("LOBBY");

  const hasNavigated = useRef(false);
  const hasAttemptedJoin = useRef(false);
  const requestedStateOnProgress = useRef(false);
  const joinTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isAdmin = userRole === "ADMIN";

  const clearJoinTimeout = useCallback(() => {
    if (joinTimeoutRef.current) {
      clearTimeout(joinTimeoutRef.current);
      joinTimeoutRef.current = null;
    }
  }, []);

  // Functions
  const handleStartRound = () => {
    if (!socket || participants.length === 0) return;
    localStorage.removeItem("battlecode-round-2-code-store");
    socket.emit("round2:ready", {}, (response: SimpleSocketResponse) => {
      if (response.success) {
        showSuccessToast("Round 2 started successfully");
      } else {
        showErrorToast(response.error || "Failed to start the round");
      }
    });
  };

  // Authentication check
  useEffect(() => {
    if (!authLoading) setAuthenticationChecked(true);
    if (!authLoading && !userId) router.push("/dashboard");
  }, [authLoading, userId, router]);

  // Round status check
  useEffect(() => {
    if (!socket || !isConnected || !authenticationChecked) return;

    socket.emit("user:current-round", {}, (response?: CurrentRoundResponse) => {
      console.log("[R2 Lobby] Current round response:", response);

      if (!response?.success || !response.currentRound) {
        showErrorToast(response?.error || "Failed to check round status");
        router.back();
        return;
      }

      const currentRound = response.currentRound;
      const r2 = currentRound.rounds?.find((r) => r.roundNumber === 2);
      const r2Status =
        r2?.status ||
        (currentRound.currentRoundNumber === 2
          ? currentRound.currentRoundStatus
          : null);

      if (r2Status !== "LOBBY" && r2Status !== "IN_PROGRESS") {
        showErrorToast(
          r2Status
            ? `Round 2 is currently ${r2Status.toLowerCase()}.`
            : "Round 2 is not active",
        );
        router.back();
        return;
      }

      setIsCheckingRound(false);
    });
  }, [socket, isConnected, authenticationChecked, router]);

  useEffect(() => {
    if (!isConnected) {
      hasAttemptedJoin.current = false;
    }
  }, [isConnected]);

  // 🔑 Join Round 2 lobby and fetch state
  useEffect(() => {
    if (
      !socket ||
      !isConnected ||
      !authenticationChecked ||
      socketLoading ||
      isCheckingRound ||
      hasAttemptedJoin.current
    ) {
      return;
    }

    hasAttemptedJoin.current = true;
    console.debug("[R2 Lobby] Emitting round2:join & round2:getState");

    joinTimeoutRef.current = setTimeout(() => {
      console.error("[R2 Lobby] Join/GetState timeout");
      setIsLoading(false);
      showErrorToast("Failed to connect to lobby. Please refresh.");
    }, 10000);

    const requestState = () => {
      socket.emit("round2:getState");
    };

    socket.emit("round2:join", {}, (res?: SimpleSocketResponse) => {
      if (res && res.success === false && !isAlreadyInRoundError(res)) {
        console.warn("[R2 Lobby] Failed to join lobby:", res);
        showErrorToast(res.error || res.message || "Failed to join lobby");
      }

      requestState();
    });

    requestState();

    return () => {
      clearJoinTimeout();
    };
  }, [
    socket,
    isConnected,
    authenticationChecked,
    socketLoading,
    isCheckingRound,
    router,
    clearJoinTimeout,
  ]);

  // Listen for lobby updates
  useEffect(() => {
    if (!socket || !isConnected) return;

    const handleRound2Redirect = ({
      target,
      reason,
    }: {
      target: string;
      reason?: string;
    }) => {
      console.warn("[R2 LOBBY REDIRECT]", { target, reason });
      clearJoinTimeout();
      showErrorToast(reason || "You were removed from Round 2");

      hasNavigated.current = true;
      localStorage.removeItem("battlecode-round-2-code-store");
      sessionStorage.removeItem("r2_session_type");
      sessionStorage.removeItem("r2_context_id");
      sessionStorage.removeItem("r2_user_role");

      router.replace("/dashboard");
    };

    const goToRole = (role?: string) => {
      if (hasNavigated.current || (role !== "elite" && role !== "challenger")) {
        return false;
      }
      hasNavigated.current = true;
      showInfoToast(`Role assigned: ${role.toUpperCase()}`);
      router.push(`/r2/${role}`);
      return true;
    };

    const roleFrom = (data: any, people: any[] = []) =>
      data?.roundSpecific?.role ||
      data?.currentUser?.role ||
      people.find((p) => p.userId === userId || p.id === userId)?.role;

    const handleStateUpdate = (stateResponse: any) => {
      console.debug("[R2 Lobby] State update:", stateResponse);
      clearJoinTimeout();

      if (stateResponse?.success) {
        const lobbyParticipants = getLobbyParticipants(stateResponse) || [];
        setParticipants(lobbyParticipants);
        setRoundStatus(stateResponse.round?.status || "LOBBY");

        if (stateResponse.round?.status === "IN_PROGRESS") {
          goToRole(roleFrom(stateResponse, lobbyParticipants));
        }

        setIsLoading(false);
      }
    };

    const handleLobbyUpdate = (data: any) => {
      console.debug("[R2 Lobby] Lobby update received:", data);
      const lobbyParticipants = getLobbyParticipants(data);
      if (lobbyParticipants) {
        setParticipants(lobbyParticipants);
        setIsLoading(false);
      } else {
        socket.emit("round2:getState");
      }

      if (
        hasNavigated.current ||
        (data.round?.status ?? data.status) !== "IN_PROGRESS"
      ) {
        return;
      }

      if (
        goToRole(
          roleFrom(data, lobbyParticipants || data.participants?.all || []),
        )
      ) {
        return;
      }

      if (!requestedStateOnProgress.current) {
        requestedStateOnProgress.current = true;
        socket.emit("round2:getState");
      }
    };

    const handleRolesAssigned = (data: { role?: string }) => {
      goToRole(data?.role);
    };

    socket.on("round2:lobby", handleLobbyUpdate);
    socket.on("round2:state", handleStateUpdate);
    socket.on("round2:redirect", handleRound2Redirect);
    socket.on("round2:rolesAssigned", handleRolesAssigned);

    return () => {
      socket.off("round2:lobby", handleLobbyUpdate);
      socket.off("round2:state", handleStateUpdate);
      socket.off("round2:redirect", handleRound2Redirect);
      socket.off("round2:rolesAssigned", handleRolesAssigned);
    };
  }, [socket, isConnected, router, userId, clearJoinTimeout]);

  // Early return for loading states
  if (
    authLoading ||
    !authenticationChecked ||
    isCheckingRound ||
    socketLoading ||
    isLoading
  ) {
    const loadingMessage = authLoading
      ? "Loading Authentication..."
      : socketLoading
        ? "Connecting to server..."
        : "Checking Round Status...";

    return <LoadingOverlay isLoading={true} message={loadingMessage} />;
  }

  // JSX Return
  return (
    <div className="flex flex-col bg-[url('/r0_lobby_bg.svg')] bg-center bg-cover h-screen">
      <div
        className="flex-shrink-0 orbitron items-center flex flex-col text-7xl"
        style={{ textShadow: "0 0 10px rgba(8, 145, 178, 1)" }}
      >
        <p className="flex-1 flex items-end pt-8">
          {" "}
          <span className="text-white">ROUND</span>{" "}
          <span className="text-orange-500">&nbsp; 2</span>
        </p>
        <span className="text-orange-500 text-2xl pb-4">LOBBY</span>
      </div>

      <div className="flex-shrink-0 text-2xl orbitron ml-40 pb-4 text-white">
        Participants: {participants.length}
      </div>

      <div className="flex-1 p-6 min-h-0">
        <CustomScrollbar className="h-full overflow-y-auto">
          <div className="grid grid-cols-3 gap-12 max-w-6xl mx-auto pb-6">
            {participants.length > 0 ? (
              participants.map((participant: any, index) => {
                const displayName =
                  participant.username ||
                  participant.id ||
                  participant.userId ||
                  `Player ${index + 1}`;
                const participantKey =
                  participant.id ||
                  participant.userId ||
                  `participant-${index}`;
                return (
                  <PlayerCard
                    key={participantKey}
                    username={displayName}
                    avatar={`https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=0e7490&color=fff`}
                  />
                );
              })
            ) : (
              <div className="col-span-3 flex items-center justify-center text-gray-400 text-base py-12">
                No participants yet. Waiting for players to join...
              </div>
            )}
          </div>
        </CustomScrollbar>
      </div>

      {/* --- BOTTOM STATUS AND CONTROLS SECTION --- */}
      {roundStatus === "LOBBY" && (
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

          {/* {isAdmin && participants.length > 0 && (
            <button
              onClick={handleStartRound}
              className="px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-600 text-white font-bold rounded-lg shadow-lg hover:scale-105 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-amber-400 text-sm flex items-center gap-2"
              disabled={participants.length < 2}
            >
              <Rocket className="h-4 w-4" />
              Start Round 2
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
