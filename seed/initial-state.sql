-- Fresh Perlis state; initializes empty databases only.
INSERT INTO competition_state (id,version,state) VALUES (1,1,$perlis${"version":1,"bouts":{},"audit":[],"extraBouts":[],"extraAthletes":[],"extraPoomsaeEntries":[],"schedule":{},"pins":{},"awards":{},"poomsae":{}}$perlis$::jsonb) ON CONFLICT (id) DO NOTHING;
