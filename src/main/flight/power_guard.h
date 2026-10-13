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

/*
 * Power guard (TrueGlide).
 *
 * Caps the collective throttle when the hottest ESC goes over a temperature
 * limit or when the battery current goes over a current limit, so that the
 * motors and ESCs are not burnt by a long full throttle punch or a stuck prop.
 *
 * Disabled by default: with both limits set to 0 the mixer output is exactly
 * the same as Betaflight's.
 *
 * Only the collective throttle is capped, never the PID corrections, and the
 * cap never goes below power_guard_min_throttle, so the quad always keeps
 * enough authority to hover and stay under control.
 */

#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "common/time.h"

#define POWER_GUARD_UPDATE_INTERVAL_US      10000   // 100 Hz
#define POWER_GUARD_TEMP_HYSTERESIS_C       3       // degrees below the limit before giving throttle back
#define POWER_GUARD_CURRENT_HYSTERESIS      0.9f    // fraction of the limit before giving throttle back
#define POWER_GUARD_TEMP_DECAY_PER_S        0.02f   // cap reduction per second, per degree over the limit (+1)
#define POWER_GUARD_CURRENT_DECAY_PER_S     5.0f    // cap reduction per second, per unit of relative over-current
#define POWER_GUARD_RECOVERY_PER_S          0.25f   // cap increase per second once back under the limit

typedef struct powerGuardLimits_s {
    uint8_t escTempLimitC;      // 0 = temperature guard off
    uint16_t currentLimitA;     // 0 = current guard off
    float minThrottle;          // lowest cap, 0..1
} powerGuardLimits_t;

typedef struct powerGuardState_s {
    float tempCap;              // 0..1
    float currentCap;           // 0..1
    bool tempOver;
    bool currentOver;
} powerGuardState_t;

// Pure logic, no hardware access (unit tested)
void powerGuardStateReset(powerGuardState_t *state);
void powerGuardStep(powerGuardState_t *state, const powerGuardLimits_t *limits,
                    int escTempC, float currentA, float throttle, float dt);
float powerGuardStateCap(const powerGuardState_t *state);

// Firmware glue
bool powerGuardIsEnabled(void);
void powerGuardUpdate(timeUs_t currentTimeUs, float throttle, bool armed);
float powerGuardGetThrottleCap(void);

typedef enum {
    POWER_GUARD_LIMIT_NONE = 0,
    POWER_GUARD_LIMIT_TEMPERATURE,  // ESC too hot
    POWER_GUARD_LIMIT_CURRENT,      // battery current over the limit
} powerGuardLimitReason_e;

// What currently limits the throttle (the lowest cap), for the OSD warning
powerGuardLimitReason_e powerGuardGetLimitReason(void);
