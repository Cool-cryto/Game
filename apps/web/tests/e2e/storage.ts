/**
 * Most tests check the detailed controls, so they start in Advanced mode with the
 * first-time guide already seen. The simple-mode test turns this off for itself.
 */
export const ADVANCED_STORAGE = {
  cookies: [],
  origins: [
    {
      origin: "http://localhost:5173",
      localStorage: [
        { name: "wa.advanced", value: "on" },
        { name: "wa.guideDone", value: "1" },
      ],
    },
  ],
};
