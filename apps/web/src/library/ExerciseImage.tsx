import { useState } from "react";
import { exerciseImageUrl } from "./filter";

/**
 * An exercise photo on a placeholder box. If it can't load (offline and not
 * cached yet), the box stays empty instead of showing a broken image.
 */
export function ExerciseImage({
  path,
  alt,
  className,
}: {
  path: string;
  alt: string;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={`overflow-hidden rounded-md bg-surface-raised ${className}`}
    >
      {!failed && (
        <img
          src={exerciseImageUrl(path)}
          alt={alt}
          loading="lazy"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
