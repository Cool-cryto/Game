/**
 * Most tests start as a returning player: the
 * first-time guide and start screen already seen. The top-navigation test turns this off for itself.
 */
export const RETURNING_PLAYER = {
  cookies: [],
  origins: [
    {
      origin: "http://localhost:5173",
      localStorage: [
        { name: "wa.guideDone", value: "1" },
      ],
    },
  ],
};
