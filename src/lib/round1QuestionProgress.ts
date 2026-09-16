export const R1_QUESTION_PROGRESS_KEY = "battlecode-round-1-question-progress";

export type R1StoredProblem = {
  id: string;
  title?: string;
  description?: string;
  difficulty?: string;
  duration?: number;
  constraints?: string[];
  boilerplate?: { [key: string]: string };
  sampleTestCases?: unknown[];
  hints?: string[];
};

export type R1QuestionProgress = {
  questionId: string;
  problemIndex?: number;
  problem?: R1StoredProblem;
  updatedAt: number;
};

type ProblemLike = Partial<R1StoredProblem> & { id?: string };

export type R1ProgressSource = {
  question?: ProblemLike | null;
  problem?: ProblemLike | null;
  problems?: ProblemLike[] | null;
  currentProblemIndex?: number;
  problemIndex?: number;
  session?: {
    problem?: ProblemLike | null;
    problems?: ProblemLike[] | null;
    currentProblemIndex?: number;
  } | null;
};

function asProblem(value?: ProblemLike | null): R1StoredProblem | null {
  if (!value?.id) return null;
  return {
    id: value.id,
    title: value.title,
    description: value.description,
    difficulty: value.difficulty,
    duration: value.duration,
    constraints: value.constraints,
    boilerplate: value.boilerplate,
    sampleTestCases: value.sampleTestCases,
    hints: value.hints,
  };
}

function isCompleteProblem(problem?: R1StoredProblem | null): boolean {
  return Boolean(problem?.id && problem.description);
}

export function readR1QuestionProgress(): R1QuestionProgress | null {
  try {
    const raw = localStorage.getItem(R1_QUESTION_PROGRESS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as R1QuestionProgress;
    if (!parsed?.questionId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeR1QuestionProgress(progress: R1QuestionProgress): void {
  try {
    localStorage.setItem(R1_QUESTION_PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // ignore quota / private-mode failures
  }
}

export function clearR1QuestionProgress(): void {
  try {
    localStorage.removeItem(R1_QUESTION_PROGRESS_KEY);
  } catch {
    // ignore
  }
}

export function extractR1Problem(
  source?: R1ProgressSource | null,
): R1StoredProblem | null {
  if (!source) return null;
  return (
    asProblem(source.question) ||
    asProblem(source.problem) ||
    asProblem(source.session?.problem)
  );
}

export function persistR1QuestionProgress(
  source?: R1ProgressSource | null,
): void {
  const incoming = extractR1Problem(source);
  if (!incoming?.id) return;

  const existing = readR1QuestionProgress();
  if (isCompleteProblem(existing?.problem) && !isCompleteProblem(incoming)) {
    return;
  }

  writeR1QuestionProgress({
    questionId: incoming.id,
    problemIndex:
      source?.currentProblemIndex ??
      source?.problemIndex ??
      source?.session?.currentProblemIndex ??
      existing?.problemIndex,
    problem: isCompleteProblem(incoming) ? incoming : existing?.problem,
    updatedAt: Date.now(),
  });
}

export function applyR1QuestionProgress<T extends R1ProgressSource>(
  incoming: T,
): T {
  const stored = readR1QuestionProgress();
  if (!stored?.questionId) return incoming;

  const problems = incoming.problems || incoming.session?.problems || undefined;
  let chosen: ProblemLike | undefined;
  let index = stored.problemIndex;

  if (Array.isArray(problems) && problems.length > 0) {
    const found = problems.findIndex(
      (problem) => problem?.id === stored.questionId,
    );
    if (found >= 0) {
      chosen = problems[found];
      index = found;
    }
  }

  if (!chosen && stored.problem?.id) {
    chosen = stored.problem;
  }

  if (!chosen?.id) return incoming;

  const problem = asProblem(chosen);
  if (!problem) return incoming;

  const next = {
    ...incoming,
    question: { ...(incoming.question || {}), ...problem },
    problem: { ...(incoming.problem || {}), ...problem },
    currentProblemIndex: index,
  };

  if (incoming.session) {
    next.session = {
      ...incoming.session,
      problem: { ...(incoming.session.problem || {}), ...problem },
      currentProblemIndex: index ?? incoming.session.currentProblemIndex,
    };
  }

  return next;
}
