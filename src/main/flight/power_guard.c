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
#include <stdint.h>

#include "platform.h"

#ifdef USE_POWER_GUARD

#include "build/debug.h"

#include "common/maths.h"

#include "config/feature.h"

#include "drivers/dshot.h"
#include "drivers/motor.h"

#include "flight/mixer.h"

#include "pg/motor.h"
#include "pg/power_guard.h"

#include "sensors/battery.h"
#include "sensors/esc_sensor.h"

#include "power_guard.h"

static powerGuardState_t guardState = { .tempCap = 1.0f, .currentCap = 1.0f };
static timeUs_t lastUpdateUs;

void powerGuardStateReset(powerGuardState_t *state)
{
    state->tempCap = 1.0f;
    state->currentCap = 1.0f;
    state->tempOver = false;
    state->currentOver = false;
}

float powerGuardStateCap(const powerGuardState_t *state)
{
    return MIN(state->tempCap, state->currentCap);
}

// When a limit is first crossed, start the cap from the throttle the pilot is
// using, otherwise the cap would have to ramp down from 100% before having any
// effect. Never start below the floor.
static float startCap(float cap, float throttle, float floor)
{
    return MIN(cap, MAX(throttle, floor));
}

void powerGuardStep(powerGuardState_t *state, const powerGuardLimits_t *limits,
                    int escTempC, float currentA, float throttle, float dt)
{
    const float floor = constrainf(limits->minThrottle, 0.0f, 1.0f);

    // ESC temperature (0 = no telemetry: give throttle back)
    if (limits->escTempLimitC > 0 && escTempC > 0 && escTempC >= limits->escTempLimitC) {
        if (!state->tempOver) {
            state->tempCap = startCap(state->tempCap, throttle, floor);
            state->tempOver = true;
        }
        const float degreesOver = escTempC - limits->escTempLimitC;
        state->tempCap -= POWER_GUARD_TEMP_DECAY_PER_S * (degreesOver + 1.0f) * dt;
    } else {
        state->tempOver = false;
        if (limits->escTempLimitC == 0 || escTempC <= 0
            || escTempC <= limits->escTempLimitC - POWER_GUARD_TEMP_HYSTERESIS_C) {
            state->tempCap += POWER_GUARD_RECOVERY_PER_S * dt;
        }
    }

    // Battery current
    if (limits->currentLimitA > 0 && currentA > limits->currentLimitA) {
        if (!state->currentOver) {
            state->currentCap = startCap(state->currentCap, throttle, floor);
            state->currentOver = true;
        }
        const float relativeOver = (currentA - limits->currentLimitA) / limits->currentLimitA;
        state->currentCap -= POWER_GUARD_CURRENT_DECAY_PER_S * relativeOver * dt;
    } else {
        state->currentOver = false;
        if (limits->currentLimitA == 0 || currentA <= limits->currentLimitA * POWER_GUARD_CURRENT_HYSTERESIS) {
            state->currentCap += POWER_GUARD_RECOVERY_PER_S * dt;
        }
    }

    state->tempCap = constrainf(state->tempCap, floor, 1.0f);
    state->currentCap = constrainf(state->currentCap, floor, 1.0f);
}

bool powerGuardIsEnabled(void)
{
    return powerGuardConfig()->esc_temp_limit > 0 || powerGuardConfig()->current_limit > 0;
}

// Hottest ESC, from DShot extended telemetry and/or serial ESC telemetry. 0 = unknown.
static int getHottestEscTemperature(void)
{
    int hottest = 0;

#ifdef USE_DSHOT_TELEMETRY
    if (useDshotTelemetry) {
        for (int i = 0; i < getMotorCount(); i++) {
            escSensorData_t data;
            if (getDshotSensorData(&data, i)) {
                hottest = MAX(hottest, data.temperature);
            }
        }
    }
#endif

#ifdef USE_ESC_SENSOR
    if (featureIsEnabled(FEATURE_ESC_SENSOR)) {
        const escSensorData_t *data = getEscSensorData(ESC_SENSOR_COMBINED);
        if (data) {
            hottest = MAX(hottest, data->temperature);
        }
    }
#endif

    return hottest;
}

void powerGuardUpdate(timeUs_t currentTimeUs, float throttle, bool armed)
{
    if (!armed || !powerGuardIsEnabled()) {
        powerGuardStateReset(&guardState);
        lastUpdateUs = currentTimeUs;
        return;
    }

    const timeDelta_t elapsedUs = cmpTimeUs(currentTimeUs, lastUpdateUs);
    if (elapsedUs < 0) {
        lastUpdateUs = currentTimeUs;   // clock went back (should not happen): restart the interval
        return;
    }
    if (elapsedUs < POWER_GUARD_UPDATE_INTERVAL_US) {
        return;
    }
    lastUpdateUs = currentTimeUs;

    // a long gap (first run, scheduler stall) must not cause a big step
    const float dt = MIN(elapsedUs, 10 * POWER_GUARD_UPDATE_INTERVAL_US) * 1e-6f;

    const powerGuardLimits_t limits = {
        .escTempLimitC = powerGuardConfig()->esc_temp_limit,
        .currentLimitA = powerGuardConfig()->current_limit,
        .minThrottle = powerGuardConfig()->min_throttle / 100.0f,
    };
    const int escTempC = getHottestEscTemperature();
    const float currentA = isAmperageConfigured() ? getAmperage() / 100.0f : 0.0f;

    powerGuardStep(&guardState, &limits, escTempC, currentA, throttle, dt);

    DEBUG_SET(DEBUG_POWER_GUARD, 0, lrintf(powerGuardStateCap(&guardState) * 1000));
    DEBUG_SET(DEBUG_POWER_GUARD, 1, lrintf(guardState.tempCap * 1000));
    DEBUG_SET(DEBUG_POWER_GUARD, 2, lrintf(guardState.currentCap * 1000));
    DEBUG_SET(DEBUG_POWER_GUARD, 3, escTempC);
    DEBUG_SET(DEBUG_POWER_GUARD, 4, lrintf(currentA * 10));
}

float powerGuardGetThrottleCap(void)
{
    return powerGuardStateCap(&guardState);
}

powerGuardLimitReason_e powerGuardGetLimitReason(void)
{
    if (powerGuardStateCap(&guardState) >= 0.99f) {
        return POWER_GUARD_LIMIT_NONE;
    }
    return guardState.tempCap <= guardState.currentCap ? POWER_GUARD_LIMIT_TEMPERATURE : POWER_GUARD_LIMIT_CURRENT;
}

#endif // USE_POWER_GUARD
