/**
 * The version this build is running, and the label that goes with it.
 *
 * Read from `package.json` rather than substituted by Vite's `define`, and that is
 * the whole point: a `define` is expanded when the dev server *starts*, so a server
 * left running since an early version serves that version's number for ever, however
 * many releases are made under it. (V0.5.1 is released against exactly that: a title
 * screen still insisting it was `v0.1.0`.) An import puts `package.json` in the
 * module graph, where changing it is something the server notices.
 */

import { version } from '../../package.json';

/** Semantic version of the build, e.g. `"0.6.0"`. */
export const APP_VERSION: string = typeof version === 'string' ? version : '0.0.0-dev';

/** Human-facing demo label shown on the title/pause screens. */
export const DEMO_LABEL = `v${APP_VERSION}`;
