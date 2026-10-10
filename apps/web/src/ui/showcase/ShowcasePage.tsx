import { useEffect, useState } from "react";
import {
  Bars3Icon,
  LinkIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { SearchField } from "../molecules/SearchField";
import { ThemeToggle } from "../molecules/ThemeToggle";
import { ThemeProvider } from "../theme/ThemeProvider";
import {
  GROUP_ORDER,
  STORY_FILES,
  type StoryFile,
  type StoryGroup,
} from "./registry";
import {
  readSelection,
  selectionUrl,
  storySlug,
  type ShowcaseSelection,
} from "./showcaseUrl";

/**
 * The dev-only component Showcase gallery (issue #56) — a Storybook-style
 * playground.
 *
 * Sidebar lists every component (grouped Atoms / Molecules / Organisms /
 * Guidelines, filterable); the canvas renders the selected component's
 * stories in isolation. Selection deep-links via
 * `?showcase&file=Button&story=Variants` (shareable, back/forward aware,
 * reflected in the document title). The gallery injects its own fake
 * services via the registry, so it runs with no backend.
 */

/** Inline SVG grid mark for the sidebar brand row. */
function GalleryMark() {
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-600 shadow-md shadow-brand-600/25"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4 text-white" fill="none">
        <rect x="1.5" y="1.5" width="5" height="5" rx="1.5" fill="currentColor" />
        <rect x="9.5" y="1.5" width="5" height="5" rx="1.5" fill="currentColor" opacity="0.65" />
        <rect x="1.5" y="9.5" width="5" height="5" rx="1.5" fill="currentColor" opacity="0.65" />
        <rect x="9.5" y="9.5" width="5" height="5" rx="1.5" fill="currentColor" />
      </svg>
    </span>
  );
}

