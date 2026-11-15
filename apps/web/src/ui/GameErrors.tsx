import { useEffect, useState } from "react";
import { useGame } from "../state/gameStore";
import { useOnline } from "../net/online";

/** Shows a rejected command briefly, so problems are never silent. */
export function GameErrors() {
  const [visible, setVisible] = useState<string | null>(null);
  const errors = useGame((s) => s.errors);
  // Online, the server reports problems (e.g. "Only the host can change the game speed").
  const onlineError = useOnline((s) => (s.room ? s.error : null));
  useEffect(() => {
    if (!onlineError) return;
    setVisible(onlineError);
    const t = setTimeout(() => setVisible(null), 4000);
    useOnline.getState().setError(null);
    return () => clearTimeout(t);
  }, [onlineError]);
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
