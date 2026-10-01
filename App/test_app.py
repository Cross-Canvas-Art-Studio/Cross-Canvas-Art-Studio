import os
os.environ['LOG_DIR'] = './data_test/logs'
os.environ['PROJECTS_DIR'] = './data_test/projects'
os.environ['USERS_DB'] = './data_test/users.db'

import unittest
import re
import numpy as np
from App import palette_manager, image_manager, user_manager

class TestCrossCanvas(unittest.TestCase):
    def setUp(self):
        palette_manager._ensure_cache()

    def test_nearest_indices_correctness(self):
        # Test that nearest_indices correctly maps colors
        # Red should map to RED or CHY, White to WHT, etc.
        rgb = np.array([
            [255, 255, 255],  # White
            [255, 0, 0],      # Red
            [0, 255, 0],      # Lime/Green
        ], dtype=np.float64)
        
        indices = palette_manager.nearest_indices(rgb)
        self.assertEqual(len(indices), 3)
        
        # Resolve indices back to codes
        codes = [palette_manager.get_entry(idx)["code"] for idx in indices]
        self.assertIn("WHT", codes)
        self.assertIn("RED", codes)
        self.assertTrue(any(c in ["LIM", "SPR", "KEL"] for c in codes))

    def test_nearest_indices_empty_input(self):
        rgb = np.empty((0, 3), dtype=np.float64)
        indices = palette_manager.nearest_indices(rgb)
        self.assertEqual(len(indices), 0)

    def test_nearest_indices_deduplication(self):
        # Multiple duplicate pixels should map to identical indices
        rgb = np.array([
            [255, 255, 255],
            [255, 255, 255],
            [0, 0, 0],
            [0, 0, 0],
        ], dtype=np.float64)
        indices = palette_manager.nearest_indices(rgb)
        self.assertEqual(indices[0], indices[1])
        self.assertEqual(indices[2], indices[3])
        self.assertNotEqual(indices[0], indices[2])

class TestUserManager(unittest.TestCase):
    def setUp(self):
        self.old_users_db = user_manager.USERS_DB
        user_manager.USERS_DB = "./users_test.db"
        # Start from a clean database. Without this the suite is not
        # repeatable: a leftover file makes the second run fail with
        # "Username already exists".
        self._remove_db()
        user_manager.init_db()

    @staticmethod
    def _remove_db():
        for suffix in ("", "-shm", "-wal"):
            path = "./users_test.db" + suffix
            if os.path.exists(path):
                try:
                    os.remove(path)
                except Exception:
                    pass

    def test_create_guest_user_optimized(self):
        guest = user_manager.create_guest_user()
        self.assertTrue(guest["is_guest"])
        self.assertEqual(guest["role"], "guest")
        
        # Verify the saved hash starts with '!!unusable-'
        row = user_manager.get_user_by_id(guest["user_id"])
        self.assertIsNotNone(row)
        self.assertTrue(row["password_hash"].startswith("!!unusable-"))
        
        # Verify verify_password rejects it cleanly
        self.assertFalse(user_manager.verify_password("any_password", row["password_hash"]))

    def test_create_user_passwordless_optimized(self):
        user = user_manager.create_user_passwordless("test_passkey_user")
        self.assertEqual(user["role"], "user")
        
        # Verify the saved hash starts with '!!unusable-'
        row = user_manager.get_user_by_id(user["user_id"])
        self.assertIsNotNone(row)
        self.assertTrue(row["password_hash"].startswith("!!unusable-"))
        
        # Verify verify_password rejects it cleanly
        self.assertFalse(user_manager.verify_password("any_password", row["password_hash"]))