/** The sidebar: filter + grouped component list. */
function Sidebar({
  files,
  activeFile,
  query,
  onQueryChange,
  onSelect,
  open,
  onClose,
}: {
  files: StoryFile[];
  activeFile: string | null;
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (file: string) => void;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {open && (
        <div
          aria-hidden
          onClick={onClose}
          className="animate-fade fixed inset-0 z-40 bg-ink-950/50 lg:hidden"
        />
      )}
      <aside
        aria-label="Components"
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-slate-200/70 bg-white/95 backdrop-blur transition-transform duration-200 dark:border-slate-800/70 dark:bg-ink-950/95 lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2.5 border-b border-slate-200/70 px-4 py-3 dark:border-slate-800/70">
          <GalleryMark />
          <span className="font-display text-sm font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
            Showcase
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="btn-square ml-auto lg:hidden"
          >
            <XMarkIcon aria-hidden className="h-5 w-5" />
          </button>
        </div>
        <div className="px-3 pt-3">
          <SearchField
            label="Filter components"
            placeholder="Filter…"
            value={query}
            onChange={onQueryChange}
          />
        </div>
        <nav aria-label="Storybook files" className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          {GROUP_ORDER.map((group: StoryGroup) => {
            const groupFiles = files.filter((f) => f.group === group);
            if (groupFiles.length === 0) return null;
            return (
              <div key={group} className="mb-4">
                <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  {group}
                </div>
                <ul className="space-y-0.5">
                  {groupFiles.map((f) => {
                    const active = activeFile === f.name;
                    return (
                      <li key={f.name}>
                        <button
                          type="button"
                          onClick={() => onSelect(f.name)}
                          aria-current={active ? "page" : undefined}
                          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
                            active
                              ? "bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                              : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">{f.name}</span>
                          <span
                            aria-hidden
                            className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-slate-500 dark:bg-white/5 dark:text-slate-400"
                          >
                            {f.stories.length}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {files.length === 0 && (
            <p className="px-2 py-4 text-sm text-slate-500 dark:text-slate-400">
              No components match.
            </p>
          )}
        </nav>
        <div className="border-t border-slate-200/70 px-4 py-3 dark:border-slate-800/70">
          <a
            href="./"
            className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            ← Back to app
          </a>
        </div>
      </aside>
    </>
  );
}

/** The top bar: mobile menu, current location, theme toggle. */
function Topbar({
  onMenu,
  title,
}: {
  onMenu: () => void;
  title: string;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200/70 bg-white/80 px-3 backdrop-blur dark:border-slate-800/70 dark:bg-ink-950/80 sm:px-4">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open navigation"
        className="btn-square lg:hidden"
      >
        <Bars3Icon aria-hidden className="h-5 w-5" />
      </button>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700 dark:text-slate-200">
        {title}
      </span>
      <ThemeToggle />
    </header>
  );
}

/** The isolated canvas for one component: its stories, each in a card. */
function FileCanvas({
  file,
  onStoryLink,
}: {
  file: StoryFile;
  /** Deep-links a story (updates the URL). */
  onStoryLink: (story: string) => void;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <p className="text-[11px] font-bold uppercase tracking-widest text-brand-600 dark:text-brand-400">
        {file.group}
      </p>
      <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
        {file.name}
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
        {file.description}
      </p>
      <div className="mt-6 space-y-5">
        {file.stories.map((story) => (
          <section
            key={story.name}
            id={storySlug(story.name)}
            aria-label={story.name}
            className="card scroll-mt-20 p-4 sm:p-5"
          >
            <div className="flex items-center gap-1.5">
              <h2 className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
                {story.name}
              </h2>
              <button
                type="button"
                onClick={() => onStoryLink(story.name)}
                aria-label={`Copy deep link to the ${story.name} story`}
                title="Deep link to this story"
                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 opacity-40 transition-opacity hover:bg-slate-100 hover:opacity-100 hover:text-slate-600 focus-visible:opacity-100 dark:text-slate-500 dark:hover:bg-white/5 dark:hover:text-slate-300"
              >
                <LinkIcon aria-hidden className="h-4 w-4" />
              </button>
            </div>
            {story.description && (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {story.description}
              </p>
            )}
            <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700/60 dark:bg-white/[0.02]">
              {story.render()}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** The gallery home: grouped cards linking to each component. */
function Home({
  files,
  onSelect,
}: {
  files: StoryFile[];
  onSelect: (file: string) => void;
}) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
      <h1 className="font-display text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
        Component Showcase
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
        A Storybook-style playground: pick a component on the left to inspect
        it in isolation — every variant is live. Selections deep-link, so you
        can share a URL to any component or story.
      </p>
      {GROUP_ORDER.map((group: StoryGroup) => {
        const groupFiles = files.filter((f) => f.group === group);
        if (groupFiles.length === 0) return null;
        return (
          <section key={group} aria-label={group} className="mt-8">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
              {group}
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {groupFiles.map((f) => (
                <button
                  key={f.name}
                  type="button"
                  onClick={() => onSelect(f.name)}
                  className="card-interactive block w-full p-4 text-left"
                >
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {f.name}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    {f.description}
                  </p>
                  <p className="mt-2 text-[11px] font-bold text-brand-600 dark:text-brand-400">
                    {f.stories.length}{" "}
                    {f.stories.length === 1 ? "story" : "stories"} →
                  </p>
                </button>
              ))}
            </div>
          </section>
        );
      })}
      {files.length === 0 && (
        <p className="mt-8 text-sm text-slate-500 dark:text-slate-400">
          No components match the filter.
        </p>
      )}
    </div>
  );
}

/**
 * The Showcase page shell.
 *
 * Sidebar + canvas layout with URL-synced selection (`?showcase&file=X&story=Y`),
 * back/forward support, a filterable component list, and a gallery-wide theme
 * toggle. Renders the home grid when no file is selected.
 */
export function ShowcasePage() {
  const [selection, setSelection] = useState<ShowcaseSelection>(readSelection);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Keep the selection in sync with browser back/forward.
  useEffect(() => {
    const onPopState = () => setSelection(readSelection());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const select = (file: string | null, story: string | null = null) => {
    window.history.pushState(null, "", selectionUrl(file, story));
    setSelection({ file, story });
    setSidebarOpen(false);
  };

  // Scroll the canvas: deep-linked story into view, otherwise back to top.
  // (Guarded — jsdom doesn't implement element scrolling.)
  useEffect(() => {
    const main = document.getElementById("showcase-main");
    const { file, story } = selection;
    if (file && story) {
      // Wait a tick so the canvas has rendered.
      const t = window.setTimeout(() => {
        const el = document.getElementById(storySlug(story));
        if (el && typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ block: "start" });
        }
      }, 0);
      return () => window.clearTimeout(t);
    }
    if (main && typeof main.scrollTo === "function") {
      main.scrollTo({ top: 0 });
    }
    return undefined;
  }, [selection]);

  useEffect(() => {
    const active = STORY_FILES.find((f) => f.name === selection.file);
    document.title = active
      ? `${active.name} · Component Showcase`
      : "Component Showcase";
  }, [selection.file]);

  const activeFile =
    STORY_FILES.find((f) => f.name === selection.file) ?? null;
  const q = query.trim().toLowerCase();
  const visibleFiles = STORY_FILES.filter(
    (f) =>
      !q ||
      f.name.toLowerCase().includes(q) ||
      f.stories.some((s) => s.name.toLowerCase().includes(q)),
  );

  return (
    <ThemeProvider>
      <a href="#showcase-main" className="skip-link">
        Skip to components
      </a>
      <div className="bg-scene flex h-dvh overflow-hidden">
        <Sidebar
          files={visibleFiles}
          activeFile={activeFile?.name ?? null}
          query={query}
          onQueryChange={setQuery}
          onSelect={(file) => select(file)}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            onMenu={() => setSidebarOpen(true)}
            title={
              activeFile ? `${activeFile.group} / ${activeFile.name}` : "Gallery"
            }
          />
          <main
            id="showcase-main"
            tabIndex={-1}
            aria-label="Component canvas"
            className="min-h-0 flex-1 overflow-y-auto"
          >
            {activeFile ? (
              <FileCanvas
                file={activeFile}
                onStoryLink={(story) => select(activeFile.name, story)}
              />
            ) : (
              <Home files={visibleFiles} onSelect={(file) => select(file)} />
            )}
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}
