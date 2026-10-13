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

#pragma once

#include <stdint.h>

#include "pg/pg.h"

// TrueGlide telemetry options (all off by default: the telemetry stream is unchanged)
typedef struct tfTelemetryConfig_s {
    uint8_t crsf_esc_temp;      // OFF / ON: send the ESC temperatures to the radio (CRSF temperature frame, every 2 s)
} tfTelemetryConfig_t;

PG_DECLARE(tfTelemetryConfig_t, tfTelemetryConfig);
