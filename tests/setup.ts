/**
 * Global test setup.
 *
 * The shared logger mirrors every entry to the console, which is exactly right
 * in a browser and pure noise in a test run. It still records everything, so
 * crash-report tests that read the buffer are unaffected.
 */

import { logger } from '../src/core/log.js';

logger.setMirrorToConsole(false);
