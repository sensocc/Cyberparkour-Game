/** Injected by Vite (`define`) from package.json. */
declare const __APP_VERSION__: string;

/** Semantic version of the build, e.g. `"0.0.0"`. */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';

/** Human-facing demo label shown on the title/pause screens. */
export const DEMO_LABEL = `Technical Demo v${APP_VERSION}`;
