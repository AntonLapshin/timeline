import { useProjectInfo } from "../viewModels/useProjectInfo";
import type { ProjectStatus } from "../../core/projectInfo";
import { SectionHeading } from "../molecules/SectionHeading";
import { Chip } from "../atoms/Chip";

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
      <SectionHeading
        eyebrow="Project"
        title={info.name}
        description={info.description}
      />

      <dl className="mt-5 space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-slate-500 dark:text-slate-400">Status</dt>
          <dd>
            <Chip tone="green">{info.statusText}</Chip>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-slate-500 dark:text-slate-400">Repo</dt>
          <dd className="font-mono text-slate-700 dark:text-slate-300">
            {info.owner}/{info.repo}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
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
              <span className="text-slate-500 dark:text-slate-400">
                Not deployed yet
              </span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
