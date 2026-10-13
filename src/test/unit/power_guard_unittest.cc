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

extern "C" {
    #include "platform.h"

    #include "build/debug.h"

    #include "common/maths.h"

    #include "config/feature.h"

    #include "drivers/dshot.h"

    #include "pg/pg.h"
    #include "pg/pg_ids.h"
    #include "pg/power_guard.h"

    #include "sensors/esc_sensor.h"

    #include "flight/power_guard.h"

    // stubs
    bool useDshotTelemetry = false;
    static int stubEscTemp = 0;
    static int32_t stubAmperage = 0;      // centiamps
    static bool stubAmperageConfigured = true;

    uint8_t getMotorCount(void) { return 4; }
    bool getDshotSensorData(escSensorData_t *dest, int motorIndex)
    {
        dest->temperature = (motorIndex == 2) ? stubEscTemp : stubEscTemp / 2;
        dest->current = 0;
        dest->rpm = 0;
        return true;
    }
    bool featureIsEnabled(uint32_t) { return false; }
    escSensorData_t *getEscSensorData(uint8_t) { return NULL; }
    bool isAmperageConfigured(void) { return stubAmperageConfigured; }
    int32_t getAmperage(void) { return stubAmperage; }
}

#include "unittest_macros.h"
#include "gtest/gtest.h"

static const float DT = 0.01f;

static powerGuardLimits_t limits(uint8_t temp, uint16_t current, float floor = 0.5f)
{
    powerGuardLimits_t l = { temp, current, floor };
    return l;
}

TEST(PowerGuardTest, DisabledNeverCaps)
{
    powerGuardState_t s;
    powerGuardStateReset(&s);
    const powerGuardLimits_t l = limits(0, 0);
    for (int i = 0; i < 1000; i++) {
        powerGuardStep(&s, &l, 150, 400.0f, 1.0f, DT);
    }
    EXPECT_FLOAT_EQ(1.0f, powerGuardStateCap(&s));
}

TEST(PowerGuardTest, UnderTemperatureLimitDoesNothing)
{
    powerGuardState_t s;
    powerGuardStateReset(&s);
    const powerGuardLimits_t l = limits(90, 0);
    for (int i = 0; i < 1000; i++) {
        powerGuardStep(&s, &l, 89, 0.0f, 1.0f, DT);
    }
    EXPECT_FLOAT_EQ(1.0f, powerGuardStateCap(&s));
}

TEST(PowerGuardTest, OverTemperatureStartsFromPilotThrottleAndRampsDown)
{
    powerGuardState_t s;
    powerGuardStateReset(&s);
    const powerGuardLimits_t l = limits(90, 0);

    powerGuardStep(&s, &l, 92, 0.0f, 0.8f, DT);
    // starts at the pilot's throttle, minus one step of decay
    EXPECT_NEAR(0.8f - 0.02f * 3 * DT, powerGuardStateCap(&s), 1e-5f);

    for (int i = 0; i < 100; i++) {        // 1 more second
        powerGuardStep(&s, &l, 92, 0.0f, 0.8f, DT);
    }
    EXPECT_NEAR(0.8f - 0.02f * 3 * 1.01f, powerGuardStateCap(&s), 1e-4f);
}

TEST(PowerGuardTest, NeverBelowFloor)
{
    powerGuardState_t s;
    powerGuardStateReset(&s);
    const powerGuardLimits_t l = limits(60, 20, 0.4f);
    for (int i = 0; i < 100000; i++) {
        powerGuardStep(&s, &l, 140, 300.0f, 0.1f, DT);
        ASSERT_GE(powerGuardStateCap(&s), 0.4f);
    }
    EXPECT_FLOAT_EQ(0.4f, powerGuardStateCap(&s));
}

TEST(PowerGuardTest, TemperatureRecoversOnlyBelowHysteresis)
{
    powerGuardState_t s;
    powerGuardStateReset(&s);
    const powerGuardLimits_t l = limits(90, 0);
    for (int i = 0; i < 1000; i++) {
        powerGuardStep(&s, &l, 95, 0.0f, 1.0f, DT);
    }
    const float capped = powerGuardStateCap(&s);
    EXPECT_LT(capped, 0.9f);

    // 88 C: under the limit but inside the hysteresis band, hold
    for (int i = 0; i < 100; i++) {
        powerGuardStep(&s, &l, 88, 0.0f, 1.0f, DT);
    }
    EXPECT_FLOAT_EQ(capped, powerGuardStateCap(&s));

    // 87 C: give throttle back at 25%/s
    for (int i = 0; i < 100; i++) {
        powerGuardStep(&s, &l, 87, 0.0f, 1.0f, DT);
    }
    EXPECT_NEAR(MIN(capped + 0.25f, 1.0f), powerGuardStateCap(&s), 1e-4f);
}

TEST(PowerGuardTest, LostTelemetryGivesThrottleBack)
{
    powerGuardState_t s;
    powerGuardStateReset(&s);
    const powerGuardLimits_t l = limits(90, 0);
    for (int i = 0; i < 1000; i++) {
        powerGuardStep(&s, &l, 100, 0.0f, 1.0f, DT);
    }
    for (int i = 0; i < 1000; i++) {
        powerGuardStep(&s, &l, 0, 0.0f, 1.0f, DT);
    }
    EXPECT_FLOAT_EQ(1.0f, powerGuardStateCap(&s));
}

