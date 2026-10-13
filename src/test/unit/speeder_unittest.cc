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

    #include "fc/rc_modes.h"
    #include "fc/runtime_config.h"

    #include "pg/pg.h"
    #include "pg/pg_ids.h"
    #include "pg/speeder.h"

    #include "flight/speeder.h"

    uint8_t armingFlags = 0;
    uint16_t flightModeFlags = 0;
    static bool speederSwitch = false;
    bool IS_RC_MODE_ACTIVE(boxId_e boxId) { return boxId == BOXSPEEDER && speederSwitch; }
}

#include "unittest_macros.h"
#include "gtest/gtest.h"

static const float DT = 0.000125f;     // 8 kHz PID loop

static void runFor(float seconds)
{
    const int n = lrintf(seconds / DT);
    for (int i = 0; i < n; i++) {
        speederUpdate(DT);
    }
}

static void flyAngleArmed(void)
{
    pgResetAll();
    armingFlags = ARMED;
    flightModeFlags = ANGLE_MODE;
    speederSwitch = false;
    runFor(10.0f);              // settle back to 0 whatever the previous test did
}

TEST(SpeederTest, StepOffsetIsRateLimitedAndStopsOnTarget)
{
    EXPECT_FLOAT_EQ(3.0f, speederStepOffset(0.0f, 60.0f, 30.0f, 0.1f));
    EXPECT_FLOAT_EQ(60.0f, speederStepOffset(59.0f, 60.0f, 30.0f, 0.1f));
    EXPECT_FLOAT_EQ(57.0f, speederStepOffset(60.0f, 0.0f, 30.0f, 0.1f));
    EXPECT_FLOAT_EQ(0.0f, speederStepOffset(1.0f, 0.0f, 30.0f, 0.1f));
}

TEST(SpeederTest, MixAtZeroIsIdentityAndAt90SwapsRollAndYaw)
{
    float roll = 100.0f, yaw = 20.0f;
    speederMixRollYaw(0.0f, &roll, &yaw);
    EXPECT_NEAR(100.0f, roll, 0.01f);
    EXPECT_NEAR(20.0f, yaw, 0.01f);

    roll = 100.0f; yaw = 0.0f;
    speederMixRollYaw(90.0f, &roll, &yaw);
    EXPECT_NEAR(0.0f, roll, 0.1f);
    EXPECT_NEAR(100.0f, yaw, 0.1f);
}

TEST(SpeederTest, DefaultsAndNoSwitchMeansNoOffset)
{
    flyAngleArmed();
    EXPECT_EQ(60, speederConfig()->cruise_angle);
    EXPECT_EQ(30, speederConfig()->transition_rate);
    EXPECT_EQ(0, speederConfig()->fpv_mix);
    runFor(5.0f);
    EXPECT_FLOAT_EQ(0.0f, speederGetPitchOffset());
}

TEST(SpeederTest, TransitionRampsToCruiseAndBack)
{
    flyAngleArmed();
    speederSwitch = true;
    runFor(1.0f);
    EXPECT_NEAR(30.0f, speederGetPitchOffset(), 0.1f);       // 30 deg/s
    runFor(2.0f);
    EXPECT_FLOAT_EQ(60.0f, speederGetPitchOffset());         // holds cruise
    speederSwitch = false;
    runFor(1.0f);
    EXPECT_NEAR(30.0f, speederGetPitchOffset(), 0.1f);       // back up to hover
    runFor(1.5f);
    EXPECT_FLOAT_EQ(0.0f, speederGetPitchOffset());
}

TEST(SpeederTest, CruiseAngleNeverAboveMax)
{
    flyAngleArmed();
    speederConfigMutable()->cruise_angle = 200;
    speederConfigMutable()->transition_rate = 180;
    speederSwitch = true;
    runFor(3.0f);
    EXPECT_FLOAT_EQ(SPEEDER_MAX_ANGLE, speederGetPitchOffset());
}

TEST(SpeederTest, OnlyInAngleMode)
{
    flyAngleArmed();
    speederSwitch = true;
    flightModeFlags = HORIZON_MODE;
    runFor(3.0f);
    EXPECT_FLOAT_EQ(0.0f, speederGetPitchOffset());
    flightModeFlags = 0;            // acro
    runFor(3.0f);
    EXPECT_FLOAT_EQ(0.0f, speederGetPitchOffset());
}

TEST(SpeederTest, FailsafeReturnsToHoverProgressively)
{
    flyAngleArmed();
    speederSwitch = true;
    runFor(3.0f);
    flightModeFlags = ANGLE_MODE | FAILSAFE_MODE;
    runFor(1.0f);
    EXPECT_NEAR(30.0f, speederGetPitchOffset(), 0.1f);
}

TEST(SpeederTest, AutopilotModesCancelImmediately)
{
    flyAngleArmed();
    speederSwitch = true;
    runFor(3.0f);
    flightModeFlags = ANGLE_MODE | GPS_RESCUE_MODE;
    speederUpdate(DT);
    EXPECT_FLOAT_EQ(0.0f, speederGetPitchOffset());
}

TEST(SpeederTest, DisarmResets)
{
    flyAngleArmed();
    speederSwitch = true;
    runFor(3.0f);
    armingFlags = 0;
    speederUpdate(DT);
    EXPECT_FLOAT_EQ(0.0f, speederGetPitchOffset());
}

TEST(SpeederTest, FpvMixOnlyWhenEnabled)
{
    flyAngleArmed();
    speederSwitch = true;
    runFor(3.0f);                   // 60 deg

    float roll = 100.0f, yaw = 0.0f;
    speederApplyFpvMix(&roll, &yaw);
    EXPECT_FLOAT_EQ(100.0f, roll);
    EXPECT_FLOAT_EQ(0.0f, yaw);

    speederConfigMutable()->fpv_mix = 1;
    speederApplyFpvMix(&roll, &yaw);
    EXPECT_NEAR(50.0f, roll, 0.1f);     // cos 60
    EXPECT_NEAR(86.6f, yaw, 0.1f);      // sin 60
}
