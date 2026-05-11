-- Beta invite codes table
CREATE TABLE IF NOT EXISTS beta_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  used_by uuid,
  used_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE beta_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS beta_invites_read ON beta_invites;
CREATE POLICY beta_invites_read ON beta_invites FOR SELECT USING (true);
DROP POLICY IF EXISTS beta_invites_update ON beta_invites;
CREATE POLICY beta_invites_update ON beta_invites FOR UPDATE USING (used_by IS NULL);
GRANT SELECT, UPDATE ON beta_invites TO anon, authenticated, service_role;

-- User profiles for real auth users (separate from demo_users)
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  email text UNIQUE,
  bio text DEFAULT '',
  avatar_url text,
  onboarded boolean DEFAULT false,
  password_hash text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_profiles_all ON user_profiles;
CREATE POLICY user_profiles_all ON user_profiles FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON user_profiles TO anon, authenticated, service_role;

-- Remove FK constraints so these tables work with both demo_users and user_profiles
ALTER TABLE demo_memories DROP CONSTRAINT IF EXISTS demo_memories_user_id_fkey;
ALTER TABLE user_preferences DROP CONSTRAINT IF EXISTS user_preferences_user_id_fkey;
ALTER TABLE demo_sessions DROP CONSTRAINT IF EXISTS demo_sessions_user_id_fkey;

-- Generate 50 beta invite codes
INSERT INTO beta_invites (code)
SELECT 'COLONII-' || upper(substr(md5(random()::text), 1, 6))
FROM generate_series(1, 50)
ON CONFLICT (code) DO NOTHING;