class TestConfigInvariants(unittest.TestCase):
    """Guards against the silent, user-visible bugs fixed in the Tier 1 work."""

    def _read(self, *parts):
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), *parts)
        with open(path, encoding='utf-8') as fh:
            return fh.read()

    def test_grid_ceiling_matches_project_store(self):
        # A 501-1000 chart used to be drawable (config.json said max_size 1000)
        # but rejected by the store (MAX_GRID_SIZE was 500) — the user could
        # paint a chart that then silently refused to save.
        import json
        from App import project_manager
        cfg = json.loads(self._read('config.json'))
        self.assertEqual(cfg['grid']['max_size'], project_manager.MAX_GRID_SIZE)
        self.assertEqual(cfg['grid']['min_size'], 5)

    def test_frontend_grid_inputs_match_backend_cap(self):
        from App import project_manager
        html = self._read('templates', 'index.html')
        cap = project_manager.MAX_GRID_SIZE
        self.assertIn('id="gridWidth" min="5" max="%d"' % cap, html)
        self.assertIn('id="gridHeight" min="5" max="%d"' % cap, html)

    def test_static_adapter_grid_cap_matches_backend(self):
        from App import project_manager
        js = self._read('static', 'static-adapter.js')
        self.assertIn('max_size: %d' % project_manager.MAX_GRID_SIZE, js)

    def test_grid_ceiling_is_enforced_consistently(self):
        # The original bug: config.json allowed 1000 while the store capped at
        # 500, so a 501-999 chart was drawable in the UI but refused to save.
        # The ceiling is 500 everywhere now, so the store must accept exactly
        # the cap and reject anything past it, matching what the UI permits.
        from App import project_manager
        cap = project_manager.MAX_GRID_SIZE

        clean, width, height = project_manager._sanitize_grid([[0] for _ in range(cap)])
        self.assertEqual(height, cap)
        self.assertEqual(width, 1)
        self.assertEqual(len(clean), cap)

        with self.assertRaises(ValueError):
            project_manager._sanitize_grid([[0] for _ in range(cap + 1)])
        with self.assertRaises(ValueError):
            project_manager._sanitize_grid([[0] * (cap + 1)])

    def test_every_palette_entry_has_a_distinct_symbol(self):
        from App import palette_manager
        palette = palette_manager.get_palette()
        symbols = [e['symbol'] for e in palette]
        self.assertEqual(len(symbols), len(set(symbols)),
                         'every palette entry needs its own glyph')
        self.assertTrue(all(0 <= s < palette_manager.SYMBOL_COUNT for s in symbols))

    def test_symbol_count_matches_frontend_glyph_table(self):
        # If the palette grows past the glyph table, entries wrap onto duplicate
        # glyphs and two colours become indistinguishable in a greyscale print.
        from App import palette_manager
        js = self._read('static', 'symbols.js')
        glyphs = re.findall(r'^\s{4}\[(?:L|C|D|P)\(', js, flags=re.M)
        self.assertEqual(len(glyphs), palette_manager.SYMBOL_COUNT,
                         'SYMBOL_COUNT in palette_manager.py must match symbols.js')
        self.assertGreaterEqual(palette_manager.SYMBOL_COUNT,
                                palette_manager.palette_size())


class TestSecurityApp(unittest.TestCase):
    def setUp(self):
        from App.app import app
        app.config['TESTING'] = True
        self.client = app.test_client()

    def test_require_auth_endpoints(self):
        import App.app as app_mod
        # Store original states
        orig_require_auth = app_mod.REQUIRE_AUTH
        orig_allow_auth = app_mod.ALLOW_AUTH
        
        try:
            # Enable auth requirement
            app_mod.REQUIRE_AUTH = True
            app_mod.ALLOW_AUTH = True
            
            # GET /api/projects/abc -> 401
            r = self.client.get('/api/projects/abc')
            self.assertEqual(r.status_code, 401)
            
            # PUT /api/projects/abc -> 401
            r = self.client.put('/api/projects/abc', json={})
            self.assertEqual(r.status_code, 401)
            
            # DELETE /api/projects/abc -> 401
            r = self.client.delete('/api/projects/abc')
            self.assertEqual(r.status_code, 401)
            
        finally:
            app_mod.REQUIRE_AUTH = orig_require_auth
            app_mod.ALLOW_AUTH = orig_allow_auth

if __name__ == "__main__":
    unittest.main()
