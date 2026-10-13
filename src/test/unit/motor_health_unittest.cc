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

extern "C" {
    #include "flight/motor_health.h"
}

#include "unittest_macros.h"
#include "gtest/gtest.h"

static const float DT = 0.00025f;   // 4 kHz PID loop

static motorHealthInput_t quad(float c1, float c2, float c3, float c4, float r1, float r2, float r3, float r4)
{
    motorHealthInput_t in = {};
    in.count = 4;
    const float c[4] = { c1, c2, c3, c4 }, r[4] = { r1, r2, r3, r4 };
    for (int i = 0; i < 4; i++) {
        in.command[i] = c[i];
        in.rpm[i] = r[i];
        in.fresh[i] = true;
    }
    return in;
}

static int runFor(motorHealthState_t *s, const motorHealthInput_t *in, float seconds, float scale[MOTOR_HEALTH_MAX_MOTORS])
{
    int n = (int)(seconds / DT + 0.5f);
    for (int k = 0; k < n; k++) {
        motorHealthDesyncStep(s, in, 40.0f, MOTOR_HEALTH_DETECT_S, DT, scale);
    }
    return n;
}

TEST(MotorHealthTest, ExpectedRpmFromOtherMotors)
{
    const motorHealthInput_t in = quad(0.5f, 0.5f, 0.5f, 0.5f, 20000, 0, 20000, 20000);
    float e;
    ASSERT_TRUE(motorHealthExpectedRpm(&in, 1, &e));
    EXPECT_FLOAT_EQ(20000.0f, e);
}

TEST(MotorHealthTest, NeedsTwoFreshOtherMotors)
{
    motorHealthInput_t in = quad(0.5f, 0.5f, 0.5f, 0.5f, 20000, 0, 20000, 20000);
    in.fresh[0] = false;
    in.fresh[2] = false;
    float e;
    EXPECT_FALSE(motorHealthExpectedRpm(&in, 1, &e));
}

TEST(MotorHealthTest, HealthyQuadNeverCut)
{
    motorHealthState_t s;
    motorHealthStateReset(&s);
    float scale[MOTOR_HEALTH_MAX_MOTORS];
    // hard roll: commands very different, speeds follow
    const motorHealthInput_t in = quad(0.9f, 0.3f, 0.9f, 0.3f, 40000, 18000, 39000, 17500);
    runFor(&s, &in, 2.0f, scale);
    for (int i = 0; i < 4; i++) {
        EXPECT_EQ(0, s.desyncCount[i]);
        EXPECT_FLOAT_EQ(1.0f, scale[i]);
    }
}

TEST(MotorHealthTest, StalledMotorIsCutThenRampedBack)
{
    motorHealthState_t s;
    motorHealthStateReset(&s);
    float scale[MOTOR_HEALTH_MAX_MOTORS];
    // motor 2 commanded 100 % but nearly stopped (as in the KarRmen logs)
    const motorHealthInput_t stalled = quad(0.15f, 1.0f, 0.15f, 0.15f, 11000, 250, 11400, 10900);

    runFor(&s, &stalled, 0.009f, scale);
    EXPECT_FLOAT_EQ(1.0f, scale[1]);        // not yet: less than 10 ms
    runFor(&s, &stalled, 0.002f, scale);
    EXPECT_EQ(1, s.desyncCount[1]);
    EXPECT_FLOAT_EQ(0.0f, scale[1]);        // cut to idle

    const motorHealthInput_t ok = quad(0.5f, 0.5f, 0.5f, 0.5f, 20000, 20000, 20000, 20000);
    runFor(&s, &ok, 0.045f, scale);
    EXPECT_FLOAT_EQ(0.0f, scale[1]);        // still held during the 50 ms cut
    runFor(&s, &ok, 0.055f, scale);
    EXPECT_GT(scale[1], 0.4f);              // ramping back
    EXPECT_LT(scale[1], 0.6f);
    runFor(&s, &ok, 0.06f, scale);
    EXPECT_FLOAT_EQ(1.0f, scale[1]);        // back to normal
    for (int i : { 0, 2, 3 }) {
        EXPECT_EQ(0, s.desyncCount[i]);
    }
}

