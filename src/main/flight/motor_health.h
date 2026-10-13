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
 * Motor health (TrueGlide), uses bidirectional DShot RPM telemetry.
 *
 * 1. Telemetry fallback (dshot_telemetry_fallback): Betaflight keeps the last
 *    valid eRPM forever when frames are lost, so the RPM filter and dynamic
 *    idle work on a frozen speed. Here, while a motor's telemetry is stale,
 *    its last valid speed is scaled by how much the other motors sped up or
 *    slowed down since the loss. Replayed on real logs (KarRmen, 400 000
 *    samples): after 60 ms of loss, 90 % of the errors are below 9 % instead
 *    of 21 % with the frozen value.
 *
 * 2. Desync / blocked motor recovery (motor_desync_recovery): a motor
 *    commanded at least MOTOR_HEALTH_MIN_COMMAND that turns slower than
 *    motor_desync_threshold % of the speed expected from the other motors, and
 *    slower than half the slowest other motor, for MOTOR_HEALTH_DETECT_S is cut to idle for MOTOR_HEALTH_CUT_S (the ESC
 *    restarts its commutation), then brought back over MOTOR_HEALTH_RAMP_S.
 *    A desynced or blocked motor gives no thrust anyway; the cut lets the ESC
 *    resync and stops it from burning.
 *
 * Speed source: bidirectional DShot (any ESC with Bluejay, AM32, BLHeli_32...)
 * or, without it, serial ESC telemetry (BLHeli_32, KISS, AM32, DroneCAN
 * ESCs). Serial telemetry reads one ESC at a time, so each motor is updated
 * about every 40 ms: a stalled motor is then detected after
 * MOTOR_HEALTH_DETECT_SERIAL_S instead of MOTOR_HEALTH_DETECT_S. The telemetry
 * fallback (1.) only applies to DShot, which feeds the RPM filter.
 *
 * Both are off by default: nothing changes compared to Betaflight.
 */

#pragma once

#include <stdbool.h>
#include <stdint.h>

#define MOTOR_HEALTH_MAX_MOTORS     8
#define MOTOR_HEALTH_STALE_FRAMES   4       // invalid telemetry frames in a row before the speed is estimated
#define MOTOR_HEALTH_MIN_COMMAND    0.30f   // desync detection only above this command (0..1)
#define MOTOR_HEALTH_MIN_EXPECTED   1500.0f // rpm: below, the speed comparison is meaningless
                                            // (low enough for 10-15" props hovering at 2500-4500 rpm)
#define MOTOR_HEALTH_DETECT_S       0.010f  // time below the threshold before acting (bidirectional DShot)
#define MOTOR_HEALTH_DETECT_SERIAL_S 0.300f // same with serial ESC telemetry (each motor read about every 40 ms)
#define MOTOR_HEALTH_CUT_S          0.050f  // motor held at idle
#define MOTOR_HEALTH_RAMP_S         0.100f  // then brought back linearly
#define MOTOR_HEALTH_OSD_HOLD_MS    3000    // OSD warning shown this long after a restart

typedef struct motorHealthInput_s {
    int count;
    float command[MOTOR_HEALTH_MAX_MOTORS];     // 0..1 between idle and full throttle
    float rpm[MOTOR_HEALTH_MAX_MOTORS];         // measured speed in rpm (compared to MOTOR_HEALTH_MIN_EXPECTED)
    bool fresh[MOTOR_HEALTH_MAX_MOTORS];        // telemetry valid recently
} motorHealthInput_t;

typedef struct motorHealthState_s {
    float slowTimeS[MOTOR_HEALTH_MAX_MOTORS];       // time spent below the threshold
    float recoverLeftS[MOTOR_HEALTH_MAX_MOTORS];    // > 0 while cutting / ramping back
    uint16_t desyncCount[MOTOR_HEALTH_MAX_MOTORS];
} motorHealthState_t;

// Pure logic (unit tested, and replayed on real blackbox logs)
bool motorHealthExpectedRpm(const motorHealthInput_t *in, int motor, float *expected);
void motorHealthStateReset(motorHealthState_t *state);
// Returns, per motor, the scale (0..1) to apply to its command above idle.
void motorHealthDesyncStep(motorHealthState_t *state, const motorHealthInput_t *in, float thresholdPct, float detectS,
                           float dt, float scale[MOTOR_HEALTH_MAX_MOTORS]);

typedef struct motorHealthFallback_s {
    bool holding[MOTOR_HEALTH_MAX_MOTORS];
    float frozen[MOTOR_HEALTH_MAX_MOTORS];          // last valid speed of the motor
    float othersAtLoss[MOTOR_HEALTH_MAX_MOTORS];    // sum of the other motors' speeds when it was lost
} motorHealthFallback_t;

// Speeds to use (out) from the received ones (erpm, stale values for stale motors) and their freshness
void motorHealthFallbackStep(motorHealthFallback_t *fb, const float *erpm, const bool *fresh, int count, float *out);

// Firmware glue
bool motorHealthTelemetryFallbackEnabled(void);
void motorHealthApplyDesyncRecovery(float *motorOutputs, int count, float outputLow, float outputHigh, float dt);
uint16_t motorHealthGetDesyncCount(int motor);
// Last motor restarted (0-based) less than MOTOR_HEALTH_OSD_HOLD_MS ago, or -1 (OSD warning)
int motorHealthRecentRestart(uint32_t nowMs);
