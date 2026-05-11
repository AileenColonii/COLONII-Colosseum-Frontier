-- Demo users table (simple auth for tech demo)
CREATE TABLE IF NOT EXISTS demo_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  bio text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- Demo memories table (facts Anja remembers about each user)
CREATE TABLE IF NOT EXISTS demo_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES demo_users(id) ON DELETE CASCADE,
  fact text NOT NULL,
  source text DEFAULT 'seed',
  created_at timestamptz DEFAULT now()
);

-- Allow anon/service_role full access (demo, not production)
ALTER TABLE demo_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_memories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS demo_users_all ON demo_users;
DROP POLICY IF EXISTS demo_memories_all ON demo_memories;
CREATE POLICY demo_users_all ON demo_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY demo_memories_all ON demo_memories FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON demo_users TO anon, service_role;
GRANT ALL ON demo_memories TO anon, service_role;
