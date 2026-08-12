// A single, page-wide ExperimentController instance shared by every screen
// (intake, instructions, and the experiment screens), so they all read/
// write the same session state instead of each creating their own
// controller.

import { ExperimentController } from './experimentController.js';
import { Timer } from '../timer/timer.js';
import { experimentConfig } from '/config/experimentConfig.js';

let controllerInstance = null;

export function getExperimentController() {
    if (!controllerInstance) {
        controllerInstance = new ExperimentController(buildControllerOptions());
    }
    return controllerInstance;
}

// Dev/testing only: ?devSpeedMsPerSecond=<n> on the URL makes each
// simulated second of every phase take <n> real milliseconds instead of
// 1000, so a tester can run the whole ~17-minute protocol in seconds.
// This NEVER changes config/experimentConfig.js - the configured phase
// durations (120s, 90s, 3s, ...) stay exactly as authored; only how fast
// real time is allowed to elapse per simulated second changes. Omitting
// the parameter (the default, and the only mode used in a real session)
// runs at the real 1000ms/second speed.
function buildControllerOptions() {
    const options = { config: experimentConfig };

    const params = new URLSearchParams(window.location.search);
    const devSpeedParam = params.get('devSpeedMsPerSecond');
    if (devSpeedParam == null) {
        return options;
    }

    const msPerSecond = Number(devSpeedParam);
    if (!Number.isFinite(msPerSecond) || msPerSecond <= 0) {
        console.warn(`[EXPERIMENT] Ignoring invalid devSpeedMsPerSecond="${devSpeedParam}"`);
        return options;
    }

    console.warn(
        `[EXPERIMENT] DEV MODE: running at ${msPerSecond}ms per simulated second (real sessions must not use this). ` +
            'config/experimentConfig.js is unmodified.'
    );
    options.timerFactory = (callbacks) => new Timer({ ...callbacks, msPerSecond });
    return options;
}