TEST(MotorHealthTest, StaleTelemetryNeverTriggers)
{
    motorHealthState_t s;
    motorHealthStateReset(&s);
    float scale[MOTOR_HEALTH_MAX_MOTORS];
    motorHealthInput_t in = quad(0.15f, 1.0f, 0.15f, 0.15f, 11000, 250, 11400, 10900);
    in.fresh[1] = false;
    runFor(&s, &in, 1.0f, scale);
    EXPECT_EQ(0, s.desyncCount[1]);
}

TEST(MotorHealthTest, LowCommandIgnored)
{
    motorHealthState_t s;
    motorHealthStateReset(&s);
    float scale[MOTOR_HEALTH_MAX_MOTORS];
    // around idle the speed comparison is meaningless
    const motorHealthInput_t in = quad(0.1f, 0.2f, 0.1f, 0.1f, 4000, 500, 4000, 4000);
    runFor(&s, &in, 1.0f, scale);
    EXPECT_EQ(0, s.desyncCount[1]);
}

TEST(MotorHealthTest, MuchHigherCommandButFasterThanSlowestOtherIsNotADesync)
{
    motorHealthState_t s;
    motorHealthStateReset(&s);
    float scale[MOTOR_HEALTH_MAX_MOTORS];
    // linear extrapolation would expect 72 000 rpm; the motor turns faster than the others: healthy
    const motorHealthInput_t in = quad(0.1f, 0.02f, 0.77f, 0.1f, 9700, 340, 17500, 8900);
    runFor(&s, &in, 1.0f, scale);
    EXPECT_EQ(0, s.desyncCount[2]);
}

TEST(MotorHealthTest, BlockedMotorRetriesPeriodically)
{
    motorHealthState_t s;
    motorHealthStateReset(&s);
    float scale[MOTOR_HEALTH_MAX_MOTORS];
    const motorHealthInput_t stalled = quad(0.3f, 0.9f, 0.3f, 0.3f, 15000, 200, 15000, 15000);
    runFor(&s, &stalled, 1.0f, scale);
    // cycle = 10 ms detection + 150 ms recovery: about 6 retries per second, never stuck at full power
    EXPECT_GE(s.desyncCount[1], 5);
    EXPECT_LE(s.desyncCount[1], 7);
}

TEST(MotorHealthTest, FallbackKeepsFreshValuesUnchanged)
{
    motorHealthFallback_t fb = {};
    const float erpm[4] = { 1000, 1100, 1200, 1300 };
    const bool fresh[4] = { true, true, true, true };
    float out[4];
    motorHealthFallbackStep(&fb, erpm, fresh, 4, out);
    for (int i = 0; i < 4; i++) {
        EXPECT_FLOAT_EQ(erpm[i], out[i]);
    }
}

TEST(MotorHealthTest, FallbackFollowsTheOtherMotors)
{
    motorHealthFallback_t fb = {};
    float out[4];
    bool fresh[4] = { true, false, true, true };
    // telemetry of motor 2 lost at 1100: the driver keeps returning 1100
    const float atLoss[4] = { 1000, 1100, 1200, 1300 };
    motorHealthFallbackStep(&fb, atLoss, fresh, 4, out);
    EXPECT_FLOAT_EQ(1100.0f, out[1]);
    // throttle punch: the other motors speed up by 50 %
    const float later[4] = { 1500, 1100, 1800, 1950 };
    motorHealthFallbackStep(&fb, later, fresh, 4, out);
    EXPECT_NEAR(1650.0f, out[1], 0.5f);
    // telemetry back: real value used again
    fresh[1] = true;
    const float back[4] = { 1500, 1700, 1800, 1950 };
    motorHealthFallbackStep(&fb, back, fresh, 4, out);
    EXPECT_FLOAT_EQ(1700.0f, out[1]);
}

