"use client";
import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useSocket } from "@/contexts/SocketContext";
import {
  showSuccessToast,
  showErrorToast,
  showInfoToast,
} from "@/components/shared/CustomToast";
import CustomScrollbar from "@/components/shared/CustomScrollbar";
import ChallengerPlayerCard from "@/components/shared/ChallengerPlayerCard";
import BountyQuestionCard, {
  BountyQuestion,
} from "@/components/shared/BountyQuestionCard";
import LoadingOverlay from "@/components/shared/LoadingOverlay";

// --- Interfaces ---
interface Participant {
  id: string;
  username: string;
  status: string;
  role?: "elite" | "challenger";
}

interface SimpleSocketResponse {
  success: boolean;
  message?: string;
}

interface ServerBountyQuestion extends Omit<BountyQuestion, "name"> {
  title: string;
  isSolvedByAnyone?: boolean;
  isAttemptedByUser?: boolean;
}

const formatTime = (ms: number) => {
  if (ms <= 0) return "00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
};

export default function ChallengerDashboard() {
  const router = useRouter();
  const { socket, isConnected } = useSocket();
  const retriedStateRef = useRef(false);
  const [availableElites, setAvailableElites] = useState<Participant[]>([]);
  const [bountyQuestions, setBountyQuestions] = useState<BountyQuestion[]>([]);
  const [pendingRequests, setPendingRequests] = useState<Set<string>>(
    new Set(),
  );
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [roundEndTime, setRoundEndTime] = useState<number | null>(null);
  const [cooldownEndTime, setCooldownEndTime] = useState<number | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [userRole, setUserRole] = useState<"elite" | "challenger" | null>(null);
  const [hasActiveSession, setHasActiveSession] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem("r2_cooldown_end");
    if (!stored) return;
    const end = Number(stored);
    sessionStorage.removeItem("r2_cooldown_end");
    if (Number.isFinite(end) && end > Date.now()) setCooldownEndTime(end);
  }, []);

  // Fetch initial state and dashboard data using state-based approach
  useEffect(() => {
    if (!socket || !isConnected) return;

    console.debug("[Challenger] Fetching round2 state...");

    // Set a timeout to prevent infinite loading
    const stateTimeout = setTimeout(() => {
      console.error("[Challenger] GetState/Dashboard timeout");
      setIsLoading(false);
      showErrorToast("Failed to load dashboard. Please refresh.");
    }, 10000); // 10 second timeout

    // Listen for state updates from server
    const handleStateUpdate = (stateResponse: any) => {
      console.debug("[Challenger] State response:", stateResponse);

      if (!stateResponse.success) {
        clearTimeout(stateTimeout);
        showErrorToast(stateResponse.error || "Failed to load state");
        setIsLoading(false);
        return;
      }

      const role = stateResponse.roundSpecific?.role;
      const session = stateResponse.session;
      const bountyQuestions =
        stateResponse.roundSpecific?.bountyQuestions || [];

      setUserRole(role);
      setHasActiveSession(!!session);

      // If user has active session, redirect to code page
      if (session) {
        clearTimeout(stateTimeout);
        setIsLoading(false);
        showInfoToast("Resuming your active session...");
        setTimeout(() => {
          router.push("/r2/code");
        }, 1000);
        return;
      }

      // If user is not a challenger, redirect
      if (role !== "challenger") {
        const expectedRole = sessionStorage.getItem("r2_user_role");
        if (expectedRole === "challenger" && !retriedStateRef.current) {
          retriedStateRef.current = true;
          setTimeout(() => socket.emit("round2:getState"), 1500);
          return;
        }
        clearTimeout(stateTimeout);
        setIsLoading(false);
        showErrorToast("Access denied. Redirecting...");
        setTimeout(() => {
          router.push(role ? `/r2/${role}` : "/dashboard");
        }, 1000);
        return;
      }

      // User is a challenger with no active session - set dashboard data from state
      setRoundEndTime(stateResponse.round?.endTime || null);
      if (stateResponse.currentUser?.cooldownEndTime) {
        setCooldownEndTime(stateResponse.currentUser.cooldownEndTime);
      }
      const transformedBounties = bountyQuestions.map((q: any) => ({
        ...q,
        name: q.title,
      }));
      setBountyQuestions(transformedBounties);

      const allParticipants = stateResponse.participants?.all || [];
      setAvailableElites(
        allParticipants.filter(
          (p: Participant) => p.role === "elite" && p.status === "elite:idle",
        ),
      );

      clearTimeout(stateTimeout);
      setIsLoading(false);
    };

    // Register listener
    socket.on("round2:state", handleStateUpdate);

    // Request state from server
    socket.emit("round2:getState");

    return () => {
      socket.off("round2:state", handleStateUpdate);
      clearTimeout(stateTimeout);
    };
  }, [socket, isConnected, router]);

  // --- MODIFIED: Timer now triggers redirection ---
  useEffect(() => {
    if (!roundEndTime || isRedirecting) return;
    const interval = setInterval(() => {
      const remaining = roundEndTime - Date.now();
      setTimeRemaining(Math.max(0, remaining));
      if (remaining <= 0) {
        clearInterval(interval);
        // --- FIX: Redirect when timer hits zero ---
        if (!isRedirecting) {
          setIsRedirecting(true);
          showInfoToast(
            "Round 2 has ended. You will be redirected to the dashboard.",
          );
          setTimeout(() => {
            router.push("/dashboard");
          }, 3000);
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [roundEndTime, router, isRedirecting]);

  useEffect(() => {
    if (!cooldownEndTime) {
      setCooldownRemaining(0);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, cooldownEndTime - Date.now());
      setCooldownRemaining(remaining);
      if (remaining <= 0) setCooldownEndTime(null);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [cooldownEndTime]);

  useEffect(() => {
    if (!socket) return;

    const handleRound2Redirect = ({
      target,
      reason,
    }: {
      target: string;
      reason?: string;
    }) => {
      console.log("[ROUND2 REDIRECT]", { target, reason });

      if (isRedirecting) return;

      setIsRedirecting(true);

      if (target === "lobby") {
        showInfoToast(reason || "You have been removed from Round 2");
        router.replace("/dashboard");
      }
    };

    const handleLobbyUpdate = (data: { participants: Participant[] }) => {
      setAvailableElites(
        data.participants.filter(
          (p) => p.role === "elite" && p.status === "elite:idle",
        ),
      );
    };

    const handleRequestFailed = (data: {
      eliteId: string;
      reason?: string;
    }) => {
      showInfoToast(data.reason || `Your challenge was rejected.`);
      setPendingRequests((prev) => {
        const newSet = new Set(prev);
        newSet.delete(data.eliteId);
        return newSet;
      });
    };

    const handleMatchStarted = (data: { matchId: string }) => {
      showSuccessToast("Match starting! Redirecting...");
      try {
        sessionStorage.setItem("r2_session_type", "match");
        sessionStorage.setItem("r2_context_id", data.matchId);
        sessionStorage.setItem("r2_user_role", "challenger");
        router.push(`/r2/code`);
      } catch (error) {
        console.error("Session storage is unavailable.", error);
        showErrorToast(
          "Could not save session. Please enable cookies/storage.",
        );
      }
    };

    const handleDashboardUpdate = (data: { pendingRequests?: string[] }) => {
      if (data.pendingRequests) {
        setPendingRequests(new Set(data.pendingRequests));
      }
    };

    const handleCooldown = (data: {
      duration?: number;
      cooldownEndTime?: number;
    }) => {
      const deadline =
        typeof data.cooldownEndTime === "number"
          ? data.cooldownEndTime
          : typeof data.duration === "number"
            ? Date.now() + data.duration
            : null;
      if (deadline != null) setCooldownEndTime(deadline);
    };

    const handleRoundEnd = () => {
      // --- FIX: Use safeguard to prevent double redirection ---
      if (isRedirecting) return;
      setIsRedirecting(true);
      showInfoToast(
        "Round 2 has ended. You will be redirected to the dashboard.",
      );
      setTimeout(() => {
        router.push("/dashboard");
      }, 3000);
    };

    socket.on("round2:redirect", handleRound2Redirect);
    socket.on("round2:lobbyUpdate", handleLobbyUpdate);
    socket.on("round2:challengeRejected", handleRequestFailed);
    socket.on("round2:challengeExpired", handleRequestFailed);
    socket.on("round2:matchStarted", handleMatchStarted);
    socket.on("round2:dashboardUpdate", handleDashboardUpdate);
    socket.on("round2:ended", handleRoundEnd);
    socket.on("round2:cooldown", handleCooldown);

    return () => {
      socket.off("round2:lobbyUpdate", handleLobbyUpdate);
      socket.off("round2:challengeRejected", handleRequestFailed);
      socket.off("round2:challengeExpired", handleRequestFailed);
      socket.off("round2:matchStarted", handleMatchStarted);
      socket.off("round2:dashboardUpdate", handleDashboardUpdate);
      socket.off("round2:ended", handleRoundEnd);
      socket.off("round2:redirect", handleRound2Redirect);
      socket.off("round2:cooldown", handleCooldown);
    };
  }, [socket, router, isRedirecting]);

  const handleStartBounty = (questionId: string) => {
    if (!socket) return;
    if (cooldownRemaining > 0) {
      showInfoToast(`Cooldown: ${formatTime(cooldownRemaining)}`);
      return;
    }

    socket.emit(
      "round2:bountyBeginQuestion",
      { questionId },
      (response: SimpleSocketResponse) => {
        if (response.success) {
          showSuccessToast("Starting bounty... good luck!");
          try {
            sessionStorage.setItem("r2_session_type", "bounty");
            sessionStorage.setItem("r2_context_id", questionId);
            sessionStorage.setItem("r2_user_role", "challenger");
            router.push(`/r2/code`);
          } catch (error) {
            console.error("Session storage is unavailable.", error);
            showErrorToast(
              "Could not save session. Please enable cookies/storage.",
            );
          }
        } else {
          showErrorToast(response.message || "Could not start bounty.");
        }
      },
    );
  };

  const handleChallengeElite = (eliteId: string) => {
    if (!socket) return;
    if (cooldownRemaining > 0) {
      showInfoToast(`Cooldown: ${formatTime(cooldownRemaining)}`);
      return;
    }
    setPendingRequests((prev) => new Set(prev).add(eliteId));
    socket.emit(
      "round2:challengeRequest",
      { eliteId },
      (response: SimpleSocketResponse) => {
        if (response.success) {
          showSuccessToast("Challenge request sent!");
        } else {
          showErrorToast(response.message || "Failed to send challenge.");
          setPendingRequests((prev) => {
            const newSet = new Set(prev);
            newSet.delete(eliteId);
            return newSet;
          });
          if (response.message?.includes("active session")) {
            router.refresh();
          }
        }
      },
    );
  };

  if (isLoading) {
    return (
      <LoadingOverlay
        isLoading={true}
        message="Loading Challenger Dashboard..."
      />
    );
  }

  return (
    <div className="flex bg-[url('/bg_elite.jpg')] bg-center bg-no-repeat h-screen w-full flex-col overflow-hidden orbitron">
      <div className="flex-1 flex items-center justify-center text-6xl orbitron white-glow relative">
        <Image
          src="/b-2.svg"
          alt="Battlecode Logo"
          className="h-20"
          width={80}
          height={80}
        />
        CHALLENGER
        <div className="absolute top-4 right-4 bg-black/50 text-white text-2xl p-2 px-4 rounded-lg font-mono text-right">
          <div>{formatTime(timeRemaining)}</div>
          {cooldownRemaining > 0 && (
            <div className="text-sm text-red-400 mt-1">
              Cooldown: {formatTime(cooldownRemaining)}
            </div>
          )}
        </div>
      </div>
      <div className="flex-4 flex flex-row">
        <div className="flex-1">
          <div className="h-[80%] w-[80%] glass-box rounded-lg m-auto mt-10 p-5">
            <h2 className="text-2xl font-bold text-white mb-4 ml-4 orbitron">
              Challenge Elites
            </h2>
            <CustomScrollbar className="h-[calc(100%-3rem)] overflow-y-auto overflow-x-hidden pr-2">
              {availableElites.length > 0 ? (
                availableElites.map((player) => (
                  <ChallengerPlayerCard
                    key={player.id}
                    username={player.username}
                    onChallenge={() => handleChallengeElite(player.id)}
                    isPending={pendingRequests.has(player.id)}
                  />
                ))
              ) : (
                <div className="text-center text-gray-400 mt-8">
                  <p className="text-lg">No elites are available</p>
                  <p className="text-sm">
                    All elites are currently in a match. Check back soon!
                  </p>
                </div>
              )}
            </CustomScrollbar>
          </div>
        </div>
        <div className="flex-1">
          <div className="h-[80%] w-[80%] glass-box rounded-lg m-auto mt-10 p-5">
            <h2 className="text-2xl font-bold text-white mb-4 orbitron">
              Bounty Questions
            </h2>
            <CustomScrollbar className="h-[calc(100%-3rem)] overflow-y-auto pr-2">
              <div className="grid grid-cols-4 gap-2">
                {bountyQuestions.map((question, index) => (
                  <BountyQuestionCard
                    key={question.id}
                    question={question}
                    onSolve={() => handleStartBounty(question.id)}
                    questionIndex={index}
                  />
                ))}
              </div>
            </CustomScrollbar>
          </div>
        </div>
      </div>
    </div>
  );
}
