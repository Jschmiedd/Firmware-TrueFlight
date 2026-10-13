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

#include <stdbool.h>
#include <stdint.h>
#include <math.h>

#ifndef MOTOR_HEALTH_PURE
#include "platform.h"
#endif

#if defined(USE_MOTOR_HEALTH) || defined(MOTOR_HEALTH_PURE)

#include "motor_health.h"

// ---------------------------------------------------------------------------
// Pure logic: no hardware access. MOTOR_HEALTH_PURE builds only this part
// (used to replay real blackbox logs, see trueglide/outils).
// ---------------------------------------------------------------------------

// Speed expected for one motor from the motors with fresh telemetry, scaled by
// the ratio of the commands (speed roughly proportional to command).
bool motorHealthExpectedRpm(const motorHealthInput_t *in, int motor, float *expected)
{
    float rpmSum = 0.0f, cmdSum = 0.0f;
    int n = 0;
    for (int i = 0; i < in->count; i++) {
        if (i != motor && in->fresh[i] && in->command[i] > 0.05f) {
            rpmSum += in->rpm[i];
            cmdSum += in->command[i];
            n++;
        }
    }
    if (n < 2 || cmdSum <= 0.0f) {
        return false;
    }
    *expected = rpmSum * in->command[motor] / cmdSum;
    return true;
}

static float motorHealthSlowestOtherRpm(const motorHealthInput_t *in, int motor)
{
    float slowest = 1e9f;
    for (int i = 0; i < in->count; i++) {
        if (i != motor && in->fresh[i] && in->command[i] > 0.05f && in->rpm[i] < slowest) {
            slowest = in->rpm[i];
        }
    }
    return slowest;
}

void motorHealthFallbackStep(motorHealthFallback_t *fb, const float *erpm, const bool *fresh, int count, float *out)
{
    float total = 0.0f;
    for (int i = 0; i < count; i++) {
        total += erpm[i];
    }
    for (int i = 0; i < count; i++) {
        const float others = total - erpm[i];
        out[i] = erpm[i];
        if (fresh[i]) {
            fb->holding[i] = false;
            continue;
        }
        if (!fb->holding[i]) {
            fb->holding[i] = true;
            fb->frozen[i] = erpm[i];
            fb->othersAtLoss[i] = others;
        }
        if (fb->othersAtLoss[i] > 0.0f) {
            const float ratio = others / fb->othersAtLoss[i];
            out[i] = fb->frozen[i] * (ratio < 0.5f ? 0.5f : (ratio > 2.0f ? 2.0f : ratio));
        }
    }
}

void motorHealthStateReset(motorHealthState_t *state)
{
    for (int i = 0; i < MOTOR_HEALTH_MAX_MOTORS; i++) {
        state->slowTimeS[i] = 0.0f;
        state->recoverLeftS[i] = 0.0f;
        state->desyncCount[i] = 0;
    }
}

void motorHealthDesyncStep(motorHealthState_t *state, const motorHealthInput_t *in, float thresholdPct, float detectS,
                           float dt, float scale[MOTOR_HEALTH_MAX_MOTORS])
{
    for (int i = 0; i < in->count; i++) {
        scale[i] = 1.0f;

        if (state->recoverLeftS[i] > 0.0f) {
            state->recoverLeftS[i] -= dt;
            const float left = state->recoverLeftS[i];
            if (left > MOTOR_HEALTH_RAMP_S) {
                scale[i] = 0.0f;                                    // held at idle
            } else if (left > 0.0f) {
                scale[i] = 1.0f - left / MOTOR_HEALTH_RAMP_S;       // ramp back
            } else {
                state->recoverLeftS[i] = 0.0f;
            }
            state->slowTimeS[i] = 0.0f;
            continue;
        }

        // slow: below the threshold of the expected speed AND below half the slowest other motor
        // (the second test avoids false alarms when the commands are very different, e.g. in a crash)
        float expected;
        const bool slow = in->fresh[i] && in->command[i] >= MOTOR_HEALTH_MIN_COMMAND
            && motorHealthExpectedRpm(in, i, &expected) && expected >= MOTOR_HEALTH_MIN_EXPECTED
            && in->rpm[i] < expected * thresholdPct / 100.0f
            && in->rpm[i] < 0.5f * motorHealthSlowestOtherRpm(in, i);

        state->slowTimeS[i] = slow ? state->slowTimeS[i] + dt : 0.0f;
        if (state->slowTimeS[i] >= detectS) {
            state->recoverLeftS[i] = MOTOR_HEALTH_CUT_S + MOTOR_HEALTH_RAMP_S;
            state->slowTimeS[i] = 0.0f;
            if (state->desyncCount[i] < UINT16_MAX) {
                state->desyncCount[i]++;
            }
            scale[i] = 0.0f;
        }
    }
}

