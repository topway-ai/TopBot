import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";

const command = /^\/topbot-iterate(?:\s|$)/;
const version = /^\d+\.\d+\.\d+-topbot\.\d+$/;
const produced = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), version: z.string().regex(version), sha: z.string().regex(/^[a-f0-9]{40}$/), pr: z.number().int().positive() }),
  z.object({ ok: z.literal(false), message: z.string().max(300) }),
]);
type Result = z.infer<typeof produced>;

export function topBotIterationTask(text: string): { task: string } | null {
  return command.test(text) ? { task: text.slice("/topbot-iterate".length).trim() } : null;
}

async function runIteration(task: string): Promise<Result> {
  const home = join(homedir(), ".topbot-development");
  const text = await readFile(join(home, "config.json"), "utf8").catch(() => "{}");
  const { automatic } = z.object({ automatic: z.object({ enabled: z.boolean(), nodeExecutable: z.string().refine(isAbsolute) }).optional() })
    .parse(JSON.parse(text));
  if (!automatic?.enabled || !process.env.OMB_RESOURCES_PATH) {
    return { ok: false, message: "自动迭代尚未在此安装启用；未改动代码或发布。" };
  }
  const script = join(process.env.OMB_RESOURCES_PATH, "server", "topbot-iteration.mjs");
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^NODE_(?:OPTIONS|PATH)$/i.test(name)));
  return new Promise(resolve => {
    const child = execFile(automatic.nodeExecutable, ["--max-old-space-size=384", script], { cwd: home, env, windowsHide: true,
      maxBuffer: 1_048_576, timeout: 250 * 60_000 }, (_error, stdout) => {
      try { resolve(produced.parse(JSON.parse(stdout.trim()))); }
      catch { resolve({ ok: false, message: "自动迭代进程异常终止。请核对开发工作区和 GitHub 状态；不会自动重试发布。" }); }
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(JSON.stringify({ task }));
  });
}

export function createTopBotIteration({ run = runIteration, available = () => true }: {
  run?: (task: string) => Promise<Result>;
  available?: () => boolean;
} = {}) {
  let busy = false;
  return (task: string, report: (message: string) => void) => {
    if (!task || task.length > 4000 || /[^\P{Cc}\t\n\r]/u.test(task)) return "用法：`/topbot-iterate 需求`，需求最多 4000 字符。";
    if (busy || !available()) return "TopBot 有任务正在运行，请等当前任务结束。";
    busy = true;
    void Promise.resolve().then(() => run(task)).then(
      (result) => report(result.ok
        ? `TopBot ${result.version} 已发布：[PR #${result.pr}](https://github.com/topway-ai/TopBot/pull/${result.pr})。空闲时由更新器安装，启动失败会回滚。`
        : result.message),
      () => report("自动迭代未完成，不会自动重试。请核对 GitHub 状态。"),
    ).finally(() => { busy = false; }).catch(() => {});
    return "开始自动迭代。修改、审核、测试和发布不需要再次确认；未通过检查会停止。";
  };
}
