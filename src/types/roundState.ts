/**
 * UNIFIED ROUND STATE SCHEMA
 * Common structure for all round state emissions
 */

interface BaseRoundState {
  success: boolean;
  error?: string;
  timestamp: number;
  roundNumber: number;

  // Round Status
  round: {
    isActive: boolean;
    status: "LOBBY" | "IN_PROGRESS" | "COMPLETED" | "LOCKED";
    startTime: number | null;
    endTime: number | null; // epoch ms
    timeRemaining: number; // ms
    duration: number; // ms
  };

  // Participant Data
  participants: {
    total: number;
    byStatus: {
      lobby: Array<Participant>;
      waiting: Array<Participant>;
      in_match: Array<Participant>;
      in_bounty?: Array<Participant>; // Round 2 specific
      cooldown: Array<Participant>;
      finished: Array<Participant>;
      disconnected: Array<Participant>;
    };
    all: Array<Participant>;
  };

  // Current User
  currentUser: Participant | null;

  // Session Data (when applicable)
  session?: {
    type: "match" | "bounty" | "problem";
    id: string;
    startTime: number; // epoch ms
    endTime: number; // epoch ms
    timeRemaining: number; // ms
    opponent?: {
      id: string;
      username: string;
      rank?: number | string;
    };
    problem?: Problem;
    problems?: Array<Problem>;
    currentProblemIndex?: number;
    totalProblems?: number;
  };

  // Round-specific data
  roundSpecific?: {
    // Round 0
    progress?: UserProgress;

    // Round 1 (durations in ms)
    nextMatchmakingCycle?: number;
    globalTimeRemaining?: number;

    // Round 2
    role?: "elite" | "challenger";
    incomingRequests?: Array<ChallengeRequest>;
    pendingRequests?: Array<string>;
    bountyQuestions?: Array<BountyQuestion>;

    // Round 3
    lockedQuestionIds?: Array<string>;
    questions?: Array<Problem>;
    isHackingPhase?: boolean;
  };

  message?: string;
}

// Round 3 specific state type
interface Round3State extends BaseRoundState {
  roundNumber: 3;
  roundSpecific: {
    lockedQuestionIds: Array<string>;
    questions: Array<Problem>;
    isHackingPhase: boolean;
  };
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
  opponentUsername?: string; // Included by backend for matched users
}

interface Problem {
  id: string;
  title: string;
  difficulty: string;
  description?: string;
  // ... other problem fields
}

interface UserProgress {
  problemsSolved: number;
  currentProblem: number;
  score: number;
  lastActivity: string;
}

interface ChallengeRequest {
  userId: string;
  username: string;
  rank: number;
  expiresAt: number;
}

interface BountyQuestion extends Problem {
  isSolved: boolean;
  isSolvedByAnyone: boolean;
  isAttemptedByUser: boolean;
}

export type {
  BaseRoundState,
  Round3State,
  Participant,
  Problem,
  UserProgress,
  ChallengeRequest,
  BountyQuestion,
};