#ifndef MOTOR_HEALTH_PURE
// ---------------------------------------------------------------------------
// Firmware glue
// ---------------------------------------------------------------------------

#include "build/debug.h"

#include "common/maths.h"

#include "config/feature.h"

#include "drivers/dshot.h"
#include "drivers/time.h"

#include "fc/runtime_config.h"

#include "flight/mixer.h"

#include "pg/motor_health.h"

#include "sensors/esc_sensor.h"

static motorHealthState_t desyncState;
static float lastCommand[MOTOR_HEALTH_MAX_MOTORS];
static int lastRestartMotor = -1;
static uint32_t lastRestartMs;

bool motorHealthTelemetryFallbackEnabled(void)
{
    return motorHealthConfig()->telemetry_fallback;
}


void motorHealthApplyDesyncRecovery(float *motorOutputs, int count, float outputLow, float outputHigh, float dt)
{
    count = MIN(count, MOTOR_HEALTH_MAX_MOTORS);
    const float range = outputHigh - outputLow;
    for (int i = 0; i < count; i++) {
        lastCommand[i] = range > 0.0f ? constrainf((motorOutputs[i] - outputLow) / range, 0.0f, 1.0f) : 0.0f;
    }

    // speed source: bidirectional DShot, else serial ESC telemetry
    bool dshotSource = false;
#ifdef USE_DSHOT_TELEMETRY
    dshotSource = useDshotTelemetry;
#endif
    bool serialSource = false;
#ifdef USE_ESC_SENSOR
    serialSource = !dshotSource && featureIsEnabled(FEATURE_ESC_SENSOR);
#endif

    if (!motorHealthConfig()->desync_recovery || !ARMING_FLAG(ARMED) || !(dshotSource || serialSource)) {
        for (int i = 0; i < MOTOR_HEALTH_MAX_MOTORS; i++) {
            desyncState.slowTimeS[i] = 0.0f;
            desyncState.recoverLeftS[i] = 0.0f;
        }
        return;
    }

    motorHealthInput_t in = { .count = count };
    for (int i = 0; i < count; i++) {
        in.command[i] = lastCommand[i];
#ifdef USE_DSHOT_TELEMETRY
        if (dshotSource) {
            in.rpm[i] = getDshotRpm(i);
            in.fresh[i] = isDshotMotorTelemetryFresh(i);
        }
#endif
#ifdef USE_ESC_SENSOR
        if (serialSource) {
            const escSensorData_t *esc = getEscSensorData(i);
            in.rpm[i] = esc ? erpmToRpm(esc->rpm) : 0.0f;  // esc->rpm is in 100 eRPM, like DShot: same unit
            in.fresh[i] = esc && esc->dataAge == 0;
        }
#endif
    }
    uint16_t countBefore[MOTOR_HEALTH_MAX_MOTORS];
    for (int i = 0; i < count; i++) {
        countBefore[i] = desyncState.desyncCount[i];
    }
    float scale[MOTOR_HEALTH_MAX_MOTORS];
    motorHealthDesyncStep(&desyncState, &in, motorHealthConfig()->desync_threshold,
                          dshotSource ? MOTOR_HEALTH_DETECT_S : MOTOR_HEALTH_DETECT_SERIAL_S, dt, scale);
    for (int i = 0; i < count; i++) {
        if (desyncState.desyncCount[i] != countBefore[i]) {
            lastRestartMotor = i;
            lastRestartMs = millis();
        }
        if (scale[i] < 1.0f) {
            motorOutputs[i] = outputLow + (motorOutputs[i] - outputLow) * scale[i];
        }
        if (i < DEBUG16_VALUE_COUNT) {
            DEBUG_SET(DEBUG_MOTOR_HEALTH, i, desyncState.desyncCount[i]);   // up to 8 motors (X8)
        }
    }
}

uint16_t motorHealthGetDesyncCount(int motor)
{
    return (motor >= 0 && motor < MOTOR_HEALTH_MAX_MOTORS) ? desyncState.desyncCount[motor] : 0;
}

int motorHealthRecentRestart(uint32_t nowMs)
{
    return (lastRestartMotor >= 0 && nowMs - lastRestartMs < MOTOR_HEALTH_OSD_HOLD_MS) ? lastRestartMotor : -1;
}
#endif // !MOTOR_HEALTH_PURE

#endif // USE_MOTOR_HEALTH || MOTOR_HEALTH_PURE
