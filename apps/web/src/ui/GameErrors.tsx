import { useEffect, useState } from "react";
import { useGame } from "../state/gameStore";

/** Shows a rejected command briefly, so problems are never silent. */
export function GameErrors() {
  const errors = useGame((s) => s.errors);
  const [visible, setVisible] = useState<string | null>(null);
  useEffect(() => {
    if (!errors.length) return;
    setVisible(errors[errors.length - 1]!);
    const t = setTimeout(() => setVisible(null), 4000);
    return () => clearTimeout(t);
  }, [errors]);
  return visible ? (
    <div className="toast" role="alert">
      {visible}
    </div>
  ) : null;
}
