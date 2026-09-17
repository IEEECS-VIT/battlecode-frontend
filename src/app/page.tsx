"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Hero from "@/components/shared/Hero";
import { useSocket } from "@/contexts/SocketContext";
import {
  showSuccessToast,
  showErrorToast,
} from "@/components/shared/CustomToast";

export default function Landing() {
  const router = useRouter();
  const { socket, isConnected } = useSocket();

  useEffect(() => {
    if (!socket || !isConnected) return;

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

    socket.on("round1:adminAdded", handleAdminAdded);

    return () => {
      socket.off("round1:adminAdded", handleAdminAdded);
    };
  }, [socket, isConnected, router]);

  return (
    <div className="select-none">
      <Hero />
    </div>
  );
}
