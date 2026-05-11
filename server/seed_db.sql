-- Clear existing demo data
DELETE FROM demo_memories;
DELETE FROM demo_users;

-- Insert demo users
INSERT INTO demo_users (username, password_hash, display_name, bio) VALUES
('aileen', '$2b$12$Nu37uhea7h1dx19iT7ShoOY2XTabsj3dSLnDQIJFXiPI.Rz6J/DrW', 'Aileen', 'Co-founder at COLONII. Creative director. Loves design, branding, and storytelling.'),
('luke', '$2b$12$oH8PL471Z3zQSEiOFEEm2.ipT3V/pp2Dk/wUDhsZam6OrdgXT7h6W', 'Luke', 'Tech lead. Into AI, music production, and building things that matter.'),
('sam', '$2b$12$.7OfXo9dHS6Jc0Lje2m.aeIpVDJxOD5OBPNNAXVlJef4pp5vegNk6', 'Sam', 'Product thinker. Loves strategy, gaming, and finding patterns in chaos.'),
('lollie', '$2b$12$Xh7kjEkwEmlBmPNP3w/x5OCqiHRu2.T03qLUAGMy.P15O5oYCjlru', 'Lollie', 'Dog mom and community builder. Heart of every group she is part of.');

-- Seed memories for Aileen
INSERT INTO demo_memories (user_id, fact, source) VALUES
((SELECT id FROM demo_users WHERE username = 'aileen'), 'Her name is Aileen. She is a co-founder of COLONII.', 'seed'),
((SELECT id FROM demo_users WHERE username = 'aileen'), 'She is the creative director and cares deeply about brand identity and visual storytelling.', 'seed'),
((SELECT id FROM demo_users WHERE username = 'aileen'), 'She loves design systems, mood boards, and typography.', 'seed'),
((SELECT id FROM demo_users WHERE username = 'aileen'), 'She gets excited when talking about how technology can feel more human.', 'seed');

-- Seed memories for Luke
INSERT INTO demo_memories (user_id, fact, source) VALUES
((SELECT id FROM demo_users WHERE username = 'luke'), 'His name is Luke. He is the tech lead at COLONII.', 'seed'),
((SELECT id FROM demo_users WHERE username = 'luke'), 'He is passionate about AI and building real-time voice systems.', 'seed'),
((SELECT id FROM demo_users WHERE username = 'luke'), 'He produces music in his spare time and loves electronic music.', 'seed'),
((SELECT id FROM demo_users WHERE username = 'luke'), 'He values clean architecture and hates over-engineering.', 'seed');

-- Seed memories for Sam
INSERT INTO demo_memories (user_id, fact, source) VALUES
((SELECT id FROM demo_users WHERE username = 'sam'), 'His name is Sam. He is the product strategist.', 'seed'),
((SELECT id FROM demo_users WHERE username = 'sam'), 'He loves gaming, especially strategy and RPG games.', 'seed'),
((SELECT id FROM demo_users WHERE username = 'sam'), 'He is great at seeing the big picture and connecting dots others miss.', 'seed'),
((SELECT id FROM demo_users WHERE username = 'sam'), 'He is curious about behavioral psychology and what motivates people.', 'seed');

-- Seed memories for Lollie
INSERT INTO demo_memories (user_id, fact, source) VALUES
((SELECT id FROM demo_users WHERE username = 'lollie'), 'Her name is Lollie. She is the community heart of the group.', 'seed'),
((SELECT id FROM demo_users WHERE username = 'lollie'), 'She has dogs that she absolutely adores and talks about them often.', 'seed'),
((SELECT id FROM demo_users WHERE username = 'lollie'), 'She is a natural community builder who makes everyone feel welcome.', 'seed'),
((SELECT id FROM demo_users WHERE username = 'lollie'), 'She cares about mental health, wellbeing, and creating safe spaces online.', 'seed');
