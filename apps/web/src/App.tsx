import { DemoPanel } from "./ui/components/DemoPanel";
import { ServicesProvider } from "./ui/services/ServicesProvider";

/**
 * App root.
 *
 * Wraps the tree in the `ServicesProvider` (context injection of apiClient /
 * llmParser) and composes the (dumb) demo panel, passing the project identity
 * down from the scaffold context. No business logic here — that lives in
 * `src/core`.
 */
export default function App() {
  return (
    <ServicesProvider>
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="w-full">
          <DemoPanel
            projectName="timeline"
            owner="AntonLapshin"
            repo="timeline"
            description="A personal, local-first global schedule that remembers everything: capture one-time and recurrent future events in under 30 seconds, view them on a timeline + calendar at home, and get configurable Telegram reminders from anywhere."
          />
        </div>
      </main>
    </ServicesProvider>
  );
}