TEST(MotorHealthTest, FallbackRatioIsBounded)
{
    motorHealthFallback_t fb = {};
    float out[4];
    const bool fresh[4] = { true, false, true, true };
    const float atLoss[4] = { 1000, 1000, 1000, 1000 };
    motorHealthFallbackStep(&fb, atLoss, fresh, 4, out);
    const float huge[4] = { 9000, 1000, 9000, 9000 };
    motorHealthFallbackStep(&fb, huge, fresh, 4, out);
    EXPECT_FLOAT_EQ(2000.0f, out[1]);
    const float tiny[4] = { 10, 1000, 10, 10 };
    motorHealthFallbackStep(&fb, tiny, fresh, 4, out);
    EXPECT_FLOAT_EQ(500.0f, out[1]);
}

TEST(MotorHealthTest, SerialTelemetryNeedsALongerStall)
{
    motorHealthState_t s;
    motorHealthStateReset(&s);
    float scale[MOTOR_HEALTH_MAX_MOTORS];
    // serial ESC telemetry (BLHeli_32, KISS...): each motor read about every 40 ms
    const motorHealthInput_t stalled = quad(0.15f, 1.0f, 0.15f, 0.15f, 11000, 250, 11400, 10900);
    for (int k = 0; k < (int)(0.25f / DT); k++) {
        motorHealthDesyncStep(&s, &stalled, 40.0f, MOTOR_HEALTH_DETECT_SERIAL_S, DT, scale);
    }
    EXPECT_EQ(0, s.desyncCount[1]);         // 250 ms: not yet
    for (int k = 0; k < (int)(0.06f / DT); k++) {
        motorHealthDesyncStep(&s, &stalled, 40.0f, MOTOR_HEALTH_DETECT_SERIAL_S, DT, scale);
    }
    EXPECT_EQ(1, s.desyncCount[1]);         // after 300 ms: cut
}

TEST(MotorHealthTest, BigPropStalledMotorIsDetected)
{
    motorHealthState_t s;
    motorHealthStateReset(&s);
    float scale[MOTOR_HEALTH_MAX_MOTORS];
    // 10-15" props hover around 2500-4500 rpm: a stall must still be seen (expected about 3700 rpm here)
    const motorHealthInput_t stalled = quad(0.35f, 0.4f, 0.35f, 0.35f, 3300, 150, 3200, 3250);
    runFor(&s, &stalled, 0.011f, scale);
    EXPECT_EQ(1, s.desyncCount[1]);
    EXPECT_FLOAT_EQ(0.0f, scale[1]);
}

TEST(MotorHealthTest, BigPropHealthyNeverCut)
{
    motorHealthState_t s;
    motorHealthStateReset(&s);
    float scale[MOTOR_HEALTH_MAX_MOTORS];
    // hard roll on a big drone: commands very different, speeds follow (slowly spinning props)
    const motorHealthInput_t in = quad(0.8f, 0.3f, 0.8f, 0.3f, 6200, 2600, 6100, 2500);
    runFor(&s, &in, 2.0f, scale);
    for (int i = 0; i < 4; i++) {
        EXPECT_EQ(0, s.desyncCount[i]);
    }
}

TEST(MotorHealthTest, VerySlowExpectedSpeedIgnored)
{
    motorHealthState_t s;
    motorHealthStateReset(&s);
    float scale[MOTOR_HEALTH_MAX_MOTORS];
    // expected below MOTOR_HEALTH_MIN_EXPECTED (about 1300 rpm): the comparison is not trusted
    const motorHealthInput_t in = quad(0.3f, 0.3f, 0.3f, 0.3f, 1300, 100, 1300, 1300);
    runFor(&s, &in, 1.0f, scale);
    EXPECT_EQ(0, s.desyncCount[1]);
}
