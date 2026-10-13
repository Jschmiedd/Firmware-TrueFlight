/*
 * This file is part of Cleanflight and Betaflight.
 *
 * Cleanflight and Betaflight are free software. You can redistribute
 * this software and/or modify this software under the terms of the
 * GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * Cleanflight and Betaflight are distributed in the hope that they
 * will be useful, but WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this software.
 *
 * If not, see <http://www.gnu.org/licenses/>.
 */

#include <math.h>
#include <stdbool.h>

#include "platform.h"

#ifdef USE_SPEEDER

#include "build/debug.h"

#include "common/maths.h"

#include "fc/rc_modes.h"
#include "fc/runtime_config.h"

#include "pg/speeder.h"

#include "speeder.h"

static float pitchOffset;

float speederStepOffset(float offset, float target, float ratePerS, float dT)
{
    const float step = ratePerS * dT;
    if (offset < target) {
        return MIN(offset + step, target);
    }
    return MAX(offset - step, target);
}

void speederMixRollYaw(float angleDeg, float *roll, float *yaw)
{
    float sinFactor, cosFactor;
    sincosf_approx(DEGREES_TO_RADIANS(angleDeg), &sinFactor, &cosFactor);
    const float r = *roll;
    const float y = *yaw;
    *roll = r * cosFactor - y * sinFactor;
    *yaw = y * cosFactor + r * sinFactor;
}

// Autopilot modes command their own angles: no transition offset at all
static bool autopilotOwnsAttitude(void)
{
    return FLIGHT_MODE(GPS_RESCUE_MODE | ALT_HOLD_MODE | POS_HOLD_MODE);
}

bool speederIsEngaged(void)
{
    return IS_RC_MODE_ACTIVE(BOXSPEEDER) && ARMING_FLAG(ARMED)
        && FLIGHT_MODE(ANGLE_MODE) && !FLIGHT_MODE(FAILSAFE_MODE) && !autopilotOwnsAttitude();
}

void speederUpdate(float dT)
{
    if (!ARMING_FLAG(ARMED) || autopilotOwnsAttitude()) {
        pitchOffset = 0.0f;
    } else {
        const float cruise = MIN(speederConfig()->cruise_angle, SPEEDER_MAX_ANGLE);
        const float target = speederIsEngaged() ? cruise : 0.0f;
        pitchOffset = speederStepOffset(pitchOffset, target, speederConfig()->transition_rate, dT);
    }
    DEBUG_SET(DEBUG_ANGLE_MODE, 4, lrintf(pitchOffset * 10.0f));
}

float speederGetPitchOffset(void)
{
    // only meaningful in ANGLE mode: horizon and acro never get the offset
    return FLIGHT_MODE(ANGLE_MODE) ? pitchOffset : 0.0f;
}

void speederApplyFpvMix(float *roll, float *yaw)
{
    if (speederConfig()->fpv_mix && pitchOffset > 0.0f && FLIGHT_MODE(ANGLE_MODE)) {
        speederMixRollYaw(pitchOffset, roll, yaw);
    }
}

#endif // USE_SPEEDER
