import type { DayAvailability } from "@workout-app/shared";
import { Link } from "react-router";
import { ChipGroup } from "../components/ChipGroup";
import { Skeleton } from "../components/Skeleton";
import { EquipmentEditor } from "../settings/EquipmentEditor";
import { Section, Subsection } from "../settings/Sections";
import {
  readSettings,
  updateSettings,
  type SettingsData,
} from "../settings/settings";
import { liftTemplates } from "../templates/templates";
import { ImportUnsynced } from "../UnsyncedData";
import { useAppUpdate, type UpdateStatus } from "../update/update-context";
import { button, buttonBase, toggle } from "../ui";
import { useLiveQuery } from "../use-live-query";
import { Screen } from "./Screen";

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const dayOptions = [
  { value: "auto", label: "Any" },
  ...WEEKDAYS.map((day, i) => ({
    value: String(i + 1),
    label: day.slice(0, 3),
  })),
];

function Units({ settings }: { settings: SettingsData }) {
  return (
    <Section title="Units">
      <ChipGroup
        type="single"
        label="Weight unit"
        options={[
          { value: "lb", label: "lb" },
          { value: "kg", label: "kg" },
        ]}
        value={settings.weightUnit}
        onValueChange={(weightUnit) =>
          void updateSettings(() => ({ weightUnit }))
        }
      />
      <p className="text-sm text-fg-muted">
        Equipment weights are in {settings.weightUnit}; switching units doesn't
        convert them.
      </p>
      <ChipGroup
        type="single"
        label="Distance unit"
        options={[
          { value: "mi", label: "Miles" },
          { value: "km", label: "Kilometers" },
        ]}
        value={settings.distanceUnit}
        onValueChange={(distanceUnit) =>
          void updateSettings(() => ({ distanceUnit }))
        }
      />
    </Section>
  );
}

function Availability({ settings }: { settings: SettingsData }) {
  const byDay = new Map(settings.availability.map((d) => [d.weekday, d]));
  const slots = [
    ["am", "AM"],
    ["pm", "PM"],
    ["gym", "Gym"],
  ] as const;

  function flip(weekday: number, slot: (typeof slots)[number][0]) {
    void updateSettings((s) => {
      const days = new Map(s.availability.map((d) => [d.weekday, d]));
      const day: DayAvailability = days.get(weekday) ?? {
        weekday,
        am: false,
        pm: false,
        gym: false,
      };
      days.set(weekday, { ...day, [slot]: !day[slot] });
      return {
        availability: [...days.values()].sort((a, b) => a.weekday - b.weekday),
      };
    });
  }

  return (
    <Subsection title="Weekly availability">
      <p className="text-sm text-fg-muted">
        When you can train, and which days you can get to the gym.
      </p>
      <div
        role="list"
        aria-label="Weekly availability"
        className="flex flex-col gap-2"
      >
        {WEEKDAYS.map((name, i) => {
          const weekday = i + 1;
          const day = byDay.get(weekday);
          return (
            <div
              key={name}
              role="listitem"
              className="grid grid-cols-[1fr_repeat(3,4rem)] items-center gap-2"
            >
              <span>{name}</span>
              {slots.map(([slot, label]) => (
                <button
                  key={slot}
                  type="button"
                  className={toggle}
                  aria-pressed={day?.[slot] ?? false}
                  aria-label={`${name} ${label}`}
                  onClick={() => flip(weekday, slot)}
                >
                  {label}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </Subsection>
  );
}

function DayPreference({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number | null;
  onChange: (day: number | null) => void;
}) {
  return (
    <Subsection title={label}>
      <p className="text-sm text-fg-muted">{hint}</p>
      <ChipGroup
        type="single"
        label={label}
        options={dayOptions}
        value={value === null ? "auto" : String(value)}
        onValueChange={(v) => onChange(v === "auto" ? null : Number(v))}
      />
    </Subsection>
  );
}

function Templates() {
  const templates = useLiveQuery(liftTemplates, null);
  return (
    <Section title="Lifting templates">
      {templates === null ? (
        <Skeleton className="h-24" />
      ) : templates.length === 0 ? (
        <p className="text-sm text-fg-muted">
          The default templates arrive with your first sync.
        </p>
      ) : (
        <ul aria-label="Lifting templates" className="flex flex-col gap-2">
          {templates.map((t) => (
            <li key={t.id}>
              <Link
                to={`/settings/templates/${t.id}`}
                className={`${button} min-h-tap w-full justify-between`}
              >
                <span>{t.name}</span>
                <span className="text-sm text-fg-muted">
                  {t.slots.length}{" "}
                  {t.slots.length === 1 ? "exercise" : "exercises"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function SettingsForm({ settings }: { settings: SettingsData }) {
  return (
    <>
      <Units settings={settings} />
      <Section title="Equipment">
        <EquipmentEditor settings={settings} />
      </Section>
      <Section title="Schedule">
        <Availability settings={settings} />
        <DayPreference
          label="Lift-free day"
          hint="Any lets the planner choose."
          value={settings.liftFreeDay}
          onChange={(liftFreeDay) =>
            void updateSettings(() => ({ liftFreeDay }))
          }
        />
        <DayPreference
          label="Long-run day"
          hint="Any lets the planner choose."
          value={settings.longRunDay}
          onChange={(longRunDay) => void updateSettings(() => ({ longRunDay }))}
        />
        <p className="text-sm text-fg-muted">Time zone: {settings.timezone}</p>
      </Section>
      <Templates />
      <Section title="Setup">
        <p className="text-sm text-fg-muted">
          {settings.onboarding
            ? "Update your working weights, recent run and climbing grades."
            : "Tell the coach your working weights, a recent run and your climbing grades."}
        </p>
        <Link to="/onboarding" className={`${button} min-h-tap self-start`}>
          {settings.onboarding ? "Run setup again" : "Start setup"}
        </Link>
      </Section>
    </>
  );
}

const updateMessages: Record<UpdateStatus, string> = {
  unsupported: "Updates aren't available in this browser.",
  idle: "Updates download in the background.",
  checking: "Checking for updates…",
  current: "You're on the latest version.",
  available: "An update is ready. Reloading won't lose anything you've saved.",
  failed: "Couldn't check for updates. Try again when you're online.",
};

function AppUpdates() {
  const { status, check, install } = useAppUpdate();
  return (
    <Section title="App updates">
      <p role="status" className="text-sm text-fg-muted">
        {updateMessages[status]}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`${button} min-h-tap`}
          disabled={status === "unsupported" || status === "checking"}
          onClick={check}
        >
          Check for updates
        </button>
        <button
          type="button"
          className={`${buttonBase} min-h-tap bg-accent text-bg`}
          disabled={status !== "available"}
          onClick={install}
        >
          Reload to update
        </button>
      </div>
    </Section>
  );
}

export function Settings() {
  const settings = useLiveQuery(readSettings, null);
  return (
    <Screen title="Settings">
      {settings ? (
        <SettingsForm settings={settings} />
      ) : (
        <Skeleton className="h-96" />
      )}
      <AppUpdates />
      <ImportUnsynced />
    </Screen>
  );
}
