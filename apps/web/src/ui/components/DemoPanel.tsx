import { useProjectInfo } from "../viewModels/useProjectInfo";
import type { ProjectStatus } from "../../core/projectInfo";

export interface DemoPanelProps {
  projectName: string;
  owner: string;
  repo: string;
  status?: ProjectStatus;
  description?: string;
}

/**
 * Initial demo panel (plan.md §26.3).
 *
 * Renders the project name, lifecycle status, and demo info. It is a dumb view:
 * it delegates all derivation to the `useProjectInfo` view model, which in turn
 * delegates to the pure `src/core` module. No business logic lives here.
 */
export function DemoPanel({
  projectName,
  owner,
  repo,
  status = "scaffolded",
  description,
}: DemoPanelProps) {
  const info = useProjectInfo(projectName, owner, repo, status, description);

  return (
    <section className="card mx-auto max-w-md p-6">
      <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{info.name}</h2>
      {info.description && (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{info.description}</p>
      )}

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-slate-500 dark:text-slate-400">Status</dt>
          <dd>
            <span className="chip border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300">
              {info.statusText}
            </span>
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-500 dark:text-slate-400">Repo</dt>
          <dd className="font-mono text-slate-700 dark:text-slate-300">
            {info.owner}/{info.repo}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-500 dark:text-slate-400">Demo</dt>
          <dd>
            {info.demoReady ? (
              <a
                href={info.demoUrl}
                className="text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-800 dark:text-indigo-400 dark:decoration-indigo-500/40 dark:hover:text-indigo-300"
              >
                {info.demoUrl}
              </a>
            ) : (
              <span className="text-slate-500 dark:text-slate-400">Not deployed yet</span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
