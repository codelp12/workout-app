import { useEffect, type ReactNode } from "react";
import {
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router";
import { ExerciseDetail } from "./screens/ExerciseDetail";
import { Library } from "./screens/Library";
import { Log } from "./screens/Log";
import { Onboarding } from "./screens/Onboarding";
import { Session } from "./screens/Session";
import { Settings } from "./screens/Settings";
import { TemplateEditor } from "./screens/TemplateEditor";
import { Today } from "./screens/Today";
import { Week } from "./screens/Week";
import { rememberScreen } from "./settings/problem-report";
import { useAppUpdate } from "./update/update-context";

type Tab = { path: string; label: string; icon: ReactNode; screen: ReactNode };

// 24×24 outline icons, drawn with the tab's text color.
const tabs: Tab[] = [
  {
    path: "/",
    label: "Today",
    screen: <Today />,
    icon: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
  },
  {
    path: "/week",
    label: "Week",
    screen: <Week />,
    icon: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </>
    ),
  },
  {
    path: "/log",
    label: "Log",
    screen: <Log />,
    icon: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18M3 14h18M9 4v16" />
      </>
    ),
  },
  {
    path: "/library",
    label: "Library",
    screen: <Library />,
    icon: (
      <path d="M4 19.5V5a2 2 0 0 1 2-2h14v15H6.5A2.5 2.5 0 0 0 4 20.5 2.5 2.5 0 0 0 6.5 23H20v-5" />
    ),
  },
  {
    path: "/settings",
    label: "Settings",
    screen: <Settings />,
    icon: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <circle cx="9" cy="6" r="2" fill="currentColor" />
        <circle cx="15" cy="12" r="2" fill="currentColor" />
        <circle cx="7" cy="18" r="2" fill="currentColor" />
      </>
    ),
  },
];

function TabBar() {
  const updateAvailable = useAppUpdate().status === "available";
  return (
    <nav
      aria-label="Tabs"
      // viewport-fit=cover (index.html) makes the safe-area insets non-zero on
      // iPhone, so the tabs clear the home indicator and the rounded corners.
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pr-[env(safe-area-inset-right)] pb-[max(0.75rem,calc(env(safe-area-inset-bottom)+0.25rem))] pl-[env(safe-area-inset-left)]"
    >
      <ul className="mx-auto grid max-w-md grid-cols-5 px-2">
        {tabs.map((tab) => (
          <li key={tab.path}>
            <NavLink
              to={tab.path}
              // Library and Settings stay highlighted on their detail pages.
              end={tab.path === "/"}
              className={({ isActive }) =>
                `flex min-h-tab-bar flex-col items-center justify-center gap-1 pt-2 text-sm font-medium ${
                  isActive ? "text-accent" : "text-fg-muted"
                }`
              }
            >
              <span className="relative">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="size-7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {tab.icon}
                </svg>
                {tab.path === "/settings" && updateAvailable && (
                  <span
                    aria-hidden="true"
                    className="absolute -top-0.5 -right-1 size-2.5 rounded-full bg-warning"
                  />
                )}
              </span>
              {tab.label}
              {tab.path === "/settings" && updateAvailable && (
                <span className="sr-only">, update available</span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function TabLayout({ header }: { header: ReactNode }) {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    rememberScreen(pathname);
  }, [pathname]);
  return (
    <>
      <main className="mx-auto flex max-w-md flex-col gap-4 p-4 pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(var(--spacing-tab-bar)+env(safe-area-inset-bottom)+2rem)] pl-[max(1rem,env(safe-area-inset-left))]">
        {header}
        <Outlet />
      </main>
      <TabBar />
    </>
  );
}

/**
 * The page for the current URL: `header` (shown on every tab), the tab's
 * screen and the bottom tabs (SPEC §6).
 */
export function Navigation({ header }: { header?: ReactNode }) {
  return (
    <Routes>
      <Route element={<TabLayout header={header} />}>
        {tabs.map((tab) => (
          <Route key={tab.path} path={tab.path} element={tab.screen} />
        ))}
        <Route path="/library/:id" element={<ExerciseDetail />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/session/:id" element={<Session />} />
        <Route path="/settings/templates/:id" element={<TemplateEditor />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
