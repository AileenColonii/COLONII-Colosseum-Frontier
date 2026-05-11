-- Session analytics table (tracks every conversation for engagement insights)
CREATE TABLE IF NOT EXISTS demo_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES demo_users(id) ON DELETE SET NULL,
  model text NOT NULL DEFAULT 'groq',
  is_guest boolean NOT NULL DEFAULT true,
  total_turns integer NOT NULL DEFAULT 0,
  user_turns integer NOT NULL DEFAULT 0,
  duration_seconds integer,
  sentiment_score integer CHECK (sentiment_score BETWEEN 1 AND 5),
  sentiment_label text,
  engagement_level text,
  topics jsonb DEFAULT '[]'::jsonb,
  conversation_summary text,
  user_reaction text,
  created_at timestamptz DEFAULT now()
);

-- Allow service_role full access (demo, not production)
ALTER TABLE demo_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS demo_sessions_all ON demo_sessions;
CREATE POLICY demo_sessions_all ON demo_sessions FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON demo_sessions TO anon, service_role;

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_demo_sessions_created ON demo_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demo_sessions_sentiment ON demo_sessions(sentiment_score);
