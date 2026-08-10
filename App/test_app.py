import os
os.environ['LOG_DIR'] = './data_test/logs'
os.environ['PROJECTS_DIR'] = './data_test/projects'
os.environ['USERS_DB'] = './data_test/users.db'

import unittest
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
        user_manager.init_db()

    def tearDown(self):
        user_manager.USERS_DB = self.old_users_db
        if os.path.exists("./users_test.db"):
            try:
                os.remove("./users_test.db")
            except Exception:
                pass
        if os.path.exists("./users_test.db-shm"):
            try:
                os.remove("./users_test.db-shm")
            except Exception:
                pass
        if os.path.exists("./users_test.db-wal"):
            try:
                os.remove("./users_test.db-wal")
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
