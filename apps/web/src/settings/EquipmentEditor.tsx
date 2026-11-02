import { availableLoads } from "@workout-app/engine";
import { DEFAULT_EQUIPMENT, type Equipment } from "@workout-app/shared";
import { useId, useState, type FormEvent } from "react";
import { Stepper } from "../components/Stepper";
import { button, input, toggle } from "../ui";
import { Subsection } from "./Sections";
import { updateSettings, type SettingsData } from "./settings";

const setEquipment = (change: (e: Equipment) => Partial<Equipment>) =>
  updateSettings((s) => ({
    equipment: { ...s.equipment, ...change(s.equipment) },
  }));

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

/** Dumbbells, fixed barbells and bands; every edit saves at once. */
export function EquipmentEditor({ settings }: { settings: SettingsData }) {
  return (
    <>
      <Dumbbells settings={settings} />
      <Barbells settings={settings} />
      <Bands settings={settings} />
    </>
  );
}
