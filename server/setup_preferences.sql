CREATE TABLE IF NOT EXISTS user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES demo_users(id) ON DELETE CASCADE,
  notification_days jsonb DEFAULT '["monday","wednesday","friday"]'::jsonb,
  notification_time text DEFAULT '10:00',
  max_notifications_per_day integer DEFAULT 1,
  quiet_until timestamptz,
  haptic_enabled boolean DEFAULT true,
  visual_enabled boolean DEFAULT true,
  sound_enabled boolean DEFAULT true,
  session_time_limit_minutes integer DEFAULT 20,
  preferred_activities jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_preferences_all ON user_preferences;
CREATE POLICY user_preferences_all ON user_preferences FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON user_preferences TO anon, service_role;