TEST(PowerGuardTest, OverCurrentRampsDownAndRecovers)
{
    powerGuardState_t s;
    powerGuardStateReset(&s);
    const powerGuardLimits_t l = limits(0, 100);

    powerGuardStep(&s, &l, 0, 120.0f, 1.0f, DT);         // 20% over: -1.0/s
    EXPECT_NEAR(1.0f - 1.0f * DT, powerGuardStateCap(&s), 1e-5f);

    // 95 A: under the limit but above 90%, hold
    const float held = powerGuardStateCap(&s);
    powerGuardStep(&s, &l, 0, 95.0f, 1.0f, DT);
    EXPECT_FLOAT_EQ(held, powerGuardStateCap(&s));

    for (int i = 0; i < 100; i++) {
        powerGuardStep(&s, &l, 0, 50.0f, 1.0f, DT);
    }
    EXPECT_FLOAT_EQ(1.0f, powerGuardStateCap(&s));
}

TEST(PowerGuardTest, ChoppingThrottleWhileHotDoesNotDropCapToFloor)
{
    powerGuardState_t s;
    powerGuardStateReset(&s);
    const powerGuardLimits_t l = limits(90, 0);
    powerGuardStep(&s, &l, 91, 0.0f, 0.9f, DT);
    const float cap = powerGuardStateCap(&s);
    powerGuardStep(&s, &l, 91, 0.0f, 0.0f, DT);          // flip: throttle chopped
    EXPECT_NEAR(cap - 0.02f * 2 * DT, powerGuardStateCap(&s), 1e-5f);
}

// Closed loop with a simple quad model: current grows with throttle^1.5,
// 200 A at full throttle, 0.05 s current sensor lag. Pilot holds full throttle.
TEST(PowerGuardTest, ClosedLoopCurrentSettlesNearLimit)
{
    powerGuardState_t s;
    powerGuardStateReset(&s);
    const powerGuardLimits_t l = limits(0, 120, 0.3f);
    float current = 0.0f;
    float peak = 0.0f;
    float lastSecondMax = 0.0f;
    for (int i = 0; i < 1000; i++) {                     // 10 s
        const float throttle = MIN(1.0f, powerGuardStateCap(&s));
        const float target = 200.0f * powf(throttle, 1.5f);
        current += (target - current) * DT / (0.05f + DT);
        powerGuardStep(&s, &l, 0, current, 1.0f, DT);
        peak = MAX(peak, current);
        if (i >= 900) {
            lastSecondMax = MAX(lastSecondMax, current);
        }
    }
    EXPECT_LT(peak, 200.0f);
    EXPECT_LT(lastSecondMax, 120.0f * 1.05f);
    EXPECT_GT(lastSecondMax, 120.0f * 0.85f);
}

// Firmware glue

TEST(PowerGuardTest, GlueDisabledByDefault)
{
    pgResetAll();
    EXPECT_FALSE(powerGuardIsEnabled());
    EXPECT_EQ(0, powerGuardConfig()->esc_temp_limit);
    EXPECT_EQ(0, powerGuardConfig()->current_limit);
    EXPECT_EQ(50, powerGuardConfig()->min_throttle);

    stubAmperage = 50000;
    useDshotTelemetry = true;
    stubEscTemp = 140;
    for (timeUs_t t = 0; t < 2000000; t += 125) {
        powerGuardUpdate(t, 1.0f, true);
    }
    EXPECT_FLOAT_EQ(1.0f, powerGuardGetThrottleCap());
}

TEST(PowerGuardTest, GlueUsesHottestEscAndResetsOnDisarm)
{
    pgResetAll();
    powerGuardConfigMutable()->esc_temp_limit = 90;
    useDshotTelemetry = true;
    stubEscTemp = 100;          // motor 3 at 100 C, others 50 C
    stubAmperage = 0;

    timeUs_t t = 0;
    for (; t < 1000000; t += 125) {
        powerGuardUpdate(t, 1.0f, true);
    }
    EXPECT_LT(powerGuardGetThrottleCap(), 0.9f);
    EXPECT_GE(powerGuardGetThrottleCap(), 0.5f);

    powerGuardUpdate(t, 1.0f, false);
    EXPECT_FLOAT_EQ(1.0f, powerGuardGetThrottleCap());
}

TEST(PowerGuardTest, GlueCurrentGuardUsesBatteryCurrent)
{
    pgResetAll();
    powerGuardConfigMutable()->current_limit = 100;
    useDshotTelemetry = false;
    stubAmperage = 15000;       // 150 A

    timeUs_t t = 0;
    for (; t < 200000; t += 125) {
        powerGuardUpdate(t, 1.0f, true);
    }
    EXPECT_LT(powerGuardGetThrottleCap(), 0.6f);

    stubAmperageConfigured = false;     // no current sensor: no current guard
    for (; t < 4000000; t += 125) {
        powerGuardUpdate(t, 1.0f, true);
    }
    EXPECT_FLOAT_EQ(1.0f, powerGuardGetThrottleCap());
    stubAmperageConfigured = true;
}
