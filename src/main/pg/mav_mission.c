/*
 * This file is part of TrueGlide (derived from Betaflight).
 *
 * TrueGlide is free software. You can redistribute this software
 * and/or modify this software under the terms of the GNU General
 * Public License as published by the Free Software Foundation,
 * either version 3 of the License, or (at your option) any later
 * version.
 *
 * TrueGlide is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 *
 * See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public
 * License along with this software.
 *
 * If not, see <http://www.gnu.org/licenses/>.
 */

#include "platform.h"

#if ENABLE_TELEMETRY_MAVLINK_MISSION

#include "pg/pg.h"
#include "pg/pg_ids.h"

#include "mav_mission.h"

// TRUENAV models target Mission Planner: home item ON. Elsewhere (SITL, unit tests) the Betaflight behaviour is kept.
#if defined(TRUEGLIDE_NAV)
#define MAV_MISSION_HOME_ITEM_DEFAULT 1
#else
#define MAV_MISSION_HOME_ITEM_DEFAULT 0
#endif

PG_REGISTER_WITH_RESET_TEMPLATE(mavMissionConfig_t, mavMissionConfig, PG_MAV_MISSION_CONFIG, 0);

PG_RESET_TEMPLATE(mavMissionConfig_t, mavMissionConfig,
    .home_item = MAV_MISSION_HOME_ITEM_DEFAULT,
);

#endif // ENABLE_TELEMETRY_MAVLINK_MISSION
