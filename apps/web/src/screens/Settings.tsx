import { availableLoads } from "@workout-app/engine";
import {
  DEFAULT_EQUIPMENT,
  type DayAvailability,
  type Equipment,
} from "@workout-app/shared";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { ChipGroup } from "../components/ChipGroup";
import { Skeleton } from "../components/Skeleton";
import { Stepper } from "../components/Stepper";
import {
  readSettings,
  updateSettings,
  type SettingsData,
} from "../settings/settings";
import { ImportUnsynced } from "../UnsyncedData";
import { button, buttonBase, card, input } from "../ui";
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

const toggle = `${buttonBase} min-h-tap bg-surface-raised text-fg aria-pressed:bg-accent aria-pressed:text-bg`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`${card} flex flex-col gap-4`}>
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Subsection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="font-medium">
        {title}
      </h3>
      {children}
    </section>
  );
}

const setEquipment = (change: (e: Equipment) => Partial<Equipment>) =>
  updateSettings((s) => ({
    equipment: { ...s.equipment, ...change(s.equipment) },
  }));

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

function Dumbbells({ settings }: { settings: SettingsData }) {
  const rack = settings.equipment.dumbbells;
  const unit = settings.weightUnit;
  const loads = availableLoads(settings.equipment, "dumbbell");
  const setRack = (change: Partial<NonNullable<Equipment["dumbbells"]>>) =>
    void setEquipment((e) => ({
      dumbbells: e.dumbbells && { ...e.dumbbells, ...change },
    }));
  return (
    <Subsection title="Dumbbells">
      <button
        type="button"
        className={`${toggle} self-start`}
        aria-pressed={rack !== null}
        onClick={() =>
          void setEquipment((e) => ({
            dumbbells: e.dumbbells ? null : DEFAULT_EQUIPMENT.dumbbells,
          }))
        }
      >
        I have dumbbells
      </button>
      {rack && (
        <>
          <div className="grid grid-cols-1 gap-3">
            <Stepper
              label="Lightest dumbbell"
              value={rack.min}
              step={rack.step}
              min={rack.step}
              max={rack.max}
              unit={unit}
              onValueChange={(min) => setRack({ min })}
            />
            <Stepper
              label="Heaviest dumbbell"
              value={rack.max}
              step={rack.step}
              min={rack.min}
              unit={unit}
              onValueChange={(max) => setRack({ max })}
            />
            <Stepper
              label="Dumbbell step"
              value={rack.step}
              step={0.5}
              min={0.5}
              unit={unit}
              onValueChange={(step) => setRack({ step })}
            />
          </div>
          <p className="text-sm text-fg-muted tabular-nums">
            {loads.length} weights: {loads.join(", ")} {unit}
          </p>
        </>
      )}
    </Subsection>
  );
}

function Barbells({ settings }: { settings: SettingsData }) {
  const id = useId();
  const unit = settings.weightUnit;
  const { barbells } = settings.equipment;
  const [draft, setDraft] = useState("");

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const weight = Number(draft.replace(",", "."));
    if (!Number.isFinite(weight) || weight <= 0) return;
    setDraft("");
    void setEquipment((e) => ({
      barbells: [...new Set([...e.barbells, weight])].sort((a, b) => a - b),
    }));
  }

  return (
    <Subsection title="Fixed barbells">
      {barbells.length === 0 ? (
        <p className="text-sm text-fg-muted">None.</p>
      ) : (
        <ul aria-label="Fixed barbells" className="flex flex-wrap gap-2">
          {barbells.map((weight) => (
            <li key={weight}>
              <button
                type="button"
                className={`${button} min-h-tap tabular-nums`}
                aria-label={`Remove ${weight} ${unit} barbell`}
                onClick={() =>
                  void setEquipment((e) => ({
                    barbells: e.barbells.filter((w) => w !== weight),
                  }))
                }
              >
                {weight} {unit}{" "}
                <span aria-hidden="true" className="ml-1">
                  ×
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={onSubmit} className="flex gap-2">
        <label htmlFor={id} className="sr-only">
          Barbell weight ({unit})
        </label>
        <input
          id={id}
          className={`${input} min-h-tap`}
          inputMode="decimal"
          placeholder={`Weight (${unit})`}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <button type="submit" className={`${button} min-h-tap shrink-0`}>
          Add barbell
        </button>
      </form>
    </Subsection>
  );
}

function Bands({ settings }: { settings: SettingsData }) {
  const id = useId();
  const { bands } = settings.equipment;
  const [draft, setDraft] = useState("");

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (!name) return;
    setDraft("");
    void setEquipment((e) =>
      e.bands.includes(name) ? {} : { bands: [...e.bands, name] },
    );
  }

  function move(name: string, by: -1 | 1) {
    void setEquipment((e) => {
      const from = e.bands.indexOf(name);
      const to = from + by;
      if (from < 0 || to < 0 || to >= e.bands.length) return {};
      const next = [...e.bands];
      [next[from], next[to]] = [next[to]!, next[from]!];
      return { bands: next };
    });
  }

  return (
    <Subsection title="Bands">
      <p className="text-sm text-fg-muted">Lightest first.</p>
      {bands.length === 0 ? (
        <p className="text-sm text-fg-muted">None.</p>
      ) : (
        <ol aria-label="Bands" className="flex flex-col gap-2">
          {bands.map((name, i) => (
            <li key={name} className="flex items-center gap-2">
              <span className="flex-1">{name}</span>
              <button
                type="button"
                className={`${button} min-h-tap`}
                aria-label={`Move ${name} lighter`}
                disabled={i === 0}
                onClick={() => move(name, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className={`${button} min-h-tap`}
                aria-label={`Move ${name} heavier`}
                disabled={i === bands.length - 1}
                onClick={() => move(name, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className={`${button} min-h-tap`}
                aria-label={`Remove ${name} band`}
                onClick={() =>
                  void setEquipment((e) => ({
                    bands: e.bands.filter((b) => b !== name),
                  }))
                }
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      )}
      <form onSubmit={onSubmit} className="flex gap-2">
        <label htmlFor={id} className="sr-only">
          Band name
        </label>
        <input
          id={id}
          className={`${input} min-h-tap`}
          placeholder="Band name"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <button type="submit" className={`${button} min-h-tap shrink-0`}>
          Add band
        </button>
      </form>
    </Subsection>
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

function SettingsForm({ settings }: { settings: SettingsData }) {
  return (
    <>
      <Units settings={settings} />
      <Section title="Equipment">
        <Dumbbells settings={settings} />
        <Barbells settings={settings} />
        <Bands settings={settings} />
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
    </>
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
      <ImportUnsynced />
    </Screen>
  );
}
