export class TopBotReleaseGateError extends Error {}
export function verifyWindowsReleaseGate(read: (path: string) => Promise<unknown>, sha: string, expectedPR?: number): Promise<{
  pullRequest: number; head: string; base: string; sha: string; tree: string; ciRun: number; ciAttempt: number; approval: number;
}>;
