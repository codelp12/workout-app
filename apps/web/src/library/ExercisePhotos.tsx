import type { Exercise } from "@workout-app/shared";
import { ExerciseImage } from "./ExerciseImage";

export function ExercisePhotos({ exercise }: { exercise: Exercise }) {
  const images = exercise.media.filter((m) => m.kind === "image");
  if (images.length === 0) return null;
  const credit = images[0]!;
  return (
    <figure className="flex flex-col gap-1">
      <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto">
        {images.map((m, i) => (
          <ExerciseImage
            key={m.path}
            path={m.path}
            alt={`${exercise.name}, photo ${i + 1} of ${images.length}`}
            className="aspect-[4/3] w-full shrink-0 snap-center"
          />
        ))}
      </div>
      <figcaption className="text-xs text-fg-muted">
        Photos: {credit.source.split("@")[0]}, {credit.license}
      </figcaption>
    </figure>
  );
}
